import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import net from "node:net";
import { resolve } from "node:path";

const root = process.cwd();
const relayPath = resolve(root, "server/netplay-relay.mjs");
function freePort(){return new Promise((res,rej)=>{const s=net.createServer();s.once('error',rej);s.listen(0,'127.0.0.1',()=>{const a=s.address();s.close(e=>e?rej(e):res(a.port));});});}
function waitListening(child){return new Promise((res,rej)=>{const timer=setTimeout(()=>rej(Error('relay timeout')),5000);const onData=c=>{if(!String(c).includes('listening'))return;clearTimeout(timer);child.stdout.off('data',onData);res();};child.stdout.on('data',onData);child.once('exit',c=>rej(Error(`relay exited ${c}`)));});}
function waitMessage(socket, predicate, timeout=3000){return new Promise((res,rej)=>{const timer=setTimeout(()=>{cleanup();rej(Error('message timeout'));},timeout);const onMessage=e=>{let m;try{m=JSON.parse(String(e.data));}catch{return;}if(!predicate(m))return;cleanup();res(m);};const onError=()=>{cleanup();rej(Error('socket error'));};function cleanup(){clearTimeout(timer);socket.removeEventListener('message',onMessage);socket.removeEventListener('error',onError);}socket.addEventListener('message',onMessage);socket.addEventListener('error',onError);});}
async function open(url){const s=new WebSocket(url);await new Promise((res,rej)=>{s.addEventListener('open',res,{once:true});s.addEventListener('error',()=>rej(Error('open failed')),{once:true});});return s;}
async function openLobby(port,room,id){const s=new WebSocket(`ws://127.0.0.1:${port}/?room=${room}&lobby=${id}`);const state=waitMessage(s,m=>m.type==='state');await new Promise((res,rej)=>{s.addEventListener('open',res,{once:true});s.addEventListener('error',()=>rej(Error('open failed')),{once:true});});await state;return s;}
function sendWait(s,payload,pred){const p=waitMessage(s,pred);s.send(JSON.stringify(payload));return p;}

const port=await freePort();
const relay=spawn(process.execPath,[relayPath],{cwd:root,env:{...process.env,TH07_RELAY_HOST:'127.0.0.1',TH07_RELAY_PORT:String(port),TH07_STUN_URLS:'',TH07_SPECTATOR_CONNECT_GRACE_MS:'150'},stdio:['ignore','pipe','pipe']});
try{
  await waitListening(relay);
  const room=`th06mp-life${Date.now().toString(36)}`;
  const p1=await openLobby(port,room,'client_p1');
  const p2=await openLobby(port,room,'client_p2');
  await sendWait(p1,{type:'take-seat',seat:0,loadout:0,ready:false,name:'P1'},m=>m.type==='state'&&m.room.seats[0]?.clientId==='client_p1');
  await sendWait(p2,{type:'take-seat',seat:1,loadout:1,ready:false,name:'P2'},m=>m.type==='state'&&m.room.seats[1]?.clientId==='client_p2');
  await sendWait(p1,{type:'set-ready',ready:true},m=>m.type==='state'&&m.room.seats[0]?.ready===true);
  let both=await sendWait(p2,{type:'set-ready',ready:true},m=>m.type==='state'&&m.room.seats.slice(0,2).every(x=>x?.ready));
  const v1=both.room.settingsVersion;
  const changed=await sendWait(p1,{type:'settings',playerCount:2,difficulty:2},m=>m.type==='state'&&m.room.settingsVersion>v1);
  assert.equal(changed.room.seats[0].ready,false);
  assert.equal(changed.room.seats[1].ready,false);
  await sendWait(p1,{type:'set-ready',ready:true},m=>m.type==='state'&&m.room.seats[0]?.ready);
  both=await sendWait(p2,{type:'set-ready',ready:true},m=>m.type==='state'&&m.room.seats.slice(0,2).every(x=>x?.ready));
  const settingsVersion=both.room.settingsVersion;

  p2.close();
  await waitMessage(p1,m=>m.type==='state'&&m.room.seats[1]?.offline===true);
  const offlineError=await sendWait(p1,{type:'start'},m=>m.type==='error');
  assert.match(offlineError.error,/未在线|未对当前设置/);

  // Change match settings while P2 is offline. A reconnect may send its stale
  // local ready=true, but the server must not promote that stale state to the
  // new settingsVersion.
  const offlineChanged=await sendWait(p1,{type:'settings',playerCount:2,difficulty:3},m=>m.type==='state'&&m.room.settingsVersion>settingsVersion);
  assert.equal(offlineChanged.room.seats[1].ready,false);
  await sendWait(p1,{type:'set-ready',ready:true},m=>m.type==='state'&&m.room.seats[0]?.ready===true);
  const p2r=await openLobby(port,room,'client_p2');
  const staleReady=await sendWait(p2r,{type:'take-seat',seat:1,loadout:1,ready:true,name:'P2'},m=>m.type==='state'&&m.room.seats[1]?.clientId==='client_p2');
  assert.equal(staleReady.room.seats[1].ready,false);
  const currentSettingsVersion=staleReady.room.settingsVersion;
  await sendWait(p2r,{type:'set-ready',ready:true},m=>m.type==='state'&&m.room.seats[1]?.ready===true);
  const start=await sendWait(p1,{type:'start'},m=>m.type==='start');
  assert.equal(start.room.phase,'starting');
  const serial=start.serial;
  const duplicate=await sendWait(p1,{type:'start'},m=>m.type==='state');
  assert.equal(duplicate.room.startSerial,serial);

  const late=await openLobby(port,room,'spectator_late');
  const lateErrorPromise=waitMessage(late,m=>m.type==='error');
  late.send(JSON.stringify({type:'spectate',name:'Late'}));
  const lateError=await lateErrorPromise;
  assert.match(lateError.error,/下一局/);

  // Keep the run alive through signaling, then closing both endpoints must
  // return the room to lobby and invalidate readiness for the next match.
  const sig0=await open(`ws://127.0.0.1:${port}/?room=${room}&run=${serial}&player=0&players=2&signal=1`);
  const sig1=await open(`ws://127.0.0.1:${port}/?room=${room}&run=${serial}&player=1&players=2&signal=1`);
  sig0.close(); sig1.close();
  const reset=await waitMessage(p1,m=>m.type==='state'&&m.room.phase==='lobby'&&m.room.settingsVersion>currentSettingsVersion,4000);
  assert.equal(reset.room.seats[0].ready,false);
  assert.equal(reset.room.seats[1].ready,false);
  p1.close();p2r.close();late.close();
} finally { relay.kill(); }
console.log('Netplay relay lifecycle: PASS');
