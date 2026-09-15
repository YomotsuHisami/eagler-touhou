import assert from 'node:assert/strict';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createFixtureServer} from './sdl-fixture-server.mjs';
const config=JSON.parse(readFileSync(process.env.EAGLER_SDL_FIXTURE,'utf8'));
const out=resolve(process.env.EAGLER_SDL_EVIDENCE??'.cache/sdl-browser');mkdirSync(out,{recursive:true});
const {chromium}=await import(pathToFileURL(resolve(process.env.TH_PLAYWRIGHT)).href);
const server=createFixtureServer(config);await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true,executablePath:process.env.TH_BROWSER,args:['--enable-unsafe-swiftshader','--autoplay-policy=no-user-gesture-required']});
const reports=[];
try{
 for(const game of (process.env.TH_GAME?[process.env.TH_GAME]:['th10','th08'])){
  const context=await browser.newContext({viewport:{width:960,height:720},serviceWorkers:'block'});
  // Never contact production services during a local validation run.
  await context.route('**/*',route=>route.request().url().startsWith(origin)||route.request().url().startsWith('blob:')?route.continue():route.abort());
  const page=await context.newPage();
  page.on('console',m=>{if(m.type()==='error')console.log('browser console:',m.text());});
  await page.goto(origin+'/__fixture/setup.html');
  await page.evaluate(async g=>{const {seedFixture}=await import('/__fixture/seed.mjs');await seedFixture(g);},game);
  // This lane tests Runtime integration, not the independently tested notice UI.
  await page.evaluate(()=>localStorage.setItem('eagler-touhou-first-use-notice-seen-v1','1'));
  for(const music of (process.env.TH_MUSIC?[process.env.TH_MUSIC]:['ogg-stream','ogg-full','none'])){
   const report={game,music,errors:[],stages:[]};reports.push(report);
   const onError=e=>report.errors.push(e.message);page.on('pageerror',onError);
   await page.goto(origin+'/?game='+game);
   await page.waitForFunction(()=>window.__eaglerBoot?.done===true,null,{timeout:60000});
   await page.evaluate(()=>{document.querySelector('#firstUseNoticeDialog')?.close();window.__sdlEvents=[];addEventListener('message',e=>{if(e.data?.protocol==='eagler-touhou/1')window.__sdlEvents.push(e.data);});});
   await page.locator('[data-game='+game+']').first().click();
   await page.evaluate(mode=>{const select=document.querySelector('#musicSelect');if(!Array.from(select.options).some(o=>o.value===mode))throw Error('Unavailable music option: '+mode);select.value=mode;select.dispatchEvent(new Event('change',{bubbles:true}));},music);
   const movement=music==='ogg-full'?'joystick':music==='none'?'touch-unlimited':'touch';
   await page.evaluate(mode=>{const select=document.querySelector('#touchMovementMode');select.value=mode;select.dispatchEvent(new Event('change',{bubbles:true}));},movement);
   if(await page.locator('#decisionDialog').evaluate(e=>e.open)){await page.locator('#decisionConfirm').click();await page.waitForFunction(()=>!document.querySelector('#decisionDialog').open);}
   await page.evaluate(()=>{const button=document.querySelector('#touchToggle');if(button.getAttribute('aria-checked')!=='true')button.click();});
   if(await page.locator('#decisionDialog').evaluate(e=>e.open)){await page.locator('#decisionConfirm').click();await page.waitForFunction(()=>!document.querySelector('#decisionDialog').open);}
   await page.locator('#launch').click();
   try{
    await page.waitForFunction(()=>window.__sdlEvents.some(e=>e.event==='first-frame'),null,{timeout:120000});
   }catch(e){report.playerStatus=await page.locator('#playerStatus').textContent();report.events=await page.evaluate(()=>window.__sdlEvents);await page.screenshot({path:resolve(out,game+'-'+music+'-error.png')});throw e;}
   const frame=page.frames().find(f=>f.url().includes('/runtime/'+game+'/'));assert(frame,'canonical Runtime iframe');
   assert(frame.url().includes('managedData=1'));
   await page.waitForTimeout(8000);
   report.title=await frame.evaluate(g=>{const r=window['__'+g+'Runtime'],p=r.core.sdl_audio_stats();return {status:r.status(),music:r.Module.touhouMusicMode,options:r.Module.eaglerOptions,audio:Array.from(new Uint32Array(r.core.memory.buffer,p,12)),musicStats:Array.from(new Uint32Array(r.core.memory.buffer,r.core.sdl_music_stats(),6)),rms:new Float32Array(r.core.memory.buffer,p+40,1)[0],mounts:r.Module.FS.readdir('/game'),oggFiles:r.Module.FS.analyzePath('/bgm-ogg').exists?r.Module.FS.readdir('/bgm-ogg'):[]};},game);
   assert.equal(report.title.music,music==='none'?'none':'ogg');
   assert.equal(report.title.options.oggDecodeMode,music==='ogg-full'?'full':'stream');
   assert.equal(report.title.options.touchMovementMode,movement);
   assert(report.title.mounts.includes(game+'.dat'));
   await page.screenshot({path:resolve(out,game+'-'+music+'-title.png')});
   if(music==='none')assert.equal(report.title.rms,0,'BGM off must be silent on idle title');else assert(report.title.rms>0,'OGG title produces PCM');
   const send=async fields=>page.evaluate(({game,fields})=>document.querySelector('#gameFrame').contentWindow.postMessage({protocol:'eagler-touhou/1',game,...fields},location.origin),{game,fields});
   if(music==='ogg-stream'){
    // Keep the already-open title source alive, but delay every future track.
    // Selection stays game-owned; the test does not guess retail track indices.
    await frame.evaluate(g=>{const fs=window['__'+g+'Runtime'].Module.FS;window.__delayedOgg=fs.readdir('/bgm-ogg').filter(n=>n.endsWith('.ogg')).map(n=>{const path='/bgm-ogg/'+n,bytes=fs.readFile(path);fs.unlink(path);return {path,bytes};});},game);
    await send({command:'touch-controls',fireEnabled:false,focusEnabled:false,bombSerial:0,escapeSerial:0,joystickX:0,joystickY:0});
   }
   for(let step=0;step<8;step++){
    const status=await frame.evaluate(g=>window['__'+g+'Runtime'].status(),game);report.stages.push(status);if(status[5]===1)break;
    await send({command:'keyboard',code:'KeyZ',down:true});await page.waitForTimeout(100);await send({command:'keyboard',code:'KeyZ',down:false});await page.waitForTimeout(1300);
   }
   await frame.waitForFunction(g=>window['__'+g+'Runtime'].status()[5]===1,game,{timeout:45000});
   if(music==='ogg-stream'){
    await frame.waitForFunction(g=>{const r=window['__'+g+'Runtime'];return new Uint32Array(r.core.memory.buffer,r.core.sdl_music_stats(),6)[3]>0;},game,{timeout:15000});
    report.pendingBeforeDelivery=await frame.evaluate(g=>{const r=window['__'+g+'Runtime'];return Array.from(new Uint32Array(r.core.memory.buffer,r.core.sdl_music_stats(),6));},game);
    await frame.evaluate(g=>{const r=window['__'+g+'Runtime'];for(const late of window.__delayedOgg)r.Module.FS.writeFile(late.path,late.bytes);},game);
    await frame.waitForFunction(g=>{const r=window['__'+g+'Runtime'],p=r.core.sdl_audio_stats();return new Uint32Array(r.core.memory.buffer,r.core.sdl_music_stats(),6)[3]===0&&new Float32Array(r.core.memory.buffer,p+40,1)[0]>0;},game,{timeout:15000});
    report.lateOggRecovered=true;
   }
   const player=()=>frame.evaluate(g=>{const r=window['__'+g+'Runtime'],c=r.core,p=(g==='th10'?c.graphics_allocate:c.allocate)(48);try{(g==='th10'?c.application_touch_state:c.touch_state)(r.app,p);return Array.from(new Float32Array(c.memory.buffer,p+12,2));}finally{(g==='th10'?c.graphics_free:c.deallocate)(p);}},game);
   await page.waitForTimeout(500);report.playerBefore=await player();
   if(movement==='joystick'){
    await page.locator('#touchJoystick').evaluate(e=>{const r=e.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;for(const [type,cx] of [['pointerdown',x],['pointermove',x+r.width/2]])e.dispatchEvent(new PointerEvent(type,{pointerId:44,pointerType:'touch',clientX:cx,clientY:y,bubbles:true,cancelable:true}));});
    await page.waitForTimeout(300);report.playerMoved=await player();assert(report.playerMoved[0]>report.playerBefore[0]+5,'canonical joystick moves player right');
    // Headless pages remain visible when opening another tab. Drive the actual
    // blur handler with an explicit lost-focus state instead of relying on it.
    await page.evaluate(async()=>{const old=Object.getOwnPropertyDescriptor(document,'hasFocus');Object.defineProperty(document,'hasFocus',{value:()=>false,configurable:true});window.dispatchEvent(new Event('blur'));await Promise.resolve();if(old)Object.defineProperty(document,'hasFocus',old);else delete document.hasFocus;});
    await page.waitForTimeout(100);assert.equal(await page.locator('#touchJoystick').evaluate(e=>e.classList.contains('active')),false,'host clears joystick pointer and visual');
    report.afterBlur=await player();await page.waitForTimeout(300);report.afterResume=await player();
    assert(Math.abs(report.afterResume[0]-report.afterBlur[0])<1,'blur cannot restore stale joystick');
    assert(report.afterBlur[0]<(game==='th10'?174:366),'boundary clamping cannot hide stuck input');
    report.syntheticBlurCleared=true;
   }else{
    await send({command:'direct-touch',type:'down',id:9,x:.45,y:.70});await page.waitForTimeout(100);
    await send({command:'direct-touch',type:'move',id:9,x:.60,y:.55});await page.waitForTimeout(150);
    report.playerMoved=await player();assert(report.playerMoved.some((v,i)=>Math.abs(v-report.playerBefore[i])>5),'direct drag moves player');
    report.drag=await frame.evaluate(g=>window['__'+g+'Runtime'].status(),game);assert.equal(report.drag[6],1,'direct drag is active');
    await send({command:'touch-cancel'});await page.waitForTimeout(100);
    report.cancel=await frame.evaluate(g=>window['__'+g+'Runtime'].status(),game);assert.equal(report.cancel[6],0,'cancel releases drag');
   }
   await send({command:'keyboard',code:'KeyZ',down:true});await page.waitForTimeout(3000);
   report.shootingRms=[];for(let i=0;i<8;i++){await page.waitForTimeout(100);report.shootingRms.push(await frame.evaluate(g=>{const r=window['__'+g+'Runtime'];return new Float32Array(r.core.memory.buffer,r.core.sdl_audio_stats()+40,1)[0];},game));}
   assert(report.shootingRms.some(v=>v>0),'SFX remain audible, including music none');
   await send({command:'keyboard-clear'});
   report.end=await frame.evaluate(g=>{const r=window['__'+g+'Runtime'],p=r.core.sdl_audio_stats();return {status:r.status(),audio:Array.from(new Uint32Array(r.core.memory.buffer,p,12)),rms:new Float32Array(r.core.memory.buffer,p+40,1)[0],error:document.querySelector('#error').textContent};},game);
   report.events=await page.evaluate(()=>window.__sdlEvents.filter(e=>['error','frame-health','audio-health'].includes(e.event)));
   assert.equal(report.end.status[2],0);assert.equal(report.end.error,'');assert.deepEqual(report.errors,[]);
   assert(!report.events.some(e=>e.event==='error'));assert(report.events.filter(e=>e.event==='frame-health').some(e=>e.fps>30));
   await page.screenshot({path:resolve(out,game+'-'+music+'-stage1.png')});
   report.passed=true;console.log(JSON.stringify({game,music,passed:true,titleRms:report.title.rms,stageRms:report.end.rms}));
   page.off('pageerror',onError);
  }
  await context.close();
 }
}finally{writeFileSync(resolve(out,'results.json'),JSON.stringify(reports,null,2));await browser.close();await new Promise(r=>server.close(r));}
