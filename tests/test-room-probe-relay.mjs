import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { WebSocket } from 'ws';
const port=await new Promise(resolve=>{const server=net.createServer();server.listen(0,'127.0.0.1',()=>{const p=server.address().port;server.close(()=>resolve(p));});});
const relay=spawn(process.execPath,['server/netplay-relay.mjs'],{env:{...process.env,EAGLER_NETPLAY_RELAY_HOST:'127.0.0.1',EAGLER_NETPLAY_RELAY_PORT:String(port),EAGLER_NETPLAY_STUN_URLS:''},stdio:['ignore','pipe','pipe']});
const clients=[];
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function connect(id,room='th07mp-roomprobe') {
  const socket=new WebSocket(`ws://127.0.0.1:${port}/?room=${room}&lobby=${id}&member=m_${id}`);
  const messages=[];socket.on('message',data=>messages.push(JSON.parse(String(data))));
  const client={socket,messages,send:value=>socket.send(JSON.stringify(value))};clients.push(client);
  await until(()=>messages.some(m=>m.type==='state'));
  assert.ok(messages[0].roomProbe,'capability must extend the initial state, not insert a protocol message');
  return client;
}
async function until(check) { const end=Date.now()+4000;while(!check()){if(Date.now()>end)throw new Error('relay expectation timed out');await delay(10);} }
async function seat(client,index) {client.send({type:'take-seat',seat:index,loadout:0,name:`Player${index}`});await until(()=>client.messages.some(m=>m.room?.seats[index]?.name===`Player${index}`));}
try {
  await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error('relay start timeout')),5000);relay.stdout.on('data',data=>{if(String(data).includes('listening')){clearTimeout(timeout);resolve();}});relay.once('exit',()=>reject(new Error('relay exited')));});
  const a=await connect('client_alpha'), b=await connect('client_beta'), spectator=await connect('client_watcher'), outsider=await connect('client_outsider','th07mp-otherprobe');
  await seat(a,0);await seat(b,1);spectator.send({type:'spectate',name:'Watcher'});await until(()=>a.messages.some(m=>m.room?.spectators?.length));
  const state=a.messages.filter(m=>m.type==='state').at(-1).room;
  const probe={type:'room-probe',to:'client_beta',from:'spoof',lane:'relay',echo:'ping:7'};
  a.send(probe);await until(()=>b.messages.some(m=>m.type==='room-probe'));
  assert.deepEqual(b.messages.find(m=>m.type==='room-probe'),{type:'room-probe',from:'client_alpha',lane:'relay',echo:'ping:7'});
  assert.ok(!spectator.messages.some(m=>m.type==='room-probe'),'probes are not broadcast to spectators');
  b.messages.length=0; spectator.send(probe);outsider.send(probe);a.send({...probe,to:'client_outsider'});await delay(100);
  assert.ok(!b.messages.some(m=>m.type==='room-probe'),'unseated/cross-room senders cannot signal');
  assert.ok(!outsider.messages.some(m=>m.type==='room-probe'));
  a.send({type:'room-probe',to:'client_beta',lane:'direct',token:'session-1',restart:true});
  await until(()=>b.messages.some(m=>m.restart));
  assert.deepEqual(a.messages.filter(m=>m.type==='state').at(-1).room,state,'diagnostics do not mutate seats, settings, ready or phase');
  const latest=()=>a.messages.filter(m=>m.type==='state').at(-1).room;
  b.send({type:'resource-progress',status:'preparing',stage:'package',percent:42.6});
  await until(()=>latest().seats[1]?.resource?.percent===43);
  assert.deepEqual(latest().seats[1].resource,{status:'preparing',stage:'package',percent:43});
  b.send({type:'resource-progress',status:'preparing',stage:'runtime',percent:101});
  spectator.send({type:'resource-progress',status:'ready',stage:'package',percent:100});
  await delay(100);
  assert.equal(latest().seats[1].resource.percent,43,'invalid progress and unseated senders cannot change player progress');
  b.send({type:'resource-progress',status:'ready',stage:'runtime',percent:null});
  await until(()=>latest().seats[1]?.resource?.status==='ready');
  assert.equal(latest().seats[1].resource.percent,100);
  b.send({type:'set-ready',ready:true});
  await until(()=>latest().seats[1]?.ready);
  b.send({type:'remove-player',seat:0,clientId:'client_alpha'});
  a.send({type:'remove-player',seat:1,clientId:'stale_client'});
  a.send({type:'remove-player',seat:1,clientId:'client_outsider'});
  spectator.send({type:'remove-player',seat:1,clientId:'client_beta'});
  b.send({type:'remove-spectator',clientId:'client_watcher'});
  await delay(100);
  assert.equal(latest().seats[1]?.clientId,'client_beta','non-host, stale and cross-room removals cannot evict a player');
  assert.equal(spectator.socket.readyState,WebSocket.OPEN);
  const playerClosed=new Promise(resolve=>b.socket.once('close',code=>resolve(code)));
  a.send({type:'remove-player',seat:1,clientId:'client_beta'});
  assert.equal(await playerClosed,4010);
  await until(()=>latest().seats[1]===null);
  assert.equal(latest().seats[0].ready,false,'membership changes invalidate readiness');
  const spectatorClosed=new Promise(resolve=>spectator.socket.once('close',code=>resolve(code)));
  a.send({type:'remove-spectator',clientId:'client_watcher'});
  assert.equal(await spectatorClosed,4010);
  await until(()=>latest().spectators.length===0);
  a.send({type:'stand-up'});await until(()=>a.messages.filter(m=>m.type==='state').at(-1).room.seats[0]===null);
  b.messages.length=0;a.send(probe);await delay(100);assert.ok(!b.messages.some(m=>m.type==='room-probe'));
  console.log('PASS real relay diagnostics, resource progress validation, host-only eviction, stale-target isolation and membership cleanup');
} finally { for(const client of clients)client.socket.terminate();relay.kill(); }
