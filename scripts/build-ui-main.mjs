import routes from '../app/routes.ts';
import {navigationPatterns} from './ui-routing.mjs';
import {spawn} from 'node:child_process';
import {cp, mkdir, writeFile, readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const root = process.cwd(), output = resolve('.cache/build/ui-main/client');
await new Promise((done, fail) => {const p=spawn(process.execPath, ['node_modules/@react-router/dev/bin.cjs','build'], {cwd:root,stdio:'inherit'});p.on('error',fail);p.on('exit',code=>code===0?done():fail(Error(`UI build failed: ${code}`)));});
// Only current main's public assets: never the old experiment's artwork or SW.
await mkdir(resolve(output,'assets'),{recursive:true});
await cp(resolve('public/assets'),resolve(output,'assets'),{recursive:true});
const ownership=JSON.parse(await readFile(resolve(output,'ui-ownership.json'),'utf8'));
if(ownership.schema!=='eagler-touhou/ui-ownership/1'||ownership.legacyLauncherIncluded!==false||ownership.nodeBuiltinsIncluded!==false)throw Error('UI build ownership proof missing');
await writeFile(resolve(output,'ui-navigation.json'),JSON.stringify({schema:'eagler-touhou/ui-navigation/1',patterns:navigationPatterns(routes)}));
