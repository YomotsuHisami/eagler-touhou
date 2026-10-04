/** Actual ES5 boot source + synthetic DOM/clock/clipboard. No browser, listener,
 * live network, native game, GPU, or storage acceptance is claimed here. */
import assert from 'node:assert/strict';
import {test, after} from 'node:test';
import {readFile, mkdir, mkdtemp, writeFile, rm} from 'node:fs/promises';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {join} from 'node:path';
import {runInNewContext} from 'node:vm';
import {parse} from 'acorn';
import {build} from 'esbuild';
const root = fileURLToPath(new URL('../..', import.meta.url));
const source = await readFile(join(root, 'app/browser/boot-recovery.js'), 'utf8');
const gateSource = await readFile(join(root, 'app/browser/compatibility-gate.js'), 'utf8');
await mkdir(join(root,'.cache'),{recursive:true});
const folder = await mkdtemp(join(root, '.cache/boot-recovery-test-')); after(() => rm(folder, {recursive:true, force:true}));
const bundle = await build({stdin:{contents:`
  export {LauncherErrorBoundary} from './app/components/LauncherErrorBoundary';
  export {bootUiEntries} from './src/launcher/i18n-boot-ui.mts';
  export {createElement} from 'react'; export {renderToStaticMarkup} from 'react-dom/server';
  export {createMemoryRouter, RouterProvider} from 'react-router';
`, resolveDir:root, loader:'tsx'}, bundle:true, platform:'node', format:'esm', packages:'external', jsx:'automatic', write:false,
  // Framework replaces .client exports during SSR. Error recovery cannot rely
  // on them, even though an ordinary esbuild SSR fixture would allow it.
  plugins:[{name:'server-error-boundary',setup(builder){builder.onLoad({filter:/\.client\.[cm]?tsx?$/},args=>{throw Error(`Server error boundary depends on stripped client module: ${args.path}`);});}}]});
const entry = join(folder, 'entry.mjs'); await writeFile(entry, bundle.outputFiles[0].text);
const {LauncherErrorBoundary, bootUiEntries, createElement:h, renderToStaticMarkup, createMemoryRouter, RouterProvider} = await import(pathToFileURL(entry).href);
const messages = JSON.stringify(Object.fromEntries(['zh-CN','en'].map((locale,index)=>[locale,Object.fromEntries(bootUiEntries.map(row=>[row[0],row[index+1]]))])));

