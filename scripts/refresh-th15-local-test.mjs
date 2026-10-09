// Private local validation only. Materialize a new immutable Runtime generation
// through the normal publisher; do not overwrite an existing generation.
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {canonicalPackagePayload,validatePackageDescriptor} from '../package/package-descriptor.mjs';
import {writeRuntimeGeneration,publishRuntimeManifest} from '../lib/runtime-generations.mjs';
const site=resolve(process.argv[2]),source=resolve(process.argv[3]);
const expected=JSON.parse(await readFile(resolve(source,'runtime-files.json'),'utf8')).files;
const current=await writeRuntimeGeneration({site,root:'runtime/th15/',entry:'th15.html',source,names:Object.keys(expected),expected});
const host=JSON.parse(await readFile(resolve(site,'host-manifest.json'),'utf8'));
if(process.argv[4]){
 const prepared=resolve(process.argv[4]),catalog=JSON.parse(await readFile(resolve(prepared,'catalog.json'),'utf8'));
 if(catalog.game!=='th15'||catalog.schema!=='eagler-touhou/thcrap-static-catalog/1')throw Error('Invalid TH15 language catalog');
 const game=host.games.th15,descriptorPath=resolve(site,game.package.descriptor);
 const descriptor=validatePackageDescriptor(JSON.parse(await readFile(descriptorPath,'utf8')));
 for(const language of catalog.languages){
  if(!/^lang_[a-z0-9-]+$/.test(language.id)||language.pack.url!==`language/${language.id}.zip`)throw Error('Invalid language path');
  const bytes=await readFile(resolve(prepared,language.pack.url)),hash=createHash('sha256').update(bytes).digest('hex');
  if(bytes.length!==language.pack.bytes||hash!==language.pack.sha256)throw Error('Language content identity mismatch');
  const file=descriptor.files[`language:${language.id}`];if(!file||file.source!==`games/th15/${language.pack.url}`)throw Error('Missing published language');
  await writeFile(resolve(site,file.source),bytes);
  Object.assign(file,{bytes:bytes.length,sha256:hash,revision:hash.slice(0,16)});
  for(const entries of [game.languages,game.languageOptions]){
   const entry=entries.find(e=>e.id===language.id);if(!entry?.pack)throw Error('Missing host language');
   Object.assign(entry.pack,{bytes:bytes.length,sha256:hash,files:language.pack.files});
  }
 }
 descriptor.revision=createHash('sha256').update(canonicalPackagePayload(descriptor)).digest('hex').slice(0,16);
 validatePackageDescriptor(descriptor);game.package.revision=descriptor.revision;
 await writeFile(descriptorPath,JSON.stringify(descriptor,null,2)+'\n');
 const releasePath=resolve(site,'release-catalog.json'),release=JSON.parse(await readFile(releasePath,'utf8'));
 release.games.th15={...release.games.th15,...game.package};
 await writeFile(releasePath,JSON.stringify(release,null,2)+'\n');
}
host.games.th15.runtime=`runtime/th15/${current.generation}/th15.html`;
await publishRuntimeManifest(site,[{root:'runtime/th15/',current}]);
await writeFile(resolve(site,'host-manifest.json'),JSON.stringify(host,null,2)+'\n');
console.log(JSON.stringify({site,generation:current.generation}));
