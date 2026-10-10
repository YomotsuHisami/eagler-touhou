import {pinnedUiAuthorityText} from './source-text.mjs';
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
let env, React, createRoot, owners, changedMotionOwners, baselineHTML, current = null;
const alive = new Set();
const originalSetTimeout = globalThis.setTimeout, originalClearTimeout = globalThis.clearTimeout;
let reduce = true, clock, motions = [];
before(async () => {
  env = installMountedDom();
  env.window.HTMLElement.prototype.scrollIntoView = function () {};
  env.window.AnimationEvent = class extends env.window.Event {}; // React event capability detection, synthetic only
  globalThis.matchMedia = env.window.matchMedia = query => ({matches: reduce, media:query, addEventListener(){}, removeEventListener(){}});
  env.window.HTMLDialogElement.prototype.animate = function (keyframes, options) {
    const done=deferred(), record={node:this,keyframes,options,cancelled:false,settled:false,
      finished:done.promise,
      finish(){if(!this.settled){this.settled=true;done.resolve();}},
      cancel(){this.cancelled=true;if(!this.settled){this.settled=true;done.reject(new env.window.DOMException('Cancelled','AbortError'));}}};
    motions.push(record);return record;
  };
  React = await import(pathToFileURL(require.resolve('react')));
  ({createRoot} = await import(pathToFileURL(require.resolve('react-dom/client'))));
  for (const p of ['src/launcher/first-use-notice.mts','src/launcher/content-fragment.mts','src/launcher/i18n.mts']) assert.equal(pinnedUiAuthorityText(readFileSync(resolve(project,p), 'utf8')),pinned(p),`baseline ${p} changed`);
  baselineHTML = pinned('public/index.html');
  buildDirectory = await mkdtemp(resolve(here, 'notices-build-'));
  const buildOptions={absWorkingDir:project, stdin:{resolveDir:project,loader:'ts',contents:`
    export * from './app/components/notices/FirstUseNotice.tsx';
    export * from './app/components/notices/MultiplayerGuideDialog.tsx';
    export * from './app/components/notices/DonationDialog.tsx';
    export * from './app/components/notices/AppleRefreshDialog.tsx';
    export * from './app/components/notices/InformationalDialog.tsx';
    export * from './app/components/FullscreenTransient.tsx';
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
    ctx.onResolve({filter:/^[^./]/},args=>({path:pathToFileURL(require.resolve(args.path)).href,external:true}));
    ctx.onResolve({filter:/^\.\.?\/.*\.mjs$/},args=>{const path=resolve(dirname(args.importer),args.path).replace(/\.mjs$/,'.mts');if(existsSync(path))return {path};});
  }}]};
  await build(buildOptions);
  owners = await import(pathToFileURL(resolve(buildDirectory,'actual-bundle.mjs')));
  // An isolated in-memory edit of the one production motion source proves
  // consumers inherit actual behavior, rather than merely sharing JSX names.
  let replacements=0;
  await build({...buildOptions,outfile:resolve(buildDirectory,'changed-motion.mjs'),plugins:[{name:'shared-motion-proof',setup(ctx){
    ctx.onLoad({filter:/[/\\]informational-dialog-motion\.ts$/},args=>{
      const source=readFileSync(args.path,'utf8');assert.equal(source.split('duration: 180').length,2);replacements++;
      return {contents:source.replace('duration: 180','duration: 90'),loader:'tsx',resolveDir:dirname(args.path)};
    });
  }},...buildOptions.plugins]});
  assert.equal(replacements,1);
  changedMotionOwners=await import(pathToFileURL(resolve(buildDirectory,'changed-motion.mjs')));
});
afterEach(async () => {
  globalThis.setTimeout = originalSetTimeout; globalThis.clearTimeout = originalClearTimeout; clock = null;
  for(const m of alive) await React.act(async()=>m.root.unmount());
  alive.clear(); motions=[]; current=null; env.document.body.replaceChildren(); reduce=true;
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
function activeMotion(dialog){const motion=motions.findLast(item=>item.node===dialog&&!item.cancelled&&!item.settled);assert.ok(motion,'active native motion');return motion;}
async function finishMotion(dialog){const motion=activeMotion(dialog);await React.act(async()=>motion.finish());}
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
  if(name!=='FirstUseNotice') {
    const [layout,window,legacyRoot,legacyWindow] = name==='MultiplayerGuideDialog'
      ? ['scrollable','scrollable','multiplayer-guide-dialog','multiplayer-guide-window']
      : name==='DonationDialog' ? ['artwork','standard','apple-refresh-dialog donation-dialog','apple-refresh-window donation-window']
      : ['standard','standard','apple-refresh-dialog','apple-refresh-window'];
    assert.equal(actual.className,`informational-dialog informational-dialog--${layout}`);
    assert.equal(actual.firstElementChild.className,`informational-window informational-window--${window}`);
    assert.equal(actual.hasAttribute('style'),false,'No CSS duration mirror');
    // Only the intentional shared presentation markers differ. Preserve every
    // original structure, ID, accessible name, body class and copy assertion.
    actual.className=legacyRoot; actual.firstElementChild.className=legacyWindow; actual.removeAttribute('style');
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
test('FirstUseNotice: timed cancel/backdrop/dedupe and native parent preserved',async()=>{reduce=false;let callbacks=0;const m=await mount(owners.FirstUseNotice,{...firstDefaults(),open:true,onCloseRequest:()=>callbacks++},{parent:true});const c=fakeClock(),dialog=n('#firstUseNoticeDialog');await click('#firstUseNoticeDialog article');assert.equal(dialog.classList.contains('closing'),false);await cancel('#firstUseNoticeDialog');await click('#firstUseNoticeDialog');assert.equal(dialog.open,true);assert.equal(c.timers.size,1);await c.advance(219);assert.equal(dialog.open,true);await c.advance(1);assert.equal(dialog.open,false);assert.equal(callbacks,1);assert.equal(m.nativeParent.open,true);});
for(const [name,id,extra] of [['MultiplayerGuideDialog','mpGuideDialog',()=>({gameId:'th07',fetchImpl:async()=>response(html)})],['AppleRefreshDialog','appleRefreshDialog',()=>({})],['DonationDialog','donationDialog',()=>({assetUrl:x=>x,onArtworkUnavailable(){}})]])test(`${name}: completion-driven cancel/backdrop/dedupe and native parent preserved`,async()=>{
  reduce=false;let callbacks=0;const m=await mount(owners[name],{...extra(),open:true,onCloseRequest:()=>callbacks++},{parent:true});const c=fakeClock(),dialog=n('#'+id);
  await click('#'+id+' article');assert.equal(dialog.classList.contains('closing'),false);
  await cancel('#'+id);const closing=activeMotion(dialog);await click('#'+id);assert.equal(activeMotion(dialog),closing);assert.equal(dialog.open,true);assert.equal(c.timers.size,0);
  await c.advance(10000);assert.equal(dialog.open,true,'No timer can substitute for actual completion');
  await finishMotion(dialog);assert.equal(dialog.open,false);assert.equal(callbacks,1);assert.equal(m.nativeParent.open,true);assert.equal(dialog.classList.contains('closing'),false);
});
test('Dialog: reduced motion closes immediately and reopening cancels old completion',async()=>{let callbacks=0;const m=await mount(owners.AppleRefreshDialog,{open:true,onCloseRequest:()=>callbacks++});await click('#appleRefreshClose');assert.equal(n('#appleRefreshDialog').open,false);assert.equal(callbacks,1);await m.update({open:false});await m.update({open:true});reduce=false;const c=fakeClock();await click('#appleRefreshClose');const old=activeMotion(n('#appleRefreshDialog'));await m.update({open:false});await m.update({open:true});assert.equal(old.cancelled,true);assert.equal(n('#appleRefreshDialog').classList.contains('closing'),false);assert.equal(c.timers.size,0);await React.act(async()=>old.finish());assert.equal(n('#appleRefreshDialog').open,true);assert.equal(callbacks,1);});
test('Dialog: Router Back during pending user close must suppress stale close intent',async()=>{reduce=false;let callbacks=0;const m=await mount(owners.AppleRefreshDialog,{open:true,onCloseRequest:()=>callbacks++});await click('#appleRefreshClose');await m.update({open:false});await finishMotion(n('#appleRefreshDialog'));assert.equal(n('#appleRefreshDialog').open,false);assert.equal(callbacks,0,'Router consumed close; stale user callback must not recurse into history');});
test('Dialog: parent prop close never notifies; CSS animation events cannot settle native motion',async()=>{reduce=false;let callbacks=0;const m=await mount(owners.AppleRefreshDialog,{open:true,onCloseRequest:()=>callbacks++});const c=fakeClock();await m.update({open:false});for(const name of ['irrelevant','replay-window-out']){const e=new env.window.Event('animationend',{bubbles:true});Object.defineProperty(e,'animationName',{value:name});await React.act(async()=>n('#appleRefreshDialog').dispatchEvent(e));assert.equal(n('#appleRefreshDialog').open,true);}await finishMotion(n('#appleRefreshDialog'));assert.equal(n('#appleRefreshDialog').open,false);assert.equal(callbacks,0);assert.equal(c.timers.size,0);});
test('Donation: artwork failure closes immediately and signals unavailable once per error',async()=>{let unavailable=0,closes=0;await mount(owners.DonationDialog,{open:true,assetUrl:x=>'/base/'+x,onArtworkUnavailable:()=>unavailable++,onCloseRequest:()=>closes++});assert.equal(n('#donationImage').getAttribute('src'),'/base/assets/donation.webp');await React.act(async()=>n('#donationImage').dispatchEvent(new env.window.Event('error')));assert.equal(n('#donationDialog').open,false);assert.equal(unavailable,1);assert.equal(closes,1);});
test('Donation: artwork failure during animated close bypasses pending completion',async()=>{reduce=false;let unavailable=0;await mount(owners.DonationDialog,{open:true,assetUrl:x=>x,onArtworkUnavailable:()=>unavailable++});fakeClock();await click('#donationClose');await React.act(async()=>n('#donationImage').dispatchEvent(new env.window.Event('error')));assert.equal(unavailable,1);assert.equal(n('#donationDialog').open,false,'Original image-error handler closes even while closing');});
test('Dialog: unmount cancels completion and prevents delayed callback',async()=>{reduce=false;let callbacks=0;const m=await mount(owners.AppleRefreshDialog,{open:true,onCloseRequest:()=>callbacks++});const c=fakeClock();await click('#appleRefreshClose');await m.unmount();assert.equal(c.timers.size,0);await c.advance(500);assert.equal(callbacks,0);});
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

// Presentation-only reuse: a fourth consumer supplies content/config, with no
// timer, native-event listener or focus owner of its own.
test('Informational shell: new content inherits interrupted close, suspension focus/scroll and latest close intent',async()=>{
  reduce=false; const calls=[];
  const m=await mount(owners.InformationalDialog,{open:true,id:'genericInfo',titleId:'genericTitle',closeId:'genericClose',title:'Information',closeLabel:'Close',presentation:owners.informationalDialogPresentation.standard,
    onCloseRequest:()=>calls.push('old'),onClosed:()=>calls.push('closed'),
    children:React.createElement('div',{id:'genericBody'},React.createElement('input',{id:'genericInput',defaultValue:'retained'}))},{strict:true,parent:true});
  const dialog=n('#genericInfo'),body=n('#genericBody'),input=n('#genericInput'),c=fakeClock();
  input.focus();body.scrollTop=77;
  await click('#genericClose');assert.equal(c.timers.size,0);const interrupted=activeMotion(dialog);
  await m.update({suspended:true});assert.equal(dialog.open,false);assert.equal(interrupted.cancelled,true);assert.equal(c.timers.size,0);assert.deepEqual(calls,[]);
  await m.update({suspended:false,onCloseRequest:()=>calls.push('latest')});
  assert.equal(dialog.open,true);assert.equal(n('#genericBody'),body);assert.equal(n('#genericInput'),input);
  assert.equal(env.document.activeElement,input);assert.equal(input.value,'retained');assert.equal(body.scrollTop,77);assert.equal(m.nativeParent.open,true);
  await click('#genericClose');await m.update({open:false});await m.update({open:true});await c.advance(220);
  assert.equal(dialog.open,true);assert.deepEqual(calls,[]);
  await cancel('#genericInfo');await finishMotion(dialog);assert.deepEqual(calls,['closed','latest']);assert.equal(dialog.open,false);assert.equal(m.nativeParent.open,true);
});
for(const [name,id,closeId,extra] of [
  ['AppleRefreshDialog','appleRefreshDialog','appleRefreshClose',()=>({})],
  ['DonationDialog','donationDialog','donationClose',()=>({assetUrl:x=>x,onArtworkUnavailable(){}})],
  ['MultiplayerGuideDialog','mpGuideDialog','mpGuideClose',()=>({gameId:'th07',fetchImpl:async()=>response(html)})],
])test(`${name}: shared shell preserves focus/content and one completion policy`,async()=>{
  reduce=false;let requests=0,closed=0;
  const m=await mount(owners[name],{...extra(),open:true,onCloseRequest:()=>requests++,onClosed:()=>closed++},{strict:true,parent:true});
  const dialog=n('#'+id),button=n('#'+closeId),article=dialog.firstElementChild,c=fakeClock();
  article.scrollTop=65;button.focus();await m.update({suspended:true});assert.equal(dialog.open,false);assert.equal(closed,0);
  await m.update({suspended:false});assert.equal(n('#'+closeId),button);assert.equal(env.document.activeElement,button);assert.equal(article.scrollTop,65);
  await click('#'+closeId);await m.update({open:false});await m.update({open:true});await c.advance(1000);
  assert.equal(dialog.open,true);assert.equal(requests,0);assert.equal(closed,0);
  await click('#'+closeId);assert.deepEqual(activeMotion(dialog).options,{duration:180,easing:'cubic-bezier(.2,0,0,1)',fill:'both'});
  const event=new env.window.Event('animationend',{bubbles:true});Object.defineProperty(event,'animationName',{value:'replay-window-out'});
  await React.act(async()=>article.dispatchEvent(event));assert.equal(dialog.open,true);await finishMotion(dialog);
  assert.equal(requests,1);assert.equal(closed,1);assert.equal(c.timers.size,0);assert.equal(m.nativeParent.open,true);
});

for(const [name,id,closeId,extra] of [
  ['AppleRefreshDialog','appleRefreshDialog','appleRefreshClose',()=>({})],
  ['DonationDialog','donationDialog','donationClose',()=>({assetUrl:x=>x,onArtworkUnavailable(){}})],
  ['MultiplayerGuideDialog','mpGuideDialog','mpGuideClose',()=>({gameId:'th07',fetchImpl:async()=>response(html)})],
])test(`${name}: changing the single shared motion changes all consumers without a mirrored timer`,async()=>{
  reduce=false;let closes=0;await mount(changedMotionOwners[name],{...extra(),open:true,onCloseRequest:()=>closes++});
  const dialog=n('#'+id),c=fakeClock();assert.equal(activeMotion(dialog).options.duration,90);
  await click('#'+closeId);assert.equal(activeMotion(dialog).options.duration,90);assert.equal(c.timers.size,0);assert.equal(dialog.classList.contains('closing'),true);
  await c.advance(10000);assert.equal(dialog.open,true);assert.equal(closes,0);
  await finishMotion(dialog);assert.equal(dialog.open,false);assert.equal(closes,1);assert.equal(c.timers.size,0);
});

for(const mode of ['missing','throws','partial'])test(`Informational motion: ${mode} WAAPI degrades immediately without a timeout`,async()=>{
  reduce=false;const prototype=env.window.HTMLDialogElement.prototype,original=prototype.animate;let requests=0,closed=0,cancels=0;
  try {
    prototype.animate=mode==='missing'?undefined:mode==='throws'?()=>{throw new Error('unsupported');}:()=>({cancel(){cancels++;}});
    await mount(owners.AppleRefreshDialog,{open:true,onCloseRequest:()=>requests++,onClosed:()=>closed++});const c=fakeClock();
    await click('#appleRefreshClose');assert.equal(n('#appleRefreshDialog').open,false);assert.equal(requests,1);assert.equal(closed,1);assert.equal(c.timers.size,0);
    if(mode==='partial')assert.equal(cancels,2,'Both incomplete native animations are released');
  }finally{prototype.animate=original;}
});
test('Informational motion: already-finished animations settle once and release fill after native close',async()=>{
  reduce=false;const prototype=env.window.HTMLDialogElement.prototype,original=prototype.animate;const events=[];
  try {
    prototype.animate=function(...args){const animation=original.apply(this,args),cancel=animation.cancel.bind(animation);animation.cancel=()=>{events.push(['cancel',this.open]);cancel();};animation.finish();return animation;};
    await mount(owners.AppleRefreshDialog,{open:true,onCloseRequest:()=>events.push('request'),onClosed:()=>events.push('closed')});
    assert.equal(n('#appleRefreshDialog').open,true);assert.deepEqual(events,[['cancel',true]]);
    const c=fakeClock();await click('#appleRefreshClose');assert.equal(c.timers.size,0);assert.equal(n('#appleRefreshDialog').open,false);
    assert.deepEqual(events,[['cancel',true],['cancel',false],'closed','request']);
  }finally{prototype.animate=original;}
});
test('Informational motion: active animation cancellation settles close, stale completion cannot close a reopened dialog',async()=>{
  reduce=false;let requests=0;const m=await mount(owners.AppleRefreshDialog,{open:true,onCloseRequest:()=>requests++}),dialog=n('#appleRefreshDialog');
  await click('#appleRefreshClose');await React.act(async()=>activeMotion(dialog).cancel());assert.equal(dialog.open,false);assert.equal(requests,1);
  await m.update({open:false});await m.update({open:true});await click('#appleRefreshClose');
  const stale=activeMotion(dialog);stale.cancel=()=>{stale.cancelled=true;}; // completion already queued outside the cancellation boundary
  await m.update({open:false});await m.update({open:true});assert.equal(stale.cancelled,true);
  const opening=activeMotion(dialog);await React.act(async()=>stale.finish());assert.equal(dialog.open,true);assert.equal(activeMotion(dialog),opening);assert.equal(requests,1);
});
test('Informational motion: interruption samples current appearance before cancelling either direction',async()=>{
  reduce=false;const m=await mount(owners.AppleRefreshDialog,{open:true}),dialog=n('#appleRefreshDialog'),original=env.window.getComputedStyle;
  const entry=activeMotion(dialog);assert.deepEqual(entry.keyframes[0],{opacity:0,transform:'translateY(12px) scale(.98)'});
  try {
    env.window.getComputedStyle=node=>{assert.equal(node,dialog);assert.equal(entry.cancelled,false);return {opacity:'.4',transform:'matrix(.99, 0, 0, .99, 0, 6)'};};
    await click('#appleRefreshClose');const exit=activeMotion(dialog);assert.equal(entry.cancelled,true);assert.deepEqual(exit.keyframes[0],{opacity:'.4',transform:'matrix(.99, 0, 0, .99, 0, 6)'});
    env.window.getComputedStyle=node=>{assert.equal(node,dialog);assert.equal(exit.cancelled,false);return {opacity:'.2',transform:'matrix(.98, 0, 0, .98, 0, 10)'};};
    await m.update({open:false});await m.update({open:true});assert.equal(exit.cancelled,true);assert.deepEqual(activeMotion(dialog).keyframes[0],{opacity:'.2',transform:'matrix(.98, 0, 0, .98, 0, 10)'});
  }finally{env.window.getComputedStyle=original;}
});
test('Informational motion: reduced preference and less-motion skip native motion; immediate donation close cancels entry',async()=>{
  const m=await mount(owners.AppleRefreshDialog,{open:true});assert.equal(motions.length,0);await click('#appleRefreshClose');assert.equal(n('#appleRefreshDialog').open,false);
  await m.unmount();reduce=false;env.document.body.classList.add('less-motion');
  try{await mount(owners.AppleRefreshDialog,{open:true});assert.equal(motions.length,0);await click('#appleRefreshClose');assert.equal(n('#appleRefreshDialog').open,false);}finally{env.document.body.classList.remove('less-motion');}
  await mount(owners.DonationDialog,{open:true,closeDurationMs:0,assetUrl:x=>x,onArtworkUnavailable(){}});const entry=activeMotion(n('#donationDialog'));
  await click('#donationClose');assert.equal(entry.cancelled,true);assert.equal(n('#donationDialog').open,false);
});
test('Informational motion: fullscreen carrier movement retains node/animation; unmount cancels without callbacks',async()=>{
  reduce=false;let requests=0,closed=0;
  function Hosted(props){return React.createElement(React.Fragment,null,React.createElement('div',{id:'player'}),React.createElement(owners.FullscreenTransient,null,React.createElement(owners.AppleRefreshDialog,props)));}
  const m=await mount(Hosted,{open:true,onCloseRequest:()=>requests++,onClosed:()=>closed++},{strict:true,parent:true});const dialog=n('#appleRefreshDialog'),entry=activeMotion(dialog);
  try {
    Object.defineProperty(env.document,'fullscreenElement',{configurable:true,value:n('#player')});
    await React.act(async()=>env.document.dispatchEvent(new env.window.Event('fullscreenchange')));
    assert.equal(n('#appleRefreshDialog'),dialog);assert.equal(activeMotion(dialog),entry);assert.ok(n('#player').contains(dialog));assert.equal(m.nativeParent.open,true);
    await click('#appleRefreshClose');const exit=activeMotion(dialog);
    Object.defineProperty(env.document,'fullscreenElement',{configurable:true,value:null});
    await React.act(async()=>env.document.dispatchEvent(new env.window.Event('webkitfullscreenchange')));
    assert.equal(n('#appleRefreshDialog'),dialog);assert.equal(activeMotion(dialog),exit);assert.equal(m.nativeParent.open,true);
    await m.unmount();assert.equal(exit.cancelled,true);assert.equal(dialog.open,false);await React.act(async()=>exit.finish());assert.equal(requests,0);assert.equal(closed,0);
  }finally{delete env.document.fullscreenElement;}
});
test('Informational motion: direct native close cancels pending exit and queued old close cannot consume a reopened intent',async()=>{
  reduce=false;let requests=0,closed=0;
  const m=await mount(owners.AppleRefreshDialog,{open:true,onCloseRequest:()=>requests++,onClosed:()=>closed++},{strict:true});
  const dialog=n('#appleRefreshDialog');await click('#appleRefreshClose');const exit=activeMotion(dialog);
  await React.act(async()=>dialog.close());assert.equal(exit.cancelled,true);assert.equal(requests,1);assert.equal(closed,1);
  await m.update({open:false});await m.update({open:true});const entry=activeMotion(dialog);
  await React.act(async()=>dialog.dispatchEvent(new env.window.Event('close')));
  assert.equal(dialog.open,true);assert.equal(activeMotion(dialog),entry);assert.equal(requests,1);assert.equal(closed,1);
});
