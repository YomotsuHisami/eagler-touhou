/** Independent mounted synthetic-DOM regression. No browser/native top-layer/CSS claim. */
import test, {before, after, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';
import {mkdtemp, rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {dirname, resolve} from 'node:path';
import {pathToFileURL, fileURLToPath} from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const project = resolve(here, '../..');
let buildDirectory;
const require = createRequire(resolve(project, 'package.json'));
const {build} = require('esbuild');
const {JSDOM} = require('jsdom');
const {installMountedDom} = await import(pathToFileURL(resolve(project, 'tests/react-main/mounted-dom-environment.mjs')));
const pinnedMain = 'edee9633e5e3ee79cd2e1aa334f84f6caf755090';
const pinned = path => execFileSync('git', ['show', `${pinnedMain}:${path}`], {cwd: project, encoding:'utf8'});
let env, React, createRoot, owners, baselineHTML, current = null;
const alive = new Set();
const originalSetTimeout = globalThis.setTimeout, originalClearTimeout = globalThis.clearTimeout;
let reduce = true, clock;
before(async () => {
  env = installMountedDom();
  env.window.HTMLElement.prototype.scrollIntoView = function () {};
  env.window.AnimationEvent = class extends env.window.Event {}; // React event capability detection, synthetic only
  globalThis.matchMedia = env.window.matchMedia = query => ({matches: reduce, media:query, addEventListener(){}, removeEventListener(){}});
  React = await import(pathToFileURL(require.resolve('react')));
  ({createRoot} = await import(pathToFileURL(require.resolve('react-dom/client'))));
  for (const p of ['src/launcher/first-use-notice.mts','src/launcher/content-fragment.mts','src/launcher/i18n.mts']) assert.equal(readFileSync(resolve(project,p),'utf8'),pinned(p),`baseline ${p} changed`);
  baselineHTML = pinned('public/index.html');
  buildDirectory = await mkdtemp(resolve(here, 'notices-build-'));
  await build({absWorkingDir:project, stdin:{resolveDir:project,loader:'ts',contents:`
    export * from './app/components/notices/FirstUseNotice.tsx';
    export * from './app/components/notices/MultiplayerGuideDialog.tsx';
    export * from './app/components/notices/DonationDialog.tsx';
    export * from './app/components/notices/AppleRefreshDialog.tsx';
    export * from './app/i18n.tsx';
    export {createFirstUseNoticeController} from './src/launcher/first-use-notice.mts';
    export {createMultiplayerGuideController} from 'pinned:multiplayer-guide.mts';
    export * from './src/launcher/content-fragment.mts';
  `},bundle:true,platform:'node',format:'esm',jsx:'automatic',outfile:resolve(buildDirectory,'actual-bundle.mjs'),logLevel:'silent',plugins:[{name:'pinned-guide-oracle',setup(ctx){
    // The production owners now share the builder. Keep their oracle independent
    // by executing the complete pinned controller and its pinned sanitizer.
    ctx.onResolve({filter:/^pinned:/},args=>({path:args.path.slice(7),namespace:'pinned'}));
    ctx.onResolve({filter:/^\.\/content-fragment\.mjs$/,namespace:'pinned'},()=>({path:'content-fragment.mts',namespace:'pinned'}));
    ctx.onLoad({filter:/.*/,namespace:'pinned'},args=>({contents:pinned(`src/launcher/${args.path}`),resolveDir:resolve(project,'src/launcher'),loader:'ts'}));
  }},{name:'existing-deps-and-original-mts',setup(ctx){
    ctx.onResolve({filter:/^[^./]/},args=>({path:require.resolve(args.path),external:true}));
    ctx.onResolve({filter:/^\.\.?\/.*\.mjs$/},args=>{const path=resolve(dirname(args.importer),args.path).replace(/\.mjs$/,'.mts');if(existsSync(path))return {path};});
  }}]});
  owners = await import(pathToFileURL(resolve(buildDirectory,'actual-bundle.mjs')));
});
afterEach(async () => {
  globalThis.setTimeout = originalSetTimeout; globalThis.clearTimeout = originalClearTimeout; clock = null;
  for(const m of alive) await React.act(async()=>m.root.unmount());
  alive.clear(); current=null; env.document.body.replaceChildren(); reduce=true;
  assert.deepEqual(env.errors.splice(0),[], 'No React/DOM errors');
});
after(async () => {
  try { env?.close(); } finally {
    if (buildDirectory) await rm(buildDirectory, {recursive: true, force: true});
  }
});
function n(selector, scope=env.document){const v=scope.querySelector(selector);assert.ok(v,`missing ${selector}`);return v;}
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
const response = (text, status=200)=>({ok:status>=200&&status<300,status,text:async()=>text});
const flush = ()=>React.act(async()=>{await Promise.resolve();await Promise.resolve();});
function storage(seed={}){const values=new Map(Object.entries(seed)),writes=[];return {values,writes,getItem:k=>values.get(k)??null,setItem:(k,v)=>{writes.push([k,v]);values.set(k,v);}};}
async function mount(Component, initial={}, {strict=false,locale='zh-CN',parent=false}={}) {
  let props={open:false,onCloseRequest(){},...initial};
  const container=env.document.createElement('div');env.document.body.append(container);
  let nativeParent;
  if(parent){nativeParent=env.document.createElement('dialog');nativeParent.id='nativeParent';env.document.body.append(nativeParent);nativeParent.showModal();}
  const root=createRoot(container);const m={root,container,props,nativeParent,async update(p){props={...props,...p};m.props=props;await render();},async setLocale(next){locale=next;await render();},async unmount(){await React.act(async()=>root.unmount());alive.delete(m);}};
  async function render(){let element=React.createElement(owners.LocaleProvider,{locale},React.createElement(Component,props));if(strict)element=React.createElement(React.StrictMode,null,element);await React.act(async()=>root.render(element));}
  alive.add(m);current=m;await render();return m;
}
function fakeClock(){let now=0,serial=0;const timers=new Map();globalThis.setTimeout=(fn,delay)=>{timers.set(++serial,{at:now+delay,fn});return serial;};globalThis.clearTimeout=id=>timers.delete(id);clock={timers,async advance(ms){now+=ms;await React.act(async()=>{for(const [id,t] of [...timers])if(t.at<=now){timers.delete(id);t.fn();}});}};return clock;}
async function click(selector){await React.act(async()=>n(selector).click());}
async function cancel(selector){const e=new env.window.Event('cancel',{cancelable:true});await React.act(async()=>n(selector).dispatchEvent(e));assert.equal(e.defaultPrevented,true);}
function normalize(element){if(element.nodeType===3)return element.textContent.replace(/\s+/g,' ').trim()||null;if(element.nodeType!==1)return null;const attrs=[...element.attributes].filter(a=>!a.name.startsWith('data-i18n')&&a.name!=='open').map(a=>[a.name,a.value]).sort(([a],[b])=>a.localeCompare(b));return [element.localName,attrs,[...element.childNodes].map(normalize).filter(Boolean)];}
function baselineDialog(id,locale='zh-CN'){const doc=new env.window.DOMParser().parseFromString(baselineHTML,'text/html'),el=n('#'+id,doc);for(const e of el.querySelectorAll('[data-i18n]'))e.textContent=owners.translate(locale,e.dataset.i18n);for(const e of el.querySelectorAll('[data-i18n-aria-label]'))e.setAttribute('aria-label',owners.translate(locale,e.getAttribute('data-i18n-aria-label')));return el;}
const html='<h2>通用规则</h2><h3>网络</h3><p class="markdown-blockquote unsafe" onclick="bad()">Safe <a href="javascript:alert(1)">bad link</a><a href="/safe" target="_blank">safe link</a></p><script>window.bad=1</script><svg onload="bad()"><text>badsvg</text></svg><img src="data:bad"><img src="/safe.png" onerror="bad()"><h2>TH06 红魔乡</h2><h3>本作特有规则</h3><h4>Six</h4><p>TH06 rules</p><h2>TH07 妖妖梦</h2><h3>本作特有规则</h3><p>TH07 rules</p><h2>TH08 永夜抄</h2><h3>规则</h3><h4>Sub</h4><p>TH08 rules</p>';
const firstDefaults=()=>({onOpenRequest(){},edgeGestures:false,storage:storage(),fetchImpl:async()=>response('<p>Notice</p>')});
for(const locale of ['zh-CN','en'])for(const [name,id,extra] of [['FirstUseNotice','firstUseNoticeDialog',()=>firstDefaults()],['MultiplayerGuideDialog','mpGuideDialog',()=>({gameId:'th07'})],['AppleRefreshDialog','appleRefreshDialog',()=>({})],['DonationDialog','donationDialog',()=>({assetUrl:x=>x,onArtworkUnavailable(){}})]])test(`${name}: original DOM and copy in ${locale}`,async()=>{
  await mount(owners[name],extra(),{locale});
  const actual=n('#'+id).cloneNode(true);
  // React's former iframe document owns this dialog, even in the lobby. Check
  // the explicit ownership metadata, then retain the exact pinned DOM/copy gate.
  if(name==='AppleRefreshDialog'){
    assert.equal(actual.getAttribute('data-launcher-document'),'');
    actual.removeAttribute('data-launcher-document');
  }
  assert.deepEqual(normalize(actual),normalize(baselineDialog(id,locale)));
});
test('First use: original fetch options/sanitizer/cache with intentional concurrent dedup',async()=>{const pending=deferred(),ref=React.createRef(),calls=[];await mount(owners.FirstUseNotice,{...firstDefaults(),ref,fetchImpl:(...args)=>{calls.push(args);return pending.promise;}});const p=ref.current.load(),p2=ref.current.load();assert.equal(calls.length,1);pending.resolve(response(html));await flush();assert.equal((await p).kind,'available');assert.equal((await p2).kind,'available');assert.deepEqual(calls,[['content/FIRST_USE_NOTICE.html',{cache:'no-store'}]]);const expected=env.document.createElement('div');owners.renderContentFragment(expected,html,env.document);assert.equal(n('#firstUseNoticeText').innerHTML,expected.innerHTML);await ref.current.load();assert.equal(calls.length,1);assert.equal(n('#firstUseNoticeDialog').open,false);});
test('First use: auto available opens once and records current seen marker',async()=>{const ref=React.createRef(),store=storage();let opens=0;const m=await mount(owners.FirstUseNotice,{...firstDefaults(),ref,storage:store,onOpenRequest:()=>{opens++;}});await React.act(async()=>assert.equal(await ref.current.maybeShowAutomatically(),true));assert.equal(opens,1);assert.equal(store.getItem(owners.FIRST_USE_NOTICE_SEEN_STORAGE_KEY),'1');assert.equal(await ref.current.maybeShowAutomatically(),false);assert.equal(opens,1);await m.update({open:true});assert.equal(ref.current.isOpen(),true);});
test('First use: all legacy nonempty markers migrate; current only literal 1 suppresses',async()=>{for(const key of ['eagler-touhou-new-player-notice-seen-v1','eagler-touhou-changelog-seen-v2','eagler-touhou-changelog-seen-20260822-1']){const ref=React.createRef(),store=storage({[key]:'legacy-other'});let calls=0;const m=await mount(owners.FirstUseNotice,{...firstDefaults(),ref,storage:store,fetchImpl:()=>{calls++;throw Error('unexpected');}});assert.equal(await ref.current.maybeShowAutomatically(),false);assert.equal(calls,0);assert.equal(store.getItem(owners.FIRST_USE_NOTICE_SEEN_STORAGE_KEY),'1');await m.unmount();}const ref=React.createRef();await mount(owners.FirstUseNotice,{...firstDefaults(),ref,storage:storage({[owners.FIRST_USE_NOTICE_SEEN_STORAGE_KEY]:'0'})});assert.equal(ref.current.hasSeenNotice(),false);});
for(const kind of ['empty','error'])test(`First use: ${kind} suppresses auto, manual opens without seen, ${kind==='empty'?'caches':'retries'}`,async()=>{const ref=React.createRef(),store=storage();let calls=0,opens=0;await mount(owners.FirstUseNotice,{...firstDefaults(),ref,storage:store,onOpenRequest:()=>opens++,fetchImpl:async()=>{calls++;return response(kind==='empty'?'  ':'bad',kind==='empty'?200:503);}});assert.equal(await ref.current.maybeShowAutomatically(),false);assert.equal(opens,0);await React.act(async()=>assert.equal((await ref.current.showManual()).kind,kind));assert.equal(opens,1);assert.equal(store.writes.length,0);assert.equal(calls,kind==='empty'?1:2);assert.equal(n('#firstUseNoticeText p').className,`first-use-notice-${kind}`);assert.equal(n('#firstUseNoticeText').textContent,owners.translate('zh-CN',kind==='empty'?'firstUseNotice.empty':'firstUseNotice.readFailed',{reason:'HTTP 503'}));});
test('First use: transient failure retries and succeeds; storage denial does not block',async()=>{const ref=React.createRef();let calls=0,opens=0;await mount(owners.FirstUseNotice,{...firstDefaults(),ref,storage:{getItem(){throw Error('denied');},setItem(){throw Error('denied');}},onOpenRequest:()=>opens++,fetchImpl:async()=>{if(++calls===1)throw Error('offline');return response('<p>Recovered</p>');}});assert.equal(await ref.current.maybeShowAutomatically(),false);assert.equal(await ref.current.maybeShowAutomatically(),true);assert.equal(opens,1);assert.equal(calls,2);assert.equal(n('#firstUseNoticeText').textContent,'Recovered');});
test('First use: unmounted pending manual cannot open or mark seen',async()=>{const d=deferred(),ref=React.createRef(),store=storage();let opens=0;const m=await mount(owners.FirstUseNotice,{...firstDefaults(),ref,storage:store,onOpenRequest:()=>opens++,fetchImpl:()=>d.promise});const p=ref.current.showManual();await m.unmount();d.resolve(response('<p>Late</p>'));assert.equal((await p).kind,'error');assert.equal(opens,0);assert.equal(store.writes.length,0);});
test('First use: StrictMode open fetches reject stale result and retain latest content',async()=>{const ds=[],ref=React.createRef(),store=storage();await mount(owners.FirstUseNotice,{...firstDefaults(),ref,open:true,storage:store,fetchImpl:()=>{const d=deferred();ds.push(d);return d.promise;}},{strict:true});assert.equal(ds.length,2);ds[1].resolve(response('<p>Current</p>'));await flush();ds[0].resolve(response('<p>Stale</p>'));await flush();assert.equal(n('#firstUseNoticeText').textContent,'Current');assert.equal(n('#firstUseNoticeDialog').open,true);});
test('Multiplayer: opens before fetch, sanitizer/builder output matches original pinned controller',async()=>{const d=deferred();let calls=[];await mount(owners.MultiplayerGuideDialog,{open:true,gameId:'th08',fetchImpl:(...a)=>{calls.push(a);return d.promise;}});assert.equal(n('#mpGuideDialog').open,true);assert.equal(n('#mpGuideContent p').className,'multiplayer-guide-loading');d.resolve(response(html));await flush();assert.deepEqual(calls,[['content/MULTIPLAYER.html']]);const baseline=new JSDOM('<!doctype html>'+baselineDialog('mpGuideDialog').outerHTML,{url:'https://launcher.invalid/'});baseline.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};baseline.window.HTMLDialogElement.prototype.close=function(){this.open=false;};baseline.window.HTMLElement.prototype.scrollIntoView=function(){};const controller=owners.createMultiplayerGuideController({documentObj:baseline.window.document,fetchImpl:async()=>response(html),getGameId:()=> 'th08'});await controller.show();assert.equal(n('#mpGuideContent').innerHTML,n('#mpGuideContent',baseline.window.document).innerHTML);baseline.window.close();assert.equal(n('[role=tab][aria-selected=true]').dataset.game,'th08');});
test('Multiplayer: current game changes while pending and on reopening; cache retained',async()=>{const d=deferred();let calls=0;const m=await mount(owners.MultiplayerGuideDialog,{open:true,gameId:'th06',fetchImpl:()=>{calls++;return d.promise;}});await m.update({gameId:'th10'});d.resolve(response(html));await flush();assert.equal(n('[role=tab][aria-selected=true]').dataset.game,'th10');await m.update({open:false});await m.update({open:true,gameId:'th08'});assert.equal(n('[role=tab][aria-selected=true]').dataset.game,'th08');assert.equal(calls,1);});
test('Multiplayer: errors retry after reopening, empty success is cached',async()=>{let calls=0;const m=await mount(owners.MultiplayerGuideDialog,{open:true,gameId:'th07',fetchImpl:async()=>++calls===1?response('fail',502):response('')});await flush();assert.equal(n('#mpGuideContent p').className,'multiplayer-guide-error');assert.equal(n('#mpGuideContent').textContent,owners.translate('zh-CN','multiplayerGuide.readFailed',{reason:'HTTP 502'}));await m.update({open:false});await m.update({open:true});assert.equal(n('#mpGuideContent').innerHTML,'');await m.update({open:false});await m.update({open:true});assert.equal(calls,2);});
test('Multiplayer: tabs, keyboard wrap, scroll reset, collapsed disclosures and fallback game',async()=>{await mount(owners.MultiplayerGuideDialog,{open:true,gameId:'unknown',fetchImpl:async()=>response(html)});await flush();assert.equal(n('[role=tab][aria-selected=true]').dataset.game,'th07');assert.equal(env.document.querySelectorAll('details[open]').length,0);n('#mpGuideContent').scrollTop=123;await click('[role=tab][data-game=th06]');assert.equal(n('#mpGuideContent').scrollTop,0);const first=n('[role=tab][data-game=th06]');first.focus();const e=new env.window.KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true,cancelable:true});first.dispatchEvent(e);assert.equal(e.defaultPrevented,true);assert.equal(env.document.activeElement.dataset.game,'th10');assert.equal(n('[role=tab][aria-selected=true]').dataset.game,'th06');assert.equal(n('.multiplayer-rule-panel[data-game=th10] .multiplayer-rule-disclosure-specific').textContent,'本作特有规则无');});
test('Multiplayer: StrictMode stale failure cannot overwrite newer success',async()=>{const ds=[];await mount(owners.MultiplayerGuideDialog,{open:true,gameId:'th07',fetchImpl:()=>{const d=deferred();ds.push(d);return d.promise;}},{strict:true});assert.equal(ds.length,2);ds[1].resolve(response(html));await flush();ds[0].reject(Error('stale fail'));await flush();assert.ok(n('[data-mp-rule-guide]'));assert.equal(n('#mpGuideDialog').open,true);});
test('Multiplayer: resolution after unmount does not alter detached content',async()=>{const d=deferred();const m=await mount(owners.MultiplayerGuideDialog,{open:true,gameId:'th07',fetchImpl:()=>d.promise});const content=n('#mpGuideContent'),before=content.innerHTML;await m.unmount();d.resolve(response(html));await flush();assert.equal(content.innerHTML,before);});
for(const [name,id,delay,extra] of [['FirstUseNotice','firstUseNoticeDialog',220,firstDefaults],['MultiplayerGuideDialog','mpGuideDialog',180,()=>({gameId:'th07',fetchImpl:async()=>response(html)})],['AppleRefreshDialog','appleRefreshDialog',220,()=>({})],['DonationDialog','donationDialog',220,()=>({assetUrl:x=>x,onArtworkUnavailable(){}})]])test(`${name}: timed cancel/backdrop/dedupe and native parent preserved`,async()=>{reduce=false;let callbacks=0;const m=await mount(owners[name],{...extra(),open:true,onCloseRequest:()=>callbacks++},{parent:true});const c=fakeClock(),dialog=n('#'+id);await click('#'+id+' article');assert.equal(dialog.classList.contains('closing'),false);await cancel('#'+id);await click('#'+id);assert.equal(dialog.open,true);assert.equal(dialog.classList.contains('closing'),true);assert.equal(c.timers.size,1);await c.advance(delay-1);assert.equal(dialog.open,true);await c.advance(1);assert.equal(dialog.open,false);assert.equal(callbacks,1);assert.equal(m.nativeParent.open,true);assert.equal(dialog.classList.contains('closing'),false);});
test('Dialog: reduced motion closes immediately and reopening cancels old timer',async()=>{let callbacks=0;const m=await mount(owners.AppleRefreshDialog,{open:true,onCloseRequest:()=>callbacks++});await click('#appleRefreshClose');assert.equal(n('#appleRefreshDialog').open,false);assert.equal(callbacks,1);await m.update({open:false});await m.update({open:true});reduce=false;const c=fakeClock();await click('#appleRefreshClose');await m.update({open:false});await m.update({open:true});assert.equal(n('#appleRefreshDialog').classList.contains('closing'),false);assert.equal(c.timers.size,0);await c.advance(220);assert.equal(n('#appleRefreshDialog').open,true);assert.equal(callbacks,1);});
test('Dialog: Router Back during pending user close must suppress stale close intent',async()=>{reduce=false;let callbacks=0;const m=await mount(owners.AppleRefreshDialog,{open:true,onCloseRequest:()=>callbacks++});const c=fakeClock();await click('#appleRefreshClose');await m.update({open:false});await c.advance(220);assert.equal(n('#appleRefreshDialog').open,false);assert.equal(callbacks,0,'Router consumed close; stale user callback must not recurse into history');});
test('Dialog: parent prop close never notifies, correct animation can complete early',async()=>{reduce=false;let callbacks=0;const m=await mount(owners.AppleRefreshDialog,{open:true,onCloseRequest:()=>callbacks++});const c=fakeClock();await m.update({open:false});let e=new env.window.Event('animationend',{bubbles:true});Object.defineProperty(e,'animationName',{value:'irrelevant'});n('#appleRefreshDialog').dispatchEvent(e);assert.equal(n('#appleRefreshDialog').open,true);e=new env.window.Event('animationend',{bubbles:true});Object.defineProperty(e,'animationName',{value:'replay-window-out'});await React.act(async()=>n('#appleRefreshDialog').dispatchEvent(e));assert.equal(n('#appleRefreshDialog').open,false);assert.equal(callbacks,0);assert.equal(c.timers.size,0);});
test('Donation: artwork failure closes immediately and signals unavailable once per error',async()=>{let unavailable=0,closes=0;await mount(owners.DonationDialog,{open:true,assetUrl:x=>'/base/'+x,onArtworkUnavailable:()=>unavailable++,onCloseRequest:()=>closes++});assert.equal(n('#donationImage').getAttribute('src'),'/base/assets/donation.webp');await React.act(async()=>n('#donationImage').dispatchEvent(new env.window.Event('error')));assert.equal(n('#donationDialog').open,false);assert.equal(unavailable,1);assert.equal(closes,1);});
test('Donation: artwork failure during animated close must bypass pending timer',async()=>{reduce=false;let unavailable=0;await mount(owners.DonationDialog,{open:true,assetUrl:x=>x,onArtworkUnavailable:()=>unavailable++});fakeClock();await click('#donationClose');await React.act(async()=>n('#donationImage').dispatchEvent(new env.window.Event('error')));assert.equal(unavailable,1);assert.equal(n('#donationDialog').open,false,'Original image-error handler closes even while closing');});
test('Dialog: unmount cancels timers and prevents delayed callback',async()=>{reduce=false;let callbacks=0;const m=await mount(owners.AppleRefreshDialog,{open:true,onCloseRequest:()=>callbacks++});const c=fakeClock();await click('#appleRefreshClose');await m.unmount();assert.equal(c.timers.size,0);await c.advance(500);assert.equal(callbacks,0);});
test('First use: manual re-show while closing cancels close as original does',async()=>{reduce=false;const ref=React.createRef();let closes=0;await mount(owners.FirstUseNotice,{...firstDefaults(),ref,open:true,onCloseRequest:()=>closes++});const c=fakeClock();await click('#firstUseNoticeClose');await React.act(async()=>ref.current.showManual());await c.advance(220);assert.equal(n('#firstUseNoticeDialog').open,true,'Original showManual invalidates its close-generation even when already open');assert.equal(closes,0);});
test('Original edge-drawer setup: native first-use close settles its owner and later manual reveal reopens',async()=>{
  const ref=React.createRef();let closes=0;
  function Controlled(){const [open,setOpen]=React.useState(true);return React.createElement(owners.FirstUseNotice,{...firstDefaults(),ref,open,onCloseRequest(){closes++;setOpen(false);},onOpenRequest(){setOpen(true);}});}
  await mount(Controlled,{}, {strict:true});const dialog=n('#firstUseNoticeDialog');
  await React.act(async()=>dialog.close());assert.equal(dialog.open,false);assert.equal(closes,1);
  await React.act(async()=>ref.current.showManual());assert.equal(dialog.open,true);assert.equal(closes,1);
  await click('#firstUseNoticeCloseHint');assert.equal(dialog.open,false);assert.equal(closes,2,'Owned close events do not duplicate the Router intent');
});
test('Unmount closes the captured native dialog after React clears its ref without domain callbacks',async()=>{
  let closes=0;const m=await mount(owners.AppleRefreshDialog,{open:true,onCloseRequest:()=>closes++},{strict:true}),dialog=n('#appleRefreshDialog');
  assert.equal(dialog.open,true);await m.unmount();assert.equal(dialog.open,false);assert.equal(closes,0);
});
test('First use: stale StrictMode manual load must not emit an open request',async()=>{const ds=[],ref=React.createRef();let opens=0;function EffectOpener(){React.useEffect(()=>{void ref.current.showManual();},[]);return React.createElement(owners.FirstUseNotice,{...firstDefaults(),ref,fetchImpl:()=>{const d=deferred();ds.push(d);return d.promise;},onOpenRequest:()=>opens++});}await mount(EffectOpener,{}, {strict:true});assert.equal(ds.length,2);ds[0].resolve(response('<p>Stale</p>'));await flush();assert.equal(opens,0,'Strict replay superseded the first manual request');ds[1].resolve(response('<p>Current</p>'));await flush();assert.equal(opens,1);});
for(const [name,id,extra,key] of [['FirstUseNotice','firstUseNoticeText',firstDefaults,'firstUseNotice.loading'],['MultiplayerGuideDialog','mpGuideContent',()=>({gameId:'th07'}),'multiplayerGuide.loading']])test(`${name}: initial loading copy follows a live locale change`,async()=>{const m=await mount(owners[name],extra());await m.setLocale('en');assert.equal(n('#'+id).textContent,owners.translate('en',key));});
test('First use: cached empty manual re-show uses current locale like original',async()=>{const ref=React.createRef();const m=await mount(owners.FirstUseNotice,{...firstDefaults(),ref,fetchImpl:async()=>response(' ')});await ref.current.showManual();await m.setLocale('en');await ref.current.showManual();assert.equal(n('#firstUseNoticeText').textContent,owners.translate('en','firstUseNotice.empty'));});
test('Authored first-use document: fetched fragment equals pinned main sanitization',async()=>{const authored=pinned('public/content/FIRST_USE_NOTICE.html'),ref=React.createRef();await mount(owners.FirstUseNotice,{...firstDefaults(),ref,fetchImpl:async()=>response(authored)});await ref.current.load();const expected=env.document.createElement('div');owners.renderContentFragment(expected,authored.trim(),env.document);assert.equal(n('#firstUseNoticeText').innerHTML,expected.innerHTML);});
test('Authored multiplayer document: all four game renderings equal pinned main controller',async()=>{const authored=pinned('public/content/MULTIPLAYER.html');for(const gameId of ['th06','th07','th08','th10']){const m=await mount(owners.MultiplayerGuideDialog,{open:true,gameId,fetchImpl:async()=>response(authored)});await flush();const baseline=new JSDOM('<!doctype html>'+baselineDialog('mpGuideDialog').outerHTML,{url:'https://launcher.invalid/'});baseline.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};baseline.window.HTMLDialogElement.prototype.close=function(){this.open=false;};baseline.window.HTMLElement.prototype.scrollIntoView=function(){};await owners.createMultiplayerGuideController({documentObj:baseline.window.document,fetchImpl:async()=>response(authored),getGameId:()=>gameId}).show();assert.equal(n('#mpGuideContent').innerHTML,n('#mpGuideContent',baseline.window.document).innerHTML,gameId);baseline.window.close();await m.unmount();m.container.remove();}});
test('Donation: original lobby closes immediately without library exit animation',async()=>{reduce=false;let closes=0;await mount(owners.DonationDialog,{open:true,closeDurationMs:0,assetUrl:x=>x,onArtworkUnavailable(){},onCloseRequest:()=>closes++});const c=fakeClock();await click('#donationClose');assert.equal(n('#donationDialog').open,false);assert.equal(n('#donationDialog').classList.contains('closing'),false);assert.equal(c.timers.size,0);assert.equal(closes,1);});

