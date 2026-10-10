/** Original keyboard harness setup only. Synthetic DOM/protocol ports; no
 * browser, candidate Runtime, SDL state, multiplayer or confirmed-hash proof. */
import test, {before, after} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFile, mkdir, mkdtemp, writeFile, rm, access} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {runInNewContext} from 'node:vm';
import {buildOriginalComponentFixture, originalComponentFixture} from './original-component-fixture.mjs';
import {installMountedDom} from '../react-main/mounted-dom-environment.mjs';
const project=fileURLToPath(new URL('../../',import.meta.url)), path='tests/test-keyboard-ownership-browser.py';
let fixture, adapter, work, env, HostedKeyboard, launcherPreparation;
const fingerprint=async path=>createHash('sha256').update(await readFile(path)).digest('hex');
before(async()=>{
  await mkdir(resolve(project,'.cache'),{recursive:true});work=await mkdtemp(resolve(project,'.cache/keyboard-adapter-'));
  // Compile the default-handler oracle from source using the canonical launcher
  // configuration. Never import or read the shared, potentially stale cache.
  const output=resolve(work,'.cache/build/browser/assets');
  await assert.rejects(access(output),{code:'ENOENT'});
  const sources=['tsconfig.launcher.json','src/launcher/app.mts','src/launcher/hosted-keyboard.mts'];
  const beforeHashes=await Promise.all(sources.map(path=>fingerprint(resolve(project,path))));
  execFileSync(process.execPath,[resolve(project,'node_modules/typescript/bin/tsc'),'-p',resolve(project,'tsconfig.launcher.json'),'--outDir',output,'--pretty','false'],{cwd:project,stdio:'pipe'});
  assert.deepEqual(await Promise.all(sources.map(path=>fingerprint(resolve(project,path)))),beforeHashes,'oracle sources changed during compilation');
  launcherPreparation={cold:true,sources:Object.fromEntries(sources.map((path,index)=>[path,beforeHashes[index]])),
    outputs:Object.fromEntries(await Promise.all(['app.mjs','hosted-keyboard.mjs'].map(async name=>[name,await fingerprint(resolve(output,'launcher',name))])))};
  ({HostedKeyboard}=await import(pathToFileURL(resolve(output,'launcher/hosted-keyboard.mjs')).href));
  fixture=await buildOriginalComponentFixture('keyboard-ownership');
  const file=resolve(work,'fixture.mjs');await writeFile(file,fixture.module);
  env=installMountedDom();adapter=await import(pathToFileURL(file).href);
});
after(async()=>{try {if(env){assert.deepEqual(env.errors,[]);env.close();}} finally {if(work) await rm(work,{recursive:true,force:true});}});
function hostHtml(react) {
  return execFileSync('python3',['-c',`
import ast,json
from pathlib import Path
source=Path(${JSON.stringify(path)}).read_text()
node=next(n for n in ast.parse(source).body if isinstance(n,ast.FunctionDef) and n.name=='host_html')
context={'ROOT':Path(${JSON.stringify(react ? '/no-main-launcher-cache' : work)}),'FIXTURE':{'module':'selected'} if ${react ? 'True':'False'} else None,'json':json}
exec(compile(ast.Module(body=[node],type_ignores=[]),'keyboard-host-setup','exec'),context)
print(context['host_html']('th06').decode())
`],{cwd:project,encoding:'utf8'});
}
test('default oracle is compiled into cold isolated output before import and never consumes the shared cache',async t=>{
  assert.equal(launcherPreparation.cold,true);
  for(const hash of Object.values(launcherPreparation.outputs)) assert.match(hash,/^[a-f0-9]{64}$/);
  const html=hostHtml(false),compiled=await readFile(resolve(work,'.cache/build/browser/assets/launcher/app.mjs'),'utf8');
  const start=compiled.indexOf('const hostedKeyboard'),end=compiled.indexOf('function preventPlayerBrowserGesture',start);
  assert.ok(start>=0&&end>start);assert.ok(html.includes(compiled.slice(start,end)));
  t.diagnostic(JSON.stringify(launcherPreparation));
});
test('explicit selection bundles the actual keyboard owner/shared protocol without original application bootstrap',async()=>{
  assert.equal(await originalComponentFixture('keyboard-ownership','main'),null);
  await assert.rejects(originalComponentFixture('keyboard-ownership','invalid'),/main or react/);
  for(const path of ['app/services/player-keyboard.ts','src/launcher/hosted-keyboard.mts','src/launcher/touch-runtime-protocol.mts','src/launcher/touch-function-key.mts']) assert.ok(fixture.inputs.includes(path),path);
  assert.equal(fixture.inputs.some(path=>path.endsWith('/app.mts')||path.includes('original-bootstrap')),false);
  const html=hostHtml(true);assert.match(html,/installKeyboardOwnershipFixture/);assert.doesNotMatch(html,/const hostedKeyboard =/);
  assert.match(html,/frame.src='\/runtime\/\+?/); // Runtime URL is checked byte-for-byte below as well.
});
test('every original scenario/engine/probe/relay action and assertion remains byte-identical',async()=>{
  const baseline=execFileSync('git',['show','edee9633:'+path],{cwd:project,encoding:'utf8'}),current=await readFile(resolve(project,path),'utf8');
  const marker='def admit_lobby(';
  assert.equal(current.slice(current.indexOf(marker)),baseline.slice(baseline.indexOf(marker)));
  const info=JSON.parse(execFileSync('python3',['-c',`
import ast,json,subprocess
from pathlib import Path
old=subprocess.check_output(['git','show','edee9633:${path}'],text=True); new=Path('${path}').read_text()
def assertions(source):
 return [ast.get_source_segment(source,n) for n in ast.walk(ast.parse(source)) if isinstance(n,ast.Assert)]
print(json.dumps({'count':len(assertions(old)),'same':assertions(old)==assertions(new)}))
`],{cwd:project,encoding:'utf8'}));
  assert.ok(info.count>0);assert.equal(info.same,true);
  const originalRuntimeLine=baseline.split('\n').find(line=>line.startsWith('frame.src='));
  assert.ok(current.includes(originalRuntimeLine));
});
test('default compiled handlers have their missing canonical inert function owner and clear on pagehide',()=>{
  const html=hostHtml(false),start=html.indexOf('const hostedKeyboard ='),end=html.indexOf('const pending=',start);
  assert.ok(start>0&&end>start);const handlers={},messages=[];let touchSends=0;
  const ports={HostedKeyboard,window:{addEventListener:(name,fn)=>handlers[name]=fn},document:{addEventListener(){}},
    state:{launched:true,game:'th06'},player:{classList:{contains:()=>true}},frame:{contentWindow:{}},protocol:'eagler-touhou/1',
    releaseHeldTouchFire(){},touchRuntimeMessageContext:()=>({game:'th06',epoch:1}),deliverRuntimeInput:(_,message)=>messages.push(message)};
  runInNewContext(html.slice(start,end),ports);
  assert.throws(()=>handlers.pagehide(),/touchFunctionOwner/);
  ports.touchFunctionOwner=adapter.createFunctionKeyOwner(()=>{touchSends++;throw new Error('Unexpected held fixture touch key');});
  handlers.pagehide();assert.equal(touchSends,0);assert.equal(messages.at(-1).command,'keyboard-clear');
  assert.match(html,/createFunctionKeyOwner\(\(\)=>\{throw new Error\('Keyboard fixture unexpectedly acquired host touch input'\)/);
});
test('compiled production keyboard attaches to original fixture elements and uses the real canonical delivery boundary',()=>{
  const {document,window}=env;document.body.innerHTML='<div id="player" class="open"><iframe id="runtime"></iframe></div><button id="control">Launcher control</button>';
  const player=document.getElementById('player'),frame=document.getElementById('runtime'),control=document.getElementById('control');
  const state={launched:false,game:'th06'},messages=[];let spectator=false,touchSends=0;
  const context=()=>({target:frame.contentWindow,targetOrigin:window.location.origin,protocol:'eagler-touhou/1',game:'th06',epoch:1,launched:state.launched,ready:state.launched,spectator});
  frame.contentWindow.__eaglerDirectInputBridge={schema:'eagler-touhou/direct-input/1',protocol:'eagler-touhou/1',game:'th06',epoch:1,origin:window.location.origin,submit:message=>{messages.push(message);return true;}};
  const originalPost=frame.contentWindow.postMessage;let fallback=0;frame.contentWindow.postMessage=()=>fallback++;
  const owner=adapter.installKeyboardOwnershipFixture({state,frame,player,touchRuntimeMessageContext:context,releaseHeldTouchFire(){},
    touchFunctionOwner:adapter.createFunctionKeyOwner(()=>{touchSends++;throw new Error('Unexpected fixture touch input');})});
  const key=(type,target,changes={})=>target.dispatchEvent(new window.KeyboardEvent(type,{bubbles:true,cancelable:true,key:'Shift',code:'ShiftLeft',keyCode:16,location:1,...changes}));
  try {
    key('keydown',player);assert.equal(messages.length,0);
    state.launched=true;owner.sync();key('keydown',player);key('keyup',control,{code:'Unidentified',location:0,keyCode:0});
    assert.deepEqual(messages.map(({command,down,code})=>({command,down,code})),[{command:'keyboard',down:true,code:'ShiftLeft'},{command:'keyboard',down:false,code:'ShiftLeft'}]);
    key('keydown',player);window.dispatchEvent(new window.Event('pagehide'));assert.equal(messages.at(-1).command,'keyboard-clear');
    const before=messages.length;key('keydown',player,{repeat:true});key('keyup',control,{code:'Unidentified',location:0,keyCode:0});assert.equal(messages.length,before);
    key('keydown',player);assert.equal(messages.length,before+1,'pagehide must not dispose the owner');
    spectator=true;const count=messages.length;key('keydown',player);key('keyup',control);assert.equal(messages.length,count);
    assert.equal(touchSends,0);assert.equal(fallback,0);assert.equal(document.getElementById('runtime'),frame);
  } finally {owner.dispose();frame.contentWindow.postMessage=originalPost;}
});
