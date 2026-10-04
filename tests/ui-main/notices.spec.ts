import {test,expect} from './synthetic-ui-test';

test('first-use notice acknowledges only displayed canonical content and can be reopened',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>localStorage.setItem('eagler-touhou-site-notice-enabled-v1','0'));
 await page.goto('/');
 const notice=page.getByRole('dialog',{name:'首次使用须知',exact:true});await expect(notice).toBeVisible();
 await expect.poll(()=>page.evaluate(()=>localStorage.getItem('eagler-touhou-first-use-notice-seen-v1'))).toBe('1');
 await notice.getByRole('button',{name:'关闭',exact:true}).click();await expect(notice).toHaveCount(0);
 await page.reload();await expect(page.getByRole('heading',{name:'单机',exact:true})).toBeVisible();await expect(notice).toHaveCount(0);
 await page.getByLabel('更多站点信息').click();await page.getByRole('button',{name:'首次使用须知',exact:true}).click();await expect(notice).toBeVisible();
 await notice.getByRole('button',{name:'关闭',exact:true}).click();expect(errors).toEqual([]);
});

test('English legacy identity drives canonical help and remains explicit across reload',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{localStorage.setItem('eagler-touhou-first-use-notice-seen-v1','1');localStorage.setItem('eagler-touhou-site-notice-enabled-v1','0');});
 await page.goto('/en.html?game=th06');await expect(page).toHaveURL(/\/play\/th06\?uiLocale=en$/);
 await expect(page.locator('html')).toHaveAttribute('lang','en');
 await page.getByRole('link',{name:'Controls and help',exact:true}).click();await expect(page.getByRole('dialog',{name:'Controls and help',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Close',exact:true}).click();await page.reload();await expect(page.locator('html')).toHaveAttribute('lang','en');expect(errors).toEqual([]);
});
