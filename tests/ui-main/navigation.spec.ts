import {test,expect} from '@playwright/test';
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
 await page.goto('/'); await page.evaluate(()=>document.fonts.ready);
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
