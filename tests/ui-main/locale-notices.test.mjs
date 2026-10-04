/** Synthetic services, fixed source artifacts and SSR; no browser/phone claims. */
import assert from 'node:assert/strict';
import {after,test} from 'node:test';
import {existsSync} from 'node:fs';
import {mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {boundaryViolations} from '../../scripts/check-ui-boundaries.mjs';
const root=fileURLToPath(new URL('../..',import.meta.url));
await mkdir(join(root,'.cache'),{recursive:true});
const directory=await mkdtemp(join(root,'.cache/ui-locale-notices-test-'));
after(()=>rm(directory,{recursive:true,force:true}));
const bundle=await build({stdin:{contents:`
 export * from './app/services/locale.client.ts';
 export * from './app/services/notices.client.ts';
 export * from './app/components/LocaleProvider.tsx';
 export * from './app/components/Notices.tsx';
 export {UI_MESSAGES} from './src/launcher/i18n.mts';
 export {createElement,Fragment} from 'react';
 export {createMemoryRouter,RouterProvider} from 'react-router';
 export {renderToStaticMarkup} from 'react-dom/server';
`,resolveDir:root,loader:'tsx'},bundle:true,format:'esm',platform:'node',packages:'external',write:false,jsx:'automatic',plugins:[{name:'authored-contracts',setup(builder){builder.onResolve({filter:/\.mjs$/},args=>{if(!args.path.startsWith('.'))return;const path=resolve(dirname(args.importer),args.path).replace(/\.mjs$/,'.mts');if(path.startsWith(join(root,'src')+'/')&&existsSync(path))return{path};});}}]});
const modulePath=join(directory,'locale-notices.mjs');await writeFile(modulePath,bundle.outputFiles[0].text);
const api=await import(pathToFileURL(modulePath).href);
const {createLocaleStore,formatUiMessage,routeUiLocale,UI_LOCALE_STORAGE_KEY,UI_MESSAGES,
 createNoticesService,parsePackagedContent,packagedContentNodes,LEGACY_FIRST_USE_KEYS,FIRST_USE_NOTICE_SEEN_STORAGE_KEY,
 SITE_NOTICE_STORAGE_KEY,SITE_NOTICE_DISMISSED_KEY,SITE_NOTICE_DURATION_MS,
 LocaleProvider,LocaleSelect,NoticesProvider,CanonicalHelpContent,entryNoticeMode,
 createElement,createMemoryRouter,RouterProvider,renderToStaticMarkup}=api;
class Storage {
 constructor(values={}){this.values=new Map(Object.entries(values));this.reads=[];this.writes=[];}
 getItem(key){this.reads.push(key);return this.values.get(key)??null;}
 setItem(key,value){this.writes.push([key,value]);this.values.set(key,value);}
}
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};}
function timers(){let serial=0;const tasks=new Map();return{tasks,set(callback,delay){const handle={id:++serial};tasks.set(handle,{callback,delay});return handle;},clear(handle){tasks.delete(handle);},fire(){for(const [handle,task]of[...tasks]){tasks.delete(handle);task.callback();}}};}
function setup(t,{storage=new Storage(),fetchImpl,body='<p>Actual notice</p>',status=200}={}){
 const calls=[],clock=timers();const service=createNoticesService({baseUrl:'https://launcher.example/mount/',storage,timers:clock,fetchImpl:fetchImpl??(async(url,options)=>{calls.push({url,options});return new Response(body,{status});})});
 t.after(()=>service.dispose());return{service,storage,clock,calls,state:()=>service.getSnapshot()};
}

