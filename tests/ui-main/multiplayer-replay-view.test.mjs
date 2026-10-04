/** Synthetic static-render and ownership coverage; no browser/gameplay claims. */
import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import {existsSync} from 'node:fs';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {build} from 'esbuild';
const root=fileURLToPath(new URL('../..',import.meta.url));
await mkdir(join(root,'.cache'),{recursive:true});
const folder=await mkdtemp(join(root,'.cache/mp-replay-view-'));after(()=>rm(folder,{recursive:true,force:true}));
const built=await build({stdin:{contents:`
export {MultiplayerReplayViewerView} from './app/components/MultiplayerReplayViewer';
export {LocaleProvider} from './app/components/LocaleProvider';
export {UI_MESSAGES,validateUiCatalogs} from './src/launcher/i18n.mts';
export {createElement} from 'react';
export {createMemoryRouter,RouterProvider} from 'react-router';
export {renderToStaticMarkup} from 'react-dom/server';
`,resolveDir:root,loader:'tsx'},bundle:true,format:'esm',platform:'node',packages:'external',write:false,jsx:'automatic',loader:{'.css':'empty','.webp':'dataurl','.svg':'dataurl'},plugins:[{name:'authored-contracts',setup(builder){builder.onResolve({filter:/\.mjs$/},args=>{if(!args.path.startsWith('.'))return;const path=resolve(dirname(args.importer),args.path).replace(/\.mjs$/,'.mts');if(path.startsWith(join(root,'src')+'/')&&existsSync(path))return{path};});}}]});
const path=join(folder,'view.mjs');await writeFile(path,built.outputFiles[0].text);
const {MultiplayerReplayViewerView,LocaleProvider,UI_MESSAGES,validateUiCatalogs,createElement:h,createMemoryRouter,RouterProvider,renderToStaticMarkup}=await import(pathToFileURL(path).href);
const snapshot={selection:null,inspection:{productId:'th08mp',available:true},inspecting:false,preparing:false,progress:null,error:null,warnings:[],preparedEpoch:null};
function render(locale,patch={},search=''){
 const props={productId:'th08mp',controller:{},snapshot,settings:{productId:'th08mp'},touchLayout:null,runtimeActive:false,inRoom:false,...patch};
 const router=createMemoryRouter([{path:'*',element:h(LocaleProvider,{initialLocale:locale},h(MultiplayerReplayViewerView,props))}],{initialEntries:[`/play/th08mp/replays?uiLocale=${locale}${search}`]});
 try{return renderToStaticMarkup(h(RouterProvider,{router}));}finally{router.dispose();}
}
for(const locale of ['en','zh-CN']){
 test(`${locale} Replay view exposes explicit prepare and resource import in the same multiplayer product`,()=>{
  const html=render(locale,{},'&panel=help&touchLayout=edit');
  assert.ok(html.includes(UI_MESSAGES[locale]['ui.multiplayerReplay.title']));assert.ok(html.includes(UI_MESSAGES[locale]['ui.multiplayerReplay.hint']));
  assert.match(html,new RegExp(`href="/play/th08mp/resources\\?uiLocale=${locale}"`));assert.doesNotMatch(html,/href="[^"]*(?:panel|touchLayout)=/);
  assert.ok(html.includes(UI_MESSAGES[locale]['ui.multiplayerReplay.prepare']));assert.doesNotMatch(html,/ disabled=""/);
 });
 test(`${locale} room membership and current Runtime each disable Replay preparation`,()=>{
  for(const [field,label]of [['inRoom','leaveRoom'],['runtimeActive','closeCurrent']]){
   const html=render(locale,{[field]:true});assert.ok(html.includes(UI_MESSAGES[locale][`ui.multiplayerReplay.${label}`]));
   assert.match(html,new RegExp(`<button[^>]+disabled=""[^>]*>${UI_MESSAGES[locale]['ui.multiplayerReplay.prepare']}</button>`));
  }
 });
 test(`${locale} unresolved settings and missing resources cannot launch and preserve the import entry`,()=>{
  const html=render(locale,{settings:null,snapshot:{...snapshot,inspection:{productId:'th08mp',available:false,reason:{message:'Synthetic missing DATA'}}}});
  assert.match(html,/Synthetic missing DATA/);assert.match(html,/disabled=""/);assert.ok(html.includes(UI_MESSAGES[locale]['ui.multiplayerReplay.resources']));
 });
}
test('Replay translations remain complete and interpolation-compatible',()=>{
 validateUiCatalogs();const keys=Object.keys(UI_MESSAGES.en).filter(key=>key.startsWith('ui.multiplayerReplay.'));assert.ok(keys.length>=10);
 for(const key of keys){assert.ok(UI_MESSAGES.en[key]);assert.ok(UI_MESSAGES['zh-CN'][key]);assert.deepEqual([...UI_MESSAGES.en[key].matchAll(/\{([^}]+)\}/g)].map(x=>x[1]),[...UI_MESSAGES['zh-CN'][key].matchAll(/\{([^}]+)\}/g)].map(x=>x[1]));}
});
test('Replay views retain sole root Runtime and shared preparation document ownership',async()=>{
 const provider=await readFile(join(root,'app/components/MultiplayerReplayProvider.tsx'),'utf8');
 assert.match(provider,/createPreparationDocumentOwner/);assert.match(provider,/useRuntimeService/);assert.match(provider,/currentIntent:.*roomController\?\.getSnapshot\(\)\.route/);
 assert.doesNotMatch(provider,/<iframe|createRuntimeService|new WebSocket|postMessage|\.launch\(/);
 const route=await readFile(join(root,'app/routes/game-replays.tsx'),'utf8');assert.match(route,/MultiplayerReplayViewer/);assert.match(route,/ReplayManager/);
 const view=await readFile(join(root,'app/components/MultiplayerReplayViewer.tsx'),'utf8');assert.match(view,/controller.inspect\(productId\)/);assert.doesNotMatch(view,/\.launch\(|new WebSocket|<iframe/);
});
