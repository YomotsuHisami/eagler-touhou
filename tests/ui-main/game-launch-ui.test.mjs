/** Synthetic SSR view checks; acquisition/epoch tests cover the click jobs. */
import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import {existsSync} from 'node:fs';
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {build} from 'esbuild';
const root=fileURLToPath(new URL('../..',import.meta.url));
await mkdir(join(root,'.cache'),{recursive:true});
const directory=await mkdtemp(join(root,'.cache/ui-launch-view-'));after(()=>rm(directory,{recursive:true,force:true}));
const result=await build({stdin:{contents:`
 import {createElement} from 'react';
 import {renderToStaticMarkup} from 'react-dom/server';
 import {createMemoryRouter, RouterProvider} from 'react-router';
 import {LocaleProvider} from './app/components/LocaleProvider';
 import {GameLaunch} from './app/components/GameLaunch';
 import {setState} from 'launch-view-state';
 export {UI_MESSAGES} from './src/launcher/i18n.mts';
 export function render(state,locale='en') {
  setState(state);
  const element=createElement(LocaleProvider,{initialLocale:locale},createElement(GameLaunch,{productId:'th06'}));
  const router=createMemoryRouter([{path:'*',element}],{initialEntries:['/play/th06?uiLocale='+locale]});
  try{return renderToStaticMarkup(createElement(RouterProvider,{router}));}finally{router.dispose();}
 }
`,resolveDir:root,loader:'tsx'},bundle:true,jsx:'automatic',format:'esm',platform:'node',packages:'external',write:false,loader:{'.css':'empty'},plugins:[{name:'injected-launch-state',setup(builder){
 builder.onResolve({filter:/^(?:launch-view-state|\.\/GameLaunchProvider|\.\.\/runtime\/RuntimeHost|\.\/GameSettingsProvider|\.\/TouchLayoutProvider)$/},args=>{
  if(args.path==='launch-view-state'||args.importer.split(String.fromCharCode(92)).join('/').endsWith('/GameLaunch.tsx'))return{path:'launch-view-state',namespace:'fixture'};
 });
 builder.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:`
  let state;export function setState(value){state=value;}
  export function useGameLaunchJob(){return {controller:{},snapshot:state.snapshot};}
  export function useSettingsGameLaunch(){return {controller:{launch(){}},snapshot:state.launch??{phase:'idle',error:null}};}
  export function useGamePackageImporter(){return ()=>true;}
  export function useRuntimeSnapshot(){return state.live??null;}
  export function useGamePreferences(){return {settings:state.settings===null?null:{productId:'th06'}};}
  export function useTouchLayoutSnapshot(){return null;}
 `,loader:'js'}));
 builder.onResolve({filter:/\.mjs$/},args=>{
  if(!args.path.startsWith('.'))return;
  const path=resolve(dirname(args.importer),args.path).replace(/\.mjs$/,'.mts');
  if(path.startsWith(join(root,'src')+'/')&&existsSync(path))return{path};
 });
}}]});
const file=join(directory,'launch-view.mjs');await writeFile(file,result.outputFiles[0].text);
const {render,UI_MESSAGES}=await import(pathToFileURL(file).href);
const state=(patch={})=>({snapshot:{preparing:false,inspecting:false,warnings:[],inspection:{productId:'th06',available:true,updateAvailable:true,source:'local',...patch}}});
for(const locale of ['en','zh-CN'])test(`${locale}: an available update retains the main Start and in-place Import actions`,()=>{
 const html=render(state(),locale);
 for(const key of ['package.updateAvailableLocal','action.start','action.import'])assert.ok(html.includes(UI_MESSAGES[locale][key]),key);
 for(const key of ['package.updateNow','action.backgroundDownload','package.keepCurrent'])assert.ok(!html.includes(UI_MESSAGES[locale][key]),key);
 assert.equal((html.match(/<button/g)??[]).length,3);assert.doesNotMatch(html,/disabled=""/);
 assert.doesNotMatch(html,/href="\/play\/th06\/resources/);
});
test('active Runtime or missing settings blocks Start while the main actions retain their scope',()=>{
 for(const changes of [{live:{epoch:1,ready:true}},{settings:null}]){
  const html=render({...state(),...changes});assert.equal((html.match(/disabled=""/g)??[]).length,1);
 }
 const html=render(state({updateAvailable:false}));assert.ok(html.includes(UI_MESSAGES.en['action.start']));assert.ok(!html.includes(UI_MESSAGES.en['package.updateNow']));
});
test('unavailable resources keep Start available for the original import-recovery flow',()=>{
 const html=render(state({available:false,updateAvailable:false,reason:{message:'No Game Package'},gameDataFallback:{url:'https://example.test/data',hint:'Import your data'}}));
 assert.doesNotMatch(html,/href="https:\/\/example\.test\/data"/,'the captured Start recovery owns the fallback link rather than expanding the initial footer');
 assert.match(html,/class="sr-only" data-launch-status/,'inspection failures do not crowd the initial main footer');
 assert.equal((html.match(/disabled=""/g)??[]).length,0);
});
