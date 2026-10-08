/** Screen lock and lifecycle fences are deterministic service evidence, not
 * physical-device orientation acceptance. */
import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {build} from 'esbuild';

const root = fileURLToPath(new URL('../..', import.meta.url));
const bundle = await build({entryPoints:[join(root, 'app/services/runtime-orientation.client.ts')], bundle:true, format:'esm', platform:'browser', write:false});
const directory = await mkdtemp(join(tmpdir(), 'runtime-orientation-test-'));
after(() => rm(directory, {recursive:true, force:true}));
const modulePath = join(directory, 'orientation.mjs');
await writeFile(modulePath, bundle.outputFiles[0].text);
const {createRuntimeOrientationController} = await import(pathToFileURL(modulePath).href);
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
const capabilityState=()=>({checked:false,unsupported:false});

test('screen lock targets the opposite measured orientation and waits for geometry frames', async () => {
  const requests=[], unlocks=[];let layouts=0;
  const orientation={type:'landscape-primary',async lock(value){requests.push(value);},unlock(){unlocks.push(1);}};
  const owner=createRuntimeOrientationController({screen:{orientation},mobile:true,capabilityState:capabilityState(),waitForLayout:async()=>{layouts++;}});
  owner.setSession(4);
  const result=await owner.request({epoch:4,orientation:'landscape',fullscreen:true,enterFullscreen:async()=>false,current:()=>true});
  assert.deepEqual(result,{status:'requested',orientation:'portrait'});assert.deepEqual(requests,['portrait']);assert.equal(layouts,1);
  assert.equal(unlocks.length,0,'a successful target lock stays active');owner.dispose();
});

test('orientation lock failure is reported and NotSupportedError removes future controls', async () => {
  const orientation={type:'portrait-primary',async lock(){throw new DOMException('unsupported','NotSupportedError');}};
  const owner=createRuntimeOrientationController({screen:{orientation},mobile:true,capabilityState:capabilityState()});
  const result=await owner.request({epoch:null,orientation:'portrait',fullscreen:true,enterFullscreen:async()=>true,current:()=>true});
  assert.deepEqual(result,{status:'unsupported'});assert.equal(owner.getSnapshot().available,false);owner.dispose();
});

test('a Runtime epoch change during fullscreen or lock work fences stale completion', async () => {
  const lock=deferred(),orientation={type:'landscape-primary',lock:()=>lock.promise};let waited=0;
  const owner=createRuntimeOrientationController({screen:{orientation},mobile:true,capabilityState:capabilityState(),waitForLayout:async()=>{waited++;}});
  owner.setSession(1);
  const request=owner.request({epoch:1,orientation:'landscape',fullscreen:true,enterFullscreen:async()=>true,current:()=>true});
  owner.setSession(2);lock.resolve();
  assert.deepEqual(await request,{status:'superseded'});assert.equal(waited,0);owner.dispose();
});

test('a failed fullscreen request does not call the orientation lock', async () => {
  let locks=0;
  const owner=createRuntimeOrientationController({screen:{orientation:{lock:async()=>{locks++;}}},mobile:true,capabilityState:capabilityState()});
  const result=await owner.request({epoch:null,orientation:'portrait',fullscreen:false,enterFullscreen:async()=>false,current:()=>true});
  assert.deepEqual(result,{status:'failed'});assert.equal(locks,0);owner.dispose();
});
