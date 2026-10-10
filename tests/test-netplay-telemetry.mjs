import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTelemetryStore, validateSample, startTelemetryServer, capacityModel } from '../server/netplay-telemetry.mjs';
import { createNetplayTelemetry } from '../.cache/build/browser/assets/launcher/netplay-telemetry.mjs';
let at=0,tx=100,rx=200,pair='pair',path='host',fail=false;
const pc={getStats:async()=>{if(fail)throw Error('closed');return new Map([
  ['transport',{type:'transport',selectedCandidatePairId:pair}],
  [pair,{id:pair,type:'candidate-pair',localCandidateId:'local',remoteCandidateId:'remote',bytesSent:tx,bytesReceived:rx,packetsSent:10,packetsReceived:20}],
  ['local',{candidateType:path,address:'must-never-be-reported'}],['remote',{candidateType:'srflx',address:'must-never-be-reported'}],
]);}};
let snapshot={identity:{},product:'th11mp',players:2,spectator:false,transport:'rtc',peers:new Map([[1,{pc}]])};
const records=[];const reporter=createNetplayTelemetry({origin:'https://example.test',endpoint:()=>'/netplay-stats/sample',
  snapshot:()=>snapshot,now:()=>at,id:()=> '12345678-1234-1234-1234-123456789abc',send:async(url,r)=>{records.push(r);assert.equal(new URL(url).origin,'https://example.test');}});
await reporter.tick();assert.equal(records[0].route,'direct');assert.equal(records[0].seconds,0);
at=15000;tx+=1000;rx+=2000;await reporter.tick();assert.equal(records[1].links[0].tx,1000);assert.equal(records[1].links[0].seconds,15);
assert(!JSON.stringify(records).includes('must-never'));assert(records.every(r=>validateSample(r)));
// An ICE restart must not turn cumulative bytes or the old route into traffic.
at+=15000;pair='restart';path='relay';tx=30;rx=40;await reporter.tick();assert.equal(records[2].route,'unknown');assert.equal(records[2].links.length,0);
at+=15000;tx+=3000;rx+=4000;await reporter.tick();assert.equal(records[3].route,'turn');assert.equal(records[3].links[0].tx,3000);
at+=150000;tx+=10000;await reporter.tick();assert.equal(records[4].seconds,0);assert.equal(records[4].links.length,0);
at+=15000;fail=true;await reporter.tick();assert.equal(records[5].route,'unknown');assert.equal(records[5].links.length,0);
at+=15000;snapshot={...snapshot,identity:{},spectator:true,transport:'spectator'};await reporter.tick();assert.equal(records[6].role,'spectator');assert.equal(records[6].route,'websocket');assert.equal(records[6].seq,1);
const mixed=createNetplayTelemetry({origin:'https://example.test',endpoint:()=>'/netplay-stats/sample',now:()=>at,id:()=> '12345678-1234-1234-1234-123456789abd',
  snapshot:()=>({...snapshot,identity:pc,spectator:false,players:3,transport:'rtc',peers:new Map([[1,{pc:{getStats:async()=>new Map([['t',{type:'transport',selectedCandidatePairId:'p'}],['p',{id:'p',localCandidateId:'l',remoteCandidateId:'r',bytesSent:0,bytesReceived:0}],['l',{candidateType:'host'}],['r',{candidateType:'host'}]])}}],[2,{pc:{getStats:async()=>new Map([['t',{type:'transport',selectedCandidatePairId:'p'}],['p',{id:'p',localCandidateId:'l',remoteCandidateId:'r',bytesSent:0,bytesReceived:0}],['l',{candidateType:'host'}],['r',{candidateType:'relay'}]])}}]])}),send:async(u,r)=>{assert.equal(r.route,'mixed');}});
await mixed.tick();
const disabled=createNetplayTelemetry({origin:'https://example.test',endpoint:()=> 'https://other.test/sample',snapshot:()=>{throw Error('must not inspect');}});await disabled.tick();
let time=Date.UTC(2026,9,10),store=createTelemetryStore({},()=>time);
assert(store.accept(records[0]));assert(!store.accept(records[0]));time+=15000;assert(store.accept(records[1]));
let s=store.snapshot();assert.equal(s.days['2026-10-10'].total.direct.seconds,15);assert.equal(s.days['2026-10-10'].total.sessions,1);assert.equal(s.active.players,1);
assert(!JSON.stringify(s).includes(records[0].id));assert(!validateSample({...records[1],route:'turn'}));assert(!validateSample({...records[1],seconds:100}));
assert(!validateSample({...records[0],id:[records[0].id]}));
assert.equal(capacityModel({}).unitMbps,.6);assert.equal(capacityModel({day:{products:{th08mp:{direct:{seconds:0},turn:{seconds:100,tx:2600000,txPackets:20300}}}}}).unitMbps,1);
assert(!validateSample({...records[1],links:[{...records[1].links[0],tx:-1}]}));
assert(!store.accept({...records[1],seq:9,seconds:90,links:[{...records[1].links[0],seconds:90}]}));
time+=50000;assert.equal(store.snapshot().active.players,0);
const automationStore=createTelemetryStore({},()=>time);assert(automationStore.accept({...records[0],automated:true}));assert.equal(automationStore.snapshot().active.players,0);assert.equal(Object.values(automationStore.snapshot().days)[0].total.sessions,0);assert.equal(Object.values(automationStore.snapshot().days)[0].automation.sessions,1);
const dir=await mkdtemp(join(tmpdir(),'netplay-telemetry-'));const stateFile=join(dir,'state.json');let service;
try{
 service=await startTelemetryServer({port:0,origin:'https://example.test',stateFile});const base='http://127.0.0.1:'+service.server.address().port;
 let r=await fetch(base+'/netplay-stats/sample',{method:'POST',headers:{Origin:'https://wrong.test','Content-Type':'application/json'},body:JSON.stringify(records[0])});assert.equal(r.status,403);
 r=await fetch(base+'/netplay-stats/sample',{method:'POST',headers:{Origin:'https://example.test','Content-Type':'application/json'},body:JSON.stringify({...records[0],playerName:'do-not-retain',ip:'do-not-retain'})});assert.equal(r.status,204);
 const publicData=await (await fetch(base+'/netplay-stats/summary')).text();assert(!publicData.includes('do-not-retain'));assert(!publicData.includes(records[0].id));
 assert.equal((await fetch(base+'/netplay-stats/')).status,200);await service.close();service=null;
 const persisted=JSON.parse(await readFile(stateFile,'utf8'));assert.equal(persisted.days[Object.keys(persisted.days)[0]].total.sessions,1);assert(!JSON.stringify(persisted).includes(records[0].id));
 service=await startTelemetryServer({port:0,origin:'https://example.test',stateFile});assert(Object.keys(service.store.snapshot().days).length);
}finally{if(service)await service.close();await rm(dir,{recursive:true,force:true});}
console.log('Anonymous netplay telemetry: routes, reset, mixed mesh, aggregation, privacy and HTTP persistence PASS');
