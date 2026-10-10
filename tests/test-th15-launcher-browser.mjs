// Real shared Launcher + production TH15 Runtime. Requires prepared private content.
// Desktop and emulated touch coverage, not a physical-device/high-refresh claim.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import puppeteer from 'puppeteer-core';
import {findChromiumExecutable} from '../lib/chromium-executable.mjs';
import {installRuntimeDocumentObservation} from './support/runtime-document-observation.mjs';
const base=process.env.EAGLER_TH15_TEST_URL||'http://127.0.0.1:18115/';
const out=resolve(process.env.EAGLER_TH15_TEST_OUTPUT||'artifacts/th15-launcher');await mkdir(out,{recursive:true});
const browser=await puppeteer.launch({executablePath:await findChromiumExecutable(),headless:true,args:['--disable-extensions','--no-first-run','--autoplay-policy=no-user-gesture-required','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const report=[];
async function rpc(page,command,fields={}){
 return page.evaluate(({command,fields})=>new Promise((resolve,reject)=>{
  const frame=document.querySelector('#gameFrame'),url=new URL(globalThis.__originalRuntimeDocumentObservation ? globalThis.__originalRuntimeDocumentObservation.url(frame) : frame.src),epoch=Number(url.searchParams.get('runtimeEpoch'));
  const request='th15-test-'+crypto.randomUUID(),timer=setTimeout(()=>{window.removeEventListener('message',listen);reject(Error('RPC timed out: '+command));},30000);
  function listen(e){if(e.source!==frame.contentWindow||e.data?.request!==request)return;clearTimeout(timer);window.removeEventListener('message',listen);e.data.ok?resolve(e.data):reject(Error(e.data.error));}
  window.addEventListener('message',listen);frame.contentWindow.postMessage({protocol:'eagler-touhou/1',game:'th15',epoch,request,command,...fields},location.origin);
 }),{command,fields});
}
async function launch(page){
 await page.waitForFunction(()=>{const e=document.querySelector('#launch'),r=e.getBoundingClientRect();return !e.disabled&&e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));},{timeout:15000});
 await page.click('#launch');
 const deadline=Date.now()+120000;let nextLog=Date.now()+10000;
 while(Date.now()<deadline){
  await page.evaluate(()=>{const d=document.querySelector('#decisionDialog[open]');if(d&&!d.classList.contains('closing'))document.querySelector('#decisionConfirm')?.click();});
  const runtime=page.frames().find(f=>f.url().includes('/th15.html'));
  const runtimeError=runtime&&await runtime.evaluate(()=>document.querySelector('#error')?.textContent).catch(()=>'');
  if(runtimeError)throw Error(runtimeError);
  // The native initial title menu accepts input only after its 130-frame intro.
  if(runtime&&await runtime.evaluate(()=>globalThis.Module?._th15_frame()>160).catch(()=>false))return runtime;
  const fatal=await page.$eval('#playerStatus',e=>e.textContent).catch(()=>'');
  if(Date.now()>nextLog){console.log('launch status:',fatal,await runtime?.evaluate(()=>({frame:globalThis.Module?._th15_frame(),error:document.querySelector('#error')?.textContent})).catch(()=>null));nextLog=Date.now()+10000;}
  await new Promise(r=>setTimeout(r,200));
 }
 await page.screenshot({path:resolve(out,'launch-failure.png')});throw Error('TH15 did not reach first-frame: '+page.url()+' '+await page.$eval('#playerStatus',e=>e.textContent).catch(()=>''));
}
try{
 for(const mobile of process.env.EAGLER_TH15_TEST_MODE==='touch'?[true]:process.env.EAGLER_TH15_TEST_MODE==='desktop'?[false]:[false,true]){
  const context=await browser.createBrowserContext(),page=await context.newPage(),errors=[];
  await installRuntimeDocumentObservation(page);
  await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}]);
  await page.setViewport(mobile?{width:900,height:650,isMobile:true,hasTouch:true}:{width:1280,height:900});
  if(mobile)await page.setUserAgent('Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/149.0.0.0 Mobile Safari/537.36');
  page.on('pageerror',e=>{errors.push(String(e));console.log('browser error:',String(e));});
  await page.evaluateOnNewDocument(()=>{window.runtimeEvents=[];window.addEventListener('message',e=>{if(e.data?.protocol==='eagler-touhou/1'&&e.data?.game==='th15'&&e.data.event)window.runtimeEvents.push(e.data);});});
  await page.goto(base);await page.waitForFunction(()=>window.__eaglerBoot?.done===true);
  assert.equal(await page.$eval('.game[data-game=th15]',e=>e.hidden),process.env.EAGLER_TH15_TEST_SITE!=='1');
  await page.goto(base+'?test=th15');await page.waitForFunction(()=>window.__eaglerBoot?.done===true);
  await page.evaluate(()=>document.querySelector('#firstUseNoticeDialog')?.close());
  await page.waitForFunction(()=>!document.querySelector('.game[data-game=th15]').hidden);
  await page.$eval('.game[data-game=th15]',e=>{e.click();e.click();});
  await page.waitForFunction(()=>document.querySelector('#gameId').textContent==='TH15');
  if(process.env.EAGLER_TH15_TEST_IMPORT){
    await page.setRequestInterception(true);
    page.on('request',request=>new URL(request.url()).pathname.startsWith('/games/th15/')?request.abort():request.continue());
    await page.$eval('.game[data-game=th15]',e=>e.click());
    await page.click('#gamePackageImport');
    await page.waitForFunction(()=>document.querySelector('#gameDataImportWindow')?.hidden===false);
    const input=await page.$('#gameDataImportInput');await input.uploadFile(resolve(process.env.EAGLER_TH15_TEST_IMPORT));
    await page.waitForFunction(()=>document.querySelector('#gameDataImportWindow')?.hidden===true,{timeout:120000});
  }
  const music=await page.$$eval('#musicSelect option',a=>a.filter(e=>!e.disabled).map(e=>e.value));
  console.log('TH15 available music',music);
  const selected=mobile?'none':music.find(v=>v.includes('ogg'));assert.ok(selected,music);
  await page.select('#musicSelect',selected);
  const runtime=await launch(page);
  assert.match(runtime.url(),/managedData=1/);
  assert.equal(await runtime.evaluate(()=>typeof Module._th15_probe_state),'undefined');
  async function frames(n){const start=await runtime.evaluate(()=>Module._th15_frame());await runtime.waitForFunction(t=>Module._th15_frame()>=t,{timeout:45000},start+n);}
  async function key(code){await rpc(page,'keyboard',{code,down:true});await frames(3);await rpc(page,'keyboard',{code,down:false});await frames(3);}
  const audio=await runtime.evaluate(()=>{const p=Module._th15_audio_statistics();return Array.from(Module.HEAPU32.subarray(p>>>2,(p>>>2)+11));});
  assert.equal(audio[0],1);assert.ok(audio[2]>0,audio);
  if(!mobile)assert.ok(audio[9]>0,audio);
  else {assert.equal(audio[9],0);assert.equal(await runtime.evaluate(()=>{try{return Module.FS.readdir('/music').some(n=>n.endsWith('.ogg'));}catch{return false;}}),false);}
  await key('KeyZ');await frames(50);await key('ArrowDown');await key('KeyZ');await frames(45);
  for(let i=0;i<4;i++)await key('ArrowUp');await key('ArrowDown');await key('KeyZ');await frames(40);await key('KeyZ');
  // Native title panels reject input while animating. Finish the remaining
  // difficulty/character confirmation panels at their normal frame cadence.
  for(let i=0;i<4&&await runtime.evaluate(()=>Module._th15_phase()===0);i++){await frames(60);await key('KeyZ');}
  await page.screenshot({path:resolve(out,'menu-before-game.png')});
  await runtime.waitForFunction(()=>Module._th15_phase()===1,{timeout:45000});await frames(80);
  if(mobile){await rpc(page,'direct-touch',{type:'down',id:44,x:.30,y:.80});await rpc(page,'direct-touch',{type:'move',id:44,x:.34,y:.77});await rpc(page,'touch-controls',{controls:{fireEnabled:true,focusEnabled:true,bombSerial:1,escapeSerial:0}});await frames(60);await rpc(page,'direct-touch',{type:'up',id:44,x:.34,y:.77});await rpc(page,'touch-cancel');}
  await page.screenshot({path:resolve(out,mobile?'touch.png':'desktop.png')});
  await key('Escape');await runtime.waitForFunction(()=>Module._th15_phase()===2);await frames(25);await key('KeyQ');await runtime.waitForFunction(()=>Module._th15_phase()===0);await frames(35);
  await rpc(page,'sync');const files=(await rpc(page,'list')).files;
  assert.ok(files.some(f=>f.path==='scoreth15.dat'));assert.ok(files.some(f=>f.path==='th15.cfg'));
  const config=(await rpc(page,'read',{path:'th15.cfg'})).bytes;
  await assert.rejects(rpc(page,'read',{path:'../th15.dat'}),/路径/);
  const events=await page.evaluate(()=>runtimeEvents);
  for(const event of ['ready','first-frame','runtime-info','frame-health','audio-health'])assert.ok(events.some(e=>e.event===event),event);
  await key('KeyX');await key('KeyZ').catch(()=>{});
  await page.waitForFunction(()=>!document.querySelector('#player').classList.contains('open'),{timeout:45000});
  if(process.env.EAGLER_TH15_TEST_OFFLINE==='1'){
    // The shared worker intentionally does not claim a document mid-load.
    // Complete its first activation and navigate once before going offline.
    await page.evaluate(()=>navigator.serviceWorker.ready.then(()=>true));
    await page.reload();await page.waitForFunction(()=>window.__eaglerBoot?.done===true);
    await page.waitForFunction(()=>!!navigator.serviceWorker.controller,{timeout:30000});
    await page.setOfflineMode(true);
  }
  await page.reload();await page.waitForFunction(()=>window.__eaglerBoot?.done===true);
  // Offline discovery includes all local products. A first activation selects
  // the cover; a second opens its options, just as in the online full library.
  await page.evaluate(()=>document.querySelector('#firstUseNoticeDialog')?.close());await page.$eval('.game[data-game=th15]',e=>{e.click();e.click();});
  await page.waitForFunction(()=>document.querySelector('#gameId').textContent==='TH15');
  console.log('TH15 reload ready',page.url());
  const second=await launch(page);assert.ok(second);
  assert.deepEqual((await rpc(page,'read',{path:'th15.cfg'})).bytes,config);
  assert.deepEqual(errors,[]);report.push({mobile,music:selected,files,audio,events:[...new Set(events.map(e=>e.event))],reload:true,offline:process.env.EAGLER_TH15_TEST_OFFLINE==='1',imported:!!process.env.EAGLER_TH15_TEST_IMPORT});
  await context.close();console.log('PASS TH15',mobile?'touch':'desktop');
 }
 await writeFile(resolve(out,'report.json'),JSON.stringify({passed:true,report},null,2));
}finally{await browser.close();}
