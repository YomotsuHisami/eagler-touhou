#!/usr/bin/env node
/** Explicit local performance/browser acceptance over a real current publication.
 * No generated site, fake Host, browser certificate bypass, or native game claim. */
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import lighthouse from 'lighthouse';
import desktopConfig from 'lighthouse/core/config/desktop-config.js';
import {computeMedianRun} from 'lighthouse/core/lib/median-run.js';
import puppeteer from 'puppeteer-core';
import {findChromiumExecutable} from '../lib/chromium-executable.mjs';
import {isProductId,isMultiplayerProductId,productEnabledForBuild} from '../lib/contracts/product-catalog.mjs';
import {validateHostManifest} from '../lib/contracts/host-manifest.mjs';
import {createUiDeploymentContract} from './ui-deployment-contract.mjs';
const project=resolve(fileURLToPath(new URL('..',import.meta.url)));
if(process.argv.includes('--help')){
 console.log('Usage: npm run verify:practice -- --url=http[s]://LOOPBACK/MOUNT/ [--diagnostic=0|1] [--profile=reference|standard] [--runs=1|3|5|7|9] [--report=PATH_OUTSIDE_SOURCE]');
 process.exit(0);
}
const args=Object.fromEntries(process.argv.slice(2).map(value=>{
 const match=value.match(/^--(url|diagnostic|profile|report|runs)=(.*)$/);if(!match)throw Error(`Invalid option: ${value}`);return [match[1],match[2]];
}));
const targetValue=args.url||process.env.EAGLER_NATIVE_SITE_URL;
if(!targetValue)throw Error('An explicit assembled loopback --url or EAGLER_NATIVE_SITE_URL is required; source/development metadata is not a release fixture');
const target=new URL(targetValue);
const local=hostname=>['localhost','127.0.0.1','[::1]'].includes(hostname);
if(!['http:','https:'].includes(target.protocol)||!local(target.hostname)||target.username||target.password||!target.pathname.endsWith('/')||target.search||target.hash)throw Error('Use an uncredentialed assembled loopback mount URL ending in /');
if(args.diagnostic!==undefined&&!['0','1'].includes(args.diagnostic))throw Error('--diagnostic must be0 or1');
const diagnostic=args.diagnostic==='1',profile=args.profile||'reference',runCount=Number(args.runs||5);
if(!['reference','standard'].includes(profile))throw Error('--profile must be reference or standard');
if(!Number.isInteger(runCount)||runCount<1||runCount>9||runCount%2===0)throw Error('--runs must be an odd integer from1 to9');
const reportPath=resolve(args.report||resolve(tmpdir(),'eagler-touhou-verified-in-practice.json'));
if(reportPath.toLowerCase()===project.toLowerCase()||reportPath.toLowerCase().startsWith(project.toLowerCase()+sep))throw Error('Reports are evidence artifacts and must be outside the source repository');
const referenceConfig=structuredClone(desktopConfig);
if(profile==='reference')referenceConfig.settings.throttling={...referenceConfig.settings.throttling,rttMs:10,throughputKbps:40_960};
async function metadata(name){const response=await fetch(new URL(name,target),{redirect:'error',signal:AbortSignal.timeout(15000)});if(!response.ok)throw Error(`${name}: HTTP${response.status}`);return response.json();}
const publication=await metadata('ui-publication.json'),host=validateHostManifest(await metadata('host-manifest.json'));
if(publication.schema!=='eagler-touhou/ui-publication/1'||!['react-main','experimental-opt-in'].includes(publication.status)||host.shared.runtimeManifest!=='runtime-manifest.json')throw Error('A current assembled publication with immutable Runtime metadata is required');
const navigation=createUiDeploymentContract(publication.navigation);
if(navigation.mountPath!==target.pathname||publication.mountPath!==target.pathname)throw Error('Publication mount differs from --url');
if(!Array.isArray(publication.products)||publication.products.some(id=>!isProductId(id)||!productEnabledForBuild(id,publication.testBuild===true)))throw Error('Invalid published product membership');
if(!publication.products.some(id=>!isMultiplayerProductId(id))||!publication.products.some(isMultiplayerProductId))throw Error('The full browsing acceptance needs published singleplayer and multiplayer products');
if(host.shared.netplayRelay){const relay=new URL(host.shared.netplayRelay);if(!['ws:','wss:'].includes(relay.protocol)||!local(relay.hostname)||relay.username||relay.password)throw Error('Browser acceptance must not connect to a non-loopback relay');}

