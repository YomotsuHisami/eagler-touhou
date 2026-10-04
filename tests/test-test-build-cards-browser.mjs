/** Actual Framework card-membership gate over sealed synthetic publications.
 * No native Runtime starts; invalid metadata cannot expose hidden products. */
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import puppeteer from 'puppeteer-core';
import {findChromiumExecutable} from '../lib/chromium-executable.mjs';
import {PRODUCT_GAMES,PRODUCT_IDS,productEnabledForBuild} from '../lib/contracts/product-catalog.mjs';
import {createPublishedSiteServer} from '../server/ui-static-server.mjs';
import {buildCurrentProtocolFixture} from './support/build-current-protocol-fixture.mjs';
const temporary=await mkdtemp(join(tmpdir(),'current-card-gates-')),errors=[],checks=[];
let browser;
try{
 browser=await puppeteer.launch({executablePath:await findChromiumExecutable(),headless:true,args:['--disable-extensions','--no-first-run']});
 for(const scenario of [{name:'production',flag:false},{name:'test',flag:true},{name:'missing',missing:true},{name:'invalid-marker',invalid:true},{name:'metadata-failure',failure:true},{name:'host-subset',games:['th06','th09']}]){
  const root=join(temporary,scenario.name),games=scenario.games??Object.keys(PRODUCT_GAMES);
  const built=await buildCurrentProtocolFixture({output:root,games,testBuild:scenario.flag===true,ogg:false});
  const marker=JSON.parse(await readFile(join(root,'ui-publication.json'),'utf8'));
  if(scenario.missing){const host=JSON.parse(await readFile(join(root,'host-manifest.json'),'utf8'));delete host.shared.testBuild;await writeFile(join(root,'host-manifest.json'),JSON.stringify(host));}
  if(scenario.invalid){marker.testBuild='true';marker.products.push('th20');await writeFile(join(root,'ui-publication.json'),JSON.stringify(marker));}
  const server=await createPublishedSiteServer({root,middleware:async(_request,response,url)=>{
   if(scenario.failure&&url.pathname===built.mountPath+'host-manifest.json'){response.writeHead(503,{'cache-control':'no-store'}).end('intentional metadata failure');return true;}return false;
  }});
  await new Promise(done=>server.listen(0,'127.0.0.1',done));
  const base=`http://127.0.0.1:${server.address().port}${built.mountPath}`;
  const context=await browser.createBrowserContext(),page=await context.newPage();
  try{
   await page.evaluateOnNewDocument(()=>{localStorage.setItem('eagler-touhou-first-use-notice-seen-v1','1');localStorage.setItem('eagler-touhou-site-notice-enabled-v1','0');});
   await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}]);
   page.on('pageerror',error=>errors.push(String(error)));
   await page.goto(base+'?uiLocale=en');
   await page.waitForFunction(()=>{const probe=document.querySelector('[data-ui-app-shell]');return document.documentElement.dataset.uiLocale==='en'&&!!probe&&probe.dataset.shellPhase!=='checking'&&!!document.querySelector('[data-library-product]');});
   if(scenario.invalid)assert.equal(await page.$eval('[data-ui-app-shell]',element=>element.dataset.shellPhase),'error');
   const expected=scenario.invalid?PRODUCT_IDS.filter(id=>productEnabledForBuild(id,false)).sort():[...marker.products].sort();
   const visible=()=>page.$$eval('[data-library-product]',cards=>cards.map(card=>card.dataset.libraryProduct).sort());
   await page.waitForFunction(expected=>JSON.stringify([...document.querySelectorAll('[data-library-product]')].map(card=>card.dataset.libraryProduct).sort())===JSON.stringify(expected),{},expected);
   assert.deepEqual(await visible(),expected);assert.equal(await page.$('[data-library-product="th20"]'),null);
   const target=games.includes('th10')?'th10':'th06';
   await page.goto(new URL(`play/${target}?uiLocale=en`,base).href);
   await page.waitForSelector('[data-product-management="'+target+'"]');
   assert.equal(await page.$eval('[data-dialog-layout="library-panel"]',element=>element.getAttribute('role')),'dialog');
   await page.click('[data-dialog-layout="library-panel"] button[aria-label="Back to library"]');
   await page.waitForFunction(()=>!document.querySelector('[data-dialog-layout="library-panel"]'));
   assert.deepEqual(await visible(),expected);
   await page.reload();await page.waitForFunction(expected=>JSON.stringify([...document.querySelectorAll('[data-library-product]')].map(card=>card.dataset.libraryProduct).sort())===JSON.stringify(expected),{},expected);
   assert.deepEqual(await visible(),expected);
   const html=await (await fetch(base)).text();assert.match(html,/window\.__reactRouterContext/);assert.doesNotMatch(html,/data-library-product="th20"|src="app\.js"/);
   checks.push(scenario.name);
  }finally{await context.close();await new Promise(done=>{server.close(done);server.closeAllConnections();});}
 }
 assert.deepEqual(errors,[]);console.log(JSON.stringify({currentPublicationCardGate:'PASS',checks,nativeRuntime:false}));
}finally{await browser?.close();await rm(temporary,{recursive:true,force:true});}
