import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile, mkdir} from 'node:fs/promises';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import puppeteer from 'puppeteer-core';

const root=resolve(dirname(fileURLToPath(import.meta.url)), '..');
const server=createServer(async(req,res)=>{
  try {
    const path=new URL(req.url,'http://localhost').pathname;
    if(path==='/') {
      res.setHeader('content-type','text/html; charset=utf-8');
      res.end('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><link rel="stylesheet" href="/styles.css"><main id="fixture" class="player open" style="background:#141413"><button class="orientation-toggle">横竖屏</button><button class="touch-help-open">帮助</button><button class="fullscreen-toggle">全屏</button></main>');
      return;
    }
    const target=path==='/styles.css'?resolve(root,'public/styles.css'):resolve(root,'.cache/build/browser',`.${path}`);
    assert.ok(target.startsWith(root));
    const source=await readFile(target,'utf8');
    res.setHeader('content-type',path.endsWith('.css')?'text/css':'text/javascript');res.end(source);
  }catch {res.writeHead(404);res.end();}
});
await new Promise(resolveReady=>server.listen(0,'127.0.0.1',resolveReady));
const browser=await puppeteer.launch({executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--no-first-run',...JSON.parse(process.env.CHROME_EXTRA_ARGS||'[]')]});
try {
  const page=await browser.newPage(), errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.setViewport({width:960,height:600});
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.evaluate(async()=>{
    const {MultiplayerQuickChat}=await import('/assets/launcher/multiplayer-quick-chat.mjs');
    const labels={'chat.players':'玩家发言','chat.back':'返回快捷发言','chat.prompt':'点这里快捷发言','chat.mute':'屏蔽发言','chat.unmute':'恢复发言','chat.empty':'发言内容待定'};
    window.sent=[];
    window.chat=new MultiplayerQuickChat(document.querySelector('#fixture'),key=>labels[key],message=>window.sent.push(message));
    window.ctx={visible:true,room:'th08mp-test',serial:1,localSeat:0,connected:true,language:'zh-CN',seats:[{clientId:'a',name:'本机'},{clientId:'b',name:'<img src=x onerror=alert(1)>'}]};
    window.chat.update(window.ctx);
    window.message={type:'quick-chat',room:'th08mp-test',serial:1,seat:1,clientId:'b',phrase:'1'};
    for(const change of [{serial:0},{room:'wrong'},{clientId:'a'},{seat:99},{phrase:'unknown'}])window.chat.receive({...window.message,...change});
    window.chat.receive(window.message);
  });
  assert.equal(await page.$eval('.mp-quick-chat-log',el=>el.children.length),1);
  assert.equal(await page.$eval('.mp-quick-chat-log',el=>el.querySelectorAll('img').length),0);
  await page.click('.mp-quick-chat-prompt');
  assert.deepEqual(await page.$$eval('.mp-quick-chat-picker:not([hidden]) button',els=>els.map(el=>[el.textContent,el.disabled])),[['1',false],['屏蔽发言',false]]);
  await page.click('.mp-quick-chat-phrase');
  assert.deepEqual(await page.evaluate(()=>window.sent),[{type:'quick-chat',phrase:'1',serial:1}]);
  await page.click('.mp-quick-chat-prompt');
  await page.click('.mp-quick-chat-mute');
  await page.click('.mp-quick-chat-mute-member');
  await page.evaluate(()=>window.chat.receive(window.message));
  assert.equal(await page.$eval('.mp-quick-chat-log',el=>el.children.length),0);
  await page.click('.mp-quick-chat-mute-member');
  assert.equal(await page.$eval('.mp-quick-chat-log',el=>el.children.length),2);
  await page.click('.mp-quick-chat-mute');
  await page.click('.mp-quick-chat-prompt');
  await page.evaluate(()=>{for(let n=0;n<60;++n)window.chat.receive(window.message);});
  assert.equal(await page.$eval('.mp-quick-chat-log',el=>el.children.length),50);
  await page.$eval('.mp-quick-chat-log',el=>{el.scrollTop=0;});
  await page.evaluate(()=>{window.chat.update({...window.ctx});window.chat.receive(window.message);});
  assert.equal(await page.$eval('.mp-quick-chat-log',el=>el.scrollTop),0,'reading older messages survives room updates and incoming messages');
  await page.click('.mp-quick-chat-prompt');
  await page.evaluate(()=>{
    const button=document.querySelector('.mp-quick-chat-phrase');
    button.focus();window.chat.update({...window.ctx});
    if(document.activeElement!==button)throw new Error('Room updates stole quick-chat keyboard focus');
  });
  const chromeLayout=()=>page.$eval('#fixture',el=>{
    const box=selector=>{const r=el.querySelector(selector).getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom};};
    const chat=el.querySelector('.mp-quick-chat'),style=getComputedStyle(chat);
    return {prompt:box('.mp-quick-chat-prompt'),log:box('.mp-quick-chat-log'),picker:box('.mp-quick-chat-picker:not([hidden])'),
      controls:['.orientation-toggle','.touch-help-open','.fullscreen-toggle'].map(box),background:style.backgroundColor,shadow:style.boxShadow};
  });
  const assertLayout=async()=>{
    const layout=await chromeLayout();
    assert.equal(layout.background,'rgba(0, 0, 0, 0)');assert.equal(layout.shadow,'none');
    for(const control of layout.controls){
      assert.ok(layout.prompt.bottom<control.y,'fixed quick-chat button is above player controls');
      assert.ok(layout.log.y>control.bottom&&layout.picker.y>control.bottom,'messages and picker clear the player controls');
    }
  };
  await assertLayout();
  const fixed=(await chromeLayout()).prompt;
  await page.mouse.move(fixed.x+10,fixed.y+10);await page.mouse.down();
  await page.mouse.move(fixed.x-120,fixed.y+90,{steps:5});await page.mouse.up();
  assert.deepEqual((await chromeLayout()).prompt,fixed,'quick-chat button cannot be dragged');
  await page.evaluate(()=>{
    window.ctx={...window.ctx,serial:7,seats:[{clientId:'a',name:'本机'},{clientId:'b',name:'队友'}]};
    window.chat.update(window.ctx);window.message={...window.message,serial:7};
    for(let n=0;n<3;++n)window.chat.receive(window.message);
  });
  const output=process.argv.find(x=>x.startsWith('--screenshots='))?.slice(14);
  if(output) {await mkdir(output,{recursive:true});await page.screenshot({path:resolve(output,'quick-chat-desktop.png')});}
  await page.setViewport({width:640,height:360});
  await page.click('.mp-quick-chat-prompt');
  const bounds=await page.$eval('.mp-quick-chat',el=>{const r=el.getBoundingClientRect();return [r.left,r.top,r.right,r.bottom];});
  assert.ok(bounds[0]>=0&&bounds[1]>=0&&bounds[2]<=640&&bounds[3]<=360);
  await assertLayout();
  await page.setViewport({width:360,height:640});
  await assertLayout();
  if(output)await page.screenshot({path:resolve(output,'quick-chat-mobile.png')});
  await page.evaluate(()=>window.chat.update({...window.ctx,localSeat:null}));
  assert.equal(await page.$eval('.mp-quick-chat-prompt',el=>el.disabled),false,'spectators can open the mute menu');
  assert.equal(await page.$eval('.mp-quick-chat-phrase',el=>el.disabled),true,'spectators cannot send phrases');
  assert.equal(await page.$eval('.mp-quick-chat-mute',el=>el.disabled),false);
  await page.evaluate(()=>window.chat.update({...window.ctx,serial:2}));
  assert.equal(await page.$eval('.mp-quick-chat-log',el=>el.children.length),0);
  assert.deepEqual(errors,[]);
  console.log('Multiplayer quick chat: sender/session validation, safe text, send, mute, scroll/focus stability, plain text, fixed button, portrait/landscape controls and spectator controls PASS');
}finally {await browser.close();await new Promise(done=>server.close(done));}
