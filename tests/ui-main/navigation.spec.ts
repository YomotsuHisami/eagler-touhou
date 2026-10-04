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

for (const method of ['browser Back','explicit return'] as const) test(`library rail survives ${method}`,async({page})=>{
 await page.goto('/');
 const shelf=page.getByRole('region',{name:'单机',exact:true});
 const rail=page.locator('#singleplayer-rail');
 await expect(shelf.getByRole('heading',{name:'单机',exact:true})).toBeVisible();
 await rail.evaluate(element=>element.scrollTo({left:element.scrollWidth,behavior:'instant'}));
 await expect.poll(()=>rail.evaluate(element=>Math.abs(element.scrollLeft-(element.scrollWidth-element.clientWidth)))).toBeLessThan(2);
 const previous=await rail.evaluate(element=>element.scrollLeft);
 await shelf.locator('a[href="/games/th11"]').click();
 await expect(page).toHaveURL(/\/games\/th11$/);
 if(method==='browser Back')await page.goBack();
 else await page.getByRole('button',{name:'返回游戏库',exact:true}).click();
 await expect(page).toHaveURL('http://127.0.0.1:4173/');
 await expect.poll(()=>rail.evaluate(element=>Math.abs(element.scrollLeft-previous))).toBeLessThan(2);
 await expect(shelf.getByRole('button',{name:'浏览東方地霊殿',exact:true})).toHaveAttribute('aria-pressed','true');
 await expect(shelf.locator('a[href=\"/games/th11\"]')).toBeFocused();
});

test('library restoration clamps changed viewport geometry',async({page})=>{
 await page.goto('/');
 const shelf=page.getByRole('region',{name:'单机',exact:true});
 await shelf.getByRole('button',{name:'浏览東方地霊殿',exact:true}).click();
 await shelf.locator('a[href="/games/th11"]').click();
 await expect(page).toHaveURL(/\/games\/th11$/);
 await page.setViewportSize({width:640,height:720});
 await page.goBack();
 await expect(shelf.getByRole('button',{name:'浏览東方地霊殿',exact:true})).toHaveAttribute('aria-pressed','true');
 await expect.poll(async()=>{
  const card=await shelf.locator('a[href="/games/th11"]').boundingBox();
  const rail=await page.locator('#singleplayer-rail').boundingBox();
  return !!card && !!rail && card.x<rail.x+rail.width && card.x+card.width>rail.x;
 }).toBe(true);
});
