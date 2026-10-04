import {test,expect} from '../ui-main/synthetic-ui-test';
const mount='/nested-launcher';
test.beforeEach(async({page})=>{
  await page.addInitScript(()=>{localStorage.setItem('eagler-touhou-first-use-notice-seen-v1','1');localStorage.setItem('eagler-touhou-site-notice-enabled-v1','0');});
});
test('actual nested Framework build preserves direct help, reload, Back and Forward',async({page})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(`${mount}/play/th06?panel=help`);
  await expect(page.getByRole('dialog',{name:'操作说明',exact:true})).toBeVisible();
  await page.reload();
  await expect(page.getByRole('dialog',{name:'操作说明',exact:true})).toBeVisible();
  await page.keyboard.press('Escape');await expect(page).toHaveURL(new RegExp(`${mount}/play/th06$`));
  await page.getByRole('link',{name:'操作说明',exact:true}).click();
  await page.goBack();await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.goForward();await expect(page.getByRole('dialog')).toBeVisible();
  expect(errors).toEqual([]);
});
test('legacy locale link and UI artifacts stay under the exact nested mount',async({page})=>{
  await page.goto(`${mount}/en.html?game=th06`);
  await expect(page).toHaveURL(new RegExp(`${mount}/play/th06.*uiLocale=en`));
  await expect(page.getByRole('heading',{name:'東方紅魔郷'})).toBeVisible();
  const paths=await page.locator('script[src],link[rel="stylesheet"]').evaluateAll(nodes=>nodes.map(node=>new URL(node.getAttribute('src')??node.getAttribute('href')??'',location.href).pathname));
  expect(paths.length).toBeGreaterThan(0);for(const path of paths)expect(path.startsWith(`${mount}/`)).toBe(true);
  expect(await page.evaluate(()=>navigator.serviceWorker.getRegistrations().then(items=>items.length))).toBe(0);
  for(const path of ['/play/th06',`${mount}/games/th06/missing.data`,`${mount}/assets/missing.js`,`${mount}/play/th06/missing.wasm`]){
    const response=await page.request.get(path,{headers:{Accept:'text/html'}});expect(response.status()).toBe(404);
    expect(await response.text()).not.toContain('__reactRouterContext');
  }
});
