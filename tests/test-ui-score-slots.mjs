import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join} from 'node:path';import {pathToFileURL} from 'node:url';
const directory=await mkdtemp(join(tmpdir(),'score-slot-ui-'));
try{
 const output=join(directory,'owner.mjs');await build({entryPoints:['app/services/score-slots.client.ts'],outfile:output,bundle:true,platform:'node',format:'esm'});
 const{createScoreSlotService}=await import(pathToFileURL(output));let resolveAdd;let notifications=0;
 const owner=createScoreSlotService({list:async()=>[],active:async()=>null,add:()=>new Promise(resolve=>{resolveAdd=resolve;}),select:async(_product,id)=>{if(id==='fail')throw Error('commit failed');}});
 const unlisten=owner.subscribe(()=>notifications++);
 const task=owner.add('th06','th06','demo.dat',new Uint8Array([1]));assert.equal(owner.revision('th06'),0);assert.equal(notifications,0);
 resolveAdd({id:'saved'});await task;assert.equal(owner.revision('th06'),1);assert.equal(owner.revision('th06mp'),0);assert.equal(notifications,1);
 await assert.rejects(owner.select('th06','fail'),/commit failed/);assert.equal(owner.revision('th06'),1);assert.equal(notifications,1);
 await owner.select('th06mp','okay');assert.equal(owner.revision('th06mp'),1);assert.equal(notifications,2);
 unlisten();await owner.select('th06',null);assert.equal(owner.revision('th06'),2);assert.equal(notifications,2);
 console.log('PASS score slot notifications: commit-only, failure-safe, product-isolated and view-independent');
}finally{await rm(directory,{recursive:true,force:true});}
