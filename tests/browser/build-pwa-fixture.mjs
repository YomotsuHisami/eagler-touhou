/** Current React + production worker + deliberately synthetic ABI generations. */
import {writeRuntimeGeneration,publishRuntimeManifest} from '../../lib/runtime-generations.mjs';
import {resolveBrowserPublicationSource} from '../../lib/launcher-build.mjs';
import {mkdir,readFile,writeFile,readdir,rm,mkdtemp,cp} from 'node:fs/promises';
import {resolve,dirname,join} from 'node:path';
import {tmpdir} from 'node:os';
import {ensureUiBuild} from '../../lib/ui-build.mjs';
import {installUiFrontend} from '../../lib/ui-frontend.mjs';
import {finalizeUiArtifact} from '../../scripts/finalize-ui-artifact.mjs';
import {writeRuntimeFixture} from './runtime-recovery-fixture.mjs';

const [directory,version='a',mountPath='/']=process.argv.slice(2);
if(!directory || !/^[a-z0-9-]+$/.test(version))throw Error('usage: build-pwa-fixture.mjs OUTPUT [VERSION] [MOUNT]');
const root=resolve(directory);await mkdir(root,{recursive:true});
const build=await ensureUiBuild({environment:{...process.env,EAGLER_UI_MOUNT_PATH:mountPath,
 ...(mountPath!=='/'?{EAGLER_UI_BUILD_DIRECTORY:resolve('.cache/build/ui-pwa-nested')}:{} )}});
const scratch=await mkdtemp(join(tmpdir(),'pwa-ui-artifact-'));
try{
 await cp(build.root,scratch,{recursive:true});
 // Seal a distinct current artifact, rather than changing published shell bytes
 // after its marker was written. This also forces the corrupt-shell negative.
 const index=resolve(scratch,'index.html');
 await writeFile(index,(await readFile(index,'utf8')).replace('</head>',`<meta name="pwa-fixture-shell" content="${version}"></head>`));
 const artifact=await finalizeUiArtifact(scratch);
 const fixtureFiles=[];
 for(const [source,target] of [
  ['assets/launcher/runtime-launch.mjs','fixture/launcher/runtime-launch.mjs'],
  ['assets/contracts/runtime-generations.mjs','fixture/contracts/runtime-generations.mjs'],
 ]){await mkdir(dirname(resolve(root,target)),{recursive:true});await writeFile(resolve(root,target),await readFile(resolveBrowserPublicationSource(source)));fixtureFiles.push(target);}
 const groups=[];
 for(const game of ['pwa-test','pwa-unused']){
  const source=resolve(root,'.tmp',game);await rm(source,{recursive:true,force:true});
  await writeRuntimeFixture(source,version);
  const current=await writeRuntimeGeneration({site:root,root:`runtime/${game}/`,source,entry:'runtime.html',names:await readdir(source)});
  groups.push({root:`runtime/${game}/`,current});await rm(source,{recursive:true});
 }
 await publishRuntimeManifest(root,groups);
 // The synthetic program groups are not Touhou products and no game DATA is
 // advertised. Their selector/cache tests remain separate from native gates.
 const host={schema:'eagler-touhou/host-manifest/1',protocol:'eagler-touhou/1',profile:'synthetic-pwa-only',shared:{resourceMode:'import',runtimeManifest:'runtime-manifest.json'},games:{}};
 await writeFile(resolve(root,'host-manifest.json'),JSON.stringify(host));
 await writeFile(resolve(root,'release-catalog.json'),JSON.stringify({schema:'eagler-touhou/release-catalog/1',games:{}}));
 await cp(resolve('public/site.webmanifest'),resolve(root,'site.webmanifest'));
 const result=await installUiFrontend(root,{artifact,hostManifest:host,supplementalShellFiles:['site.webmanifest',...fixtureFiles]});
 if(result.warnings.length)throw Error(result.warnings.join('\n'));
 if(result.manifestEntries.some(entry=>!/^[a-f0-9]{64}$/.test(entry.revision||'')))throw Error('non-SHA-256 precache entry');
 console.log(JSON.stringify({build:result.buildId,entries:result.count,syntheticOnly:true,mountPath}));
}finally{await rm(scratch,{recursive:true,force:true});}
