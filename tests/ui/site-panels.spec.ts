import {test,expect} from '@playwright/test';
const seen='eagler-touhou-first-use-notice-seen-v1';
test.beforeEach(async({page})=>{
 await page.route('**/host-manifest.json',route=>route.fulfill({status:404,body:'UI-only fixture'}));
 await page.route('**/release-catalog.json',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({schema:'eagler-touhou/release-catalog/1',games:{}})}));
});
test('automatic first-use drawer retains query/hash and closes without adding history',async({page},testInfo)=>{
 await page.goto('/games/th06?music=midi#settings');
 const dialog=page.getByRole('dialog',{name:'首次使用须知',exact:true});
 await expect(dialog).toBeVisible();await expect(dialog).toContainText('首次');
 await expect.poll(()=>page.evaluate(key=>localStorage.getItem(key),seen)).toBe('1');
 expect(new URL(page.url()).searchParams.get('music')).toBe('midi');
 expect(new URL(page.url()).hash).toBe('#settings');
 await expect(dialog.locator('..')).toHaveCSS('opacity','1');
 await page.screenshot({path:testInfo.outputPath('first-use-drawer.png'),fullPage:true});
 const before=await page.evaluate(()=>({length:history.length,index:history.state?.idx}));
 const bounds=await dialog.boundingBox();expect(bounds).not.toBeNull();
 expect(bounds!.height).toBeGreaterThan(page.viewportSize()!.height*.85);
 await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);
 await expect(page).toHaveURL(/\/games\/th06\?music=midi#settings$/);
 expect(await page.evaluate(()=>({length:history.length,index:history.state?.idx}))).toEqual(before);
 await page.reload();await expect(page.getByRole('region',{name:'東方紅魔郷',exact:true})).toBeVisible();
 await expect(dialog).toHaveCount(0);
});
test('manual first-use from More restores its stable trigger and Back closes donation',async({page},testInfo)=>{
 await page.addInitScript(key=>localStorage.setItem(key,'1'),seen);
 await page.goto('/games/th06');
 const frame=page.locator('iframe');await frame.evaluate(node=>node.setAttribute('data-test-identity','original'));
 const more=page.getByRole('button',{name:'更多',exact:true});await more.click();
 await page.getByRole('menuitem',{name:'首次使用须知',exact:true}).click();
 const notice=page.getByRole('dialog',{name:'首次使用须知',exact:true});await expect(notice).toBeVisible();
 await expect(page.getByRole('menu')).toHaveCount(0);
 await expect(notice.locator('..')).toHaveCSS('opacity','1');
 await page.screenshot({path:testInfo.outputPath('manual-first-use-drawer.png'),fullPage:true});
 await page.keyboard.press('Escape');await expect(notice).toHaveCount(0);await expect(more).toBeFocused();
 const donate=page.getByRole('button',{name:'捐赠',exact:true});await donate.click();
 const donation=page.getByRole('dialog',{name:'捐赠以支持服务器运行',exact:true});await expect(donation).toBeVisible();
 await expect.poll(()=>donation.locator('img').evaluate(node=>{const image=node as HTMLImageElement;return image.complete&&image.naturalWidth>0;})).toBe(true);
 await expect(donation.locator('..')).toHaveCSS('opacity','1');
 await page.screenshot({path:testInfo.outputPath('donation-dialog.png'),fullPage:true});
 await page.goBack();await expect(donation).toHaveCount(0);await expect(page).toHaveURL(/\/games\/th06$/);
 await page.goForward();await expect(donation).toBeVisible();
 await page.keyboard.press('Escape');await expect(donation).toHaveCount(0);await expect(donate).toBeFocused();
 expect(await frame.getAttribute('data-test-identity')).toBe('original');
});
test('failed automatic content remains unseen and manual retry can succeed',async({page})=>{
 let requests=0;
 await page.route('**/content/FIRST_USE_NOTICE.html',route=>route.fulfill(++requests===1?{status:500,body:'unavailable'}:{status:200,body:'<h2>重试后的须知</h2>'}));
 await page.goto('/');await expect.poll(()=>requests).toBe(1);
 await expect(page.getByRole('dialog')).toHaveCount(0);expect(await page.evaluate(key=>localStorage.getItem(key),seen)).toBeNull();
 await page.getByRole('button',{name:'更多',exact:true}).click();await page.getByRole('menuitem',{name:'首次使用须知',exact:true}).click();
 await expect(page.getByRole('dialog')).toContainText('重试后的须知');
 await expect.poll(()=>page.evaluate(key=>localStorage.getItem(key),seen)).toBe('1');
 expect(requests).toBe(2);
});
test('late automatic content cannot interrupt a newer product route',async({page})=>{
 let release!:()=>void;let requested=false;const gate=new Promise<void>(resolve=>{release=resolve;});
 await page.route('**/content/FIRST_USE_NOTICE.html',async route=>{requested=true;await gate;await route.fulfill({status:200,body:'<p>Delayed notice</p>'});});
 try{await page.goto('/');await expect.poll(()=>requested).toBe(true);
  await page.locator('a[href="/games/th07"]').first().click();await expect(page).toHaveURL(/\/games\/th07$/);
  release();await page.waitForTimeout(250);await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await page.evaluate(key=>localStorage.getItem(key),seen)).toBeNull();
 }finally{release();}
});
test('legacy seen migration does not depend on site notice preference',async({page})=>{
 await page.addInitScript(()=>{localStorage.setItem('eagler-touhou-new-player-notice-seen-v1','1');localStorage.setItem('eagler-touhou-site-notice-enabled-v1','0');});
 await page.goto('/games/th06');await expect(page.getByRole('region',{name:'東方紅魔郷',exact:true})).toBeVisible();
 await expect.poll(()=>page.evaluate(key=>localStorage.getItem(key),seen)).toBe('1');
 await expect(page.getByRole('dialog')).toHaveCount(0);
});
test('missing donation image closes its window and removes unavailable actions',async({page})=>{
 await page.addInitScript(key=>localStorage.setItem(key,'1'),seen);
 await page.route('**/assets/donation.webp',route=>route.fulfill({status:404,body:'missing'}));
 await page.goto('/games/th06');await page.getByRole('button',{name:'捐赠',exact:true}).click();
 await expect(page.getByRole('button',{name:'捐赠',exact:true})).toHaveCount(0);
 await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page).toHaveURL(/\/games\/th06$/);
});


