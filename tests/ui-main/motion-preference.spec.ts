/** CI-authored coverage only: the synthetic launcher loads no game/Runtime. */
import {test as base, expect} from './synthetic-ui-test';
const key = 'eagler-touhou-less-motion-v1';
const test = base.extend<{browserErrors: string[]}>({browserErrors: [async ({page}, use) => {
  const errors: string[] = [];
  await page.addInitScript(() => {
    localStorage.setItem('eagler-touhou-first-use-notice-seen-v1', '1');
    localStorage.setItem('eagler-touhou-site-notice-enabled-v1', '0');
  });
  page.on('pageerror', error => errors.push(error.message));
  await use(errors);expect(errors).toEqual([]);
}, {auto: true}]});

test('default motion remains active on desktop/mobile, user choice persists and controls library CSS', async ({page}) => {
  await page.emulateMedia({reducedMotion: 'no-preference'});
  await page.goto('/?uiLocale=en');
  const menu = page.locator('header details'), trigger = menu.locator('summary'), toggle = page.locator('#lessMotionToggle');
  await expect(page.locator('html')).toHaveAttribute('data-reduced-motion', 'false');
  await trigger.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect(toggle).toHaveAttribute('title', 'Reduce decorative motion');
  await expect(page.locator('#singleplayer-rail')).toHaveCSS('scroll-behavior', 'smooth');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(toggle).toHaveAttribute('title', 'Restore full page motion');
  await expect(page.locator('html')).toHaveAttribute('data-reduced-motion', 'true');
  await expect(page.locator('#singleplayer-rail')).toHaveCSS('scroll-behavior', 'auto');
  await expect(page.locator('#singleplayer-rail > a').first()).toHaveCSS('transition-property', 'none');
  expect(await page.evaluate(key => localStorage.getItem(key), key)).toBe('1');
  await page.reload();
  await trigger.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#singleplayer-rail')).toHaveCSS('scroll-behavior', 'smooth');
  expect(await page.evaluate(key => localStorage.getItem(key), key)).toBe('0');
});

test('OS changes and real cross-tab storage changes compose without changing the user toggle', async ({page, context}) => {
  await page.emulateMedia({reducedMotion: 'no-preference'});
  await page.goto('/?uiLocale=en');
  const toggle = page.locator('#lessMotionToggle');
  await page.getByLabel('More site information').click();
  const other = await context.newPage();
  await other.goto('/?uiLocale=en');
  await other.evaluate(key => localStorage.setItem(key, '1'), key);
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('html')).toHaveAttribute('data-reduced-motion', 'true');
  await page.emulateMedia({reducedMotion: 'reduce'});
  await other.evaluate(key => localStorage.setItem(key, '0'), key);
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('html')).toHaveAttribute('data-reduced-motion', 'true');
  await expect(page.locator('#singleplayer-rail')).toHaveCSS('scroll-behavior', 'auto');
  await page.emulateMedia({reducedMotion: 'no-preference'});
  await expect(page.locator('html')).toHaveAttribute('data-reduced-motion', 'false');
  await other.close();
});

test('menu Escape returns trigger focus, outside click dismisses and authored pages stay same-mount', async ({page}) => {
  await page.goto('/?uiLocale=en');
  const menu = page.locator('header details'), trigger = menu.locator('summary');
  await expect(page.getByRole('link', {name: 'Frequently asked questions'})).toHaveAttribute('href', '/faq.html');
  await trigger.click();
  await expect(menu.getByRole('link', {name: 'About this project', exact: true})).toHaveAttribute('href', '/about.html');
  await page.locator('#lessMotionToggle').focus();
  await page.keyboard.press('Escape');
  await expect(menu).not.toHaveAttribute('open', '');
  await expect(trigger).toBeFocused();
  await trigger.click();
  await page.locator('main h2').first().click();
  await expect(menu).not.toHaveAttribute('open', '');
  await page.goto('/?uiLocale=zh-CN');
  await page.getByLabel('更多站点信息').click();
  await expect(page.locator('#lessMotionToggle')).toHaveText('更少动画');
  await expect(page.locator('#lessMotionToggle')).toHaveAttribute('title', '减少页面装饰动画');
});
