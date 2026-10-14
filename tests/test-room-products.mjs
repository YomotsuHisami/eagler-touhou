// Real local relay, lobby/directory only. No Native game or match is launched.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {WebSocket} from 'ws';
const relay = spawn(process.execPath, ['server/netplay-relay.mjs'], {stdio:['ignore','pipe','pipe'],
  env:{...process.env,EAGLER_NETPLAY_RELAY_HOST:'127.0.0.1',EAGLER_NETPLAY_RELAY_PORT:'0',EAGLER_NETPLAY_STUN_URLS:''}});
let log = ''; const sockets = [];
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
      const timer=setTimeout(()=>{waiters.splice(waiters.indexOf(w),1);reject(Error('relay message timeout: '+log));},5000);
      const w={test,resolve(m){clearTimeout(timer);waiters.splice(waiters.indexOf(w),1);resolve(m);}};waiters.push(w);
    });
  }};
}
async function lobby(id, room='th07mp-8642', flags=true) {
  const c=connect({room,lobby:`client_${id}`,member:`private_member_${id}`,intent:'join',...(flags?{roomProducts:'1'}:{})});
  await c.wait(m=>m.type==='state');return c;
}
async function send(c,message,test) {c.messages.length=0;const result=c.wait(test);c.socket.send(JSON.stringify(message));return result;}
const state = test => m=>m.type==='state'&&test(m.room);
const rejected = m=>m.type==='error'&&m.code==='room-product';
try {
  const host=connect({room:'th07mp-8642',lobby:'client_host',member:'private_member_host',intent:'create',roomProducts:'1'});
  const first=await host.wait(m=>m.type==='state');assert.equal(first.roomDirectory.roomProducts,1);assert.equal(first.room.directoryLocked,true);
  await send(host,{type:'take-seat',seat:0,loadout:0,productVersion:1},state(r=>r.seats[0]?.clientId==='client_host'));
  const guest=await lobby('guest'), viewer=await lobby('viewer');
  await send(guest,{type:'take-seat',seat:1,loadout:4,productVersion:1},state(r=>r.seats[1]?.clientId==='client_guest'));
  await send(viewer,{type:'spectate'},state(r=>r.spectators.some(s=>s.clientId==='client_viewer')));
  await send(guest,{type:'directory-lock',locked:false,version:1},rejected);
  await send(host,{type:'set-product',product:'th08mp',version:1},rejected);
  await send(host,{type:'directory-lock',locked:false,version:1},state(r=>r.directoryLocked===false&&r.productVersion===2));
  await send(host,{type:'settings',playerCount:3,difficulty:3,productVersion:2},state(r=>r.playerCount===3));
  const third=await lobby('third');
  await send(third,{type:'take-seat',seat:2,loadout:5,productVersion:2},state(r=>r.seats[2]?.clientId==='client_third'));
  await send(host,{type:'set-ready',ready:true,productVersion:2},state(r=>r.seats[0]?.ready));
  await send(guest,{type:'set-ready',ready:true,productVersion:2},state(r=>r.seats[1]?.ready));
  const changed=await send(host,{type:'set-product',product:'th09mp',version:2},state(r=>r.product==='th09mp'&&r.productVersion===3));
  assert.equal(changed.room.playerCount,2);assert.equal(changed.room.difficulty,1);
  assert.deepEqual(changed.room.seats.slice(0,2).map(s=>[s.clientId,s.loadout,s.ready,s.resource]),[['client_host',0,false,null],['client_guest',0,false,null]]);
  assert.ok(changed.room.spectators.some(s=>s.clientId==='client_third'));
  for(const c of [guest,viewer,third]) {await c.wait(state(r=>r.product==='th09mp'&&r.productVersion===3));assert.equal(c.socket.readyState,1);}
  const directory=connect({directory:'1',member:'private_member_host'});
  const listed=await directory.wait(m=>m.type==='directory'&&m.mine?.product==='th09mp');
  assert.equal(listed.mine.code,'8642');assert.equal(listed.rooms.filter(r=>r.code==='8642').length,1);assert.equal(listed.rooms.find(r=>r.code==='8642').product,'th09mp');
  await send(guest,{type:'set-loadout',loadout:7,productVersion:2},state(r=>r.product==='th09mp'&&r.seats[1]?.loadout===0));
  await send(host,{type:'set-product',product:'th08mp',version:2},rejected);
  await send(host,{type:'set-product',product:'th06',version:3},rejected);
  await send(guest,{type:'product-busy',busy:true},state(r=>r.productSwitchAvailable===false));
  await send(host,{type:'set-product',product:'th08mp',version:3},rejected);
  await send(guest,{type:'product-busy',busy:false},state(r=>r.productSwitchAvailable===true));
  const oldClosed=once(guest.socket,'close'), resumed=await lobby('guest');
  assert.equal((await oldClosed)[0],4008);
  assert.equal(resumed.messages.find(m=>m.type==='state').room.product,'th09mp','old invite resolves to the current product');
  assert.equal(resumed.messages.find(m=>m.type==='state').room.seats[1].clientId,'client_guest');
  const impostor=connect({room:'th09mp-8642',lobby:'client_host',member:'private_attacker',intent:'join',roomProducts:'1'});
  assert.equal((await once(impostor.socket,'close'))[0],1008);assert.equal(host.socket.readyState,1);
  await send(host,{type:'directory-lock',locked:true,version:3},state(r=>r.directoryLocked&&r.productVersion===4));
  await send(host,{type:'set-product',product:'th08mp',version:4},rejected);
  await send(host,{type:'directory-lock',locked:false,version:4},state(r=>!r.directoryLocked&&r.productVersion===5));
  await send(host,{type:'set-product',product:'th08mp',version:5},state(r=>r.product==='th08mp'&&r.productVersion===6));
  const legacy=await lobby('legacy','th08mp-8642',false);
  await host.wait(state(r=>r.productSwitchAvailable===false));
  await send(host,{type:'set-product',product:'th10mp',version:6},rejected);
  const legacyClosed=once(legacy.socket,'close');legacy.socket.close(1000,'leave room');await legacyClosed;
  await host.wait(state(r=>r.productSwitchAvailable===true&&r.productVersion===6));
  console.log('PASS real room switching, owner/lock/version/busy gates, seat/spectator preservation, directory identity and old-invite reconnect');
} finally {
  for(const socket of sockets)socket.terminate();
  const stopped=once(relay,'exit');relay.kill();await stopped;
}
