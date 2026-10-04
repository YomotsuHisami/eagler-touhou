/** Real native WebKit gate against an explicit current local publication.
 * No sibling build discovery, development metadata, or physical iOS claims. */
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
const root=fileURLToPath(new URL('../..',import.meta.url));
const option=name=>process.argv.find(value=>value.startsWith(`--${name}=`))?.slice(name.length+3);
if(process.argv.includes('--help')){
 console.log('Usage: npm run test:webkit -- --url=http://127.0.0.1:PORT/ [--game=th06|th07|th08] [--music=none|midi|ogg-stream|ogg-full] [--package-zip=PATH] [--block-game-data] [--artifact-dir=PATH]');
 process.exit(0);
}
const url=option('url')||process.env.EAGLER_NATIVE_SITE_URL;
if(!url)throw Error('An explicit --url or EAGLER_NATIVE_SITE_URL for an assembled local current publication is required');
const game=option('game'),music=option('music')||'none';
if(game&&!['th06','th07','th08'].includes(game))throw Error('Unsupported --game');
if(!['none','midi','ogg-stream','ogg-full'].includes(music))throw Error('Unsupported --music');
for(const selected of game?[game]:['th06','th07']){
 const args=[resolve(root,'tests/browser/launcher-playwright-webkit.py'),url,selected,music];
 for(const name of ['package-zip','artifact-dir'])if(option(name))args.push(`--${name}=${option(name)}`);
 if(process.argv.includes('--block-game-data'))args.push('--block-game-data');
 await new Promise((done,fail)=>{const child=spawn(process.env.PYTHON||'python',args,{cwd:root,stdio:'inherit'});child.once('error',fail);child.once('exit',code=>code===0?done():fail(Error(`Native WebKit ${selected} failed (${code})`)));});
}
console.log('Desktop Playwright WebKit current-publication native gate: PASS; no physical-device acceptance');
