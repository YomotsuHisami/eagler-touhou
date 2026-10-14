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
  const host=connect({room:'th07mp-8750',lobby:'client_codehost',member:'private_member_codehost',intent:'create',visibility:'private',roomProducts:'1'});
  await host.wait(m=>m.type==='state');
  await send(host,{type:'take-seat',seat:0,loadout:0,productVersion:1},state(r=>!!r.seats[0]));
  const directory=connect({directory:'1',member:'private_member_codelookup'});
  const first=await directory.wait(m=>m.type==='directory');assert.equal(first.roomLookup,1);assert.equal(first.rooms.length,0,'private room not in public listing');
  let sequence=0;
  const lookup=async code=>{
    await new Promise(resolve=>setTimeout(resolve,310));const requestId=++sequence;
    return send(directory,{type:'resolve-room',requestId,code},m=>m.type==='room-lookup-result'&&m.requestId===requestId);
  };
  let result=await lookup('8750');assert.deepEqual(result,{type:'room-lookup-result',requestId:1,code:'8750',ok:true,product:'th07mp'});
  await send(host,{type:'directory-lock',locked:false,version:1},state(r=>r.productVersion===2));
  await send(host,{type:'set-product',product:'th08mp',version:2},state(r=>r.product==='th08mp'));
  result=await lookup('8750');assert.equal(result.product,'th08mp','lookup follows canonical game after title change');
  const guest=await lobby('codeguest','th08mp-8750');await send(guest,{type:'take-seat',seat:1,loadout:0,productVersion:3},state(r=>!!r.seats[1]));
  result=await lookup('8750');assert.equal(result.reason,'unavailable');assert.equal(host.socket.readyState,1);
  const own=connect({directory:'1',member:'private_member_codehost'});await own.wait(m=>m.type==='directory');
  result=await send(own,{type:'resolve-room',requestId:1,code:'8750'},m=>m.type==='room-lookup-result');assert.equal(result.product,'th08mp','own full room can be returned to');
  result=await lookup('99999999');assert.equal(result.reason,'not-found');
  const oldA=connect({room:'th06mp-8751',lobby:'client_legacycodea',member:'private_member_legacycodea',intent:'create'});await oldA.wait(m=>m.type==='state');
  const closed=once(host.socket,'close');host.socket.close(1000,'leave room');await closed;
  const guestClosed=once(guest.socket,'close');guest.socket.close(1000,'leave room');await guestClosed;
  const oldB=connect({room:'th07mp-8751',lobby:'client_legacycodeb',member:'private_member_legacycodeb',intent:'create'});await oldB.wait(m=>m.type==='state');
  result=await lookup('8751');assert.equal(result.reason,'ambiguous','never guess a game for colliding legacy codes');
  const repeated=++sequence;result=await send(directory,{type:'resolve-room',requestId:repeated,code:'8751'},m=>m.type==='room-lookup-result'&&m.requestId===repeated);assert.equal(result.reason,'rate-limited');
  console.log('PASS code-only lookup: private and off-filter rooms, canonical product switching, unavailable/missing targets, own full room, legacy ambiguity and lookup throttling');
} finally {
  for(const socket of sockets)socket.terminate();
  const stopped=once(relay,'exit');relay.kill();await stopped;
}
