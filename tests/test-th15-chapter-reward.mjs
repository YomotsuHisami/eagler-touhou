import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {defaultTh15ChapterThreshold,validTh15ChapterThreshold} from '../lib/th15-chapter-reward.mjs';
import {buildMultiplayerRuntimeOptions} from '../.cache/build/browser/assets/launcher/multiplayer-runtime-options.mjs';
import {multiplayerConfigForProduct} from '../lib/contracts/product-catalog.mjs';
for(const value of [500000,1250000,1500000,5000000])assert(validTh15ChapterThreshold(value));
for(const value of [0,250000,500001,1250001,5250000,NaN,'1250000',null])assert(!validTh15ChapterThreshold(value));
assert.equal(defaultTh15ChapterThreshold(2),1250000);assert.equal(defaultTh15ChapterThreshold(3),1500000);
const config=multiplayerConfigForProduct('th15mp');
const input={url:'ws://localhost/?room=th15mp-1234&run=1',player:0,playerCount:2,seed:1,difficulty:1,inputDelay:0,adonisMode:1,predictionLimit:0,spectator:false,spectatorId:'',spectatorCount:0,iceServers:[],loadouts:[{character:0,shot:0},{character:1,shot:0}]};
assert.equal(buildMultiplayerRuntimeOptions(input,config).netplayChapterThreshold,1250000);
assert.equal(buildMultiplayerRuntimeOptions({...input,chapterThreshold:5000000},config).netplayChapterThreshold,5000000);
for(const value of [499999,500001,5250000])assert.throws(()=>buildMultiplayerRuntimeOptions({...input,chapterThreshold:value},config));
assert.throws(()=>buildMultiplayerRuntimeOptions({...input,url:'ws://localhost/?room=th11mp-1234&run=1',chapterThreshold:1250000},config));
const relay=spawn(process.execPath,['server/netplay-relay.mjs'],{cwd:new URL('../',import.meta.url),env:{...process.env,EAGLER_NETPLAY_RELAY_HOST:'127.0.0.1',EAGLER_NETPLAY_RELAY_PORT:'0',EAGLER_NETPLAY_STUN_URLS:''},windowsHide:true,stdio:['ignore','pipe','pipe']});
let logs='';relay.stderr.on('data',b=>logs+=b);const sockets=[];
function next(socket,predicate=()=>true){return new Promise((yes,no)=>{const timer=setTimeout(()=>{clean();no(Error('Relay reply timeout '+logs));},6000);const receive=e=>{const m=JSON.parse(e.data);if(predicate(m)){clean();yes(m);}};const clean=()=>{clearTimeout(timer);socket.removeEventListener('message',receive);};socket.addEventListener('message',receive);});}
async function send(socket,message,predicate){const reply=next(socket,predicate);socket.send(JSON.stringify(message));return reply.catch(error=>{error.message+=` command=${JSON.stringify(message)}`;throw error;});}
try{
 const port=await new Promise((yes,no)=>{const timer=setTimeout(()=>no(Error(logs)),10000);relay.stdout.on('data',b=>{logs+=b;const m=logs.match(/listening ws:\/\/127\.0\.0\.1:(\d+)/);if(m){clearTimeout(timer);yes(Number(m[1]));}});});
 async function connect(product,id,seat,extra=''){const socket=new WebSocket(`ws://127.0.0.1:${port}/?room=${product}-chaptertest&lobby=client_${id}&member=member_${id}&intent=${seat===0?'create':'join'}&players=2${extra}`);sockets.push(socket);const reply=await next(socket);assert.equal(reply.type,'state');await send(socket,{type:'take-seat',seat,loadout:seat},m=>m.type==='state'&&m.room?.seats?.[seat]?.clientId===`client_${id}`);return socket;}
 const host=await connect('th15mp','host',0),guest=await connect('th15mp','guest',1);
 const settings={type:'settings',playerCount:2,difficulty:1,chapterThreshold:1250000};
 let state=await send(host,settings,m=>m.type==='state'&&m.room?.chapterThreshold===1250000);assert.equal(state.room.chapterThreshold,1250000);
 await send(host,{type:'set-ready',ready:true},m=>m.type==='state'&&m.room?.seats?.[0]?.ready===true);await send(guest,{type:'set-ready',ready:true},m=>m.type==='state'&&m.room?.seats?.[1]?.ready===true);
 const guestUpdate=next(guest,m=>m.room?.chapterThreshold===5000000);
 state=await send(host,{...settings,chapterThreshold:5000000},m=>m.room?.chapterThreshold===5000000);await guestUpdate;
 assert(state.room.seats.every(s=>!s||!s.ready),'Rule change must invalidate every ready seat');
 assert.equal((await send(guest,{...settings,chapterThreshold:500000},m=>m.type==='error')).type,'error','Guest must not edit threshold');
 for(const value of [0,499999,500001,5250000,'1250000'])assert.equal((await send(host,{...settings,chapterThreshold:value},m=>m.type==='error')).type,'error');
 state=await send(host,{type:'settings',playerCount:3,difficulty:1},m=>m.room?.playerCount===3);assert.equal(state.room.chapterThreshold,1500000);
 state=await send(host,settings,m=>m.room?.playerCount===2);assert.equal(state.room.chapterThreshold,1250000);
 await send(host,{type:'set-ready',ready:true},m=>m.type==='state'&&m.room?.seats?.[0]?.ready===true);await send(guest,{type:'set-ready',ready:true},m=>m.type==='state'&&m.room?.seats?.[1]?.ready===true);
 await send(host,{type:'start',adonisMode:1,inputDelay:0,inputDelayAuto:false,predictionReserve:2},m=>m.type==='start');
 state=await send(host,{...settings,chapterThreshold:500000},m=>m.type==='error');assert.equal(state.error,'本局已经开始','Threshold must freeze during a run');
 const other=await connect('th11mp','other',0);assert.equal((await send(other,settings,m=>m.type==='error')).type,'error','Other titles must reject this rule');
 console.log('PASS TH15 chapter threshold defaults, range, host authority, ready reset, peer sync, run lock and title isolation');
}finally{for(const socket of sockets)socket.close();relay.kill();}
