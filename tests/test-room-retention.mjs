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
  const room='th07mp-8643',id='client_host';
  const host=connect({room,lobby:id,member:'private_member_host',intent:'create',roomProducts:'1',roomCards:'1'});
  const first=await host.wait(m=>m.type==='state');assert.equal(first.roomDirectory.roomRetention,1);
  await send(host,{type:'take-seat',seat:1,loadout:2,productVersion:1},state(r=>r.seats[1]?.clientId===id));
  const guest=await lobby('guest',room);
  await send(guest,{type:'take-seat',seat:0,loadout:0,productVersion:1},state(r=>r.seats[0]?.clientId==='client_guest'));
  await send(host,{type:'resource-progress',status:'ready',stage:'runtime',percent:100},state(r=>r.seats[1]?.resource?.status==='ready'));
  await send(host,{type:'set-loadout',loadout:2,selectionConfirmed:true},state(r=>r.seats[1]?.selectionConfirmed===true));
  await send(host,{type:'set-ready',ready:true},state(r=>r.seats[1]?.ready));
  for(const type of ['park-room','resume-room','dissolve-room']) await send(guest,{type,productVersion:1},m=>m.type==='error'&&m.code==='room-retention');
  await send(host,{type:'dissolve-room',productVersion:0},m=>m.type==='error'&&m.code==='room-retention');
  await send(host,{type:'park-room',productVersion:1},state(r=>r.retainedHostId===id&&!r.seats[1]?.ready));
  const directory=connect({directory:'1',member:'private_member_host'});
  const listed=await directory.wait(m=>m.type==='directory'&&m.mine?.retained);
  assert.equal(listed.mine.clientId,id);assert.equal(listed.mine.code,'8643');
  assert.equal(listed.rooms.filter(r=>r.code==='8643').length,1);
  guest.messages.length=0;const disconnected=once(host.socket,'close');host.socket.close(1000,'page suspended');await disconnected;
  await guest.wait(state(r=>r.seats[1]?.offline&&r.hostClientId===id));
  await new Promise(resolve=>setTimeout(resolve,250));
  const refreshed=connect({directory:'1',member:'private_member_host'});
  const retained=await refreshed.wait(m=>m.type==='directory');
  assert.equal(retained.mine.retained,true,'retained membership outlives reconnect grace');
  const outsider=connect({directory:'1',member:'private_other_browser'});
  const publicList=await outsider.wait(m=>m.type==='directory');assert.equal(publicList.mine,null);
  assert.equal(publicList.rooms.some(r=>r.clientId||r.recoveryToken||r.memberId),false);
  const impostor=connect({room,lobby:id,member:'private_other_browser',intent:'join'});
  assert.equal((await once(impostor.socket,'close'))[0],1008);
  const conflict=connect({room,lobby:'different_client',member:'private_member_host',intent:'join'});
  assert.equal((await once(conflict.socket,'close'))[0],4009);
  const restored=await lobby('host',room);
  const restoredState=restored.messages.find(m=>m.type==='state').room;
  assert.equal(restoredState.hostClientId,id);assert.equal(restoredState.seats[1].loadout,2);
  assert.equal(restoredState.seats[1].selectionConfirmed,true);assert.equal(restoredState.retainedHostId,id);
  await send(restored,{type:'resume-room',productVersion:1},state(r=>r.retainedHostId===null));
  // Room ownership and old invite aliases survive product changes.
  await send(restored,{type:'directory-lock',locked:false,version:1},state(r=>!r.directoryLocked));
  await send(restored,{type:'set-product',product:'th08mp',version:2},state(r=>r.product==='th08mp'));
  await send(restored,{type:'park-room',productVersion:3},state(r=>r.retainedHostId===id));
  await send(directory,{type:'refresh'},m=>m.type==='directory'&&m.mine?.product==='th08mp'&&m.mine?.retained);
  await send(restored,{type:'resume-room',productVersion:3},state(r=>r.retainedHostId===null));
  const hostClosed=once(restored.socket,'close'),guestClosed=once(guest.socket,'close');
  directory.messages.length=0;restored.socket.send(JSON.stringify({type:'dissolve-room',productVersion:3}));
  assert.equal((await hostClosed)[0],4011);assert.equal((await guestClosed)[0],4011);
  const dissolved=await directory.wait(m=>m.type==='directory'&&!m.mine&&!m.rooms.some(r=>r.code==='8643'));
  assert.equal(dissolved.mine,null);
  const oldInvite=connect({room,lobby:id,member:'private_member_host',intent:'join'});
  assert.equal((await once(oldInvite.socket,'close'))[0],4007,'old invite cannot resurrect dissolved room');
  const newHost=connect({room:'th08mp-8644',lobby:id,member:'private_member_host',intent:'create',roomProducts:'1'});
  await newHost.wait(m=>m.type==='state');
  await send(newHost,{type:'park-room',productVersion:1},state(r=>r.retainedHostId===id));
  const closed=once(newHost.socket,'close');newHost.socket.close(1000,'page suspended');await closed;
  await new Promise(resolve=>setTimeout(resolve,250));
  const onlyOwner=connect({directory:'1',member:'private_member_host'});
  const alone=await onlyOwner.wait(m=>m.type==='directory');
  assert.equal(alone.mine.code,'8644');assert.equal(alone.rooms.find(r=>r.code==='8644').online,0);
  const recovered=await send(onlyOwner,{type:'release-membership',recoveryToken:alone.mine.recoveryToken},m=>m.type==='directory'&&!m.mine);
  assert.equal(recovered.rooms.some(r=>r.code==='8644'),false,'explicit membership recovery can release retained empty room');
  console.log('PASS host P2 parking, private membership persistence beyond disconnect grace, product/invite identity, authorized resume/dissolve, guest termination and empty retained-room recovery');
} finally {
  for(const socket of sockets)socket.terminate();
  const stopped=once(relay,'exit');relay.kill();await stopped;
}
