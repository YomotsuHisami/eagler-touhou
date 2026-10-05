import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {setTimeout as sleep} from 'node:timers/promises';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import test from 'node:test';
import {WebSocket} from 'ws';

const root=resolve(import.meta.dirname,'..');
async function until(check,message){
  const deadline=Date.now()+5000;
  while(!check()){assert(Date.now()<deadline,message);await sleep(10);}
}
async function service(t){
  const port=await new Promise((done,reject)=>{const p=createServer();p.once('error',reject);
    p.listen(0,'127.0.0.1',()=>{const value=p.address().port;p.close(error=>error?reject(error):done(value));});});
  const child=spawn(process.execPath,['server/netplay-relay.mjs'],{cwd:root,windowsHide:true,
    env:{...process.env,EAGLER_NETPLAY_RELAY_HOST:'127.0.0.1',EAGLER_NETPLAY_RELAY_PORT:String(port),EAGLER_NETPLAY_STUN_URLS:'',EAGLER_NETPLAY_RTC_TIMEOUT_MS:'1000'},
    stdio:['ignore','pipe','pipe']});
  let log='';child.stdout.on('data',b=>{log+=b;});child.stderr.on('data',b=>{log+=b;});
  const sockets=[];t.after(()=>{for(const value of sockets)value.socket.close();child.kill();});
  await until(()=>{assert.equal(child.exitCode,null,log);return log.includes('relay listening');},'relay failed to listen');
  async function open(query){
    const socket=new WebSocket('ws://127.0.0.1:'+port+'/?'+new URLSearchParams(query));
    const value={socket,messages:[],errors:[],opened:false,closed:null};sockets.push(value);
    socket.once('open',()=>{value.opened=true;});
    socket.once('close',(code,reason)=>{value.closed={code,reason:String(reason)};});
    socket.on('message',(bytes,binary)=>{if(!binary)value.messages.push(JSON.parse(String(bytes)));});
    socket.on('error',error=>value.errors.push(String(error)));
    // A deliberately rejected peer can complete the WebSocket upgrade and
    // close before this polling interval; retain the event, not just its state.
    await until(()=>value.opened,'WebSocket did not open: '+log);
    return value;
  }
  return {open};
}
const send=(client,message)=>client.socket.send(JSON.stringify(message));
const roomOf=client=>client.messages.filter(message=>message.room).at(-1)?.room;

test('relay endpoint exit closes the gameplay run, preserves seats/lobby and permits a new run',async t=>{
  const {open}=await service(t),room='th07mp-lifecycle-'+randomUUID().slice(0,8);
  const lobby=[await open({room,lobby:'lifecycle_client_0'}),await open({room,lobby:'lifecycle_client_1'})];
  for(let seat=0;seat<2;++seat){
    send(lobby[seat],{type:'take-seat',seat,loadout:0,ready:false});
    await until(()=>roomOf(lobby[seat])?.seats[seat]?.clientId==='lifecycle_client_'+seat,'seat was not retained');
  }
  for(const client of lobby)send(client,{type:'set-ready',ready:true});
  await until(()=>roomOf(lobby[0])?.seats.slice(0,2).every(seat=>seat?.ready),'players not ready');
  send(lobby[0],{type:'start'});
  await until(()=>lobby[0].messages.some(message=>message.type==='start'),'run did not start');
  const first=lobby[0].messages.findLast(message=>message.type==='start').serial;
  const peers=[await open({room,run:first,player:0,players:2}),await open({room,run:first,player:1,players:2})];
  await until(()=>peers.every(peer=>peer.messages.some(message=>message.type==='route'&&message.mode==='relay')),'relay route not selected');
  peers[0].socket.close(1000,'native runtime exit');
  await until(()=>peers[1].socket.readyState===WebSocket.CLOSED,'other endpoint was stranded in the old run');
  await until(()=>roomOf(lobby[0])?.phase==='lobby','room did not return to lobby');
  for(let seat=0;seat<2;++seat){
    assert.equal(lobby[seat].socket.readyState,WebSocket.OPEN);
    const occupied=roomOf(lobby[0]).seats[seat];
    assert.equal(occupied.clientId,'lifecycle_client_'+seat);assert.equal(occupied.ready,false);
    assert.equal(occupied.offline,false);
    send(lobby[seat],{type:'set-ready',ready:true});
  }
  await until(()=>roomOf(lobby[0]).seats.slice(0,2).every(seat=>seat?.ready),'new run readiness failed');
  send(lobby[0],{type:'start'});
  await until(()=>lobby[0].messages.some(message=>message.type==='start'&&message.serial>first),'new run did not start');
});

test('RTC selection can retire unused relay sockets without killing signaling or the active run',async t=>{
  const {open}=await service(t),room='rtc-lifecycle-'+randomUUID().slice(0,8);
  const signals=[await open({room,run:'1',player:0,players:2,signal:1}),await open({room,run:'1',player:1,players:2,signal:1})];
  const relays=[await open({room,run:'1',player:0,players:2}),await open({room,run:'1',player:1,players:2})];
  for(const peer of signals)send(peer,{type:'rtc-ready'});
  await until(()=>signals.every(peer=>peer.messages.some(message=>message.type==='route'&&message.mode==='rtc')),'RTC route not selected');
  for(const peer of relays)peer.socket.close(1000,'RTC route selected');
  await until(()=>relays.every(peer=>peer.socket.readyState===WebSocket.CLOSED),'unused relay sockets not closed');
  send(signals[0],{type:'ice-restart-request',to:1});
  await until(()=>signals[1].messages.some(message=>message.type==='ice-restart-request'&&message.from===0),'active signaling was incorrectly closed');
  assert(signals.every(peer=>peer.socket.readyState===WebSocket.OPEN));
});

test('all-signaling-unavailable rooms still resolve the relay barrier and reject mixed player counts',async t=>{
  const {open}=await service(t),room='relay-only-'+randomUUID().slice(0,8);
  const peers=[await open({room,run:'1',player:0,players:2}),await open({room,run:'1',player:1,players:2})];
  await until(()=>peers.every(peer=>peer.messages.some(message=>message.type==='route'&&message.mode==='relay')),'relay-only barrier depended on signaling');
  const invalid=await open({room,run:'1',player:2,players:3});
  await until(()=>invalid.socket.readyState===WebSocket.CLOSED,'mixed player-count peer was admitted');
  assert.equal(invalid.closed.code,1008);
  assert.match(invalid.closed.reason,/player count mismatch/);
  assert(peers.every(peer=>peer.socket.readyState===WebSocket.OPEN));
});
