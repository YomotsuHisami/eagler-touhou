// Browser acceptance for build-gated cards using real compiled Launcher modules.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import puppeteer from 'puppeteer-core';
import {findChromiumExecutable} from '../lib/chromium-executable.mjs';
import {FRONTEND_PACKAGE_FILES,resolveFrontendPackageSource} from '../lib/frontend-manifest.mjs';
import {PRODUCT_GAMES,PRODUCT_IDS} from '../lib/contracts/product-catalog.mjs';
import {launcherTestFiles} from './support/launcher-target.mjs';
const files=await launcherTestFiles(new Map(FRONTEND_PACKAGE_FILES.map(name=>['/'+name,resolveFrontendPackageSource(name)])));
const games=Object.fromEntries(Object.entries(PRODUCT_GAMES).map(([id,p])=>[id,{
  runtime:p.runtime,...(p.multiplayerRuntime?{multiplayerRuntime:p.multiplayerRuntime}:{}),
  gameData:{path:p.package.dataTarget.slice(1),bytes:1,sha256:'a'.repeat(64),version:'sha256-'+'a'.repeat(64),layout:'sha256-'+'b'.repeat(64)},
  music:{midi:{files:[]}},offlineCompatibility:{schema:'eagler-touhou/offline-game-pack/1',runtimeCompatibility:{protocol:'eagler-touhou/1',dataLayout:'sha256-'+'b'.repeat(64),versionSource:'offline-pack'},requiredShared:p.requiredShared??['/msgothic.ttc','/unifont.otf'],languages:{source:'offline-pack',baseline:['ja']}}
}]));
let flag,metadataFailure=false;
const server=createServer(async(req,res)=>{
  try{
    const path=new URL(req.url,'http://localhost').pathname;
    if(path==='/host-manifest.json'){
      if(metadataFailure){res.writeHead(503).end();return;}
      res.setHeader('Content-Type','application/json');res.end(JSON.stringify({schema:'eagler-touhou/host-manifest/1',protocol:'eagler-touhou/1',profile:'web-release-import',shared:{resourceMode:'import',...(flag===undefined?{}:{testBuild:flag})},games}));return;
    }
    if(path==='/release-catalog.json'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({schema:'eagler-touhou/release-catalog/1',games:{}}));return;}
    const file=files.get(path==='/'?'/index.html':path);if(!file){res.writeHead(404).end();return;}
    assert((await stat(file)).size<16*1024*1024);
    res.setHeader('Content-Type',/\.m?js$/.test(path)?'text/javascript':/\.css$/.test(path)?'text/css':path==='/'?'text/html':'application/octet-stream');
    res.end(await readFile(file));
  }catch{res.writeHead(500).end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const url=`http://127.0.0.1:${server.address().port}/`,checks=[],errors=[];let browser;
try{
  browser=await puppeteer.launch({
    executablePath:await findChromiumExecutable(),
    headless:true,
    args:['--disable-extensions','--no-first-run','--no-default-browser-check'],
  });
  for(const scenario of [{name:'production',flag:false},{name:'test-manifest-without-query',flag:true},{name:'test-query',flag:false,query:true},{name:'test-query-empty',flag:false,query:true,empty:true},{name:'missing',flag:undefined},{name:'invalid-string',flag:'true'},{name:'metadata-failure',failure:true}]){
    console.log('card scenario',scenario.name);
    flag=scenario.flag;metadataFailure=!!scenario.failure;
    const context=await browser.createBrowserContext(),page=await context.newPage();
    await page.setBypassServiceWorker(true);
    await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}]);
    page.on('pageerror',error=>errors.push(String(error)));
    await page.goto(url+'?debug=card-gate&game=th15'+(scenario.query?'&test='+(scenario.empty?'':'th15'):''));
    await page.waitForFunction(()=>window.__eaglerBoot?.done===true);
    await page.waitForNetworkIdle({idleTime:200,timeout:15000});
    await page.evaluate(()=>document.querySelector('#firstUseNoticeDialog')?.close());
    await page.waitForFunction(()=>document.querySelector('.game[data-game=th06]').hasAttribute('aria-current'));
    await page.waitForFunction(()=>!document.querySelector('.game[data-game=th10]').hidden);
    const testVisible=scenario.flag===true||!!scenario.query;
    const expected=PRODUCT_IDS.filter(product=>product!=='th20'||testVisible);
    const visible=()=>page.$$eval('.game:not([hidden])',cards=>cards.map(c=>c.dataset.product||c.dataset.game));
    assert.deepEqual(await visible(),expected);
    assert.equal(await page.$eval('.game[data-game=th20]',card=>card.hidden),!testVisible);
    assert.equal(await page.$eval('.game[data-game=th15]',card=>card.hidden),false);
    if(testVisible){
      await page.$eval('.game[data-game=th15]',card=>{card.click();card.click();});
      assert.equal(await page.$eval('#gameId',element=>element.textContent),'TH15');
      await page.$eval('#libraryBack',button=>button.click());
    }
    assert.equal(await page.$eval('.game[data-game=th11]',card=>card.hidden),false);
    for(const game of ['th10']){
      await page.$eval(`.game[data-game=${game}]`,card=>card.click());
      await page.$eval(`.game[data-game=${game}]`,card=>card.click());
      await page.waitForFunction(()=>document.querySelector('.tools').getAttribute('aria-hidden')==='false');
      assert.equal(await page.$eval('.tools',element=>element.getAttribute('aria-hidden')),'false');
    }
    await page.$eval('.game[data-game=th08]',card=>card.click());
    await page.$eval('.game[data-game=th08]',card=>card.click());
    assert.equal(await page.$eval('.tools',element=>element.getAttribute('aria-hidden')),'false');
    assert.equal(await page.$eval('#gameId',element=>element.textContent),'TH08');
    await page.$eval('#libraryBack',button=>button.click());
    assert.equal(await page.$('#cardFilterBar'),null);
    assert.deepEqual(await visible(),expected);
    await page.reload();await page.waitForFunction(()=>document.querySelector('.game[data-game=th06]').hasAttribute('aria-current'));
    await page.waitForFunction(()=>!document.querySelector('.game[data-game=th10]').hidden);
    assert.deepEqual(await visible(),expected);
    checks.push(scenario.name+': ordinary TH08 selection, TH10 visibility, direct route, library return and reload');await context.close();
  }
  const context=await browser.createBrowserContext(),page=await context.newPage();await page.setJavaScriptEnabled(false);await page.goto(url);
  const visible=selector=>page.$eval(selector,element=>!element.hidden&&element.getBoundingClientRect().width>0&&element.getBoundingClientRect().height>0);
  assert.equal(await visible('.game[data-game=th08]'),true);assert.equal(await visible('.game[data-game=th10]'),true);
  assert.equal(await visible('.game[data-game=th20]'),false);
  assert.equal(await visible('.game[data-game=th15]'),true);
  assert.equal(await visible('.game[data-game=th11]'),true);
  checks.push('static HTML keeps ordinary TH08 and formal TH10 visible before JavaScript');await context.close();
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({ok:true,checks,errors},null,2));
}finally{await browser?.close();await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});}
