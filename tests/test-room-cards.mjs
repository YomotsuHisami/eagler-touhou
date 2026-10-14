// Real local relay, lobby/directory only. No Native game or match is launched.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {WebSocket} from 'ws';
const relay = spawn(process.execPath, ['server/netplay-relay.mjs'], {stdio:['ignore','pipe','pipe'],
  env:{...process.env,EAGLER_NETPLAY_RELAY_HOST:'127.0.0.1',EAGLER_NETPLAY_RELAY_PORT:'0',EAGLER_NETPLAY_STUN_URLS:''}});
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
  const room='th07mp-9864';
  const host=connect({room,lobby:'client_host',member:'private_member_host',intent:'create',roomProducts:'1',roomCards:'1'});
  const first=await host.wait(m=>m.type==='state');assert.equal(first.roomDirectory.roomCards,1);assert.equal(first.roomDirectory.selectionState,1);assert.equal(first.roomDirectory.editingState,1);assert.equal(first.room.hostClientId,'client_host');
  const seat=(index,deviceType)=>({type:'take-seat',seat:index,loadout:0,productVersion:1,deviceType});
  await send(host,seat(0,'desktop'),state(r=>r.seats[0]?.deviceType==='desktop'));
  await send(host,seat(1,'desktop'),state(r=>r.seats[1]?.clientId==='client_host'&&!r.seats[0]));
  await send(host,{type:'settings',playerCount:3,difficulty:1},state(r=>r.playerCount===3&&r.hostClientId==='client_host'));
  await send(host,seat(2,'desktop'),state(r=>r.seats[2]?.clientId==='client_host'));
  let current=host.messages.findLast(m=>m.type==='state').room;
  const removed=await send(host,{type:'remove-seat',seat:0,settingsVersion:current.settingsVersion},state(r=>r.playerCount===2));
  assert.equal(removed.room.seats[1]?.clientId,'client_host');assert.equal(removed.room.hostClientId,'client_host');
  await send(host,{type:'settings',playerCount:3,difficulty:1},state(r=>r.playerCount===3));
  current=host.messages.findLast(m=>m.type==='state').room;
  await send(host,{type:'remove-seat',seat:2,settingsVersion:current.settingsVersion},state(r=>r.playerCount===2));
  const guest=await lobby('guest',room);
  await send(guest,seat(0,'phone'),state(r=>r.seats[0]?.deviceType==='phone'));
  await send(guest,{type:'settings',playerCount:3,difficulty:3},m=>m.type==='error');
  await send(host,{type:'settings',playerCount:3,difficulty:2},state(r=>r.playerCount===3&&r.difficulty===2));
  current=host.messages.findLast(m=>m.type==='state').room;
  await send(guest,{type:'remove-seat',seat:2,settingsVersion:current.settingsVersion},m=>m.type==='error');
  await send(host,{type:'remove-seat',seat:2,settingsVersion:current.settingsVersion-1},m=>m.type==='error');
  const third=await lobby('third',room);
  await send(third,seat(2,'tablet'),state(r=>r.seats[2]?.deviceType==='tablet'));
  await send(host,{type:'remove-seat',seat:2,settingsVersion:current.settingsVersion},m=>m.type==='error');
  await send(host,{type:'remove-player',seat:1,clientId:'client_host'},m=>m.type==='error');
  const early=await send(host,{type:'set-ready',ready:true},state(r=>!r.seats[1]?.ready));assert.equal(early.room.seats[1].ready,false);
  await send(host,{type:'resource-progress',status:'preparing',stage:'package',percent:40},state(r=>r.seats[1]?.resource?.percent===40));
  await guest.wait(state(r=>r.seats[1]?.resource?.percent===40));
  await send(host,{type:'resource-progress',status:'ready',stage:'runtime',percent:100},state(r=>r.seats[1]?.resource?.status==='ready'));
  await send(host,{type:'set-loadout',loadout:0,selectionConfirmed:false},state(r=>r.seats[1]?.selectionConfirmed===false));
  await send(host,{type:'set-ready',ready:true},state(r=>r.seats[1]?.ready===false));
  guest.messages.length=0;
  await send(host,{type:'set-loadout',loadout:0,selectionConfirmed:true},state(r=>r.seats[1]?.selectionConfirmed===true));
  await guest.wait(state(r=>r.seats[1]?.selectionConfirmed===true));
  await send(host,{type:'set-ready',ready:true},state(r=>r.seats[1]?.ready));
  await send(guest,{type:'resource-progress',status:'ready',stage:'runtime',percent:100},state(r=>r.seats[0]?.resource?.status==='ready'));
  await send(guest,{type:'set-loadout',loadout:0,selectionConfirmed:true},state(r=>r.seats[0]?.selectionConfirmed===true));
  await send(guest,{type:'set-ready',ready:true},state(r=>r.seats[0]?.ready));
  guest.messages.length=0;
  const editing=await send(host,{type:'editing-settings',editing:true},state(r=>r.seats[1]?.editingSettings===true&&!r.seats[1]?.ready));
  assert.equal(editing.room.seats[1].resource.status,'ready');assert.equal(editing.room.seats[1].selectionConfirmed,true);
  assert.equal(editing.room.seats[0].ready,true,'entering settings only cancels that player’s Ready');
  await guest.wait(state(r=>r.seats[1]?.editingSettings===true&&!r.seats[1]?.ready));
  await send(host,{type:'set-ready',ready:true},state(r=>r.seats[1]?.editingSettings===true&&!r.seats[1]?.ready));
  await send(host,{type:'editing-settings',editing:false},state(r=>r.seats[1]?.editingSettings===false&&!r.seats[1]?.ready));
  await send(host,{type:'set-ready',ready:true},state(r=>r.seats[1]?.ready));
  await send(host,{type:'editing-settings',editing:true,productVersion:0},state(r=>r.seats[1]?.editingSettings===false&&r.seats[1]?.ready));
  guest.messages.length=0;
  await send(host,{type:'set-loadout',loadout:0,selectionConfirmed:false},state(r=>r.seats[1]?.selectionConfirmed===false&&!r.seats[1]?.ready));
  await guest.wait(state(r=>r.seats[1]?.selectionConfirmed===false&&!r.seats[1]?.ready));
  await send(host,{type:'set-loadout',loadout:1,selectionConfirmed:true},state(r=>r.seats[1]?.selectionConfirmed===true&&r.seats[1]?.loadout===1));
  await send(host,{type:'set-loadout',loadout:2},state(r=>r.seats[1]?.selectionConfirmed===false&&r.seats[1]?.loadout===2));
  await send(host,{type:'set-loadout',loadout:0,selectionConfirmed:true,productVersion:0},state(r=>r.seats[1]?.loadout===2&&r.seats[1]?.selectionConfirmed===false));
  await send(host,{type:'set-loadout',loadout:2,selectionConfirmed:true},state(r=>r.seats[1]?.selectionConfirmed===true));
  await send(host,{type:'set-ready',ready:true},state(r=>r.seats[1]?.ready));
  await send(host,{type:'resource-progress',status:'failed',stage:'runtime',percent:null},state(r=>r.seats[1]?.resource?.status==='failed'&&!r.seats[1]?.ready));
  const kicked=once(guest.socket,'close');
  await send(host,{type:'remove-player',seat:0,clientId:'client_guest'},state(r=>!r.seats[0]));assert.equal((await kicked)[0],4010);
  await send(host,{type:'editing-settings',editing:true},state(r=>r.seats[1]?.editingSettings));
  third.messages.length=0;
  const disconnected=once(host.socket,'close');host.socket.close(1000,'page suspended');await disconnected;
  await third.wait(state(r=>r.hostClientId==='client_host'&&r.seats[1]?.offline&&!r.seats[1]?.editingSettings));
  const resumed=await lobby('host',room);assert.equal(resumed.messages.find(m=>m.type==='state').room.seats[1].selectionConfirmed,true);assert.equal(resumed.messages.find(m=>m.type==='state').room.hostClientId,'client_host');
  await send(resumed,{type:'directory-lock',locked:false,version:1},state(r=>!r.directoryLocked));
  const switched=await send(resumed,{type:'set-product',product:'th08mp',version:2},state(r=>r.product==='th08mp'));
  assert.equal(switched.room.seats[1].selectionConfirmed,false);assert.equal(switched.room.seats[1].resource,null);assert.equal(switched.room.hostClientId,'client_host');assert.equal(switched.room.seats[1].clientId,'client_host');
  third.messages.length=0;const left=once(resumed.socket,'close');resumed.socket.close(1000,'leave room');await left;
  await third.wait(state(r=>r.hostClientId==='client_third'));
  console.log('PASS P2/P3 host authority, empty slot deletion, host-only kicking, real progress/ready, settings activity with per-player unready, device reports and reconnect ownership');
} finally {
  for(const socket of sockets)socket.terminate();
  const stopped=once(relay,'exit');relay.kill();await stopped;
}