test('rapid donation interruption never reopens or duplicates the parent',async({page})=>{
 await page.addInitScript(key=>localStorage.setItem(key,'1'),seen);
 await page.goto('/');await page.locator('a[href="/games/th06"]').first().click();await expect(page).toHaveURL(/\/games\/th06$/);
 const before=await page.evaluate(()=>history.state?.idx);
 for(let i=0;i<6;i++){
  await page.getByRole('button',{name:'捐赠',exact:true}).click();await page.keyboard.press('Escape');
  await expect(page).toHaveURL(/\/games\/th06$/);await expect(page.getByRole('dialog')).toHaveCount(0);
 }
 expect(await page.evaluate(()=>history.state?.idx)).toBe(before);
 await page.goBack();await expect(page).toHaveURL(/\/$/);
});


test('mobile sample masthead keeps its compact row without horizontal overflow',async({page})=>{
 await page.addInitScript(key=>localStorage.setItem(key,'1'),seen);
 await page.setViewportSize({width:390,height:844});await page.goto('/games/th06');
 // Use the stable More control to identify the application masthead in any locale.
 const more=page.getByRole('button',{name:'更多',exact:true});await expect(more).toBeVisible();
 const geometry=await more.evaluate(button=>{const header=button.closest('header')!;const brand=header.querySelector('a')!;const b=brand.getBoundingClientRect(),r=button.getBoundingClientRect(),h=header.getBoundingClientRect();return{brandTop:b.top,buttonBottom:r.bottom,height:h.height,overflow:document.documentElement.scrollWidth>innerWidth};});
 expect(geometry.height).toBeLessThan(75);expect(geometry.buttonBottom-geometry.brandTop).toBeLessThan(50);expect(geometry.overflow).toBe(false);
});
