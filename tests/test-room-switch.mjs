// Real local relay, lobby/directory only. No Native game or match is launched.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {WebSocket} from 'ws';
const relay = spawn(process.execPath, ['server/netplay-relay.mjs'], {stdio:['ignore','pipe','pipe'],
  env:{...process.env,EAGLER_NETPLAY_RELAY_HOST:'127.0.0.1',EAGLER_NETPLAY_RELAY_PORT:'0',EAGLER_NETPLAY_STUN_URLS:'',EAGLER_NETPLAY_LOBBY_RECONNECT_GRACE_MS:'100'}});
let log = '', lastCommand = ''; const sockets = [];
const port = await new Promise((resolve,reject) => {
  const timer=setTimeout(()=>reject(Error('relay startup timeout: '+log)),5000);
  relay.stderr.on('data',data=>{log+=data;});
  relay.stdout.on('data',data=>{log+=data;const match=/listening ws:\/\/127\.0\.0\.1:(\d+)/.exec(log);if(match){clearTimeout(timer);resolve(match[1]);}});
  relay.once('exit',()=>{clearTimeout(timer);reject(Error('relay exited: '+log));});
});
function connect(params) {
  const socket=new WebSocket(`ws://127.0.0.1:${port}/?${new URLSearchParams(params)}`), messages=[], waiters=[];
  sockets.push(socket); socket.on('error',()=>{});
  socket.on('message',data=>{const m=JSON.parse(String(data));messages.push(m);for(const w of [...waiters])if(w.test(m))w.resolve(m);});
  return {socket,messages,wait(test) {
    const found=messages.find(test);if(found)return Promise.resolve(found);
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{waiters.splice(waiters.indexOf(w),1);reject(Error('relay message timeout after '+lastCommand+': '+log+'\nRecent messages: '+JSON.stringify(messages.slice(-3))));},5000);
      const w={test,resolve(m){clearTimeout(timer);waiters.splice(waiters.indexOf(w),1);resolve(m);}};waiters.push(w);
    });
  }};
}
async function lobby(id, room='th07mp-8642', flags=true) {
  const c=connect({room,lobby:`client_${id}`,member:`private_member_${id}`,intent:'join',...(flags?{roomProducts:'1',roomCards:'1'}:{})});
  await c.wait(m=>m.type==='state');return c;
}
async function send(c,message,test) {lastCommand=JSON.stringify(message);c.messages.length=0;const result=c.wait(test);c.socket.send(JSON.stringify(message));return result;}
const state = test => m=>m.type==='state'&&test(m.room);

try {
  const create = (id,room) => connect({room,lobby:`client_${id}`,member:`private_member_${id}`,intent:'create',roomProducts:'1'});
  const host=create('switchhost','th07mp-8650');await host.wait(m=>m.type==='state');
  await send(host,{type:'take-seat',seat:1,loadout:0},state(r=>r.seats[1]?.clientId==='client_switchhost'));
  const sourceGuest=await lobby('sourceguest','th07mp-8650');
  const target=create('targethost','th07mp-8651');await target.wait(m=>m.type==='state');
  await send(target,{type:'take-seat',seat:0,loadout:0},state(r=>r.seats[0]?.clientId==='client_targethost'));
  const directory=connect({directory:'1',member:'private_member_switchhost'});
  const first=await directory.wait(m=>m.type==='directory');assert.equal(first.roomSwitch,1);assert.equal(first.mine.host,true);
  const command={type:'switch-room',requestId:1,recoveryToken:first.mine.recoveryToken,product:'th07mp',code:'8651',dissolve:true};
  const response = id => m=>m.type==='room-switch-result'&&m.requestId===id;
  let result=await send(directory,{...command,recoveryToken:'wrong'},response(1));assert.equal(result.reason,'membership-changed');assert.equal(host.socket.readyState,1);
  result=await send(directory,{...command,requestId:2,code:'9999'},response(2));assert.equal(result.reason,'target-unavailable');assert.equal(host.socket.readyState,1);
  const full=await lobby('full','th07mp-8651');await send(full,{type:'take-seat',seat:1,loadout:0},state(r=>!!r.seats[1]));
  result=await send(directory,{...command,requestId:3},response(3));assert.equal(result.reason,'target-unavailable');assert.equal(host.socket.readyState,1);
  target.messages.length=0;const fullLeft=once(full.socket,'close');full.socket.close(1000,'leave room');await fullLeft;await target.wait(state(r=>!r.seats[1]));
  const ownerClosed=once(host.socket,'close'),guestClosed=once(sourceGuest.socket,'close');
  result=await send(directory,{...command,requestId:4},response(4));assert.equal(result.ok,true);
  assert.equal((await ownerClosed)[0],4011);assert.equal((await guestClosed)[0],4011);assert.equal(target.socket.readyState,1);
  const joined=await lobby('switchhost','th07mp-8651');await send(joined,{type:'take-seat',seat:1,loadout:0},state(r=>r.seats[1]?.clientId==='client_switchhost'));
  result=await send(directory,{...command,requestId:5},response(5));assert.equal(result.reason,'membership-changed');assert.equal(target.socket.readyState,1);assert.equal(joined.socket.readyState,1);
  const another=create('anotherhost','th08mp-8652');await another.wait(m=>m.type==='state');
  await send(another,{type:'take-seat',seat:0,loadout:0},state(r=>!!r.seats[0]));
  const membership=await directory.wait(m=>m.type==='directory'&&m.mine?.code==='8651');assert.equal(membership.mine.host,false);
  const guestCommand={...command,requestId:6,recoveryToken:membership.mine.recoveryToken,product:'th08mp',code:'8652'};
  result=await send(directory,guestCommand,response(6));assert.equal(result.reason,'membership-changed','guest cannot dissolve another host room');
  const removed=once(joined.socket,'close');target.messages.length=0;
  result=await send(directory,{...guestCommand,requestId:7,dissolve:false},response(7));assert.equal(result.ok,true);assert.equal((await removed)[0],4008);
  await target.wait(state(r=>!r.seats[1]));assert.equal(target.socket.readyState,1);
  const final=await lobby('switchhost','th08mp-8652');assert.equal(final.socket.readyState,1);
  console.log('PASS confirmed directory switching, exact membership/host checks, full/missing destination preservation, host-room dissolution, peer notification and guest-only departure');
} finally {
  for(const socket of sockets)socket.terminate();
  const stopped=once(relay,'exit');relay.kill();await stopped;
}