test('locale construction, snapshots and subscriptions have no storage or browser I/O',()=>{
 const storage=new Storage({[UI_LOCALE_STORAGE_KEY]:'en'}),store=createLocaleStore({storage});const stop=store.subscribe(()=>{});
 assert.equal(store.getSnapshot().locale,'zh-CN');assert.deepEqual(storage.reads,[]);assert.deepEqual(storage.writes,[]);
 store.hydrate();assert.equal(store.getSnapshot().preferredLocale,'en');assert.equal(store.getSnapshot().locale,'zh-CN','published identity outranks saved preference');stop();
});
test('locale uses the full existing catalogs with identical parameter replacement',()=>{
 for(const locale of ['zh-CN','en'])for(const [key,value]of Object.entries(UI_MESSAGES[locale]))assert.equal(formatUiMessage(locale,key),value,key);
 assert.match(formatUiMessage('en','replay.fileCount',{count:3}),/3/);
 const store=createLocaleStore();store.setLocale('en');assert.equal(store.format('action.close'),'Close');assert.equal(store.getSnapshot().persistence,'session');
});
test('explicit routes and locale state preserve both translations and storage identity',()=>{
 assert.equal(routeUiLocale('/en.html','?uiLocale=zh-CN'),'en');assert.equal(routeUiLocale('/mount/en.html',''),'en');
 assert.equal(routeUiLocale('/play/th06','?uiLocale=en'),'en');assert.equal(routeUiLocale('/','?uiLocale=zh-CN'),'zh-CN');assert.equal(routeUiLocale('/','?uiLocale=invalid'),null);
 const storage=new Storage(),store=createLocaleStore({storage});store.hydrate();store.setLocale('en');assert.deepEqual(storage.writes,[[UI_LOCALE_STORAGE_KEY,'en']]);
 store.setLocale('zh-CN',{persist:false});assert.equal(storage.writes.length,1);assert.equal(store.getSnapshot().locale,'zh-CN');
 assert.throws(()=>store.setLocale('invalid'),/Unsupported/);assert.throws(()=>createLocaleStore({initialLocale:'invalid'}),/Unsupported/);
});
test('locale storage denial remains session-only without losing selected UI',()=>{
 const store=createLocaleStore({storage:{getItem(){throw Error('denied');},setItem(){throw Error('denied');}}});
 store.hydrate();store.setLocale('en');assert.equal(store.getSnapshot().persistence,'session');assert.equal(store.getSnapshot().locale,'en');
});

