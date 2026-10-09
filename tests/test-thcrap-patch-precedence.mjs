import assert from 'node:assert/strict';
import {createThcrapClient} from '../integrations/thcrap.mjs';

const root='https://fixture.test/';
const fixtures=new Map([
 ['script_latin/patch.js',{id:'script_latin',fonts:{'font.ttf':true}}],
 ['script_latin/files.js',{'global.js':1,'th15/title/result00.png':2,'th15/musiccmt.js':3}],
 ['lang_en/patch.js',{id:'lang_en',dependencies:['script_latin']}],
 ['lang_en/files.js',{'th15.js':4,'th15/title/result00.png':5,'th15/musiccmt.js':6}],
]);
const fetchImpl=async url=>{
 const path=new URL(url).pathname.slice(1);
 return fixtures.has(path)?Response.json(fixtures.get(path)):new Response('missing',{status:404});
};
const pack=await createThcrapClient({repository:root,fetchImpl}).resolveLanguage('lang_en','th15');
for(const path of ['th15/title/result00.png','th15/musiccmt.js']){
 assert.equal(pack.assets.find(x=>x.path===path)?.crc32,path.endsWith('.png')?5:6,
  'Language artwork/tables must override font-provider dependencies');
}
assert.equal(pack.assets.find(x=>x.mountPath==='/thcrap/th15/th15.js')?.path,'global.js',
 'Font-options precedence must remain unchanged');
console.log('PASS: language leaf artwork/tables and independent font-options precedence');