async function runAgenticChecks(browser,base,publication){
 const checks=[];
 async function scenario(name,action){
  const context=await browser.createBrowserContext(),page=await context.newPage(),errors=[];
  page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});page.on('pageerror',error=>errors.push(error.message));
  try{
   await page.evaluateOnNewDocument(()=>{localStorage.clear();localStorage.setItem('eagler-touhou-first-use-notice-seen-v1','1');localStorage.setItem('eagler-touhou-site-notice-enabled-v1','0');});
   await page.goto(new URL('?uiLocale=en',base).href,{waitUntil:'networkidle0',timeout:30000});
   await page.waitForSelector('[data-library-product]',{visible:true});
   await page.waitForFunction(expected=>JSON.stringify([...document.querySelectorAll('[data-library-product]')].map(x=>x.dataset.libraryProduct).sort())===JSON.stringify([...expected].sort()),{},publication.products);
   await action(page);assert.deepEqual(errors,[],`${name} browser errors`);checks.push({name,pass:true});
  }finally{await context.close();}
 }
 await scenario('catalog-discovery',async page=>{
  const products=await page.$$eval('[data-library-product]',elements=>elements.map(element=>element.dataset.libraryProduct));
  assert.deepEqual(products.sort(),[...publication.products].sort());
  assert.equal(await page.$('[data-library-product="th20"]'),null);
  assert.equal(await page.$('[data-runtime-host] iframe')!==null,true);
 });
 await scenario('single-player-flow',async page=>{
  const product=publication.products.find(id=>!isMultiplayerProductId(id)),selector=`[data-library-product="${product}"]`;
  // The first activation may select a non-default cover; the second opens it.
  await page.click(selector);
  if(!await page.$('[data-product-management]'))await page.click(selector);
  await page.waitForSelector('[data-game-settings]',{visible:true});
  await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(button=>button.getClientRects().length&&/^(Prepare game resources|Prepare \/ repair game resources|Keep current version)$/.test(button.textContent.trim())));
 });
 await scenario('multiplayer-flow',async page=>{
  const product=publication.products.find(isMultiplayerProductId);
  await page.click(`[data-library-product="${product}"]`);await page.waitForSelector('[data-game-settings]',{visible:true});
  const lobby=`a[href="${base.pathname}lobby?game=${product}"]`;await page.click(lobby);
  await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(button=>button.getClientRects().length&&button.textContent.trim()==='Enter room code'));
  const actions=await page.$$eval('button',elements=>elements.filter(element=>element.getClientRects().length).map(element=>element.textContent.trim()));
  assert.ok(actions.includes('Create room'));assert.ok(actions.includes('Enter room code'));
  const join=await page.$$('button');for(const button of join){if(await button.evaluate(element=>element.textContent.trim()==='Enter room code')){await button.click();break;}}
  await page.waitForSelector('[role="dialog"] input[inputmode="numeric"]',{visible:true});
 });
 return checks;
}
const workRoot=await mkdtemp(resolve(tmpdir(),'eagler-verified-in-practice-'));let browser;
try{
 browser=await puppeteer.launch({executablePath:await findChromiumExecutable(),headless:true,userDataDir:resolve(workRoot,'chrome-profile'),
  args:['--disable-extensions','--no-first-run','--no-default-browser-check']});
  const endpoint = new URL(browser.wsEndpoint());
  const results = [];
  for (let attempt = 1; attempt <= runCount; attempt += 1) {
    const result = await lighthouse(target.href, {
      port: Number(endpoint.port),
      logLevel: "silent",
      output: "json",
      onlyCategories: ["performance", "accessibility", "best-practices", "seo"],
    }, referenceConfig);
    if (!result) throw new Error(`Lighthouse produced no result for run ${attempt}`);
    results.push(result.lhr);
  }
  const representative = computeMedianRun(results);
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(representative, null, 2)}\n`);
  const categories = Object.fromEntries(Object.entries(representative.categories).map(([id, category]) => [id, Math.round(category.score * 100)]));
  const metricIds = ["first-contentful-paint", "largest-contentful-paint", "speed-index", "total-blocking-time", "cumulative-layout-shift"];
  const metrics = Object.fromEntries(metricIds.map(id => [id, {
    score: Math.round((representative.audits[id].score ?? 0) * 100),
    value: representative.audits[id].displayValue || "",
  }]));
  const agenticChecks = await runAgenticChecks(browser, target, publication);
  const throttling = referenceConfig.settings.throttling;
  const summary = {
    verifiedInPractice: "PASS",
    profile,
    target: target.href,
    nativeRuntime: false,
    certificateValidation: "ordinary-browser-validation",
    runs: results.map((run, index) => ({
      attempt: index + 1,
      performance: Math.round(run.categories.performance.score * 100),
      totalBlockingTimeMs: Math.round(run.audits["total-blocking-time"].numericValue || 0),
    })),
    network: { rttMs: throttling.rttMs, throughputKbps: throttling.throughputKbps },
    categories,
    metrics,
    agenticChecks,
    report: reportPath,
  };
  const failures = [
    ...Object.entries(categories).filter(([, score]) => score !== 100).map(([id, score]) => `${id}=${score}`),
    ...Object.entries(metrics).filter(([, value]) => value.score !== 100).map(([id, value]) => `${id}=${value.score}`),
  ];
  if (failures.length) {
    summary.verifiedInPractice = diagnostic ? "DIAGNOSTIC" : "FAIL";
    if (!diagnostic) throw new Error(`Verified In Practice score gate failed: ${failures.join(", ")}\n${JSON.stringify(summary, null, 2)}`);
  }
  console.log(JSON.stringify(summary, null, 2));
} finally {
  if (browser) await browser.close().catch(() => {});
  await rm(workRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => {});
}
