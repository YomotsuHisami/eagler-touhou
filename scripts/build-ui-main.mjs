import routes from '../app/routes.ts';
import {uiBuildConfig} from './ui-build-config.mjs';
import {finalizeUiArtifact} from './finalize-ui-artifact.mjs';
import {navigationPatterns} from './ui-routing.mjs';
import {spawn} from 'node:child_process';
import {cp, mkdir, writeFile, readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const root = process.cwd(), config = uiBuildConfig(), output = config.clientDirectory;
await new Promise((done,fail)=>{const child=spawn(process.execPath,['scripts/build-content-pages.mjs','--check'],{cwd:root,stdio:'inherit'});child.on('error',fail);child.on('exit',code=>code===0?done():fail(Error('Canonical content artifacts need rebuilding')));});
await new Promise((done, fail) => {const p=spawn(process.execPath, ['node_modules/@react-router/dev/bin.cjs','build'], {cwd:root,stdio:'inherit'});p.on('error',fail);p.on('exit',code=>code===0?done():fail(Error(`UI build failed: ${code}`)));});
// Only current main's public assets: never the old experiment's artwork or SW.
await mkdir(resolve(output,'assets'),{recursive:true});
await cp(resolve('public/assets'),resolve(output,'assets'),{recursive:true});
await mkdir(resolve(output,'content'),{recursive:true});
for(const name of ['FIRST_USE_NOTICE.html','MULTIPLAYER.html']) await cp(resolve('public/content',name),resolve(output,'content',name));
await cp(resolve('NOTICE.txt'),resolve(output,'NOTICE.txt'));
await cp(resolve('public/compatibility.html'),resolve(output,'compatibility.html'));
const ownership=JSON.parse(await readFile(resolve(output,'ui-ownership.json'),'utf8'));
if(ownership.schema!=='eagler-touhou/ui-ownership/1'||ownership.legacyLauncherIncluded!==false||ownership.nodeBuiltinsIncluded!==false)throw Error('UI build ownership proof missing');
await writeFile(resolve(output,'ui-navigation.json'),JSON.stringify({schema:'eagler-touhou/ui-navigation/1',patterns:navigationPatterns(routes)}));

await writeFile(resolve(output,'ui-build.json'),JSON.stringify({schema:'eagler-touhou/ui-build/1',mountPath:config.mountPath}));
await finalizeUiArtifact(output);
