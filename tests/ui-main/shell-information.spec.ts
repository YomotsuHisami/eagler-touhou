/** Browser execution belongs to the authorized CI gate; source-only locally. */
import {test as base, expect} from './synthetic-ui-test';
const test = base.extend<{browserErrors: string[]}>({browserErrors: [async ({page}, use) => {
  const errors: string[] = [];
  await page.addInitScript(() => {try {localStorage.setItem('eagler-touhou-first-use-notice-seen-v1', '1'); localStorage.setItem('eagler-touhou-site-notice-enabled-v1', '0');} catch {}});
  page.on('pageerror', error => errors.push(error.message)); await use(errors); expect(errors).toEqual([]);
}, {auto: true}]});
const donationTitle = '捐赠以支持服务器运行';
const closeDonation = '关闭捐赠窗口';
const parent = '/play/th06?filter=single#details';
function donation(page: import('@playwright/test').Page) {return page.getByRole('dialog', {name: donationTitle, exact: true});}

test('header and footer share one in-app donation window with Back/Forward and opener focus', async ({page, context}) => {
  await page.goto(parent);
  const pages = context.pages().length;
  for (const name of ['捐赠', donationTitle]) {
    const trigger = page.getByRole('button', {name, exact: true});
    await trigger.click(); await expect(donation(page)).toBeVisible();
    await expect(donation(page).getByRole('img', {name: 'Tenko 的赞赏码'})).toBeVisible();
    expect(context.pages()).toHaveLength(pages);
    await expect(page).toHaveURL(/play\/th06\?filter=single&panel=donation#details$/);
    await page.goBack(); await expect(page).toHaveURL(/play\/th06\?filter=single#details$/);
    await expect(page.locator('[data-animated-dialog]')).toHaveCount(0); await expect(trigger).toBeFocused();
    await page.goForward(); await expect(donation(page)).toBeVisible();
    await page.getByRole('button', {name: closeDonation, exact: true}).click();
    await expect(page).toHaveURL(/play\/th06\?filter=single#details$/); await expect(donation(page)).toHaveCount(0);
  }
});

test('donation handles same-click repeated Escape and retains query, hash, focus and one parent entry', async ({page}) => {
  await page.goto(parent);
  const trigger = page.getByRole('button', {name: '捐赠', exact: true});
  for (let n = 0; n < 3; n++) {
    const immediate = await trigger.evaluate((button: HTMLButtonElement) => {
      button.click();
      const dialog = document.querySelector<HTMLElement>('[data-animated-dialog][data-presence="present"]');
      const result = {present: !!dialog, focusedInside: !!dialog?.contains(document.activeElement)};
      for (let i = 0; i < 2; i++) document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true, cancelable: true}));
      return result;
    });
    expect(immediate).toEqual({present: true, focusedInside: true});
    await expect(page).toHaveURL(/play\/th06\?filter=single#details$/);
    await expect(page.locator('[data-animated-dialog]')).toHaveCount(0); await expect(trigger).toBeFocused();
  }
  await page.goForward(); await expect(donation(page)).toBeVisible();
});

test('direct and refreshed donation entries close locally without losing unrelated state', async ({page}) => {
  await page.goto('/play/th06?filter=single&panel=donation#details');
  await expect(donation(page)).toBeVisible(); await page.reload(); await expect(donation(page)).toBeVisible();
  await page.keyboard.press('Escape'); await expect(page).toHaveURL(/play\/th06\?filter=single#details$/);
  await expect(page.locator('[data-animated-dialog]')).toHaveCount(0);
  await expect(page.locator('#main-content')).toBeFocused();
});

test('a failed donation image hides both triggers and dismisses its open route', async ({page}) => {
  await page.goto(parent);
  await page.getByRole('button', {name: '捐赠', exact: true}).click(); await expect(donation(page)).toBeVisible();
  await donation(page).getByRole('img').evaluate(image => image.dispatchEvent(new Event('error')));
  await expect(page).toHaveURL(/play\/th06\?filter=single#details$/);
  await expect(page.locator('[data-animated-dialog]')).toHaveCount(0);
  await expect(page.getByRole('button', {name: '捐赠', exact: true})).toHaveCount(0);
  await expect(page.getByRole('button', {name: donationTitle, exact: true})).toHaveCount(0);
  await expect(page.locator('#main-content')).toBeFocused();
  await page.goForward(); await expect(page).toHaveURL(/play\/th06\?filter=single#details$/);
  await expect(page.locator('[data-animated-dialog]')).toHaveCount(0);
});

test('missing donation assets hide both triggers before first opening', async ({page}) => {
  await page.route('**/donation*.webp', route => route.abort());
  await page.goto(parent);
  await expect(page.getByRole('button', {name: '捐赠', exact: true})).toHaveCount(0);
  await expect(page.getByRole('button', {name: donationTitle, exact: true})).toHaveCount(0);
  await expect(page.locator('[data-animated-dialog]')).toHaveCount(0);
});

test('Help and donation switch during visual exit without old autofocus stealing the newer modal', async ({page}) => {
  await page.goto(parent);
  const helpTrigger = page.getByRole('link', {name: '操作说明', exact: true});
  await helpTrigger.click(); await expect(page.getByRole('dialog', {name: '操作说明', exact: true})).toBeVisible();
  // Force a newer Router intent before the old surface has animated away.
  // Background controls are intentionally inert for real pointer interactions.
  await page.locator('header button').filter({hasText: /^捐赠$/}).evaluate((button: HTMLButtonElement) => button.click());
  await expect(donation(page)).toBeVisible();
  await expect(page.locator('[data-animated-dialog][data-presence="exiting"]')).toHaveCount(0);
  expect(await donation(page).evaluate(dialog => dialog.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Escape');
  const help = page.getByRole('dialog', {name: '操作说明', exact: true}); await expect(help).toBeVisible();
  await expect(page.locator('[data-animated-dialog][data-presence="exiting"]')).toHaveCount(0);
  expect(await help.evaluate(dialog => dialog.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Escape'); await expect(page).toHaveURL(/play\/th06\?filter=single#details$/);
  await expect(page.locator('[data-animated-dialog]')).toHaveCount(0);
  await page.goForward(); await expect(help).toBeVisible(); await page.goForward(); await expect(donation(page)).toBeVisible();
});
