/** Static source/catalog and synthetic SSR coverage only; no browser or device claims. */
import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import {existsSync} from 'node:fs';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {parse} from '@babel/parser';
const root=fileURLToPath(new URL('../..',import.meta.url));
await mkdir(join(root,'.cache'),{recursive:true});
const directory=await mkdtemp(join(root,'.cache/ui-labels-test-'));
after(()=>rm(directory,{recursive:true,force:true}));
const result=await build({stdin:{contents:`
 export * from './app/services/locale.client.ts';
 export {UI_MESSAGES,validateUiCatalogs} from './src/launcher/i18n.mts';
 export * from './app/components/LocaleProvider.tsx';
 export * from './app/components/LauncherShell.tsx';
 export * from './app/components/GameSettings.tsx';
 export * from './app/components/TouchSettingsFields.tsx';
 export * from './app/components/TouchLayoutEditor.tsx';
 export * from './app/components/TouchControl.tsx';
 export * from './app/components/ResourceManager.tsx';
 export * from './app/components/ResourceImport.tsx';
 export * from './app/components/ReplayManager.tsx';
 export * from './app/components/SaveManager.tsx';
 export * from './app/components/GameLaunch.tsx';
 export {HelpProvider} from './app/components/HelpPanel.tsx';
 export * from './app/runtime/RuntimeViewport.tsx';
 export * from './app/services/preferences.client.ts';
 export {default as GameRoute} from './app/routes/game.tsx';
 export {default as LegacyRoute} from './app/routes/legacy-entry.tsx';
 export {createElement,Fragment} from 'react';
 export {createMemoryRouter,RouterProvider} from 'react-router';
 export {renderToStaticMarkup} from 'react-dom/server';
`,resolveDir:root,loader:'tsx'},bundle:true,format:'esm',platform:'node',packages:'external',write:false,jsx:'automatic',loader:{'.css':'empty','.webp':'dataurl','.svg':'dataurl'},plugins:[{name:'authored-mts',setup(builder){builder.onResolve({filter:/\.mjs$/},args=>{if(!args.path.startsWith('.'))return;const absolute=resolve(dirname(args.importer),args.path);if(absolute===join(root,'product-catalog.mjs'))return{path:join(root,'src/contracts/product-catalog.mts')};const path=absolute.replace(/\.mjs$/,'.mts');if(path.startsWith(join(root,'src')+'/')&&existsSync(path))return{path};});}}]});
assert.doesNotMatch(result.outputFiles[0].text,/loadCompiledContract\(/,'SSR fixture must use source contracts, never ignored compiled assets');
const modulePath=join(directory,'labels.mjs');await writeFile(modulePath,result.outputFiles[0].text);
const api=await import(pathToFileURL(modulePath).href);
const {createElement:h,LocaleProvider,RouterProvider,createMemoryRouter,renderToStaticMarkup,UI_MESSAGES}=api;
function render(locale,component,props={},path='/') {
 const router=createMemoryRouter([{path:'*',element:h(LocaleProvider,{initialLocale:locale},h(component,props))}],{initialEntries:[`${path}${path.includes('?')?'&':'?'}uiLocale=${locale}`]});
 try{return renderToStaticMarkup(h(RouterProvider,{router}));}finally{router.dispose();}
}
function walk(n,fn,parent){if(!n||typeof n!=='object')return;fn(n,parent);for(const[k,v]of Object.entries(n)){if(['loc','extra','comments'].includes(k))continue;if(Array.isArray(v))v.forEach(x=>walk(x,fn,n));else if(v&&typeof v==='object')walk(v,fn,n);}}
const files=['GameSettings','ResourceManager','ResourceImport','ReplayManager','SaveManager','GameLaunch','TouchSettingsFields','TouchLayoutEditor','LegacyEntryAdapter','LauncherShell','TouchControl','ReplayProvider'].map(n=>`app/components/${n}.tsx`).concat(['game-settings','game','legacy-entry'].map(n=>`app/routes/${n}.tsx`),['RuntimeControls','RuntimeTouchOverlay','PreparedRuntimeStart','RuntimeHost','RuntimeViewport'].map(n=>`app/runtime/${n}.tsx`));
test('all catalogs have unique complete paired entries and matching interpolation parameters',()=>{
 const keys=api.validateUiCatalogs();assert.deepEqual(Object.keys(UI_MESSAGES.en),Object.keys(UI_MESSAGES['zh-CN']));
 assert.equal(new Set(keys).size,keys.length);
 const params=value=>[...new Set([...value.matchAll(/\{([A-Za-z0-9_]+)\}/g)].map(m=>m[1]))].sort();
 for(const key of keys){assert.equal(typeof UI_MESSAGES.en[key],'string',key);assert.ok(UI_MESSAGES.en[key].length,key);assert.deepEqual(params(UI_MESSAGES.en[key]),params(UI_MESSAGES['zh-CN'][key]),key);}
});
test('React view keys all exist, and no Chinese view labels or DOM translation bootstrap remain',async()=>{
 let calls=0;
 for(const file of files){const source=await readFile(join(root,file),'utf8');assert.doesNotMatch(source,/initUiLocale|applyStaticTranslations|MutationObserver/);const ast=parse(source,{sourceType:'module',plugins:['typescript','jsx']});
  walk(ast,(node,parent)=>{
   if(['StringLiteral','JSXText'].includes(node.type)&&/[\u3400-\u9fff]/.test(node.value))assert.equal(node.value,'赣ICP备2025074288号-1',`${file}: untranslated ${node.value}`);
   if(node.type==='CallExpression'&&node.callee.type==='Identifier'&&node.callee.name==='t'){
    calls++;const checkKey=arg=>{if(arg?.type==='StringLiteral')assert.ok(Object.hasOwn(UI_MESSAGES.en,arg.value),`${file}: missing ${arg.value}`);else if(arg?.type==='ConditionalExpression'){checkKey(arg.consequent);checkKey(arg.alternate);}};checkKey(node.arguments[0]);
   }
   if(node.type==='StringLiteral'&&/^(?:react\.|ui\.playerTools\.)/.test(node.value))assert.ok(Object.hasOwn(UI_MESSAGES.en,node.value),`${file}: missing mapped key ${node.value}`);
  });
 }
 assert.ok(calls>150,'cover every converted view');
});
for(const locale of ['en','zh-CN']){
 test(`${locale} shell, library and alias route render their labels with original Japanese titles`,()=>{
  const html=render(locale,api.LauncherShell,{children:h(api.GameLibrary)});
  assert.ok(html.includes(UI_MESSAGES[locale]['react.shell.skip']));assert.ok(html.includes(UI_MESSAGES[locale]['library.singleplayer']));
  assert.ok(html.includes(UI_MESSAGES[locale]['library.multiplayer']));assert.ok(html.includes(UI_MESSAGES[locale]['react.shell.version']));
  assert.match(html,/lang="ja"/);assert.match(html,/lang="zh-CN">赣ICP备2025074288号-1/);
  const alias=render(locale,api.LegacyRoute,{},'/en.html');
  // /en.html intentionally forces English regardless of the initial locale.
  assert.match(alias,/Opening your original link/);
  assert.ok(render(locale,api.LegacyRoute).includes(UI_MESSAGES[locale]['react.legacy.restoring']));
 });
 test(`${locale} settings translate metadata language labels, music fallback and touch warnings`,()=>{
  const store=api.createPreferencesStore({storage:null,context:()=>({uiLocale:locale,hostFeatures:{thprac:true,focusHitbox:true},languageCatalog:[{id:'ja',title:'日本語(原版)'},{id:'lang_zh-hans',title:'中文（简体）'},{id:'lang_en',title:'English'}],musicAvailability:{audio:true,midiAvailable:true,importServer:true,remoteOggAdvertised:true}})});
  store.loadProduct('th06');store.setOption('th06','touchMovementMode','touch-unlimited');store.setOption('th06','magnifierEnabled',true);store.setOption('th06','touchFocusMode','two-finger');
  const settings={...store.getSnapshot('th06'),musicPreference:'ogg-full',musicPreferenceExplicit:true,music:'midi'};
  const html=render(locale,api.GameSettingsForm,{store,settings});
  for(const key of ['react.settings.aria','react.settings.general','gameLanguage.ja','gameLanguage.zhHans','react.settings.sessionOnly','react.touch.unlimitedWarning','react.settings.magnifierConflict'])assert.ok(html.includes(UI_MESSAGES[locale][key]),key);
  assert.ok(html.includes(api.formatUiMessage(locale,'react.settings.musicPreference',{preferred:UI_MESSAGES[locale]['react.settings.oggFull'],available:'MIDI'})));
  assert.doesNotMatch(html,/\{preferred\}|\{available\}/);
  const layout=render(locale,api.TouchLayoutEditor,{settings,preferences:store});assert.ok(layout.includes(UI_MESSAGES[locale]['react.touch.editLayout']));
  const copy=render(locale,api.TouchControlCopy,{name:'focus',game:'th06',focusMode:'toggle-button'});assert.ok(copy.includes(UI_MESSAGES[locale]['touch.focus']));assert.ok(copy.includes(UI_MESSAGES[locale]['touch.tapToggle']));
 });
 test(`${locale} game route navigation and Runtime frame title are localized`,()=>{
  const router=createMemoryRouter([{path:'/play/:productId',element:h(LocaleProvider,{initialLocale:locale},h(api.HelpProvider,null,h(api.GameRoute)))}],{initialEntries:[`/play/th06?uiLocale=${locale}`]});
  let html;try{html=renderToStaticMarkup(h(RouterProvider,{router}));}finally{router.dispose();}
  for(const key of ['library.back','react.routes.management','settings.title','react.resources.title'])assert.ok(html.includes(UI_MESSAGES[locale][key]),key);
  assert.match(html,/<h1 lang="ja"[^>]*>東方紅魔郷<\/h1>/);
  const frame=render(locale,api.RuntimeViewport,{frame:{current:null},visible:true});assert.ok(frame.includes(`title="${UI_MESSAGES[locale]['react.runtime.frameTitle']}"`));
 });
 test(`${locale} manager and game preparation loading views have localized accessible labels`,()=>{
  for(const [component,key] of [[api.ResourceManager,'react.resources.title'],[api.ResourceImport,'react.import.title'],[api.ReplayManager,'react.replays.loading'],[api.SaveManager,'react.saves.loading'],[api.GameLaunch,'react.launch.prepare']]){
   const html=render(locale,component,{productId:'th06',controller:null});assert.ok(html.includes(UI_MESSAGES[locale][key]),key);
  }
 });
 test(`${locale} replay list actions, progress and empty states render without lost parameters`,()=>{
  const controller={cancelDelete(){}};
  const base={game:'th06',epoch:1,available:true,unavailableReason:null,busy:null,loaded:true,files:[{path:'replay/th6_01.rpy',name:'th6_01.rpy',size:1024}],error:null,notice:null};
  const html=render(locale,api.ReplayManagerView,{productId:'th06',controller,snapshot:base});
  assert.ok(html.includes(UI_MESSAGES[locale]['react.replays.title']));assert.ok(html.includes(api.formatUiMessage(locale,'react.files.downloadName',{name:'th6_01.rpy'})));assert.ok(html.includes(api.formatUiMessage(locale,'react.replays.count',{count:1})));
  for(const [busy,key]of [['list','reading'],['import','importing'],['export','exporting'],['delete','deleting']])assert.ok(render(locale,api.ReplayManagerView,{productId:'th06',controller,snapshot:{...base,busy}}).includes(UI_MESSAGES[locale][`react.replays.${key}`]));
  assert.ok(render(locale,api.ReplayManagerView,{productId:'th06',controller,snapshot:{...base,files:[]}}).includes(UI_MESSAGES[locale]['react.replays.empty']));
 });
 test(`${locale} save manager translates file details and busy/empty states`,()=>{
  const controller={cancelImport(){}};const base={game:'th06',epoch:1,scoreFile:'score.dat',available:true,unavailableReason:null,busy:null,fileOperationBusy:false,loaded:true,exists:true,size:1024,error:null,notice:null};
  const html=render(locale,api.SaveManagerView,{productId:'th06',controller,snapshot:base});
  assert.ok(html.includes(UI_MESSAGES[locale]['react.saves.title']));assert.ok(html.includes(api.formatUiMessage(locale,'react.saves.existing',{size:'1.0 KiB'})));assert.ok(html.includes(UI_MESSAGES[locale]['react.saves.selectFile']));
  for(const [busy,key]of [['read','reading'],['import','importing'],['export','exporting']])assert.ok(render(locale,api.SaveManagerView,{productId:'th06',controller,snapshot:{...base,busy}}).includes(UI_MESSAGES[locale][`react.saves.${key}`]));
  assert.ok(render(locale,api.SaveManagerView,{productId:'th06',controller,snapshot:{...base,exists:false}}).includes(UI_MESSAGES[locale]['react.saves.empty']));
 });
}