function emitter() {
  const listeners = new Map();
  return {listeners, addEventListener(name, fn) {if (!listeners.has(name)) listeners.set(name,new Set()); listeners.get(name).add(fn);},
    removeEventListener(name, fn) {listeners.get(name)?.delete(fn); if (!listeners.get(name)?.size) listeners.delete(name);},
    dispatch(name, event={}) {for (const listener of [...(listeners.get(name) ?? [])]) listener(event);}};
}
function fixture({mount='/nested/', pathname='/nested/play/th06', search='', parsed=true, redirect=false, runGate=false, webgl=true, clipboard='missing', fallback=true, visible=true}={}) {
  let now=0, id=0, reloads=0, redirects=[], copied=[];
  const timers=new Map(), window=emitter();
  const location={pathname,search,protocol:'https:',host:'launcher.test',href:`https://launcher.test${pathname}${search}`,reload:()=>{reloads++;},replace:value=>redirects.push(value)};
  class Element {
    constructor(tag) {this.tagName=tag.toUpperCase();this.children=[];this.attrs={};this.style={};Object.assign(this,emitter());}
    setAttribute(key,value) {this.attrs[key]=value;}
    getAttribute(key) {return this.attrs[key] ?? null;}
    appendChild(child) {this.children.push(child);child.parentNode=this;return child;}
    removeChild(child) {this.children=this.children.filter(value=>value!==child);child.parentNode=null;}
    set href(value) {this.url=new URL(value,location.href).href;} get href() {return this.url;}
    focus() {document.activeElement=this;}
    select() {this.focus();}
    getContext() {return webgl ? {} : null;}
  }
  const html=new Element('html'), head=html.appendChild(new Element('head')), body=html.appendChild(new Element('body'));
  const walk=(node, predicate)=>predicate(node)?node:node.children.map(child=>walk(child,predicate)).find(Boolean);
  const findAll=(node,predicate)=>[...(predicate(node)?[node]:[]),...node.children.flatMap(child=>findAll(child,predicate))];
  const document={...emitter(),documentElement:html,body,visibilityState:visible?'visible':'hidden',activeElement:null,
    createElement:tag=>new Element(tag),getElementById:id=>walk(html,node=>node.id===id),getElementsByTagName:tag=>findAll(html,node=>node.tagName===tag.toUpperCase()),
    execCommand(command) {assert.equal(command,'copy');if(fallback==='throw')throw Error('Synthetic clipboard unavailable');copied.push(document.activeElement.value);return fallback;}};
  const gate=head.appendChild(new Element('script'));gate.id='browser-compatibility-gate';gate.setAttribute('data-compatibility-url',`${mount}compatibility.html`);
  if(redirect)gate.setAttribute('data-redirecting','true');
  const script=head.appendChild(new Element('script'));script.id='launcher-boot-watchdog';script.setAttribute('data-assets-url',`${mount}assets/`);script.setAttribute('data-messages',messages);
  const addMount=()=>{const target=body.appendChild(new Element('div'));target.id='launcher-boot-recovery';return target;};
  if(parsed)addMount();
  const navigator={onLine:true,userAgent:'Mozilla/5.0 Firefox/144.0',clipboard:clipboard==='missing'?undefined:{writeText:async text=>{if(clipboard==='reject')throw Error('Synthetic clipboard unavailable');copied.push(text);}}};
  const scope={window,document,location,navigator,Date:{now:()=>now},setTimeout:(fn,delay)=>{const key=++id;timers.set(key,{fn,due:now+delay});return key;},clearTimeout:key=>timers.delete(key)};
  if(runGate)runInNewContext(gateSource,scope);
  runInNewContext(source,scope);
  const advance=ms=>{const target=now+ms;for(;;){const next=[...timers].filter(([,timer])=>timer.due<=target).sort((a,b)=>a[1].due-b[1].due)[0];if(!next)break;now=next[1].due;timers.delete(next[0]);next[1].fn();}now=target;};
  const panel=()=>document.getElementById('launcher-boot-emergency');
  const text=node=>node ? [node.textContent || '',...node.children.map(text)].join(' ') : '';
  const button=label=>walk(panel(),node=>node.tagName==='BUTTON'&&node.textContent===label);
  return {window,document,scope,advance,timers,panel,text,button,addMount,redirects,copied,reloads:()=>reloads,
    preload:(href,rel='modulepreload')=>{const node=head.appendChild(new Element('link'));node.href=href;node.rel=rel;return node;},
    code:()=>document.getElementById('launcher-boot-diagnostics')?.textContent,
    click:label=>button(label).dispatch('click'),
    failure:()=>window.dispatch('error',{target:{tagName:'SCRIPT',type:'module',src:`https://launcher.test${mount}assets/entry.synthetic.js?private=secret`}})};
}
test('classic recovery is ES5, source-owned, ordered after compatibility and before modules',async()=>{
  parse(source,{ecmaVersion:5,sourceType:'script'});
  const rootSource=await readFile(join(root,'app/root.tsx'),'utf8');
  assert.ok(rootSource.indexOf('<script id="browser-compatibility-gate"')<rootSource.indexOf('<script id="launcher-boot-watchdog"'));
  assert.ok(rootSource.indexOf('<script id="launcher-boot-watchdog"')<rootSource.indexOf('<Meta/>'));
  assert.match(rootSource,/useLayoutEffect\(\(\) => \{window\.__eaglerUiBoot\?\.ready\(\);\}, \[\]\)/);
  assert.match(rootSource,/export function ErrorBoundary/);
  assert.equal((rootSource.match(/<RuntimeProvider>/g)??[]).length,1);
  assert.match(rootSource,/<GameLaunchProvider>[\s\S]*<GlobalHelpPanel\/><\/SettingsBoundary>/);
  assert.doesNotMatch(source,/XMLHttpRequest|sendBeacon|localStorage|sessionStorage|indexedDB|caches\.|\.stack|userAgent|pushState|replaceState/);
  assert.equal((source.match(/window\.fetch\(/g)??[]).length,1,'the explicit bounded Reload action is the only request site');
});
test('12 active seconds replace an otherwise indefinite hydration wait with one recovery card',()=>{
  const f=fixture();f.advance(11999);assert.equal(f.panel(),undefined);f.advance(1);
  assert.ok(f.panel());assert.match(f.code(),/kind=watchdog\nelapsed_active_ms=12000/);assert.equal(f.timers.size,0);
  assert.equal(f.window.listeners.size,0);f.advance(12000);assert.equal(f.panel().parentNode.children.length,1);
});
test('a real ready signal retires all boot listeners and ignores later UI, game and network errors',()=>{
  const f=fixture();f.advance(50);f.window.__eaglerUiBoot.ready();f.window.__eaglerUiBoot.ready();
  f.failure();f.window.dispatch('unhandledrejection',{reason:Error('Failed to fetch dynamically imported module: https://launcher.test/nested/assets/later.js')});
  f.advance(24000);assert.equal(f.panel(),undefined);assert.equal(f.window.listeners.size,0);assert.equal(f.document.listeners.size,0);assert.equal(f.timers.size,0);
  runInNewContext(source,f.scope);assert.equal(f.timers.size,0,'StrictMode/repeated source must not rearm boot');
});
test('late hydration or a rendered route boundary removes emergency UI and cannot rearm it',()=>{
  for(const signal of ['ready','handled']){const f=fixture();f.failure();assert.ok(f.panel());f.window.__eaglerUiBoot[signal]();assert.equal(f.panel(),undefined);assert.equal(f.timers.size,0);f.advance(20000);assert.equal(f.panel(),undefined);}
});
test('only same-mount initial module failures trigger immediate script recovery',()=>{
  const f=fixture();
  for(const target of [{tagName:'IMG',type:'module',src:'https://launcher.test/nested/assets/image.png'},
    {tagName:'SCRIPT',type:'module',src:'https://other.test/nested/assets/entry.js'},
    {tagName:'SCRIPT',type:'module',src:'https://launcher.test/other/assets/entry.js'},
    {tagName:'SCRIPT',type:'module',src:'https://launcher.test/nested/runtime/game.js'},
    {tagName:'SCRIPT',type:'',src:'https://launcher.test/nested/assets/third-party.js'}])f.window.dispatch('error',{target});
  assert.equal(f.panel(),undefined);f.failure();assert.match(f.code(),/kind=script-load/);
  assert.doesNotMatch(f.code(),/private|secret|https:|entry|\.js/);
});
test('initial JavaScript errors retain a category but omit exception, filename, query, stack and identity',()=>{
  const f=fixture();f.window.dispatch('error',{target:f.window,filename:'https://launcher.test/nested/assets/root.synthetic.js?token=secret',message:'secret-player-and-room',error:{stack:'sensitive stack'}});
  assert.match(f.code(),/kind=javascript/);assert.doesNotMatch(f.text(f.panel()),/secret|sensitive|token|room|root\.synthetic/);
});
test('the tagged Framework inline module catches failed static imports with no src URL',()=>{
  const f=fixture();f.window.dispatch('error',{target:{tagName:'SCRIPT',type:'module',src:'',getAttribute:name=>name==='data-launcher-boot-module'?'':null}});
  assert.match(f.code(),/kind=script-load/);
});
test('ordinary rejections are ignored; owned import failure is categorized without retaining its message',()=>{
  const f=fixture();
  for(const message of ['Failed to fetch','Game data request failed','Failed to fetch dynamically imported module: https://other.test/assets/file.js'])f.window.dispatch('unhandledrejection',{reason:Error(message)});
  assert.equal(f.panel(),undefined);
  f.window.dispatch('unhandledrejection',{reason:Error('Failed to fetch dynamically imported module: https://launcher.test/nested/assets/root.synthetic.js?secret=room')});
  assert.match(f.code(),/kind=module-load/);assert.doesNotMatch(f.code(),/secret|room|root\.synthetic|https:/);
});
test('pagehide/pageshow resumes the remaining bound; BFCache suspension is not a boot failure',()=>{
  const f=fixture();f.advance(4000);f.window.dispatch('pagehide',{persisted:true});f.advance(100000);assert.equal(f.panel(),undefined);assert.equal(f.timers.size,0);
  f.window.dispatch('pageshow',{persisted:true});f.advance(7999);assert.equal(f.panel(),undefined);f.advance(1);assert.match(f.code(),/elapsed_active_ms=12000/);
});
test('background visibility pauses the bound and a ready document never resumes it',()=>{
  const f=fixture({visible:false});f.advance(100000);assert.equal(f.panel(),undefined);
  f.document.visibilityState='visible';f.document.dispatch('visibilitychange');f.advance(3000);
  f.document.visibilityState='hidden';f.document.dispatch('visibilitychange');f.advance(100000);assert.equal(f.panel(),undefined);
  f.document.visibilityState='visible';f.document.dispatch('visibilitychange');f.advance(8999);assert.equal(f.panel(),undefined);f.advance(1);assert.match(f.code(),/elapsed_active_ms=12000/);
});
test('recovery waits for its HTML mount and a ready signal cancels that deferred paint',()=>{
  const f=fixture({parsed:false});f.failure();assert.equal(f.panel(),undefined);assert.ok(f.document.listeners.has('DOMContentLoaded'));f.addMount();f.document.dispatch('DOMContentLoaded');assert.ok(f.panel());assert.equal(f.document.listeners.size,0);
  const g=fixture({parsed:false});g.failure();g.window.__eaglerUiBoot.ready();g.addMount();g.document.dispatch('DOMContentLoaded');assert.equal(g.panel(),undefined);assert.equal(g.document.listeners.size,0);
});
test('compatibility redirect disables recovery; explicit guide retry retains recovery',()=>{
  const f=fixture({runGate:true,webgl:false});assert.equal(f.redirects.length,1);assert.equal(f.window.__eaglerUiBoot,undefined);assert.equal(f.timers.size,0);f.advance(30000);assert.equal(f.panel(),undefined);
  const g=fixture({runGate:true,webgl:false,search:'?compat=continue'});assert.equal(g.redirects.length,0);g.advance(12000);assert.ok(g.panel());
});
test('repeated installation is idempotent while pending',()=>{
  const f=fixture();runInNewContext(source,f.scope);assert.equal(f.timers.size,1);assert.equal(f.window.listeners.get('error').size,1);
});
test('English entry and locale query use the same authored UI messages',()=>{
  for(const options of [{pathname:'/nested/en.html'},{search:'?uiLocale=en'},{search:'?uiLocale=%65%6e'}]){const f=fixture(options);f.failure();assert.equal(f.panel().lang,'en');assert.match(f.text(f.panel()),/Launcher could not load/);}
  for(const search of ['?uiLocale=zh-CN&uiLocale=en','?uiLocale=%broken']){const f=fixture({search});f.failure();assert.equal(f.panel().lang,'zh-CN');}
});
test('reload is user-triggered; modern clipboard copies only the displayed bounded diagnostics',async()=>{
  const f=fixture({search:'?uiLocale=en',clipboard:'success'});f.failure();assert.equal(f.reloads(),0);assert.deepEqual(f.copied,[]);
  f.click('Reload');assert.equal(f.reloads(),1);f.click('Copy diagnostics');await Promise.resolve();assert.deepEqual(f.copied,[f.code()]);assert.match(f.text(f.panel()),/Copied/);
});
test('explicit recovery Reload revalidates only unique same-origin direct authored modulepreloads then reloads once',async()=>{
  const f=fixture({search:'?uiLocale=en'}),requests=[];
  f.window.fetch=async(url,options)=>{requests.push({url,options});return {arrayBuffer:async()=>new ArrayBuffer(0)};};
  for(const url of ['/nested/assets/root-abcdefgh.js','/nested/assets/root-abcdefgh.js','/nested/assets/entry-abcdefgh.js','/nested/assets/file.js?private=token','/nested/assets/file.js#hash','/nested/assets/subdir/file.js','/other/assets/file.js','https://external.test/nested/assets/file.js'])f.preload(url);
  f.preload('/nested/assets/not-a-module.js','preload');
  f.failure();assert.equal(requests.length,0,'failure does not send background requests');
  f.click('Copy diagnostics');assert.equal(requests.length,0,'copy never retries modules');
  f.click('Reload');f.click('Reload');assert.equal(requests.length,2);assert.equal(f.reloads(),0);
  for(const request of requests){assert.match(request.url,/^https:\/\/launcher\.test\/nested\/assets\/(?:root|entry)-abcdefgh\.js$/);assert.equal(request.options.cache,'reload');assert.equal(request.options.mode,'same-origin');assert.equal(request.options.credentials,'omit');assert.equal(request.options.redirect,'error');assert.equal(request.options.referrerPolicy,'no-referrer');}
  for(let n=0;n<8;n++)await Promise.resolve();assert.equal(f.reloads(),1);assert.equal(f.timers.size,0);f.click('Reload');assert.equal(f.reloads(),1);assert.equal(requests.length,2);
});
test('recovery revalidation is capped at 64 URLs and 2 seconds, aborting pending work without a loop',()=>{
  const f=fixture({search:'?uiLocale=en'});let requests=0,aborts=0;
  f.window.fetch=()=>{requests++;return new Promise(()=>{});};
  f.window.AbortController=class{signal={};abort(){aborts++;}};
  for(let i=0;i<80;i++)f.preload(`/nested/assets/file-${i}.js`);
  f.failure();f.click('Reload');assert.equal(requests,64);f.advance(1999);assert.equal(f.reloads(),0);f.advance(1);assert.equal(f.reloads(),1);assert.equal(aborts,1);f.advance(10000);assert.equal(f.reloads(),1);
});
test('late ready, handled, pagehide or a replaced recovery card cancels a stale pending Reload',()=>{
  for(const action of ['ready','handled','pagehide','replace','replace-owner']){
    const f=fixture({search:'?uiLocale=en'});let aborted=0;f.preload('/nested/assets/root-abcdefgh.js');f.window.fetch=()=>new Promise(()=>{});f.window.AbortController=class{signal={};abort(){aborted++;}};
    f.failure();f.click('Reload');
    if(action==='pagehide')f.window.dispatch('pagehide');else if(action==='replace')f.panel().parentNode.removeChild(f.panel());else if(action==='replace-owner')f.window.__eaglerUiBoot={};else f.window.__eaglerUiBoot[action]();
    f.advance(3000);assert.equal(f.reloads(),0,action);assert.equal(aborted,1,action);assert.equal(f.timers.size,0,action);
  }
});
test('failed raw requests still perform one ordinary Reload and never expose response data',async()=>{
  for(const throws of [false,true]){const f=fixture({search:'?uiLocale=en'});f.preload('/nested/assets/root-abcdefgh.js');f.window.fetch=()=>{if(throws)throw Error('secret');return Promise.reject(Error('secret'));};f.failure();f.click('Reload');for(let i=0;i<5;i++)await Promise.resolve();assert.equal(f.reloads(),1);assert.doesNotMatch(f.text(f.panel()),/secret/);}
});
test('clipboard rejection falls back, preserves focus, and never lies about failed copy',async()=>{
  for(const fallback of [true,false,'throw']){const f=fixture({search:'?uiLocale=en',clipboard:'reject',fallback});f.failure();const button=f.button('Copy diagnostics');button.focus();f.click('Copy diagnostics');await Promise.resolve();
    assert.equal(f.document.activeElement,button);assert.equal(f.panel().children[0].children.some(node=>node.tagName==='TEXTAREA'),false);
    assert.match(f.text(f.panel()),fallback===true?/Copied/:/Could not copy automatically/);}
});
test('route boundary renders sanitized bilingual diagnostics without app providers or error details',()=>{
  for(const [url,error,expected] of [['/bad?uiLocale=en',Error('sensitive runtime data'),'This page could not load'],['/bad',{status:404,statusText:'secret',data:'secret',internal:false},'找不到此页面']]){
    const router=createMemoryRouter([{path:'*',element:h(LauncherErrorBoundary,{error})}],{initialEntries:[url]});
    try{const html=renderToStaticMarkup(h(RouterProvider,{router}));assert.match(html,new RegExp(expected));assert.match(html,/scope=route/);assert.doesNotMatch(html,/sensitive|secret|scope=initial-hydration/);assert.match(html,/data-route-recovery/);}finally{router.dispose();}
  }
});
