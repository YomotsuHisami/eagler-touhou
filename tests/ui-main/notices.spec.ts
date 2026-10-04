import {test,expect} from './synthetic-ui-test';

test('first-use notice acknowledges only displayed canonical content and can be reopened',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>localStorage.setItem('eagler-touhou-site-notice-enabled-v1','0'));
 await page.goto('/');
 const notice=page.getByRole('dialog',{name:'首次使用须知',exact:true});await expect(notice).toBeVisible();
 await expect(notice.locator('.notice-right-content h3').first()).toHaveText('1. 输入 touhou.vip 就可以打开这个应用');
 await expect(notice.locator('.notice-right-content h3').first()).toHaveCSS('font-size','18px');
 await expect(notice.locator('.notice-right-content h3').first()).toHaveCSS('font-weight','800');
 await expect.poll(()=>page.evaluate(()=>localStorage.getItem('eagler-touhou-first-use-notice-seen-v1'))).toBe('1');
 await notice.getByRole('button',{name:'关闭首次使用须知',exact:true}).click();await expect(notice).toHaveCount(0);
 await page.reload();await expect(page.getByRole('heading',{name:'单机',exact:true})).toBeVisible();await expect(notice).toHaveCount(0);
 await page.getByLabel('更多站点信息').click();await page.getByRole('button',{name:'首次使用须知',exact:true}).click();await expect(notice).toBeVisible();
 await notice.getByRole('button',{name:'关闭首次使用须知',exact:true}).click();expect(errors).toEqual([]);
});

test('English legacy identity drives canonical help and remains explicit across reload',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{localStorage.setItem('eagler-touhou-first-use-notice-seen-v1','1');localStorage.setItem('eagler-touhou-site-notice-enabled-v1','0');});
 await page.goto('/en.html?game=th06');await expect(page).toHaveURL(/\/play\/th06\?uiLocale=en$/);
 await expect(page.locator('html')).toHaveAttribute('lang','en');
 await page.getByRole('link',{name:'Controls and help',exact:true}).click();await expect(page.getByRole('dialog',{name:'Controls and help',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Close',exact:true}).click();await page.reload();await expect(page.locator('html')).toHaveAttribute('lang','en');expect(errors).toEqual([]);
});

test('Help follows saved touch mode on a fine-pointer desktop and updates without a second preference owner',async({page})=>{
 await page.addInitScript(()=>{localStorage.setItem('eagler-touhou-first-use-notice-seen-v1','1');localStorage.setItem('eagler-touhou-site-notice-enabled-v1','0');});
 await page.goto('/play/th06?uiLocale=en');
 const form=page.getByRole('form',{name:'Game settings',exact:true});
 const touch=form.getByLabel('Enable touch controls',{exact:true});
 await expect(touch).toBeEnabled();
 for(const enabled of [true,false,true]){
  await touch.setChecked(enabled);
  await page.getByRole('link',{name:'Controls and help',exact:true}).click();
  const help=page.getByRole('dialog',{name:'Controls and help',exact:true});
  await expect(help.locator(`[data-help-input="${enabled?'touch':'keyboard'}"]`)).toBeVisible();
  await expect(help.locator(`[data-help-input="${enabled?'keyboard':'touch'}"]`)).toHaveCount(0);
  await help.getByRole('button',{name:'Close',exact:true}).click();
 }
});