test('notice construction and subscription are inert; hydration preserves canonical keys',t=>{
 const h=setup(t);const stop=h.service.subscribe(()=>{});assert.deepEqual(h.storage.reads,[]);assert.equal(h.calls.length,0);assert.equal(h.clock.tasks.size,0);
 h.service.hydrate();assert.equal(h.state().hydrated,true);assert.equal(h.state().site.enabled,true);assert.equal(h.state().firstUseSeen,false);stop();
});
test('available first-use content is marked seen only after content parsing and presentation',async t=>{
 const delayed=deferred();const h=setup(t,{fetchImpl:()=>delayed.promise});const task=h.service.showFirstUse();
 assert.equal(h.state().contents['first-use'].status,'loading');assert.equal(h.state().firstUseOpen,false);assert.deepEqual(h.storage.writes,[]);
 delayed.resolve(new Response('<h2>Before you start</h2><p>Read this.</p>'));assert.equal(await task,true);
 assert.equal(h.state().firstUseOpen,true);assert.equal(h.state().contents['first-use'].nodes.length,2);
 assert.deepEqual(h.storage.writes,[[FIRST_USE_NOTICE_SEEN_STORAGE_KEY,'1']]);h.service.closeFirstUse();assert.equal(h.storage.writes.length,1,'dismissal is not the acknowledgment event');
});
test('automatic first-use errors and empty content neither open nor mark seen',async t=>{
 for(const config of [{body:'',status:200},{body:'unavailable',status:503}]){
  const h=setup(t,config);assert.equal(await h.service.showFirstUse(true),false);assert.equal(h.state().firstUseOpen,false);assert.equal(h.state().firstUseSeen,false);assert.deepEqual(h.storage.writes,[]);
 }
});
test('manual empty/error dialogs open without acknowledging content; errors can retry',async t=>{
 const h=setup(t,{body:'',status:200});assert.equal(await h.service.showFirstUse(),true);assert.equal(h.state().contents['first-use'].status,'empty');assert.equal(h.state().firstUseSeen,false);
 let attempt=0;const retry=setup(t,{fetchImpl:async()=>new Response(++attempt===1?'no':'<p>Ready</p>',{status:attempt===1?503:200})});
 assert.equal(await retry.service.showFirstUse(),true);assert.equal(retry.state().contents['first-use'].status,'error');assert.equal(retry.state().firstUseSeen,false);
 retry.service.closeFirstUse();assert.equal(await retry.service.showFirstUse(),true);assert.equal(retry.state().firstUseSeen,true);assert.equal(attempt,2);
});
test('every legacy first-use marker migrates once and does not trigger another onboarding',async t=>{
 for(const key of LEGACY_FIRST_USE_KEYS){const h=setup(t,{storage:new Storage({[key]:'1'})});h.service.hydrate();assert.equal(await h.service.showFirstUse(true),false);assert.equal(h.calls.length,0);assert.deepEqual(h.storage.writes,[[FIRST_USE_NOTICE_SEEN_STORAGE_KEY,'1']]);h.service.hydrate();assert.equal(h.storage.writes.length,1);}
});
test('one entry notice sequence suppresses site notice when first-use is presented',async t=>{
 const h=setup(t);assert.equal(await h.service.showEntry(),true);assert.equal(h.calls.length,1);assert.match(h.calls[0].url,/content\/FIRST_USE_NOTICE\.html$/);
 h.service.closeFirstUse();assert.equal(await h.service.showEntry(),true);assert.equal(h.calls.length,1,'closing onboarding does not invent a subsequent site notice');
});
test('returning users get the enabled site notice; disabled notice does not fetch',async t=>{
 const h=setup(t,{storage:new Storage({[FIRST_USE_NOTICE_SEEN_STORAGE_KEY]:'1'}),body:'Hello [FAQ](faq.html)'});assert.equal(await h.service.showEntry(),true);assert.equal(h.calls.length,1);assert.match(h.calls[0].url,/NOTICE\.txt$/);
 const off=setup(t,{storage:new Storage({[FIRST_USE_NOTICE_SEEN_STORAGE_KEY]:'1',[SITE_NOTICE_STORAGE_KEY]:'0'})});assert.equal(await off.service.showEntry(),false);assert.equal(off.calls.length,0);
});
test('site notice timeout is 15 seconds and never records explicit dismissal',async t=>{
 const h=setup(t,{body:'Site announcement'});assert.equal(await h.service.loadSite(),true);assert.equal(h.clock.tasks.size,1);assert.equal([...h.clock.tasks.values()][0].delay,SITE_NOTICE_DURATION_MS);
 h.clock.fire();assert.equal(h.state().site.open,false);assert.equal(h.state().site.dismissed,false);assert.deepEqual(h.storage.writes,[]);
});
test('explicit close records dismissal; opt-out is shown only on a subsequent presentation',async t=>{
 const h=setup(t,{body:'Notice'});await h.service.loadSite();assert.equal(h.state().site.canOptOut,false);
 h.service.closeSite({dismiss:true});assert.equal(h.state().site.dismissed,true);assert.equal(h.state().site.canOptOut,false);assert.deepEqual(h.storage.writes,[[SITE_NOTICE_DISMISSED_KEY,'1']]);
 await h.service.loadSite();assert.equal(h.state().site.canOptOut,true);h.service.setSiteEnabled(false);assert.equal(h.state().site.enabled,false);assert.equal(h.state().site.open,false);assert.equal(h.storage.values.get(SITE_NOTICE_STORAGE_KEY),'0');
});
test('scroll visibility uses per-owner delta and does not change notice preference or dismissal',async t=>{
 const h=setup(t,{body:'Notice'});await h.service.loadSite();const owner={},nested={};h.service.observeScroll(owner,0);h.service.observeScroll(owner,20);assert.equal(h.state().site.scrollHidden,true);
 h.service.observeScroll(owner,18);assert.equal(h.state().site.scrollHidden,true,'under-three delta ignored');h.service.observeScroll(owner,10);assert.equal(h.state().site.scrollHidden,false);
 h.service.observeScroll(nested,100);assert.equal(h.state().site.scrollHidden,false,'new scroll owner establishes its own baseline');assert.deepEqual(h.storage.writes,[]);
});
test('late notice fetch after close or opt-out cannot reopen a surface',async t=>{
 const pending=deferred();const h=setup(t,{fetchImpl:()=>pending.promise});const task=h.service.loadSite();h.service.closeSite({dismiss:true});pending.resolve(new Response('late'));
 assert.equal(await task,false);assert.equal(h.state().site.open,false);assert.equal(h.state().site.dismissed,true);
});
test('late first-use after close/disposal is never acknowledged; concurrent displays use latest intent',async t=>{
 const d=deferred();const h=setup(t,{fetchImpl:()=>d.promise});const first=h.service.showFirstUse();h.service.closeFirstUse();d.resolve(new Response('<p>Late</p>'));assert.equal(await first,false);assert.deepEqual(h.storage.writes,[]);
 const d2=deferred();const h2=setup(t,{fetchImpl:()=>d2.promise});const a=h2.service.showFirstUse(),b=h2.service.showFirstUse();d2.resolve(new Response('<p>Latest</p>'));assert.equal(await a,false);assert.equal(await b,true);assert.equal(h2.storage.writes.length,1);
 const d3=deferred();const h3=setup(t,{fetchImpl:()=>d3.promise});const task=h3.service.showFirstUse();h3.service.dispose();d3.resolve(new Response('<p>Disposed</p>'));assert.equal(await task,false);assert.deepEqual(h3.storage.writes,[]);assert.equal(h3.clock.tasks.size,0);
});
test('navigation into a room while automatic content is pending prevents late interruption',async t=>{
 let mode='all';const d=deferred(),storage=new Storage();const service=createNoticesService({baseUrl:'https://launcher.example/',storage,automaticMode:()=>mode,fetchImpl:()=>d.promise});t.after(()=>service.dispose());
 const task=service.showEntry();mode='none';d.resolve(new Response('<p>Late onboarding</p>'));assert.equal(await task,false);assert.equal(service.getSnapshot().firstUseOpen,false);assert.equal(service.getSnapshot().site.open,false);assert.deepEqual(storage.writes,[]);
 assert.equal(await service.showFirstUse(),true,'a deliberate manual request is still allowed');
});
test('fixed content URLs reject cross-origin/path redirects and undeclared content kinds',async t=>{
 for(const url of ['https://evil.example/notice.html','https://launcher.example/mount/login.html']){
  const response=new Response('<p>Wrong</p>');Object.defineProperty(response,'url',{value:url});const h=setup(t,{fetchImpl:async()=>response});assert.equal(await h.service.showFirstUse(true),false);assert.match(h.state().contents['first-use'].error,/redirected/);assert.deepEqual(h.storage.writes,[]);
 }
 const h=setup(t);assert.throws(()=>h.service.loadContent('../secret'),/Unknown/);assert.throws(()=>h.service.loadContent('toString'),/Unknown/);assert.equal(h.calls.length,0);
});
test('unsupported, oversized and excessive-depth content cannot acknowledge first-use',async t=>{
 const unsupported=setup(t,{body:'<script>alert(1)</script>'});assert.equal(await unsupported.service.showFirstUse(true),false);assert.deepEqual(unsupported.storage.writes,[]);
 const oversized=createNoticesService({baseUrl:'https://launcher.example/',maxContentBytes:4,fetchImpl:async()=>new Response('<p>Too large</p>')});t.after(()=>oversized.dispose());assert.equal(await oversized.showFirstUse(true),false);assert.match(oversized.getSnapshot().contents['first-use'].error,/size limit/);
 await assert.rejects(parsePackagedContent('<div>'.repeat(70)+'content'+'</div>'.repeat(70),'https://launcher.example/'),/too complex/);
});
test('packaged content allowlist drops active markup and unsafe URLs, resolves actual nested links',async()=>{
 const html='<section onclick="bad()"><script>bad()</script><style>bad</style><iframe src="https://bad"></iframe><svg onload="bad()"></svg><p style="color:red">Safe &lt;script&gt;text&lt;/script&gt;</p><a href="javascript:bad()" onclick="bad()">bad link</a><a href="faq.html?a=1&amp;b=2" target="evil">FAQ</a><img src="data:x" onerror="bad()"><img src="assets/help.webp" alt="guide" onerror="bad()"><a href="https://docs.example/">external</a></section>';
 const nodes=await packagedContentNodes(html,'https://launcher.example/mount/');const rendered=renderToStaticMarkup(createElement('div',null,...nodes));
 assert.doesNotMatch(rendered,/<script|<style|<iframe|<svg|onclick|onerror|javascript:|data:x|style=|target="evil"/);
 assert.match(rendered,/Safe &lt;script&gt;text&lt;\/script&gt;/);assert.match(rendered,/https:\/\/launcher\.example\/mount\/faq\.html\?a=1&amp;b=2/);
 assert.match(rendered,/https:\/\/launcher\.example\/mount\/assets\/help\.webp/);assert.match(rendered,/rel="noopener noreferrer"/);
});
test('actual repository-generated notice and guide render without placeholder content',async()=>{
 for(const name of ['FIRST_USE_NOTICE','MULTIPLAYER']){
  const html=await readFile(join(root,'public/content',`${name}.html`),'utf8');const nodes=await packagedContentNodes(html,'https://launcher.example/');
  const rendered=renderToStaticMarkup(createElement('div',null,...nodes));assert.ok(rendered.length>200);
  assert.match(rendered,name==='FIRST_USE_NOTICE'?/touhou\.vip/:/Boss/);assert.doesNotMatch(rendered,/onerror=|<script/);
 }
});
test('canonical help uses established controls including TH11 C, and optional thprac stays gated',()=>{
 const renderHelp = props => {const router=createMemoryRouter([{path:'*',element:createElement(CanonicalHelpContent,props)}],{basename:'/nested/',initialEntries:['/nested/']});try{return renderToStaticMarkup(createElement(RouterProvider,{router}));}finally{router.dispose();}};
 const base=renderHelp({gameId:'th11'});assert.match(base,/<kbd>C<\/kbd>/);assert.match(base,/Ctrl/);assert.match(base,/暂停菜单/);assert.doesNotMatch(base,/当前原版验证入口限定|从 Practice/);
 const practice=renderHelp({gameId:'th06',thpracAvailable:true});assert.match(practice,/从 Practice/);assert.match(practice,/F12/);assert.match(practice,/Backspace/);assert.doesNotMatch(practice,/<kbd>C<\/kbd>/);
});
test('automatic notice mode preserves direct-room, directory and debug entry exclusions',()=>{
 assert.equal(entryNoticeMode('/',''),'all');assert.equal(entryNoticeMode('/play/th06',''),'all');
 for(const [path,search]of [['/','?mpRoom=1234'],['/lobby',''],['/lobby.html',''],['/','?lobbyOptions=1'],['/play/th09mp/room/1234','']])assert.equal(entryNoticeMode(path,search),'none');
 assert.equal(entryNoticeMode('/','?debug=fixture'),'site-only');assert.equal(entryNoticeMode('/','?preview=touch'),'site-only');
});
test('SSR providers do not touch browser storage/document or begin content fetches',()=>{
 const element=createElement(LocaleProvider,null,createElement(NoticesProvider,null,createElement(LocaleSelect),createElement(CanonicalHelpContent,{gameId:'th11'})));
 const router=createMemoryRouter([{path:'*',element}],{initialEntries:['/en.html?game=th11']});
 const names=['window','document','localStorage','sessionStorage'];const originals=new Map(names.map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)]));
 for(const name of names)Object.defineProperty(globalThis,name,{configurable:true,get(){throw Error(`SSR read ${name}`);}});
 try{const rendered=renderToStaticMarkup(createElement(RouterProvider,{router}));assert.match(rendered,/Game controls/);assert.match(rendered,/Interface language/);assert.equal(router.state.location.pathname,'/en.html');}
 finally{for(const name of names){const prior=originals.get(name);if(prior)Object.defineProperty(globalThis,name,prior);else delete globalThis[name];}router.dispose();}
});
test('new service graphs tree-shake old DOM controllers and preserve dependency boundaries',async()=>{
 assert.doesNotMatch(bundle.outputFiles[0].text,/function (?:createSiteNoticeController|createFirstUseNoticeController|createMultiplayerGuideController|initUiLocale|setUiLocale)\(/);
 for(const path of ['app/services/locale.client.ts','app/services/notices.client.ts','app/components/LocaleProvider.tsx','app/components/Notices.tsx']){
  const source=await readFile(join(root,path),'utf8');assert.deepEqual(boundaryViolations(path,source),[],path);assert.doesNotMatch(source,/dangerouslySetInnerHTML|\.innerHTML\s*=/);
 }
});
