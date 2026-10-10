/** Executed pinned controller is the oracle. Synthetic DOM only: native browser
 * layout/top-layer focus and keyboard activation remain separate acceptance. */
import test, {before, after, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mkdir, mkdtemp, rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {authoredSourcesPlugin} from './authored-sources.mjs';
import {installMountedDom} from './mounted-dom-environment.mjs';
const project=fileURLToPath(new URL('../../',import.meta.url));
let env, React, createRoot, api, work;const mounts=[];
const pinned=path=>execFileSync('git',['show',`edee9633e5e3ee79cd2e1aa334f84f6caf755090:${path}`],{cwd:project,encoding:'utf8'});
before(async()=>{
 env=installMountedDom();React=await import('react');({createRoot}=await import('react-dom/client'));
 await mkdir(resolve(project,'.cache'),{recursive:true});work=await mkdtemp(resolve(project,'.cache/main-select-test-')); const outfile=resolve(work,'actual.mjs');
 const original=pinned('src/launcher/custom-select.mts');
 // The measured geometry algorithm is intentionally kept as pinned bytes.
 const current=readFileSync(resolve(project,'src/launcher/custom-select.mts'),'utf8');
 const geometry=source=>source.slice(source.indexOf('  function positionCustomSelectMenu('),source.indexOf(source.includes('  function reflectDescription(')?'  function reflectDescription(':'  function syncCustomSelect('));
 assert.equal(geometry(current),geometry(original));
 await build({absWorkingDir:project,stdin:{resolveDir:project,loader:'tsx',contents:`
 import React,{useLayoutEffect,useRef,useState} from 'react';
 import {MainSelect,MainSelectPrefix} from './app/components/launcher/MainSelect.tsx';
 import {LocaleProvider,translate} from './app/i18n.tsx';
 import {createCustomSelectController} from './src/launcher/custom-select.mts';
 import {createCustomSelectController as pinnedController} from 'pinned-controller';
 export {createCustomSelectController,pinnedController,MainSelect,MainSelectPrefix,LocaleProvider,translate};
 export function ControlledHarness({kind,accept,event,focusUpdate='none',strictProps={}}) {
   const [value,setValue]=useState('a'), [revision,setRevision]=useState(0), select=useRef(null), presentation=useRef(null);
   const nativeProps={id:'controlled-'+kind,value,ref:select,onChange:e=>{
     const ui=presentation.current ?? {trigger:select.current.parentElement.querySelector('button'),menu:document.querySelector('.mizuki-select-menu')};
     event({phase:'change',value:e.currentTarget.value,hidden:ui.menu.hidden,expanded:ui.trigger.getAttribute('aria-expanded'),label:ui.trigger.textContent,focused:document.activeElement===ui.trigger,ariaLabel:ui.trigger.getAttribute('aria-label'),selected:[...ui.menu.querySelectorAll('[aria-selected="true"]')].map(item=>item.dataset.value)});
     if(accept)setValue(e.currentTarget.value);
   },...strictProps};
   const options=<><option value="a">A</option><option value="b">B</option><option value="c">C</option></>;
   useLayoutEffect(()=>{
     const node=select.current;let controller;
     if(kind!=='react') {controller=(kind==='pinned'?pinnedController:createCustomSelectController)({translate:key=>translate('en',key)});controller.installCustomSelect(node);}
     const root=node.parentElement,trigger=root.querySelector('button');
     const ui={trigger,get menu(){return document.querySelector('.mizuki-select-menu');}};presentation.current=ui;
     const focus=()=>event({phase:'focus',value:node.value,hidden:ui.menu.hidden,expanded:trigger.getAttribute('aria-expanded'),label:trigger.textContent});
     const sync=()=>queueMicrotask(()=>controller?.syncCustomSelect(node));trigger.addEventListener('focus',focus);if(controller)node.addEventListener('change',sync);
     return()=>{trigger.removeEventListener('focus',focus);if(controller){node.removeEventListener('change',sync);if(controller.dispose)controller.dispose();else{root.before(node);root.remove();ui.menu?.remove();}}};
   },[]);
   return <div data-revision={revision} onFocus={()=>{
     if(focusUpdate==='ancestor')setRevision(value=>value+1);
     if(focusUpdate==='native-selection')select.current.value='c';
     if(focusUpdate==='state-selection')setValue('c');
   }}><LocaleProvider locale="en">{kind==='react'?<MainSelect {...nativeProps}>{options}</MainSelect>:<select {...nativeProps}>{options}</select>}</LocaleProvider></div>;
 }
 `},outfile,bundle:true,platform:'node',format:'esm',jsx:'automatic',packages:'external',logLevel:'silent',plugins:[{
 name:'pinned-controller',setup(ctx){ctx.onResolve({filter:/^pinned-controller$/},()=>({path:'original',namespace:'pinned'}));ctx.onLoad({filter:/.*/,namespace:'pinned'},()=>({loader:'ts',resolveDir:resolve(project,'src/launcher'),contents:original.replace("import { isUiMessageKey, t } from './i18n.mjs';","import {isUiMessageKey} from './i18n.mjs'; const t=key=>globalThis.__selectTranslate(key);")}));}},authoredSourcesPlugin(project)]});
 api=await import(pathToFileURL(outfile).href);globalThis.__selectTranslate=key=>api.translate('en',key);
});
afterEach(async()=>{for(const clean of mounts.splice(0).reverse())await clean();env.document.body.replaceChildren();assert.deepEqual(env.errors.splice(0),[]);});
after(async()=>{delete globalThis.__selectTranslate;env.close();await rm(work,{recursive:true,force:true});});
const act=callback=>React.act(async()=>{callback();await Promise.resolve();});
const query=(selector,scope=env.document)=>{const node=scope.querySelector(selector);assert.ok(node,selector);return node;};
const key=(node,value)=>node.dispatchEvent(new env.window.KeyboardEvent('keydown',{key:value,bubbles:true,cancelable:true}));
function describe(select,menu){const root=select.parentElement,trigger=query('.mizuki-select-trigger',root);return {
 value:select.value,label:query('.mizuki-select-value',root).textContent,nativeTitle:select.title,nativeTabIndex:select.tabIndex,nativeHidden:select.getAttribute('aria-hidden'),
 trigger:{disabled:trigger.disabled,ariaDisabled:trigger.getAttribute('aria-disabled'),ariaLabel:trigger.getAttribute('aria-label'),expanded:trigger.getAttribute('aria-expanded'),title:trigger.getAttribute('title'),hasPopup:trigger.getAttribute('aria-haspopup')},
 menu:{hidden:menu.hidden,role:menu.getAttribute('role'),ariaLabel:menu.getAttribute('aria-label'),items:[...menu.children].map(item=>({value:item.dataset.value,index:item.dataset.index,text:item.textContent,disabled:item.disabled,selected:item.getAttribute('aria-selected'),title:item.getAttribute('title'),role:item.getAttribute('role')}))},
 active:env.document.activeElement===trigger?'trigger':env.document.activeElement?.closest('.mizuki-select-item')?.dataset.index??'other'};}
function nativeOwner(kind,{html='<option value="a">A</option><option value="b">B</option>',props={},label='',locale='en',host}={}){
 const container=env.document.createElement('div');container.innerHTML='<label for="native-select"></label><select id="native-select"></select>';env.document.body.append(container);
 const select=container.querySelector('select');select.innerHTML=html;for(const [name,value]of Object.entries(props)) {if(name==='value')select.value=value;else if(name==='disabled')select.disabled=value;else select.setAttribute(name,value);}
 container.querySelector('label').textContent=label;globalThis.__selectTranslate=key=>api.translate(locale,key);
 const controller=(kind==='pinned'?api.pinnedController:api.createCustomSelectController)({getHost:()=>host?.()??env.document.body,translate:key=>api.translate(locale,key)});
 controller.installCustomSelect(select);const trigger=query('.mizuki-select-trigger',container);trigger.click();
 const menu=[...env.document.querySelectorAll('.mizuki-select-menu')].find(node=>!node.hidden);controller.closeOtherCustomSelects();
 mounts.push(async()=>{if(controller.dispose)controller.dispose();else{select.parentElement.before(select);select.nextElementSibling?.remove();menu?.remove();}container.remove();});
 return {select,trigger,menu,controller,container,setLocale(value){locale=value;globalThis.__selectTranslate=key=>api.translate(locale,key);controller.syncCustomSelect(select);}};
}
async function reactOwner({options,props={},label='',locale='en',strict=false}={}){
 const host=env.document.createElement('div');env.document.body.append(host);const root=createRoot(host);
 const render=(nextProps=props,nextOptions=options,nextLocale=locale)=>React.createElement(api.LocaleProvider,{locale:nextLocale},React.createElement(React.Fragment,null,
 React.createElement('label',{htmlFor:'react-select'},label),React.createElement(api.MainSelect,{id:'react-select',...nextProps},nextOptions??[React.createElement('option',{key:'a',value:'a'},'A'),React.createElement('option',{key:'b',value:'b'},'B')])));
 await act(()=>root.render(strict?React.createElement(React.StrictMode,null,render()):render()));
 const select=query('select',host),trigger=query('.mizuki-select-trigger',host);await act(()=>trigger.click());
 const menu=[...env.document.querySelectorAll('.mizuki-select-menu')].find(node=>!node.hidden);await act(()=>trigger.click());
 mounts.push(async()=>{await act(()=>root.unmount());host.remove();});
 return {select,trigger,menu,host,root,render};
}
for(const accept of [false,true])for(const strict of [false,true])test(`pinned controlled event/focus timing: accept=${accept}, StrictMode=${strict}`,async()=>{
 globalThis.__selectTranslate=key=>api.translate('en',key);
 const traces=[];
 for(const kind of ['pinned','canonical','react']){
  const host=env.document.createElement('div');env.document.body.append(host);const root=createRoot(host);mounts.push(async()=>{await act(()=>root.unmount());host.remove();});const events=[];
  const element=React.createElement(api.ControlledHarness,{kind,accept,event:value=>events.push(value)});
  await act(()=>root.render(strict?React.createElement(React.StrictMode,null,element):element));
  const trigger=query('button',host),select=query('select',host);await act(()=>trigger.click());const menu=[...env.document.querySelectorAll('.mizuki-select-menu')].find(node=>!node.hidden);
  await act(()=>menu.querySelector('[data-value="b"]').click());
  assert.equal(select.value,accept?'b':'a');assert.equal(query('.mizuki-select-value',host).textContent,accept?'B':'A');traces.push(events);
  await act(()=>root.unmount());mounts.pop();host.remove();
 }
 assert.deepEqual(traces[1],traces[0]);assert.deepEqual(traces[2],traces[0]);
 assert.deepEqual(traces[0].map(e=>e.phase),['focus','change']);assert.equal(traces[0][0].label,'A');assert.equal(traces[0][1].label,'B');assert.equal(traces[0][1].value,'b');assert.equal(traces[0][1].hidden,true);assert.equal(traces[0][1].focused,true);
});
for(const locale of ['en','zh-CN'])test(`pinned ordinary/optgroup/disabled option/title/ARIA projection (${locale})`,async()=>{
 const html='<option value="a" title="not forwarded">A</option><option value="b" disabled>B</option><optgroup label="ignored group label" disabled><option value="c">C</option></optgroup><option value="a">Duplicate A</option>';
 const props={title:'native title','aria-label':'Explicit label','data-trigger-i18n':'ui.language.menu'};
 const expected=nativeOwner('pinned',{html,props,locale,label:'Fallback label'}),canonical=nativeOwner('canonical',{html,props,locale,label:'Fallback label'});
 const options=[React.createElement('option',{key:0,value:'a',title:'not forwarded'},'A'),React.createElement('option',{key:1,value:'b',disabled:true},'B'),React.createElement('optgroup',{key:2,label:'ignored group label',disabled:true},React.createElement('option',{value:'c'},'C')),React.createElement('option',{key:3,value:'a'},'Duplicate A')];
 const actual=await reactOwner({options,props,locale,label:'Fallback label'});
 assert.deepEqual(describe(canonical.select,canonical.menu),describe(expected.select,expected.menu));assert.deepEqual(describe(actual.select,actual.menu),describe(expected.select,expected.menu));
 assert.equal(actual.menu.querySelector('[data-value="c"]').disabled,false,'Main flattens option.disabled only; do not invent optgroup semantics');
 assert.equal(actual.menu.querySelectorAll('[aria-selected="true"]').length,2,'Main marks duplicate values, not option identity');
});
test('pinned keyboard focus, wrapping, pointer outside close and unchanged-value event suppression',async()=>{
 const phases=[];
 for(const kind of ['pinned','canonical','react']){
  const owner=kind==='react'?await reactOwner():nativeOwner(kind);const trace=[],changes=[];owner.select.addEventListener('change',()=>changes.push(owner.select.value));
  await act(()=>key(owner.trigger,'ArrowDown'));trace.push(describe(owner.select,owner.menu));
  await act(()=>key(env.document.activeElement,'ArrowDown'));trace.push(describe(owner.select,owner.menu));
  await act(()=>key(env.document.activeElement,'End'));trace.push(describe(owner.select,owner.menu));
  await act(()=>key(env.document.activeElement,'Home'));trace.push(describe(owner.select,owner.menu));
  await act(()=>key(env.document.activeElement,'Escape'));trace.push(describe(owner.select,owner.menu));
  await act(()=>owner.trigger.click());await act(()=>owner.menu.querySelector('[data-value="a"]').click());assert.deepEqual(changes,[]);
  await act(()=>owner.trigger.click());await act(()=>owner.menu.querySelector('[data-value="b"]').click());assert.deepEqual(changes,['b']);trace.push(describe(owner.select,owner.menu));
  await act(()=>owner.trigger.click());await act(()=>env.document.body.dispatchEvent(new env.window.PointerEvent('pointerdown',{bubbles:true})));trace.push(describe(owner.select,owner.menu));
  phases.push(trace);await mounts.pop()();
 }
 assert.deepEqual(phases[1],phases[0]);assert.deepEqual(phases[2],phases[0]);
});
test('pinned disabled native control and label fallback retain original trigger semantics',async()=>{
 for(const kind of ['pinned','canonical','react']){
  const owner=kind==='react'?await reactOwner({label:'  A label  '}):nativeOwner(kind,{label:'  A label  '});
  assert.equal(owner.trigger.getAttribute('aria-label'),'A label');owner.select.disabled=true;
  if(owner.controller)owner.controller.syncCustomSelect(owner.select);else await act(()=>owner.root.render(owner.render({disabled:true})));
  assert.equal(owner.trigger.disabled,true);assert.equal(owner.trigger.getAttribute('aria-disabled'),'true');await act(()=>owner.trigger.click());assert.equal(owner.menu.hidden,true);
  await mounts.pop()();
 }
});
test('canonical option signature and React item identity follow pinned replacement semantics',async()=>{
 for(const kind of ['pinned','canonical','react']){
  const owner=kind==='react'?await reactOwner():nativeOwner(kind);const first=owner.menu.firstElementChild;
  if(owner.controller){owner.select.value='b';owner.controller.syncCustomSelect(owner.select);}else await act(()=>owner.root.render(owner.render({value:'b',onChange(){}})));
  assert.equal(owner.menu.firstElementChild,first);
  if(owner.controller){owner.select.options[0].textContent='Updated';owner.controller.syncCustomSelect(owner.select);}else await act(()=>owner.root.render(owner.render({value:'b',onChange(){}},[React.createElement('option',{key:'a',value:'a'},'Updated'),React.createElement('option',{key:'b',value:'b'},'B')])));
  assert.notEqual(owner.menu.firstElementChild,first);assert.equal(owner.menu.firstElementChild.textContent,'Updated✓');await mounts.pop()();
 }
});

test('pinned body/dialog/fullscreen moves keep one menu identity and stable native selection',async()=>{
 const originalDescriptor=Object.getOwnPropertyDescriptor(env.document,'fullscreenElement');let fullscreen=null;
 Object.defineProperty(env.document,'fullscreenElement',{configurable:true,get:()=>fullscreen});
 try {
  for(const kind of ['pinned','canonical','react']){
   const player=env.document.createElement('section');player.id='player';const dialog=env.document.createElement('dialog');dialog.open=true;env.document.body.append(player,dialog);
   let target=env.document.body;const owner=kind==='react'?await reactOwner({strict:true}):nativeOwner(kind,{host:()=>target});const originalMenu=owner.menu;
   for(const next of ['body','player','dialog','body']){
    fullscreen=next==='player'||next==='dialog'?player:null;target=next==='dialog'?dialog:next==='player'?player:env.document.body;
    (next==='dialog'?dialog:env.document.body).append(owner.host??owner.container);
    await act(()=>owner.trigger.click());assert.equal(owner.menu,originalMenu);assert.equal(owner.menu.parentElement,target);
    await act(()=>owner.menu.querySelector('[data-value="b"]').click());assert.equal(owner.select.value,'b');assert.equal(owner.menu.hidden,true);assert.equal(env.document.activeElement,owner.trigger);
   }
   await mounts.pop()();player.remove();dialog.remove();
  }
 } finally {if(originalDescriptor)Object.defineProperty(env.document,'fullscreenElement',originalDescriptor);else delete env.document.fullscreenElement;}
});

test('open-menu geometry is recomputed after committed option replacement, using pinned measurements',async()=>{
 globalThis.__selectTranslate=key=>api.translate('en',key);
 const traces=[];
 for(const kind of ['pinned','canonical','react']){
  const owner=kind==='react'?await reactOwner():nativeOwner(kind);
  // Controlled numerical measurements only, not a browser layout claim.
  owner.trigger.getBoundingClientRect=()=>new env.window.DOMRect(20,720,200,30);
  Object.defineProperty(owner.menu,'scrollHeight',{configurable:true,get:()=>owner.menu.children.length*40});
  await act(()=>owner.trigger.click());const initial=owner.menu.style.cssText;
  if(owner.controller){owner.select.innerHTML='<option value="a">A</option>';owner.controller.syncCustomSelect(owner.select);}
  else await act(()=>owner.root.render(owner.render({},React.createElement('option',{value:'a'},'A'))));
  assert.notEqual(initial,owner.menu.style.cssText);traces.push([initial,owner.menu.style.cssText]);await mounts.pop()();
 }
 assert.deepEqual(traces[1],traces[0]);assert.deepEqual(traces[2],traces[0]);
});

test('live locale changes update the same open menu and trigger with pinned copy',async()=>{
 const results=[];const props={'data-trigger-i18n':'ui.language.menu'};
 for(const kind of ['pinned','canonical','react']){
  const owner=kind==='react'?await reactOwner({props}):nativeOwner(kind,{props});const menu=owner.menu;await act(()=>owner.trigger.click());
  if(owner.controller)owner.setLocale('zh-CN');else await act(()=>owner.root.render(owner.render(props,undefined,'zh-CN')));
  assert.equal(owner.menu,menu);assert.equal(menu.hidden,false);results.push(describe(owner.select,menu));await mounts.pop()();
 }
 assert.deepEqual(results[1],results[0]);assert.deepEqual(results[2],results[0]);
});

test('React renders native props/ref and the exact supplied direct-child prefix without imperative tree creation',async()=>{
 const host=env.document.createElement('div');env.document.body.append(host);const root=createRoot(host);let ref;
 mounts.push(async()=>{await act(()=>root.unmount());host.remove();});
 const prefix=React.createElement('svg',{className:'masthead-menu-icon',viewBox:'0 0 24 24','aria-hidden':'true'},React.createElement('path',{d:'M1 2h3'}));
 await act(()=>root.render(React.createElement(api.LocaleProvider,{locale:'en'},React.createElement(api.MainSelectPrefix,{prefix},React.createElement(api.MainSelect,{id:'prefix-select',name:'setting',required:true,title:'Native title',ref:element=>{ref=element;}},React.createElement('option',{value:'a'},'A'))))));
 assert.equal(ref,query('select',host));assert.equal(ref.name,'setting');assert.equal(ref.required,true);assert.equal(ref.title,'Native title');
 const trigger=query('button',host);assert.equal(trigger.firstElementChild.tagName.toLowerCase(),'svg');assert.equal(trigger.firstElementChild.querySelector('path').getAttribute('d'),'M1 2h3');
 const adapter=readFileSync(resolve(project,'app/components/launcher/main-select-controller.ts'),'utf8');
 assert.doesNotMatch(adapter,/createElement|replaceChildren|innerHTML|\.before\(|\.append\(/);
});

for(const focusUpdate of ['ancestor','native-selection','state-selection'])for(const accept of [false,true])test(`pinned focus reentrancy: ${focusUpdate}, accept=${accept}`,async()=>{
 globalThis.__selectTranslate=key=>api.translate('en',key);
 const traces=[];
 for(const kind of ['pinned','canonical','react']){
  const host=env.document.createElement('div');env.document.body.append(host);const root=createRoot(host);mounts.push(async()=>{await act(()=>root.unmount());host.remove();});const events=[];
  await act(()=>root.render(React.createElement(React.StrictMode,null,React.createElement(api.ControlledHarness,{kind,accept,focusUpdate,event:value=>events.push(value)}))));
  const trigger=query('button',host),select=query('select',host);await act(()=>trigger.click());
  const menu=[...env.document.querySelectorAll('.mizuki-select-menu')].find(node=>!node.hidden);
  await act(()=>menu.querySelector('[data-value="b"]').click());
  traces.push({events,value:select.value,label:query('.mizuki-select-value',host).textContent,selected:[...menu.querySelectorAll('[aria-selected="true"]')].map(item=>item.dataset.value)});
  await act(()=>root.unmount());mounts.pop();host.remove();
 }
 assert.deepEqual(traces[1],traces[0]);assert.deepEqual(traces[2],traces[0]);
 const change=traces[0].events.find(event=>event.phase==='change');assert.equal(change.value,focusUpdate==='native-selection'?'c':'b');assert.equal(change.label,focusUpdate==='native-selection'?'C':'B');assert.equal(change.hidden,true);assert.equal(change.focused,true);assert.deepEqual(change.selected,[change.value]);
});
