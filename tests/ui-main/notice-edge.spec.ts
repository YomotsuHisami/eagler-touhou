/** Source-owned pointer fixtures. This is not physical-device gesture acceptance. */
import {test,expect} from './synthetic-ui-test';
import type {Page} from '@playwright/test';
async function swipe(page:Page,from:[number,number],to:[number,number]) {
  await page.mouse.move(...from);await page.mouse.down();await page.mouse.move(...to,{steps:8});await page.mouse.up();
}
test('notice edge reveal/retract preserves the shared owners and established geometry',async({page},info)=>{
  await page.setViewportSize({width:430,height:820});
  await page.addInitScript(()=>{localStorage.setItem('eagler-touhou-first-use-notice-seen-v1','1');localStorage.setItem('eagler-touhou-site-notice-enabled-v1','1');});
  await page.route('**/NOTICE.txt',route=>route.fulfill({status:200,contentType:'text/plain',body:'Source-owned notice fixture'}));
  await page.goto('/');
  const site=page.locator('[data-site-notice]');
  await expect(site).toBeVisible();await site.getByRole('button',{name:'关闭公告'}).click();await expect(site).toHaveCount(0);
  const notice=page.getByRole('dialog',{name:'首次使用须知',exact:true});
  await swipe(page,[428,320],[348,321]);await expect(notice).toBeVisible();await expect(page).toHaveURL(/\/$/);
  await expect(notice).toHaveAttribute('data-dialog-layout','notice-right');
  await expect(page.locator('[data-dialog-overlay]').last()).toHaveCSS('background-color','rgba(0, 0, 0, 0)');
  await expect(notice).toHaveCSS('opacity','1');
  const box=await notice.boundingBox();expect(Math.abs(box!.x+box!.width-430)).toBeLessThan(2);
  expect(await notice.locator('.notice-right-content h2').first().evaluate(node=>parseFloat(getComputedStyle(node).fontSize))).toBeGreaterThanOrEqual(21);
  await page.screenshot({path:info.outputPath('synthetic-first-use-right.png'),fullPage:true});
  await notice.getByRole('button',{name:'关闭首次使用须知'}).click();await expect(notice).toHaveCount(0);
  await swipe(page,[428,320],[348,321]);await expect(notice).toBeVisible();await expect(page).toHaveURL(/\/$/);
  await swipe(page,[90,320],[170,321]);await expect(notice).toHaveCount(0);
  await swipe(page,[2,600],[82,601]);await expect(site).toBeVisible();
  await expect(site).toHaveCSS('opacity','1');
  expect(Math.abs((await site.boundingBox())!.x)).toBeLessThan(2);
  await page.screenshot({path:info.outputPath('synthetic-site-notice-left.png'),fullPage:true});
  const boxSite=await site.boundingBox();await swipe(page,[boxSite!.x+boxSite!.width-12,boxSite!.y+30],[boxSite!.x+boxSite!.width-92,boxSite!.y+31]);
  await expect(site).toHaveCount(0);
});
test('edge gesture never opens over a visible Runtime, and site opt-out is respected',async({page})=>{
  await page.setViewportSize({width:430,height:820});
  await page.addInitScript(()=>{localStorage.setItem('eagler-touhou-first-use-notice-seen-v1','1');localStorage.setItem('eagler-touhou-site-notice-enabled-v1','0');});
  await page.goto('/');await expect(page.getByRole('heading',{name:'单机',exact:true})).toBeVisible();
  await swipe(page,[2,600],[82,601]);await expect(page.locator('[data-site-notice]')).toHaveCount(0);
  // DOM-only visibility sentinel; no game or native Runtime is created.
  await page.evaluate(()=>document.querySelector('[data-runtime-host]')?.setAttribute('aria-hidden','false'));
  await swipe(page,[428,320],[348,321]);await expect(page.getByRole('dialog',{name:'首次使用须知',exact:true})).toHaveCount(0);
});
