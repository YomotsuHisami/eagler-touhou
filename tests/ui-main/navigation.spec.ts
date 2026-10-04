import {test as base,expect} from '@playwright/test';
const test=base.extend<{browserErrors:string[]}>({browserErrors:[async({page},use)=>{const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));await use(errors);expect(errors).toEqual([]);},{auto:true}]});
test('main-derived library and nested help keep one route owner',async({page})=>{
 await page.goto('/games/th06');
 await expect(page.getByRole('heading',{name:'東方紅魔郷'})).toBeVisible();
 await page.getByRole('link',{name:'操作说明',exact:true}).click();
 await expect(page.getByRole('dialog')).toBeVisible();
 await page.keyboard.press('Escape');
 await expect(page).toHaveURL(/\/games\/th06$/);
 await expect(page.getByRole('dialog')).toHaveCount(0);
 await page.goForward(); await expect(page.getByRole('dialog')).toBeVisible();
 await page.getByRole('button',{name:'关闭',exact:true}).click();
 await expect(page).toHaveURL(/\/games\/th06$/);
});
test('direct help closes to its product; refresh remains usable',async({page})=>{
 await page.goto('/games/th06?panel=help'); await expect(page.getByRole('dialog')).toBeVisible();
 await page.reload(); await expect(page.getByRole('dialog')).toBeVisible();
 await page.getByRole('button',{name:'关闭',exact:true}).click();
 await expect(page).toHaveURL(/\/games\/th06$/);
});
test('current-main sample evidence and privacy boundary',async({page},info)=>{
 await page.goto('/'); await expect(page.getByRole('heading',{name:'单机',exact:true})).toBeVisible();
 await page.evaluate(async()=>{
  const images=[...document.querySelectorAll<HTMLImageElement>('main img')];
  await Promise.all(images.map(image=>image.decode()));
  if(images.some(image=>!image.complete || image.naturalWidth===0))throw Error('Declared cover failed to load');
  await document.fonts.load('700 24px \"ET Chill Round\"','東方紅魔郷');
  await document.fonts.ready;
  await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));
 });
 if(info.project.name === 'mobile-viewport') expect((await page.locator('header').boundingBox())!.height).toBeLessThanOrEqual(70);
 await page.screenshot({path:info.outputPath('main-derived-library.png'),fullPage:true});
 expect(await page.evaluate(()=>navigator.serviceWorker.getRegistrations().then(x=>x.length))).toBe(0);
 const missing=await page.request.get('/runtime/missing.wasm');expect(missing.status()).toBe(404);
 const ownership=await page.request.get('/ui-ownership.json');expect(ownership.status()).toBe(404);
 const legacy=await page.request.get('/app.js');expect(legacy.status()).toBe(404);
});

test('rapid repeated dismissal preserves parent query and focus',async({page})=>{
 await page.goto('/games/th06?filter=single#details');
 const help=page.getByRole('link',{name:'操作说明',exact:true});
 for(let n=0;n<3;n++){
  await help.click();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(/games\/th06\?filter=single#details$/);
  await expect(help).toBeFocused();
 }
 await page.goto('/games/th06?filter=single&panel=help#details');
 await expect(page.getByRole('dialog')).toBeVisible();
 await page.keyboard.press('Escape');
 await expect(page).toHaveURL(/games\/th06\?filter=single#details$/);
});

test('canonical settings persist while a dormant Runtime host stays stable',async({page})=>{
 await page.goto('/games/th06');
 const cap=page.getByRole('checkbox',{name:'限制为 60 FPS',exact:true});
 await cap.check();
 await page.evaluate(()=>{(window as unknown as {sampleFrame:Element|null}).sampleFrame=document.querySelector('[data-runtime-host] iframe');});
 await page.getByRole('link',{name:'操作说明',exact:true}).click();
 await expect(page.locator('[data-runtime-host] iframe')).toHaveCount(1);
 expect(await page.evaluate(()=>(window as unknown as {sampleFrame:Element|null}).sampleFrame===document.querySelector('[data-runtime-host] iframe'))).toBe(true);
 await page.keyboard.press('Escape');
 await expect(cap).toBeChecked();
 await page.reload();
 await expect(cap).toBeChecked();
 // Persistence is observed through the same form after a full reload; exact keys are covered by the service test.
});
