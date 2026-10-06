import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import net from 'node:net';
import {fileURLToPath} from 'node:url';

const port=await new Promise(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
const child=spawn(process.execPath,[fileURLToPath(new URL('../server/netplay-relay.mjs',import.meta.url))],{
  // Three retained rooms isolate the three transport cases; quota behavior has
  // its own abuse-guard integration gate.
  windowsHide:true,env:{...process.env,EAGLER_NETPLAY_RELAY_HOST:'127.0.0.1',EAGLER_NETPLAY_RELAY_PORT:String(port),EAGLER_NETPLAY_STUN_URLS:'',EAGLER_NETPLAY_MAX_ROOMS_PER_IP:'3'},stdio:['ignore','pipe','pipe']});
let log='';child.stdout.on('data',b=>log+=b);child.stderr.on('data',b=>log+=b);
const wait=async(test,label)=>{const start=Date.now();while(!test()){
  if(Date.now()-start>5000)throw Error(label+' timeout\n'+log);
  await new Promise(r=>setTimeout(r,5));
}};
const sockets=[];
async function open(query){
  const ws=new WebSocket(`ws://127.0.0.1:${port}/?${query}`);sockets.push(ws);ws.binaryType='arraybuffer';
  const s={ws,json:[],binary:[],ended:null};
  ws.addEventListener('message',e=>{if(typeof e.data==='string')s.json.push(JSON.parse(e.data));else s.binary.push(new Uint8Array(e.data));});
  ws.addEventListener('close',e=>s.ended={code:e.code,reason:e.reason});
  await wait(()=>ws.readyState===1||s.ended,'open');assert.equal(ws.readyState,1);return s;
}
const send=(s,m)=>s.ws.send(JSON.stringify(m));
const latest=s=>s.json.at(-1)?.room;
const marker=new Uint8Array([0xe8,0x53,0x54,0x4f,0x50,1]);
const frame=new Uint8Array(47);frame.set([0xe8,84,57,83,80,1,3,2,0]);
try {
  await wait(()=>log.includes('listening'),'relay');
  for(const [index,kind] of ['relay','signal','lost-upload'].entries()){
    const room=`th09mp-${6100+index}`,base=`room=${room}&run=1&players=2`;
    const p0=await open(`room=${room}&lobby=stop_host_${index}&member=member_host_${index}`),p1=await open(`room=${room}&lobby=stop_guest_${index}&member=member_guest_${index}`);
    const viewer=await open(`room=${room}&lobby=stop_viewer_${index}&member=member_viewer_${index}`);
    send(p0,{type:'take-seat',seat:0,loadout:0});send(p1,{type:'take-seat',seat:1,loadout:1});send(viewer,{type:'spectate'});
    await wait(()=>latest(p0)?.seats?.[0]&&latest(p0)?.seats?.[1]&&latest(p0)?.spectatorCount===1,'seats');
    send(p0,{type:'set-ready',ready:true});send(p1,{type:'set-ready',ready:true});
    await wait(()=>latest(p0)?.seats.slice(0,2).every(s=>s?.ready),'ready');send(p0,{type:'start'});
    await wait(()=>p0.json.some(m=>m.type==='start'),'start');
    const r0=await open(base+`&player=0&member=member_host_${index}`),r1=await open(base+`&player=1&member=member_guest_${index}`);
    const v=await open(base+`&spectator=stop_viewer_${index}&member=member_viewer_${index}`);
    const s0=await open(base+`&player=0&signal=1&member=member_host_${index}`),s1=await open(base+`&player=1&signal=1&member=member_guest_${index}`);
    send(s0,{type:kind==='relay'?'rtc-failed':'rtc-ready'});send(s1,{type:kind==='relay'?'rtc-failed':'rtc-ready'});
    await wait(()=>s0.json.some(m=>m.type==='route'),'route');
    // P2 cannot end the host's output, via either lane. Neither stop packet is
    // ever forwarded to the other player's native input queue.
    r1.ws.send(marker);send(s1,{type:'spectator-stop'});r0.ws.send(frame);
    await wait(()=>v.binary.length===1,'spectator still receives after P2 attempt');
    assert.equal(v.ended,null);assert.equal(r1.binary.length,0);
    if(kind==='relay')r0.ws.send(marker);
    else {
      if(kind==='lost-upload'){r0.ws.close(1000,'test optional upload loss');await wait(()=>r0.ended,'upload close');}
      send(s0,{type:'spectator-stop'});
    }
    await wait(()=>v.ended,'viewer explicit termination');
    assert.equal(v.ended.code,1011);assert.match(v.ended.reason,/players continue/);
    assert.equal(r1.ws.readyState,1);assert.equal(s0.ws.readyState,1);assert.equal(s1.ws.readyState,1);
    if(kind!=='lost-upload'){
      assert.equal(r0.ws.readyState,1);r0.ws.send(marker);r0.ws.send(frame);
      const gameplay=new Uint8Array([0xe7,1,11,22,33]);r0.ws.send(gameplay);
      await wait(()=>r1.binary.length===1,'gameplay after spectator stop');
      assert.deepEqual([...r1.binary[0]],[11,22,33]);
    }
    send(s0,{type:'signal',to:1,candidate:{candidate:'test-after-stop'}});
    await wait(()=>s1.json.some(m=>m.type==='signal'&&m.candidate?.candidate==='test-after-stop'),'signaling survives');
    console.log(`${kind}: host-only terminal viewer state; player relay/signaling survives PASS`);
  }
} finally {
  for(const ws of sockets)ws.close();child.kill();
}
