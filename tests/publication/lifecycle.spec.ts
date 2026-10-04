import {test,expect} from '../ui-main/synthetic-ui-test';
import {previewFixture,publicationFixtures} from './fixture-addresses';
for(const {name,origin,mount} of publicationFixtures){
 test(`${name}: first install, offline deep reload and update defer preserve synthetic local data`,async({page,context},info)=>{
  await page.request.post(origin+'/__ci_publication__/select?version=a');
  await page.addInitScript(()=>{localStorage.setItem('eagler-touhou-first-use-notice-seen-v1','1');localStorage.setItem('eagler-touhou-site-notice-enabled-v1','0');});
  await page.goto(origin+mount+'?uiLocale=en');
  const shell=page.locator('[data-ui-app-shell]');await expect(shell).toHaveAttribute('data-offline-ready','true');
  await expect(page.locator('head link[rel="manifest"]')).toHaveAttribute('href',origin+mount+'site.webmanifest');
  const card=page.locator('a[data-library-product="th06"]');await expect(card).toHaveCount(1);
  await expect(page.locator('[data-library-product]')).toHaveCount(1);
  const target=new URL((await card.getAttribute('href'))!,origin);
  expect(target.origin).toBe(origin);expect(target.pathname).toBe(mount+'play/th06');
  expect(target.searchParams.get('uiLocale')).toBe('en');
  await expect(page.locator('[data-library-product="th07"]')).toHaveCount(0);
  await page.reload();await expect(shell).toHaveAttribute('data-offline-ready','true');
  expect(await page.evaluate(()=>navigator.serviceWorker.controller?.scriptURL)).toBe(origin+mount+'app-shell-sw.js');
  await page.evaluate(async()=>{
   await (await caches.open('publication-fixture-package-sentinel')).put('/synthetic-package-sentinel',new Response('fixture-package'));
   localStorage.setItem('publication-fixture-preference','keep');
   await new Promise<void>((resolve,reject)=>{const request=indexedDB.open('publication-fixture-save-sentinel',1);request.onupgradeneeded=()=>request.result.createObjectStore('saves');request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result,transaction=db.transaction('saves','readwrite');transaction.objectStore('saves').put('fixture-save','save');transaction.oncomplete=()=>{db.close();resolve();};transaction.onerror=()=>reject(transaction.error);};});
  });
  for(const path of ['assets/missing.js','games/th06/missing.data','play/th06/missing.wasm'])expect((await page.request.get(origin+mount+path,{headers:{Accept:'text/html'}})).status()).toBe(404);
  await context.setOffline(true);
  await page.goto(origin+mount+'play/th06/resources?uiLocale=en');await expect(shell).toHaveAttribute('data-offline-ready','true');
  await page.reload();await expect(shell).toHaveAttribute('data-offline-ready','true');
  expect(await page.evaluate(()=>localStorage.getItem('publication-fixture-preference'))).toBe('keep');
  await context.setOffline(false);
  // The library-level Help dialog is the only active sheet. A product sheet
  // underneath Help would correctly keep activation deferred after one Escape.
  await page.goto(origin+mount+'?uiLocale=en&panel=help');
  const help=page.getByRole('dialog',{name:'Controls and help',exact:true});await expect(help).toBeVisible();
  await page.request.post(origin+'/__ci_publication__/select?version=b');
  await page.evaluate(async()=>{const registration=await navigator.serviceWorker.getRegistration();if(!registration)throw Error('missing registration');await registration.update();});
  await expect(shell).toHaveAttribute('data-update-waiting','true');
  expect(await page.evaluate(async()=>{const registration=await navigator.serviceWorker.getRegistration();return registration?.waiting?.state;})).toBe('installed');
  const oldBuild=await page.evaluate(()=>performance.timeOrigin);
  await expect(help).toBeVisible();
  await page.keyboard.press('Escape');
  // A transient destroyed execution context is not evidence of a reload; only
  // a positively observed newer document can satisfy this assertion.
  await expect.poll(()=>page.evaluate(()=>performance.timeOrigin).catch(()=>oldBuild)).not.toBe(oldBuild);
  await expect(shell).toHaveAttribute('data-offline-ready','true');
  expect(await page.evaluate(async()=>await (await (await caches.open('publication-fixture-package-sentinel')).match('/synthetic-package-sentinel'))?.text())).toBe('fixture-package');
  expect(await page.evaluate(()=>new Promise<string>((resolve,reject)=>{const request=indexedDB.open('publication-fixture-save-sentinel',1);request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result,get=db.transaction('saves').objectStore('saves').get('save');get.onsuccess=()=>{db.close();resolve(get.result);};get.onerror=()=>reject(get.error);};}))).toBe('fixture-save');
  await info.attach('scope-and-registration',{body:JSON.stringify(await page.evaluate(async()=>({controller:navigator.serviceWorker.controller?.scriptURL,registrations:(await navigator.serviceWorker.getRegistrations()).map(value=>value.scope)}))),contentType:'application/json'});
 });
}
test('ordinary unassembled preview registers nothing',async({page})=>{
 await page.addInitScript(()=>{localStorage.setItem('eagler-touhou-first-use-notice-seen-v1','1');localStorage.setItem('eagler-touhou-site-notice-enabled-v1','0');});
 const [marker]=await Promise.all([
  page.waitForResponse(response=>response.url()===previewFixture.origin+'/ui-publication.json'),
  page.goto(previewFixture.origin+'/'),
 ]);
 await expect(page.getByRole('main')).toBeVisible();
 expect(marker.status()).toBe(404);
 expect(await page.evaluate(()=>navigator.serviceWorker.getRegistrations().then(values=>values.length))).toBe(0);
 await expect(page.locator('[data-ui-app-shell]')).toHaveCount(0);
});
