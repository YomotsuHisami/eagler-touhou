/** Pure preference composition; synthetic storage, no Runtime or browser. */
import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {authoredSourcesPlugin} from './authored-sources.mjs';
const project=fileURLToPath(new URL('../../',import.meta.url));let api,work;
before(async()=>{work=await mkdtemp(resolve(project,'.cache/scoped-settings-test-'));const output=resolve(work,'model.mjs');await build({stdin:{resolveDir:project,loader:'ts',contents:`export * from './app/models/game-settings.ts';export * from './app/models/scoped-settings.ts';export * from './src/launcher/game-preferences.mts';`},outfile:output,bundle:true,format:'esm',platform:'node',packages:'external',logLevel:'silent',plugins:[authoredSourcesPlugin(project)]});api=await import(pathToFileURL(output).href);});
after(async()=>rm(work,{recursive:true,force:true}));
const context=(productId='th06',extra={})=>({productId,uiLocale:'en',mobile:false,webMidiAvailable:true,languages:[{id:'ja'},{id:'lang_en'}],musicAvailability:{audio:true,midiAvailable:true,remoteOggAdvertised:true,importServer:false},...extra});
function fixture(){const values=new Map(),writes=[];const storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>{writes.push(key);values.set(key,value);}};const model=api.createGameSettingsModel({storage});model.hydrate(context());return {model,values,writes};}
const editor=(model,scope,ctx=context())=>{const value=model.createEditor(scope);value.hydrate(ctx);return value;};
test('global edits apply to existing and future games without rewriting complete legacy records',()=>{
 const f=fixture(),legacy=JSON.stringify({options:{alwaysHitbox:false},music:'none'});f.values.set(api.gamePreferenceStorageKey('th07'),legacy);
 const global=editor(f.model,'global');global.setOption('alwaysHitbox',true);global.setOption('touchSensitivity',230);
 assert.equal(f.model.getSnapshot().options.alwaysHitbox,true);f.model.hydrate(context('th07'));assert.equal(f.model.getSnapshot().options.alwaysHitbox,true);assert.equal(f.model.getSnapshot().options.touchSensitivity,230);
 assert.equal(f.values.get(api.gamePreferenceStorageKey('th07')),legacy);assert.deepEqual(JSON.parse(f.values.get(api.globalSettingsStorageKey)).options,{alwaysHitbox:true,touchSensitivity:230});
 f.model.hydrate(context('th10'));assert.equal(f.model.getSnapshot().options.alwaysHitbox,true);
});
test('game overrides are sparse and touch edits do not alter other games or shared layout preferences',()=>{
 const f=fixture(),global=editor(f.model,'global');global.setOption('alwaysHitbox',true);global.setOption('touchMovementMode','touch');
 const shared=f.values.get(api.sharedTouchPreferenceStorageKey),local=editor(f.model,'game');local.setOption('alwaysHitbox',false);local.setOption('touchMovementMode','joystick');
 assert.equal(f.model.getSnapshot().options.alwaysHitbox,false);assert.equal(f.model.getSnapshot().options.touchMovementMode,'joystick');assert.equal(f.values.get(api.sharedTouchPreferenceStorageKey),shared);
 assert.deepEqual(JSON.parse(f.values.get(api.localSettingsStorageKey('th06'))).options,{alwaysHitbox:false,touchMovementMode:'joystick'});
 f.model.hydrate(context('th07'));assert.equal(f.model.getSnapshot().options.alwaysHitbox,true);assert.equal(f.model.getSnapshot().options.touchMovementMode,'touch');
 global.setOption('touchSensitivity',200);f.model.hydrate(context());assert.equal(f.model.getSnapshot().options.touchSensitivity,200);assert.equal(f.model.getSnapshot().options.touchMovementMode,'joystick');
});
test('global language/music fall back to real game capabilities and local language has precedence',()=>{
 const f=fixture(),global=editor(f.model,'global',context('th06',{languages:[{id:'ja'},{id:'lang_en'},{id:'lang_zh-hans'}]}));global.setLanguage('lang_zh-hans');global.setMusic('ogg-full');
 assert.equal(f.model.getSnapshot().language,'lang_en','an unavailable global pack does not become an invalid selection');
 f.model.hydrate(context('th07',{languages:[{id:'ja'},{id:'lang_zh-hans'}],musicAvailability:{audio:false,midiAvailable:false,remoteOggAdvertised:false,importServer:false}}));
 assert.equal(f.model.getSnapshot().language,'lang_zh-hans');assert.equal(f.model.getSnapshot().music,'none');
 const local=editor(f.model,'game',context('th07',{languages:[{id:'ja'},{id:'lang_zh-hans'}]}));local.setLanguage('ja');global.setLanguage('lang_en');assert.equal(f.model.getSnapshot().language,'ja');
});
test('global defaults do not inherit a selected game language and may store music unavailable on the current device',()=>{
 const f=fixture();f.values.set(api.languagePreferenceStorageKey('th06'),'ja');f.model.hydrate(context());
 const global=editor(f.model,'global',context('th06',{musicAvailability:{audio:false,midiAvailable:false,remoteOggAdvertised:false,importServer:false}}));
 assert.equal(global.getSnapshot().language,'lang_en');global.setMusic('midi');assert.equal(JSON.parse(f.values.get(api.globalSettingsStorageKey)).music,'midi');
 f.model.hydrate(context('th07',{musicAvailability:{audio:false,midiAvailable:false,remoteOggAdvertised:false,importServer:false}}));assert.equal(f.model.getSnapshot().music,'none');
 f.model.hydrate(context('th07'));assert.equal(f.model.getSnapshot().music,'midi');
});
test('global desired features and movement cannot bypass a game capability or a room restriction',()=>{
 const f=fixture();f.model.hydrate(context('th06mp',{hostFeatures:{thprac:false,focusHitbox:false},forbidUnlimitedMovement:true}));
 const global=editor(f.model,'global',context('th06mp'));global.setOption('thpracEnabled',true);global.setOption('focusHitboxEnabled',true);global.setOption('touchMovementMode','touch-unlimited');
 assert.equal(global.getSnapshot().options.thpracEnabled,true);assert.equal(f.model.getSnapshot().options.thpracEnabled,false);assert.equal(f.model.getSnapshot().options.focusHitboxEnabled,false);assert.equal(f.model.getSnapshot().options.touchMovementMode,'touch');
 f.model.hydrate(context('th07'));assert.equal(f.model.getSnapshot().options.thpracEnabled,true);assert.equal(f.model.getSnapshot().options.touchMovementMode,'touch-unlimited');
});
test('failed storage keeps scoped edits for the current session and malformed fields are ignored',()=>{
 const model=api.createGameSettingsModel({storage:{getItem:()=>null,setItem(){throw Error('quota');}}});model.hydrate(context());const global=editor(model,'global');global.setOption('alwaysHitbox',true);model.hydrate(context('th07'));assert.equal(model.getSnapshot().options.alwaysHitbox,true);
 const local=editor(model,'game',context('th07'));local.setOption('alwaysHitbox',false);model.hydrate(context('th06'));assert.equal(model.getSnapshot().options.alwaysHitbox,true);model.hydrate(context('th07'));assert.equal(model.getSnapshot().options.alwaysHitbox,false);
 const store=api.createScopedSettingsStore({getItem:()=>JSON.stringify({options:{alwaysHitbox:'false',touchMovementMode:'invalid',touchSensitivity:999,unrecognized:true},music:'invalid',language:45}),setItem(){}});
 assert.deepEqual(store.read('global','th06'),{options:{touchSensitivity:999}});
});
test('an MP editor sharing change refreshes the effective model and uses the chosen preference owner',()=>{
 const f=fixture(),global=editor(f.model,'global');global.setOption('alwaysHitbox',true);f.model.hydrate(context('th06mp'));
 const local=editor(f.model,'game',context('th06mp')),before=local.getSnapshot().shareSingleplayerSettings;local.setOption('alwaysHitbox',false);
 local.setShareSingleplayerSettings(!before);assert.equal(f.model.getSnapshot().shareSingleplayerSettings,!before);assert.equal(f.model.getSnapshot().preferenceId,local.getSnapshot().preferenceId);
 assert.equal(f.model.getSnapshot().options.alwaysHitbox,true,'the other preference owner inherits the global default');
});
test('a game editor exposes the global baseline and reset makes the game follow later global edits',()=>{
 const f=fixture(),global=editor(f.model,'global');global.setOption('alwaysHitbox',true);global.setMusic('ogg-full');
 const local=editor(f.model,'game');assert.equal(global.getSnapshot().globalBaseline,undefined);assert.equal(f.model.getSnapshot().globalBaseline,undefined);
 assert.equal(local.getSnapshot().globalBaseline.options.alwaysHitbox,true);local.setOption('alwaysHitbox',false);local.setMusic('none');
 assert.equal(local.getSnapshot().options.alwaysHitbox,false);assert.equal(local.getSnapshot().globalBaseline.musicPreference,'ogg-full');
 local.resetToGlobal('alwaysHitbox');local.resetToGlobal('music');
 assert.equal(local.getSnapshot().options.alwaysHitbox,true);assert.equal(local.getSnapshot().musicPreference,'ogg-full');assert.equal(f.model.getSnapshot().options.alwaysHitbox,true);
 assert.deepEqual(JSON.parse(f.values.get(api.localSettingsStorageKey('th06'))),{options:{}});
 global.setOption('alwaysHitbox',false);f.model.hydrate(context());assert.equal(f.model.getSnapshot().options.alwaysHitbox,false);
});
test('reset also retires a legacy per-game value that global settings never set',()=>{
 const f=fixture();f.values.set(api.gamePreferenceStorageKey('th07'),JSON.stringify({options:{alwaysHitbox:!api.DEFAULT_GAME_OPTIONS.alwaysHitbox}}));
 const local=editor(f.model,'game',context('th07'));assert.equal(local.getSnapshot().options.alwaysHitbox,!api.DEFAULT_GAME_OPTIONS.alwaysHitbox);
 assert.equal(local.getSnapshot().globalBaseline.options.alwaysHitbox,api.DEFAULT_GAME_OPTIONS.alwaysHitbox);
 local.resetToGlobal('alwaysHitbox');assert.equal(local.getSnapshot().options.alwaysHitbox,api.DEFAULT_GAME_OPTIONS.alwaysHitbox);
 const global=editor(f.model,'global',context('th07'));global.setOption('alwaysHitbox',!api.DEFAULT_GAME_OPTIONS.alwaysHitbox);f.model.hydrate(context('th07'));
 assert.equal(f.model.getSnapshot().options.alwaysHitbox,!api.DEFAULT_GAME_OPTIONS.alwaysHitbox);
});
test('live room restrictions adapt scoped unlimited movement without overwriting the global preference',()=>{
 const f=fixture(),global=editor(f.model,'global');global.setOption('touchMovementMode','touch-unlimited');f.model.hydrate(context('th06mp'));
 f.model.setMovementRestriction(true);assert.equal(f.model.getSnapshot().options.touchMovementMode,'touch');assert.equal(JSON.parse(f.values.get(api.globalSettingsStorageKey)).options.touchMovementMode,'touch-unlimited');
 f.model.setMovementRestriction(false);assert.equal(f.model.getSnapshot().options.touchMovementMode,'touch-unlimited');
});
