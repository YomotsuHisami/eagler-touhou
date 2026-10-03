/** Real React/DOM ownership tests with a protocol fixture, not a real game. */
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {existsSync} from 'node:fs';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {createServer} from 'node:http';
import {tmpdir} from 'node:os';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import puppeteer from 'puppeteer-core';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const temp=await mkdtemp(resolve(tmpdir(),'ui-input-browser-'));
let browser,server;
try {
 await build({entryPoints:[resolve(root,'tests/test-ui-input-fixture.tsx')],outfile:resolve(temp,'fixture.js'),bundle:true,platform:'browser',format:'esm',jsx:'automatic',target:'es2022',plugins:[{name:'fixture-services',setup(plugin){
  plugin.onResolve({filter:/browser-services$/},()=>({path:'fixture-services',namespace:'fixture'}));
  plugin.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export const useBrowserServices=()=>window.fixtureServices;',loader:'js'}));
  plugin.onResolve({filter:/\.mjs$/},args=>{const path=resolve(args.resolveDir,args.path).replace(/\.mjs$/,'.mts');if(path.startsWith(resolve(root,'src')+'/')&&existsSync(path))return{path};});
 }}]});
 if(process.argv.includes('--build-only')) {
  console.log('PASS RuntimeHost browser fixture bundles (browser execution not requested)');
 } else {
 server=createServer(async(req,res)=>{try{if(req.url==='/fixture.js'||req.url==='/fixture.css'){res.setHeader('content-type',req.url.endsWith('.js')?'text/javascript':'text/css');res.end(await readFile(resolve(temp,req.url.slice(1))));}else{res.setHeader('content-type','text/html');res.end('<html><head><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>');}}catch{res.writeHead(404);res.end();}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 browser=await puppeteer.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 const page=await browser.newPage();await page.setUserAgent('Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130.0.0.0 Mobile Safari/537.36');await page.setViewport({width:1080,height:720,hasTouch:true});
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto(`http://127.0.0.1:${server.address().port}`);await page.waitForSelector('[data-touch-control="fire"]');
 await page.waitForFunction(()=>window.bindCount===1);await page.evaluate(()=>{window.gameFrame.dataset.identity='original';window.messages=[];});
 const pointer=async(selector,type,id,x=80,y=80)=>page.$eval(selector,(element,{type,id,x,y})=>element.dispatchEvent(new PointerEvent(type,{bubbles:true,cancelable:true,pointerId:id,pointerType:'touch',clientX:x,clientY:y})),{type,id,x,y});
 const click=async text=>page.evaluate(text=>Array.from(document.querySelectorAll('button')).find(button=>button.textContent===text).click(),text);
 await pointer('[data-touch-control="fire"]','pointerdown',7);assert.equal(await page.evaluate(()=>window.messages.at(-1).down),true);
 await pointer('[data-touch-control="fire"]','pointerup',7);assert.equal(await page.evaluate(()=>window.messages.at(-1).down),false);
 await page.evaluate(()=>{window.messages=[];});await pointer('[data-touch-control="bomb"]','pointerdown',8);await pointer('[data-touch-control="bomb"]','pointerup',8);
 assert.equal(await page.evaluate(()=>window.messages.filter(m=>m.command==='touch-controls'&&m.bombSerial===1).length),1,'pointer activation cannot duplicate click');
 await pointer('[data-touch-direct]','pointerdown',10,100,200);await pointer('[data-touch-direct]','pointermove',10,110,220);await pointer('[data-touch-direct]','pointerup',10,110,220);
 assert.deepEqual(await page.evaluate(()=>window.messages.filter(m=>m.command==='direct-touch').map(m=>m.type)),['down','move','up']);
 await page.setViewport({width:390,height:844,hasTouch:true});assert.equal(await page.$eval('iframe',frame=>frame.dataset.identity),'original');assert.equal(await page.evaluate(()=>window.bindCount),1);
 await click('帮助');await page.waitForSelector('[data-ui-dialog-live]');assert.equal(await page.$eval('#route',node=>node.textContent),'/games/th09/help');
 await page.evaluate(()=>{window.messages=[];});await page.keyboard.press('z');assert.equal(await page.evaluate(()=>window.messages.filter(m=>m.command==='keyboard').length),0,'help owns keyboard');
 await click('返回游戏');await page.waitForFunction(()=>!document.querySelector('[data-ui-dialog-live]'));
 assert.equal(await page.$eval('iframe',frame=>frame.dataset.identity),'original');assert.equal(await page.evaluate(()=>window.bindCount),1);
 assert.equal(await page.evaluate(()=>{const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);return event.defaultPrevented;}),true);
 await click('保存并退出');await page.waitForFunction(()=>document.querySelector('[data-ui-dialog-live]')?.textContent.includes('保存未完成'));
 assert.equal(await page.evaluate(()=>window.fixtureSnapshot().launched),true);assert.equal(await page.$eval('iframe',frame=>frame.dataset.identity),'original');
 await click('放弃未保存进度…');await page.waitForFunction(()=>document.querySelector('[data-ui-dialog-live]')?.textContent.includes('确认放弃未保存进度'));
 assert.equal(await page.evaluate(()=>window.closeCalls.length),1,'first discard click only confirms');
 await click('确认放弃并退出');await page.waitForFunction(()=>!window.fixtureSnapshot().launched);
 assert.equal(await page.evaluate(()=>window.closeCalls.at(-1).discardUnsaved),true);assert.equal(await page.$eval('iframe',frame=>frame.dataset.identity),'original');
 assert.equal(await page.evaluate(()=>{const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);return event.defaultPrevented;}),false);
 await page.evaluate(()=>window.changeSession({phase:'prepared',intent:'prepare',ready:true,launched:false,epoch:2}));
 assert.equal(await page.$eval('[aria-label="运行中的游戏"]',element=>getComputedStyle(element).visibility),'hidden');
 assert.ok(await page.$eval('iframe',frame=>frame.getBoundingClientRect().width)>300,'preflight retains viewport width');
 await page.evaluate(()=>window.changeSession({phase:'running',intent:'launch',launched:true,spectator:true,epoch:3}));await page.waitForFunction(()=>document.querySelector('[aria-label="触控操作"]').hidden);
 assert.equal(await page.$eval('[aria-label="触控操作"]',element=>element.hidden),true);await page.evaluate(()=>{window.messages=[];});await page.keyboard.press('z');assert.equal(await page.evaluate(()=>window.messages.length),0);
 assert.deepEqual(errors,[]);console.log('PASS real React RuntimeHost: touch events, route help, stable iframe/orientation, save failure/discard, unload guard, hidden sized preflight, spectator input');
 }
} finally {await browser?.close();await new Promise(resolve=>server?server.close(resolve):resolve());await rm(temp,{recursive:true,force:true});}
