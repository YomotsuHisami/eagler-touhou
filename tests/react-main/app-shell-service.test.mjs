/** Main app1093–1184 and unchanged lifecycle guards; synthetic SW ports only. */
import test, {before, after} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdir, mkdtemp, rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
let work, createAppShellService;
before(async () => {await mkdir(resolve('.cache'), {recursive:true}); work = await mkdtemp(resolve('.cache/app-shell-main-')); const outfile = resolve(work, 'model.mjs'); await build({entryPoints:['app/services/app-shell.ts'], outfile, bundle:true, format:'esm', platform:'node', logLevel:'silent'}); ({createAppShellService} = await import(pathToFileURL(outfile).href));});
after(async () => {if(work) await rm(work,{recursive:true,force:true});});
const tick = () => new Promise(r => setImmediate(r));
class Target {listeners = new Map(); addEventListener(type, fn) {this.listeners.set(type, [...this.listeners.get(type)??[], fn]);} emit(type) {for(const fn of this.listeners.get(type)??[]) fn();}}
function fixture({enabled=false}={}) {
  const registration = new Target(); registration.scope='https://site.invalid/test/'; registration.active=Object.assign(new Target(),{state:'activated',scriptURL:'https://site.invalid/test/app-shell-sw.js',postMessage(){}}); registration.waiting = null; registration.installing = null; registration.updates=0; registration.update=async()=>{registration.updates++;};
  const serviceWorker={controller:{scriptURL:'https://site.invalid/test/app-shell-sw.js'},calls:[],async register(...args){this.calls.push(args);return registration;},async getRegistration(){return null;}};
  const activity={launched:false,runtimeReady:false,runtimeSessionActive:false,touchLayoutEditing:false,blockingOperation:false,gameDataAttempt:false,launchInFlight:false,decisionOpen:false,replayOpen:false};
  const timers = new Map(); let serial=0, reloads=0, online=true;
  const model=createAppShellService({baseUrl:'https://site.invalid/test/',deployment:enabled?{workerUrl:'https://site.invalid/test/app-shell-sw.js',scope:'/test/'}:undefined,serviceWorker,secureContext:true,activity:()=>activity,translate:(key,p)=>`${key}:${p?.reason??p?.seconds??''}`,online:()=>online,reload:()=>reloads++,timers:{setTimeout(fn,ms){const id=++serial;timers.set(id,{fn,ms});return id;},clearTimeout(id){timers.delete(id);}},fetchImpl:async()=>({ok:false}),logger:{warn(){}}});
  return {model,serviceWorker,registration,activity,timers,reloads:()=>reloads,offline(){online=false;}};
}
test('isolated experimental UI does not register any worker without explicit deployment',async()=>{const f=fixture();await f.model.ready;assert.deepEqual(f.serviceWorker.calls,[]);f.model.dispose();});
test('explicit deployment passes only selected worker URL and scope to original owner',async()=>{const f=fixture({enabled:true});await f.model.ready;assert.deepEqual(f.serviceWorker.calls,[['https://site.invalid/test/app-shell-sw.js',{scope:'/test/',updateViaCache:'none'}]]);f.model.dispose();});
test('remote status preserves source error normalization and retry priority',async()=>{const f=fixture();f.model.setRemoteState('unavailable',new Error('HTTP 503 unavailable'));assert.deepEqual(f.model.getSnapshot().status,{kind:'offline',text:'status.remoteUnavailable:HTTP 503'});f.offline();f.model.refreshLocale();assert.equal(f.model.getSnapshot().status.text,'status.remoteUnavailable:status.deviceOffline:');f.model.setRemoteState('retrying');assert.equal(f.model.getSnapshot().status.kind,'checking');f.model.setRemoteState('ready');assert.equal(f.model.getSnapshot().status.text,'');f.model.dispose();});
test('every original busy flag blocks activation, then rechecks activity before reload',async()=>{
 const f=fixture({enabled:true}); f.activity.decisionOpen=true;await f.model.ready;
 const worker=new Target();worker.scriptURL='https://site.invalid/test/app-shell-sw.js';worker.state='installing';worker.messages=[];worker.postMessage=m=>{worker.messages.push(m);worker.state='activated';worker.emit('statechange');};
 f.registration.installing=worker;f.registration.emit('updatefound');worker.state='installed';worker.emit('statechange');await tick();assert.equal(worker.messages.length,0);
 for(const key of Object.keys(f.activity)){for(const k of Object.keys(f.activity)) f.activity[k]=k===key;f.model.notifyActivityChanged();await tick();assert.equal(worker.messages.length,0,key);}
 for(const key of Object.keys(f.activity))f.activity[key]=false;f.model.notifyActivityChanged();await tick();assert.equal(worker.messages.length,1);
 f.activity.decisionOpen=true;for(const [id,timer]of [...f.timers])if(timer.ms===0){f.timers.delete(id);timer.fn();}assert.equal(f.reloads(),0);
 f.activity.decisionOpen=false;f.model.notifyActivityChanged();await tick();for(const [id,timer]of [...f.timers])if(timer.ms===0){f.timers.delete(id);timer.fn();}assert.equal(f.reloads(),1);f.model.dispose();
});
test('disposed owner ignores late registration status and never reloads',async()=>{const f=fixture({enabled:true});f.model.dispose();await f.model.ready;assert.equal(f.reloads(),0);assert.equal(f.timers.size,0);});

test('Runtime worker port uses only verified registration and fences later replacement',async()=>{
 const f=fixture({enabled:true});await f.model.ready;const seen=[];const active=f.registration.active;active.postMessage=function(message,ports){assert.equal(this,active);seen.push([message,ports]);};
 const port=await f.model.activeWorker();assert.ok(port);port.postMessage({type:'probe'},[]);assert.equal(seen.length,1);
 f.registration.active={...active,scriptURL:'https://site.invalid/foreign.js'};assert.equal(await f.model.activeWorker(),null);assert.throws(()=>port.postMessage({},[]),/no longer/);
 assert.equal(seen.length,1);f.model.dispose();assert.equal(await f.model.activeWorker(),null);
});
test('Runtime worker port is absent without explicit deployment or after owner disposal',async()=>{
 const a=fixture();assert.equal(await a.model.activeWorker(),null);a.model.dispose();
 const b=fixture({enabled:true});await b.model.ready;const port=await b.model.activeWorker();assert.ok(port);b.model.dispose();assert.equal(await b.model.activeWorker(),null);assert.throws(()=>port.postMessage({},[]),/no longer/);
});
