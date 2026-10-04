/** Current Framework locale/font browser contract. No native Runtime claim.
 * Requires an existing loopback build preview or assembled publication. */
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
import {findChromiumExecutable} from '../lib/chromium-executable.mjs';

const base=new URL(process.argv.find(value=>value.startsWith('--url='))?.slice(6)||'http://127.0.0.1:8130/');
if(!['http:','https:'].includes(base.protocol)||!['localhost','127.0.0.1','[::1]'].includes(base.hostname)||base.username||base.password||!base.pathname.endsWith('/'))throw Error('Use --url for a loopback Framework mount ending in /');
let browser;
try {
 browser=await puppeteer.launch({executablePath:process.env.CHROME_PATH||await findChromiumExecutable(),headless:true,args:['--no-first-run']});
 const page=await browser.newPage(),failures=[],fontRequests=new Set();
 await page.evaluateOnNewDocument(()=>{localStorage.setItem('eagler-touhou-first-use-notice-seen-v1','1');localStorage.setItem('eagler-touhou-site-notice-enabled-v1','0');});
 page.on('pageerror',error=>failures.push(error.message));
 page.on('request',request=>{if(/\.woff2(?:$|\?)/.test(request.url()))fontRequests.add(request.url());});
 for(const [path,locale,title] of [['','zh-CN','东方Project 原作 STG'],['en.html','en','Touhou Project Original STGs']]){
  await page.goto(new URL(path,base).href,{waitUntil:'networkidle0'});
  await page.waitForSelector('[data-library-product]');
  await page.waitForFunction(locale=>document.documentElement.lang===locale&&document.documentElement.dataset.uiLocale===locale,{},locale);
  const state=await page.evaluate(async()=>{await document.fonts.ready;return {
   title:document.title,description:document.querySelector('meta[name="description"]')?.content,
   cards:document.querySelectorAll('[data-library-product]').length,
   font:document.fonts.check('400 14px "ET Chill Round"','东方'),frameCount:document.querySelectorAll('[data-runtime-host] iframe').length,
  };});
  assert.match(state.title,new RegExp(title));assert.ok(state.description);assert.ok(state.cards>=4);assert.equal(state.font,true);assert.equal(state.frameCount,1);
 }
 await page.click('summary[aria-label="More site information"]');
 await page.waitForSelector('select[aria-label="Interface language"]',{visible:true});
 await page.select('select[aria-label="Interface language"]','zh-CN');
 await page.waitForFunction(()=>document.documentElement.lang==='zh-CN'&&new URL(location.href).searchParams.get('uiLocale')==='zh-CN');
 await page.reload({waitUntil:'networkidle0'});
 await page.waitForFunction(()=>document.documentElement.lang==='zh-CN');
 assert.ok(fontRequests.size>0,'current bundled fonts must actually load');
 for(const request of fontRequests){const url=new URL(request);assert.equal(url.origin,base.origin);assert.ok(url.pathname.startsWith(base.pathname+'assets/'),request);}
 assert.deepEqual(failures,[]);
 console.log(JSON.stringify({localizedEntries:'PASS',languages:['zh-CN','en'],fonts:[...fontRequests],nativeRuntime:false}));
}finally{await browser?.close();}
