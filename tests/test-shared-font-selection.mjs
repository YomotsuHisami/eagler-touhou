import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {transformSync} from 'esbuild';
const source=readFileSync(new URL('../src/launcher/app.mts',import.meta.url),'utf8');
const start=source.indexOf('async function selectedSharedResources(');
const end=source.indexOf('\nfunction languageCacheKey(',start);
assert(start>=0&&end>start);
const code=transformSync(source.slice(start,end),{loader:'ts',target:'es2022'}).code;
async function select(product,language='ja',practice=false,installed=[]){
 const files=Object.fromEntries(installed.map((target,i)=>[i,{target}]));
 const context=vm.createContext({URL,state:{game:'fixture',language,options:{thpracEnabled:practice}},PRODUCT_GAMES:{fixture:product},record:x=>x,manifest:{shared:{vanillaFont:'shared/msgothic.ttc',unicodeFont:'shared/unifont.otf'}},activeInstalledPackageGeneration:installed.length?{descriptor:{base:{files:Object.keys(files)},files},files:Object.fromEntries(Object.keys(files).map(k=>[k,{objectId:'installed'}]))}:null,location:{href:'https://mirror.invalid/'},GameDataAcquisitionError:Error,t:x=>x});
 vm.runInContext(code,context);return Array.from(await context.selectedSharedResources(),x=>x.path);
}
assert.deepEqual(await select({requiredShared:['/unifont.otf']}),[],'TH11 Japanese baked fonts must not request msgothic');
assert.deepEqual(await select({requiredShared:['/unifont.otf']},'ja',true),['/unifont.otf']);
assert.deepEqual(await select({requiredShared:['/unifont.otf']},'lang_zh-hans'),['/unifont.otf']);
assert.deepEqual(await select({requiredShared:['/msgothic.ttc','/unifont.otf']},'ja',true),['/msgothic.ttc','/unifont.otf']);
assert.deepEqual(await select({},'ja'),['/msgothic.ttc'],'Legacy Runtime selection remains supported');
assert.deepEqual(await select({requiredShared:[]}),[]);
assert.deepEqual(await select({requiredShared:['/unifont.otf']},'ja',true,['/unifont.otf']),[],'Installed font must not download twice');
console.log('Shared font selection: Japanese baked fonts, practice, localization, legacy and installed-font cases PASS');
