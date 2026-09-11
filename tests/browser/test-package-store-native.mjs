import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import puppeteer from "puppeteer-core";

const root = process.cwd();
const chrome = process.env.CHROME_PATH || process.env.PUPPETEER_EXECUTABLE_PATH || "/usr/bin/google-chrome";
const contentType = path => extname(path) === ".mjs" || extname(path) === ".js" ? "text/javascript" : extname(path) === ".json" ? "application/json" : "application/octet-stream";
const server = createServer(async (req,res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url || "/", "http://localhost").pathname);
    if (pathname === "/") { res.writeHead(200,{"content-type":"text/html"}); res.end("<!doctype html><title>package-store-native</title>"); return; }
    const browserModule = pathname.startsWith("/package/") || pathname === "/product-catalog.mjs" || pathname.startsWith("/assets/contracts/");
    const path = resolve(root, browserModule ? `.cache/build/browser${pathname}` : `.${pathname}`);
    if (!path.startsWith(root + sep)) throw new Error("outside root");
    const bytes = await readFile(path);
    res.writeHead(200,{"content-type":contentType(path),"cache-control":"no-store"}); res.end(bytes);
  } catch { res.writeHead(404); res.end("not found"); }
});
server.listen(0,"127.0.0.1");
await new Promise(resolveListen=>server.once("listening",resolveListen));
const port = server.address().port;
const browser = await puppeteer.launch({executablePath:chrome,headless:true,args:["--no-sandbox","--disable-dev-shm-usage"]});
try {
  const [a,b] = await Promise.all([browser.newPage(),browser.newPage()]);
  await Promise.all([a.goto(`http://127.0.0.1:${port}/`),b.goto(`http://127.0.0.1:${port}/`)]);
  await a.evaluate(async () => {
    const store=await import('/package/package-store.mjs');
    await new Promise((resolve,reject)=>{const r=indexedDB.deleteDatabase(store.PACKAGE_STORE_DB);r.onsuccess=()=>resolve();r.onerror=()=>reject(r.error);r.onblocked=()=>reject(Error('delete blocked'));});
  });
  const descriptorSource = `(revision, fileRevision, bytes=4, sha256=null) => ({schema:'eagler-touhou/package/1',game:'th06',revision,runtimeRequirement:{protocol:'eagler-touhou/1',target:'th06',dataFile:'data',dataLayout:'layout-test'},files:{data:{source:'game/data.bin',target:'/game/data.bin',revision:fileRevision,bytes,...(sha256?{sha256}:{})}},base:{files:['data']},components:{}})`;
  await a.evaluate(async source => {
    const installer=await import('/package/package-installer.mjs');
    const make=eval(source);
    await installer.installPackageFromAcquisition({descriptor:make('r1','d1'),desiredFileIds:['data'],source:'remote',reuseCurrent:false,acquire:async()=>new Uint8Array([1,2,3,4]).buffer});
  }, descriptorSource);
  const before = await a.evaluate(async()=>{const s=await import('/package/package-store.mjs');const x=await s.readCurrentPackageGeneration('th06');return {id:x.generation.id,objectId:x.generation.files.data.objectId,source:x.installation.source};});
  assert.equal(before.source,"remote");
  const leaseId="browser-test-active-r1";
  await a.evaluate(async ({id,leaseId})=>{const s=await import('/package/package-store.mjs');await s.retainPackageGeneration('th06',id,{leaseId});},{id:before.id,leaseId});

  await a.evaluate(source => {
    const make=eval(source);
    window.aDone=false;
    window.aPromise=(async()=>{const installer=await import('/package/package-installer.mjs');try{await installer.installPackageFromAcquisition({descriptor:make('r2-fail','d2-fail'),desiredFileIds:['data'],source:'local',reuseCurrent:false,acquire:async()=>new Promise((resolve,reject)=>{window.rejectAcquire=()=>reject(Error('injected acquire failure'));})});return 'unexpected-success';}catch(e){return String(e.message||e);}finally{window.aDone=true;}})();
  }, descriptorSource);
  await a.waitForFunction(()=>typeof window.rejectAcquire==='function');
  const staged = await b.evaluate(async()=>{
    const s=await import('/package/package-store.mjs');
    const installation=await s.readPackageInstallation('th06');
    return {source:installation.source,pendingSource:installation.pendingSource};
  });
  assert.deepEqual(staged,{source:'remote',pendingSource:'local'},
    'staging a local mutation must not rewrite the committed installation source');
  await b.evaluate(source => {
    const make=eval(source); window.bDone=false;
    window.bPromise=(async()=>{const installer=await import('/package/package-installer.mjs');const r=await installer.installPackageFromAcquisition({descriptor:make('r2','d2'),desiredFileIds:['data'],source:'remote',reuseCurrent:false,acquire:async()=>new Uint8Array([5,6,7,8]).buffer});window.bDone=true;return r.generation.descriptor.revision;})();
  }, descriptorSource);
  await new Promise(r=>setTimeout(r,250));
  assert.equal(await b.evaluate(()=>window.bDone),false,"second page must wait instead of replacing the first page staging state");
  await a.evaluate(()=>window.rejectAcquire());
  assert.match(await a.evaluate(()=>window.aPromise),/injected acquire failure/);
  assert.equal(await b.evaluate(()=>window.bPromise),"r2","waiting mutation must survive the first mutation's cleanup");
  const after = await b.evaluate(async()=>{const s=await import('/package/package-store.mjs');const x=await s.readCurrentPackageGeneration('th06');return {revision:x.generation.descriptor.revision,source:x.installation.source};});
  assert.deepEqual(after,{revision:"r2",source:"remote"});

  const kept = await b.evaluate(async ({oldObject})=>{const s=await import('/package/package-store.mjs');await s.garbageCollectPackageStore();return !!(await s.readPackageObject(oldObject));},{oldObject:before.objectId});
  assert.equal(kept,true,"leased generation must survive GC in another page");
  await a.evaluate(async leaseId=>{const s=await import('/package/package-store.mjs');await s.releasePackageGeneration(leaseId);},leaseId);
  const collected = await b.evaluate(async oldObject=>{const s=await import('/package/package-store.mjs');await s.garbageCollectPackageStore();return await s.readPackageObject(oldObject);},before.objectId);
  assert.equal(collected,null,"released old generation should become collectible");

  const cancelResult = await a.evaluate(async source=>{const installer=await import('/package/package-installer.mjs');const store=await import('/package/package-store.mjs');const make=eval(source);const c=new AbortController();let error='';try{await installer.installPackageFromAcquisition({descriptor:make('r3','d3'),desiredFileIds:['data'],source:'remote',reuseCurrent:false,signal:c.signal,acquire:async()=>new Uint8Array([9,9,9,9]).buffer,onProgress:()=>c.abort()});}catch(e){error=e.name;}const current=await store.readCurrentPackageGeneration('th06');return {error,revision:current.generation.descriptor.revision};},descriptorSource);
  assert.deepEqual(cancelResult,{error:"AbortError",revision:"r2"});

  const zeroSize = await a.evaluate(async source=>{const installer=await import('/package/package-installer.mjs');const make=eval(source);try{await installer.installPackageFromAcquisition({descriptor:make('zero','zero-data',0),desiredFileIds:['data'],source:'local',reuseCurrent:false,acquire:async()=>new Uint8Array([1,2,3,4]).buffer});return ''; }catch(e){return String(e.message||e);}},descriptorSource);
  assert.match(zeroSize,/size mismatch/i);
  const hashFailure = await a.evaluate(async source=>{const installer=await import('/package/package-installer.mjs');const make=eval(source);try{await installer.installPackageFromAcquisition({descriptor:make('hash','hash-data',4,'0'.repeat(64)),desiredFileIds:['data'],source:'local',reuseCurrent:false,acquire:async()=>new Uint8Array([1,2,3,4]).buffer});return ''; }catch(e){return String(e.message||e);}},descriptorSource);
  assert.match(hashFailure,/SHA-256 mismatch/);
  console.log(JSON.stringify({packageStoreNative:"PASS",crossDocumentOwnership:true,generationLease:true,lateCancel:true,zeroByteDeclaration:true,sha256:true}));
} finally { await browser.close(); server.close(); }
