import {test,expect} from '../ui-main/synthetic-ui-test';
for(const {name,origin,mount} of [{name:'root',origin:'http://127.0.0.1:4191',mount:'/'},{name:'nested',origin:'http://127.0.0.1:4192',mount:'/nested-launcher/'}]){
 test(`${name}: first install, offline deep reload and update defer preserve synthetic local data`,async({page,context},info)=>{
  await page.request.post(origin+'/__ci_publication__/select?version=a');
  await page.addInitScript(()=>{localStorage.setItem('eagler-touhou-first-use-notice-seen-v1','1');localStorage.setItem('eagler-touhou-site-notice-enabled-v1','0');});
  await page.goto(origin+mount+'?uiLocale=en');
  const shell=page.locator('[data-ui-app-shell]');await expect(shell).toHaveAttribute('data-offline-ready','true');
  await expect(page.locator('head link[rel="manifest"]')).toHaveAttribute('href',origin+mount+'site.webmanifest');
  await expect(page.locator(`a[href="${mount}play/th06"]`)).not.toHaveCount(0);
  await expect(page.locator(`a[href="${mount}play/th07"]`)).toHaveCount(0);
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
  await page.goto(origin+mount+'play/th06?uiLocale=en&panel=help');await expect(page.getByRole('dialog')).toBeVisible();
  await page.request.post(origin+'/__ci_publication__/select?version=b');
  await page.evaluate(async()=>{const registration=await navigator.serviceWorker.getRegistration();if(!registration)throw Error('missing registration');await registration.update();});
  await expect(shell).toHaveAttribute('data-update-waiting','true');
  expect(await page.evaluate(async()=>{const registration=await navigator.serviceWorker.getRegistration();return registration?.waiting?.state;})).toBe('installed');
  const oldBuild=await page.evaluate(()=>performance.timeOrigin);
  await page.keyboard.press('Escape');
  await expect.poll(()=>page.evaluate(()=>performance.timeOrigin)).not.toBe(oldBuild);
  await expect(shell).toHaveAttribute('data-offline-ready','true');
  expect(await page.evaluate(async()=>await (await (await caches.open('publication-fixture-package-sentinel')).match('/synthetic-package-sentinel'))?.text())).toBe('fixture-package');
  expect(await page.evaluate(()=>new Promise<string>((resolve,reject)=>{const request=indexedDB.open('publication-fixture-save-sentinel',1);request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result,get=db.transaction('saves').objectStore('saves').get('save');get.onsuccess=()=>{db.close();resolve(get.result);};get.onerror=()=>reject(get.error);};}))).toBe('fixture-save');
  await info.attach('scope-and-registration',{body:JSON.stringify(await page.evaluate(async()=>({controller:navigator.serviceWorker.controller?.scriptURL,registrations:(await navigator.serviceWorker.getRegistrations()).map(value=>value.scope)}))),contentType:'application/json'});
 });
}
test('ordinary unassembled preview registers nothing',async({page})=>{
 await page.addInitScript(()=>{localStorage.setItem('eagler-touhou-first-use-notice-seen-v1','1');localStorage.setItem('eagler-touhou-site-notice-enabled-v1','0');});
 const marker=page.waitForResponse(response=>new URL(response.url()).pathname==='/ui-publication.json');
 await page.goto('http://127.0.0.1:4190/');await expect(page.getByRole('main')).toBeVisible();
 expect((await marker).status()).toBe(404);
 expect(await page.evaluate(()=>navigator.serviceWorker.getRegistrations().then(values=>values.length))).toBe(0);
 await expect(page.locator('[data-ui-app-shell]')).toHaveCount(0);
});
