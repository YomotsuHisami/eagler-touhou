import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {build} from 'esbuild';
const root=fileURLToPath(new URL('../..',import.meta.url));
await mkdir(join(root,'.cache'),{recursive:true});
const dir=await mkdtemp(join(root,'.cache/notice-edge-'));
const result=await build({stdin:{contents:"export * from './app/browser/notice-edge-bindings.ts'; export * from './app/services/notice-edge-layout.ts';",resolveDir:root,loader:'ts'},bundle:true,write:false,format:'esm',platform:'node'});
await writeFile(join(dir,'test.mjs'),result.outputFiles[0].text);
const {bindNoticeEdgeGestures,noticeEdgeLayout}=await import(pathToFileURL(join(dir,'test.mjs')));
await rm(dir,{recursive:true,force:true});
function fixture(){
 const events=new Map(),calls={first:0,closeFirst:0,site:0,closeSite:0};
 const state={firstUseOpen:false,site:{open:false,enabled:true}};let playing=false;
 const right={contains:target=>target===right},left={contains:target=>target===left};
 const doc={body:{classList:{contains:()=>false}},documentElement:{clientWidth:415},querySelector:selector=>selector.includes('data-runtime-host')?(playing?{}:null):selector.includes('notice-right')?right:left,
  addEventListener(type,handler){if(!events.has(type))events.set(type,new Set());events.get(type).add(handler);},removeEventListener(type,handler){events.get(type)?.delete(handler);}};
 const service={getSnapshot:()=>state,showFirstUse(){calls.first++;state.firstUseOpen=true;return Promise.resolve(true);},closeFirstUse(){calls.closeFirst++;state.firstUseOpen=false;},loadSite(){calls.site++;state.site.open=true;return Promise.resolve(true);},closeSite(){calls.closeSite++;state.site.open=false;}};
 const stop=bindNoticeEdgeGestures(service,{documentObj:doc,windowObj:{innerWidth:430}});
 function emit(type,x,y=320,target=right){for(const handler of events.get(type)||[])handler({isPrimary:true,button:0,pointerId:1,clientX:x,clientY:y,target,preventDefault(){}});}
 function swipe(a,b,target=right){emit('pointerdown',a,320,target);emit('pointermove',b,321,target);emit('pointerup',b,321,target);}
 return{state,calls,events,right,left,emit,swipe,stop,setPlaying(value){playing=value;}};
}
test('one adapter reuses service open/dismissal and obeys site opt-out',()=>{
 const f=fixture();f.swipe(428,348);assert.equal(f.calls.first,1);f.swipe(90,170);assert.equal(f.calls.closeFirst,1);
 f.swipe(2,82,f.left);assert.equal(f.calls.site,1);f.swipe(300,220,f.left);assert.equal(f.calls.closeSite,1);
 f.state.site.enabled=false;f.swipe(2,82,f.left);assert.equal(f.calls.site,1);f.stop();
});
test('visible Runtime blocks opening and also wins if visibility changes during gesture',()=>{
 const f=fixture();f.setPlaying(true);f.swipe(428,348);assert.equal(f.calls.first,0);
 f.setPlaying(false);f.emit('pointerdown',428);f.emit('pointermove',348);f.setPlaying(true);f.emit('pointerup',348);assert.equal(f.calls.first,0);f.stop();
});
test('vertical cancellation, insufficient travel and disposal never publish open',()=>{
 const f=fixture();f.emit('pointerdown',428);f.emit('pointermove',420,400);f.emit('pointerup',348,401);f.swipe(428,400);assert.equal(f.calls.first,0);
 f.stop();f.swipe(428,348);assert.equal(f.calls.first,0);assert.ok([...f.events.values()].every(values=>values.size===0));
});
test('right drawer aligns with visual viewport without shifting the reserved library gutter',()=>{
 assert.deepEqual(noticeEdgeLayout(430,415),{right:-15,width:404.2});
 assert.deepEqual(noticeEdgeLayout(430,430),{right:0,width:404.2});
 assert.deepEqual(noticeEdgeLayout(1280,1265),{right:-15,width:700});
});
