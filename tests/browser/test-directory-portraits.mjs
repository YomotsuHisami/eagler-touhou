/** Offline browser components, not a live site, game, or network multiplayer test.
 * Uses actual authored DOM/CSS and compiled modules. Only transport/location are
 * fixtures; images are a synthetic 1px PNG, never an artist's redistributed work.
 */
import assert from 'node:assert/strict';
import {readFile,mkdir} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parse,serializeOuter} from 'parse5';
import {build} from 'esbuild';
import puppeteer from 'puppeteer-core';
import {resolveFrontendPackageSource} from '../../lib/frontend-manifest.mjs';
const project=resolve(fileURLToPath(new URL('../..',import.meta.url)));
const root=parse(await readFile(resolveFrontendPackageSource('index.html'),'utf8'));
function find(node,predicate){if(predicate(node))return node;for(const child of node.childNodes||[]){const found=find(child,predicate);if(found)return found;}}
const attr=(node,name)=>node.attrs?.find(a=>a.name===name)?.value;
const outer=id=>serializeOuter(find(root,n=>attr(n,'id')===id));
const library=serializeOuter(find(root,n=>attr(n,'class')==='game-library'));
const css=(await readFile(resolve(project,'public/styles.css'),'utf8'))+'\n'+await readFile(resolve(project,'public/assets/character-art.css'),'utf8');
const bundle=async source=>(await build({stdin:{contents:source,resolveDir:project,loader:'js'},bundle:true,write:false,format:'iife',platform:'browser',target:'es2022'})).outputFiles[0].text;
const modules=await bundle(`import {createSiteInfo} from './src/launcher/site-info.mts';import {createScorePanel} from './src/launcher/score-panel.mts';import {createCharacterPortrait} from './src/launcher/character-art.mts';import {CHARACTER_ART_IDS} from './src/contracts/character-art.mts';window.components={createSiteInfo,createScorePanel,createCharacterPortrait,ids:CHARACTER_ART_IDS};`);
const executablePath=process.env.EAGLER_TEST_CHROMIUM||['/usr/bin/chromium','/usr/bin/chromium-browser','/usr/bin/google-chrome'].find(existsSync);
assert.ok(executablePath,'Set EAGLER_TEST_CHROMIUM to a Chromium executable');
const browser=await puppeteer.launch({executablePath,headless:true,args:process.getuid?.()===0?['--no-sandbox','--disable-dev-shm-usage']:[]});
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==','base64');
const evidence=resolve(project,'.cache/frontend-browser-evidence');await mkdir(evidence,{recursive:true});
const results=[];
try{
  for(const [width,height] of [[1440,1000],[390,844]]){
    const page=await browser.newPage();await page.setViewport({width,height,hasTouch:width<780});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.setRequestInterception(true);
    page.on('request',async req=>{
      try{
        const path=new URL(req.url()).pathname.slice(1);
        if(path.startsWith('assets/dairi/')){await req.respond({status:200,contentType:'image/png',body:png});return;}
        let file;try{file=resolveFrontendPackageSource(path);}catch{file=resolve(project,'.cache/host-artwork',path.replace(/^assets\//,''));}
        const body=await readFile(file);await req.respond({status:200,headers:{'Access-Control-Allow-Origin':'*'},contentType:path.endsWith('.woff2')?'font/woff2':path.endsWith('.webp')?'image/webp':'application/octet-stream',body});
      }catch{await req.abort();}
    });
    await page.setContent(`<html><head><base href="https://frontend-fixture.invalid/"><style>${css}</style></head><body class="less-motion"><main class="main library-layout directory-layout">${library}<aside class="tools site-info-active">${outer('siteInfo')}</aside></main><div id="artTest"></div></body></html>`);
    await page.evaluate(()=>{
      window.noticeText='欢迎使用 Eagler Touhou\n[项目](https://github.com/YomotsuHisami/eagler-touhou)\n<img src=x onerror=alert(1)>';
      window.fetch=async path=>path==='NOTICE.txt'?{ok:true,text:async()=>window.noticeText}:{ok:true,json:async()=>({schema:'eagler-touhou/character-art/1',characters:['reimu','yukari']})};
    });
    await page.addScriptTag({content:modules});
    await page.evaluate(()=>{window.site=components.createSiteInfo(document.getElementById('siteInfo'));site.show(true);document.querySelector('.game-site').classList.add('selected');});
    await page.waitForFunction(()=>document.getElementById('siteInfoContent').textContent.includes('欢迎'));
    assert.equal(await page.$$eval('#siteInfoContent img',n=>n.length),0,'notice must not inject HTML');
    assert.equal(await page.$eval('#siteInfoContent a',n=>n.rel),'noopener noreferrer');
    assert.equal(await page.$$eval('.game',nodes=>nodes.length),6);
    assert.equal(await page.$eval('.game',n=>n.dataset.directory),'site');
    assert.ok(await page.$eval('#siteInfoMultiplayer',n=>{const [r,g,b]=getComputedStyle(n).backgroundColor.match(/\d+/g).map(Number);return r>g*1.5&&r>b*1.5;}),'red multiplayer button');
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'no horizontal overflow');
    await page.evaluate(()=>document.fonts.ready);
    assert.equal(await page.$eval('.game-site',n=>getComputedStyle(n).display),'flex');
    assert.equal(await page.$eval('.site-card-wordmark',n=>getComputedStyle(n).fontFamily),'touhou98, monospace');
    assert.ok(await page.$eval('.site-card-wordmark',n=>{const a=n.getBoundingClientRect(),b=n.closest('.game').getBoundingClientRect();return a.left>=b.left+4&&a.right<=b.right-4;}),'wordmark fits without clipping');
    await page.screenshot({path:resolve(evidence,`site-${width}.png`),fullPage:true});
    await page.evaluate(()=>{window.noticeText='';});await page.click('#siteInfoRefresh');
    await page.waitForFunction(()=>document.getElementById('siteInfoStatus').textContent.includes('暂无'));
    await page.evaluate(()=>{window.fetch=async()=>{throw Error('fixture request failed');};});await page.click('#siteInfoRefresh');
    await page.waitForFunction(()=>document.getElementById('siteInfoStatus').textContent.includes('failed'));
    // Missing/correct portrait behavior shares the same renderer as room and scores.
    await page.evaluate(()=>{window.fetch=async()=>({ok:true,json:async()=>({schema:'eagler-touhou/character-art/1',characters:['reimu','yukari']})});
      for(const id of ['reimu','yukari','marisa'])document.getElementById('artTest').append(components.createCharacterPortrait(id));});
    await page.waitForFunction(()=>document.querySelectorAll('#artTest .has-art').length===2);
    assert.equal(await page.$$eval('#artTest [data-character=marisa] img',n=>n.length),0);
    assert.equal(await page.$eval('#artTest [data-character=marisa] small',n=>n.textContent),'立绘未导入');
    await page.evaluate(()=>{const panel=document.createElement('section'),art=document.createElement('div');document.body.append(panel,art);art.id='scoreArtFixture';const score=components.createScorePanel(panel,art,async()=>null);score.select({game:'th08',product:'th08',root:'/test',file:'score.dat'});});
    await page.waitForFunction(()=>document.querySelectorAll('#scoreArtFixture .has-art').length===2);
    assert.deepEqual(await page.$$eval('#scoreArtFixture .character-portrait',nodes=>nodes.map(n=>n.dataset.character)),['reimu','yukari']);
    assert.deepEqual(errors,[]);results.push({width,siteNotice:true,emptyAndError:true,safeLinks:true,redButton:true,portraitPair:true,missingArt:true,scoreEmptyState:true});await page.close();
  }
  // The real local lobby module is executed with an explicit synthetic location.
  // No browser navigation/network/relay is attempted; all room data is its fixture.
  const lobbyBundle=(await build({entryPoints:[resolve(project,'public/dev-lobby.mjs')],bundle:true,write:false,format:'iife',platform:'browser',
    define:{location:'__TEST_LOCATION__'},banner:{js:'const __TEST_LOCATION__=new URL("http://localhost:8137/dev-lobby.html?game=");'},
    plugins:[{name:'compiled-local-modules',setup(build){build.onResolve({filter:/^\.\/assets\//},args=>({path:resolve(project,'.cache/build/browser',args.path.slice(2))}));}}]})).outputFiles[0].text;
  const lobbyMarkup=(await readFile(resolve(project,'public/dev-lobby.html'),'utf8')).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<link\b[^>]*>/gi,'');
  const lobbyCss=await readFile(resolve(project,'public/dev-lobby.css'),'utf8');
  for(const [width,height] of [[1440,1000],[390,844]]){
    const page=await browser.newPage();await page.setViewport({width,height,hasTouch:width<780});const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.setContent(lobbyMarkup);await page.addStyleTag({content:lobbyCss+'\n'+await readFile(resolve(project,'public/assets/character-art.css'),'utf8')});
    await page.evaluate(()=>{window.fetch=async()=>({ok:true,json:async()=>({schema:'eagler-touhou/character-art/1',characters:[]})});});
    await page.addScriptTag({content:lobbyBundle});
    const sync=game=>page.evaluate(({game,width})=>window.dispatchEvent(new MessageEvent('message',{origin:'http://localhost:8137',source:window,data:{type:'local-lobby-view',game,portrait:width<780,desktop:width>=780}})),{game,width});
    await sync('');assert.equal(await page.$$eval('#roomList .lobby-room-code',n=>n.length),5);
    assert.equal(await page.$$eval('#roomList .lobby-room-game',n=>n.length),5);
    await sync('th07');assert.equal(await page.$$eval('#roomList .lobby-room-code',n=>n.length),1);
    await sync('');await page.click('#createButton');assert.equal(await page.$eval('#gameSelect',n=>n.value),'');assert.equal(await page.$eval('#gameSelect',n=>n.checkValidity()),false);
    await page.select('#gameSelect','th08');await page.click('#submitRoom');
    await page.waitForFunction(()=>!document.querySelector('.preview-room-card').hidden);
    assert.deepEqual(await page.$$eval('.is-local .character-portrait',n=>n.map(i=>i.dataset.character)),['reimu','yukari']);
    await page.focus('.preview-room-seat.is-local');await page.keyboard.press('Enter');await page.keyboard.press('ArrowDown');
    assert.deepEqual(await page.$$eval('.is-local .character-portrait',n=>n.map(i=>i.dataset.character)),['reimu']);
    await page.keyboard.press('Enter');await page.click('#previewRoomReady');assert.equal(await page.$eval('#previewRoomReady',n=>n.textContent),'取消准备');
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'lobby no horizontal overflow');
    await page.screenshot({path:resolve(evidence,`room-${width}.png`),fullPage:true});
    await page.click('#previewRoomBack');await sync('');assert.equal(await page.$$eval('#roomList .lobby-room-code',n=>n.length),6);
    assert.deepEqual(errors,[]);results.push({width,allRooms:true,filter:true,createRequiresGame:true,th08Selection:true,ready:true,returnToAll:true});await page.close();
  }
  console.log(JSON.stringify({result:'PASS',scope:'offline DOM/components; synthetic images and location, not full Launcher navigation or real multiplayer',results},null,2));
}finally{await browser.close();}
