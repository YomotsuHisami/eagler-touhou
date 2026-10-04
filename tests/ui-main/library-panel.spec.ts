/** Source-owned synthetic UI evidence, authored for the authorized CI lanes.
 * Mobile viewport emulation does not establish physical-phone acceptance. */
import {test, expect} from './synthetic-ui-test';
import type {Page} from '@playwright/test';
import {readFile} from 'node:fs/promises';
const sheet = (page: Page) => page.locator('[data-animated-dialog][data-dialog-layout="library-panel"]');
const library = (page: Page) => page.locator('[data-library-stage]');
test.beforeEach(async ({page}) => {
  await page.addInitScript(() => {
    localStorage.setItem('eagler-touhou-first-use-notice-seen-v1', '1');
    localStorage.setItem('eagler-touhou-site-notice-enabled-v1', '0');
  });
});
async function loaded(page: Page) {
  await expect(page.getByRole('form', {name: '游戏设置', exact: true})).toBeVisible();
  await expect(sheet(page)).toHaveCSS('opacity', '1');
}
test('cover-led settings retains actual library rails and the one Runtime frame', async ({page}, info) => {
  await page.goto('/');
  const rail = await page.locator('#singleplayer-rail').elementHandle();
  const frame = await page.locator('[data-runtime-host] iframe').elementHandle();
  const card = page.locator('[data-library-product="th06"]');
  const before = await card.boundingBox();
  await card.click(); await loaded(page);
  expect(await rail!.evaluate(node => node === document.querySelector('#singleplayer-rail'))).toBe(true);
  expect(await frame!.evaluate(node => node === document.querySelector('[data-runtime-host] iframe'))).toBe(true);
  const after = await card.boundingBox();
  expect(Math.abs(after!.x - before!.x)).toBeLessThan(1);
  expect(Math.abs(after!.width - before!.width)).toBeLessThan(1);
  const cover = page.locator('[data-product-cover="th06"] img');
  await expect(cover).toHaveAttribute('src', await card.locator('img').getAttribute('src') as string);
  const bounds = await sheet(page).boundingBox(), viewport = page.viewportSize()!;
  if (viewport.width <= 780) {
    expect(Math.abs(bounds!.x - 8)).toBeLessThan(2);
    expect(Math.abs(bounds!.width - (viewport.width - 16))).toBeLessThan(2);
    expect(Math.abs(bounds!.y + bounds!.height - (viewport.height - 8))).toBeLessThan(2);
  } else {
    expect(Math.abs(bounds!.width - 480)).toBeLessThan(2);
    expect(Math.abs(bounds!.y - 16)).toBeLessThan(2);
    await expect(sheet(page)).toHaveCSS('right', '16px');
    // A classic scrollbar's stable gutter is part of main's desktop geometry.
    const rightGap = viewport.width - bounds!.x - bounds!.width;
    expect(rightGap).toBeGreaterThanOrEqual(15); expect(rightGap).toBeLessThanOrEqual(34);
  }
  await page.screenshot({path: info.outputPath('main-derived-settings-panel.png'), fullPage: true});
  await page.getByRole('button', {name: '返回游戏库', exact: true}).click();
  await expect(sheet(page)).toHaveCount(0); await expect(card).toBeFocused();
  expect(await rail!.evaluate(node => node === document.querySelector('#singleplayer-rail'))).toBe(true);
  await page.goForward(); await loaded(page);
  expect(await frame!.evaluate(node => node === document.querySelector('[data-runtime-host] iframe'))).toBe(true);
});
test('child management closes to settings before library and never replaces the sheet or Runtime', async ({page}, info) => {
  await page.goto('/?filter=single#kept'); await page.locator('[data-library-product="th06"]').click(); await loaded(page);
  const panel = await sheet(page).elementHandle(), rail = await page.locator('#singleplayer-rail').elementHandle(), frame = await page.locator('[data-runtime-host] iframe').elementHandle();
  for (const [label, route] of [['资源管理', 'resources'], ['Replay', 'replays'], ['存档', 'saves']]) {
    await page.getByRole('link', {name: label, exact: true}).click();
    await expect(page).toHaveURL(new RegExp(`/play/th06/${route}\\?filter=single#kept$`));
    expect(await panel!.evaluate(node => node === document.querySelector('[data-dialog-layout="library-panel"]'))).toBe(true);
    expect(await rail!.evaluate(node => node === document.querySelector('#singleplayer-rail'))).toBe(true);
    expect(await frame!.evaluate(node => node === document.querySelector('[data-runtime-host] iframe'))).toBe(true);
    // Evidence is the settled child view, not the 220ms route-entry fade.
    await expect(page.locator('[data-product-management-view]')).toHaveCSS('opacity', '1');
    await page.screenshot({path: info.outputPath(`main-derived-${route}-panel.png`), fullPage: true});
  }
  await page.getByRole('button', {name: '返回设置', exact: true}).click(); await loaded(page);
  await expect(page).toHaveURL(/\/play\/th06\?filter=single#kept$/);
  await page.keyboard.press('Escape'); await expect(sheet(page)).toHaveCount(0);
  await expect(page).toHaveURL(/\/\?filter=single#kept$/);
  await expect(page.locator('[data-library-product="th06"]')).toBeFocused();
});
for (const child of ['resources', 'replays', 'saves']) test(`direct ${child} link dismisses to settings then library without guessing external history`, async ({page}) => {
  await page.goto(`/play/th06/${child}?uiLocale=en#kept`);
  await expect(sheet(page)).toBeVisible(); await page.keyboard.press('Escape');
  await expect(page).toHaveURL(/\/play\/th06\?uiLocale=en#kept$/);
  await expect(page.getByRole('form', {name: 'Game settings', exact: true})).toBeVisible();
  await page.keyboard.press('Escape'); await expect(sheet(page)).toHaveCount(0);
  await expect(page).toHaveURL(/\/\?uiLocale=en#kept$/);
});
test('direct Help owns focus above settings and dismissal restores exactly the existing sheet', async ({page}) => {
  await page.goto('/play/th06?panel=help');
  const help = page.getByRole('dialog', {name: '操作说明', exact: true});
  await expect(help).toBeVisible();
  expect(await help.evaluate(element => !element.closest('[aria-hidden="true"], [inert]'))).toBe(true);
  expect(await help.evaluate(element => element.contains(document.activeElement))).toBe(true);
  await expect(sheet(page)).toHaveCount(1);
  const panel = await sheet(page).elementHandle();
  await page.keyboard.press('Escape'); await expect(help).toHaveCount(0); await loaded(page);
  expect(await sheet(page).evaluate(element => element.contains(document.activeElement))).toBe(true);
  expect(await panel!.evaluate(node => node === document.querySelector('[data-dialog-layout="library-panel"]'))).toBe(true);
  await page.keyboard.press('Escape'); await expect(sheet(page)).toHaveCount(0); await expect(library(page)).toBeVisible();
});
for (const dismissal of ['Escape', 'Back'] as const) test(`cold lazy Game opening with immediate ${dismissal} cannot later reopen or skip history`, async ({page}, info) => {
  let release!: () => void, held = 0;
  const gate = new Promise<void>(resolve => {release = resolve;});
  // Resolve authored route ownership from the actual build: game-preferences
  // is an eager shared chunk and must never be held as if it were the route.
  const ownership = JSON.parse(await readFile('.cache/build/ui-main/client/ui-ownership.json','utf8')) as {chunkMetrics:Array<{file:string;modules:string[]}>};
  const routeChunk = ownership.chunkMetrics.find(chunk=>chunk.modules.includes('app/routes/game.tsx'));
  expect(routeChunk).toBeDefined();
  await page.route(url=>url.pathname===`/${routeChunk!.file}`, async route => {
    held++; await gate; await route.continue();
  });
  try {
    await page.goto('/?sentinel=1');
    // A native same-app link supplies the prior root entry without loading Game.
    await page.getByRole('link', {name: 'EAGLER TOUHOU 游戏库', exact: true}).click();
    await expect(page).toHaveURL(/\/$/);
    const immediate = await page.locator('[data-library-product="th06"]').evaluate((trigger: HTMLAnchorElement, dismissal) => {
      trigger.click();
      const dialog = document.querySelector<HTMLElement>('[data-dialog-layout="library-panel"]');
      const result = {present: dialog?.dataset.presence, focusInside: !!dialog?.contains(document.activeElement)};
      if (dismissal === 'Escape') {
        document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true, cancelable: true}));
        document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true, cancelable: true}));
      }
      return result;
    }, dismissal);
    expect(immediate).toEqual({present: 'present', focusInside: true});
    await expect.poll(() => held).toBe(1);
    if (dismissal === 'Back') await page.goBack();
    release();
    await expect(sheet(page)).toHaveCount(0);
    await expect(page).toHaveURL(dismissal === 'Back' ? /\/\?sentinel=1$/ : /\/$/);
    await info.attach('cold-library-navigation', {body: JSON.stringify({dismissal, immediate, held, url: page.url()}), contentType: 'application/json'});
    await expect(page.locator('[data-runtime-host] iframe')).toHaveCount(1);
  } finally {release();}
});
test('full-motion close/reopen reuses one retained surface and reduced motion remains usable', async ({page}) => {
  await page.emulateMedia({reducedMotion: 'no-preference'});
  await page.goto('/'); await page.locator('[data-library-product="th06"]').click(); await loaded(page);
  const panel = await sheet(page).elementHandle();
  await page.getByRole('button', {name: '返回游戏库', exact: true}).click();
  await expect(sheet(page)).toHaveAttribute('data-presence', 'exiting');
  await page.goForward(); await loaded(page);
  expect(await panel!.evaluate(node => node === document.querySelector('[data-dialog-layout="library-panel"]'))).toBe(true);
  await expect(sheet(page)).toHaveCount(1);
  await page.emulateMedia({reducedMotion: 'reduce'});
  await expect(sheet(page)).toHaveAttribute('data-reduced-motion', 'true');
  await page.keyboard.press('Escape'); await expect(sheet(page)).toHaveCount(0);
  await page.goForward(); await loaded(page);
  await expect(sheet(page)).toHaveAttribute('data-reduced-motion', 'true');
});