for (const locale of ['zh-CN', 'en']) test(`First use ${locale}: failed explicit show preserves pinned error until a later explicit retry`, async () => {
  const originalDom = new JSDOM('<!doctype html><dialog id="firstUseNoticeDialog"><div id="firstUseNoticeText"></div></dialog>', {url: 'https://launcher.invalid/'});
  originalDom.window.HTMLDialogElement.prototype.showModal = function () {this.open = true;};
  originalDom.window.HTMLDialogElement.prototype.close = function () {this.open = false;};
  const originalSuccess = deferred(), reactSuccess = deferred(), counts = {main: 0, react: 0};
  const fetcher = (side, success) => () => ++counts[side] === 1 ? Promise.resolve(response('', 503)) : success.promise;
  const original = owners.createFirstUseNoticeController({documentObj: originalDom.window.document, storage: null,
    fetchImpl: fetcher('main', originalSuccess), matchMediaImpl: () => ({matches: true}),
    readFailureText: error => owners.translate(locale, 'firstUseNotice.readFailed', {reason: error.message})});
  const ref = React.createRef(), fetchImpl = fetcher('react', reactSuccess);
  function RoutedNotice() {
    const [open, setOpen] = React.useState(false);
    return React.createElement(owners.FirstUseNotice, {ref, open, storage: null, edgeGestures: false, fetchImpl,
      onOpenRequest: () => setOpen(true), onCloseRequest: () => setOpen(false)});
  }
  try {
    await mount(RoutedNotice, {}, {locale, strict: true});
    const originalResult = await original.showManual();
    let reactResult;
    await React.act(async () => {reactResult = await ref.current.showManual();});
    assert.equal(reactResult.kind, originalResult.kind); assert.equal(reactResult.kind, 'error');
    assert.deepEqual(counts, {main: 1, react: 1}, 'Opening a completed error must not start another request');
    const expectedError = n('#firstUseNoticeText', originalDom.window.document).innerHTML;
    assert.equal(n('#firstUseNoticeText').innerHTML, expectedError);
    assert.equal(ref.current.isOpen(), original.isOpen());
    const authored = pinned('public/content/FIRST_USE_NOTICE.html');
    originalSuccess.resolve(response(authored)); reactSuccess.resolve(response(authored)); await flush();
    assert.equal(n('#firstUseNoticeText').innerHTML, expectedError, 'An unrequested queued success cannot overwrite the original error view');
    original.close(); await React.act(async () => ref.current.close());
    assert.equal(ref.current.isOpen(), original.isOpen());
    assert.equal((await original.showManual()).kind, 'available');
    await React.act(async () => {assert.equal((await ref.current.showManual()).kind, 'available');});
    assert.deepEqual(counts, {main: 2, react: 2}, 'A later explicit reopen retries exactly once');
    assert.equal(n('#firstUseNoticeText').innerHTML, n('#firstUseNoticeText', originalDom.window.document).innerHTML);
    assert.equal(ref.current.isOpen(), original.isOpen());
  } finally {originalDom.window.close();}
});
