import {test, expect} from '@playwright/test';
import type {} from './runtime-viewport-fixture';
const origin = process.env.UI_RUNTIME_FIXTURE_ORIGIN ?? 'http://127.0.0.1:4175';
const url = `${origin}/__ui_tests__/runtime-viewport.html`;
// CI-only synthetic DOM checks; never starts a Runtime or establishes phone acceptance.
test.beforeEach(async ({page}) => {
  await page.addInitScript(() => {Object.defineProperty(navigator, 'maxTouchPoints', {configurable: true, get: () => 2});});
  await page.goto(url);
  await expect.poll(()=>page.evaluate(()=>typeof window.__viewportFixture?.inspect)).toBe('function');
  await expect(page.getByRole('toolbar', {name: '游戏会话控制'})).toBeVisible();
  await expect(page.getByRole('button', {name: 'ESC', exact: true})).toBeVisible();
  // Full-screen Runtime must not inherit the library's reserved scrollbar strip.
  await expect.poll(()=>page.evaluate(()=>getComputedStyle(document.documentElement).scrollbarGutter)).toBe('auto');
  await expect.poll(()=>page.locator('[data-runtime-host]').evaluate(node=>node.getBoundingClientRect().width)).toBe(page.viewportSize()!.width);
});

test('captured portrait/landscape offsets change the wrapper while retaining one iframe and document', async ({page}) => {
  await page.setViewportSize({width: 800, height: 600});
  await page.evaluate(() => {
    const controls = {focus: {x: .2, y: .5, scale: 1, priority: 0}, fire: {x: .3, y: .5, scale: 1, priority: 1}, bomb: {x: .4, y: .5, scale: 1, priority: 2}, escape: {x: .5, y: .5, scale: 1, priority: 3}};
    window.__viewportFixture.start({version: 6, profiles: {landscape: {controls, viewport: {x: .2}}, portrait: {controls, viewport: {x: -.15}}}});
  });
  await expect.poll(async () => (await page.evaluate(() => window.__viewportFixture.inspect())).frame.left).toBe(160);
  await page.setViewportSize({width: 400, height: 800});
  await expect.poll(async () => (await page.evaluate(() => window.__viewportFixture.inspect())).frame.left).toBe(-60);
  const state = await page.evaluate(() => window.__viewportFixture.inspect());
  expect(state.sameFrame).toBe(true);expect(state.sameDocument).toBe(true);expect(state.model.orientation).toBe('portrait');
  await expect(page.locator('iframe[title="游戏 Runtime"]')).toHaveCount(1);
});

test('same-origin frame pointer events magnify the existing frame and accessible reset preserves its identity', async ({page}) => {
  await page.evaluate(() => {const f = window.__viewportFixture;f.pointer('frame', 'down', 1, 100, 100);f.pointer('frame', 'down', 2, 200, 100);f.pointer('frame', 'move', 2, 300, 100);});
  await expect.poll(async () => (await page.evaluate(() => window.__viewportFixture.inspect())).model.scale).toBe(2);
  await expect.poll(async () => (await page.evaluate(() => window.__viewportFixture.inspect())).frame.width).toBe((page.viewportSize()?.width ?? 0) * 2);
  const state = await page.evaluate(() => window.__viewportFixture.inspect());
  expect(state.frame.width).toBe((page.viewportSize()?.width ?? 0) * 2);
  await page.getByRole('button', {name: '重置游戏画面放大'}).click();
  await expect.poll(async () => (await page.evaluate(() => window.__viewportFixture.inspect())).model.scale).toBe(1);
  expect((await page.evaluate(() => window.__viewportFixture.inspect())).sameDocument).toBe(true);
});

test('mobile toolbar uses the measured shared reservation and stays clear of default ESC and R controls', async ({page}) => {
  await page.setViewportSize({width: 390, height: 844});
  const toolbar = page.getByRole('toolbar', {name: '游戏会话控制'});
  await expect.poll(async () => Math.round((await toolbar.boundingBox())?.width ?? 0)).toBe(100);
  await expect.poll(async () => Math.round((await toolbar.boundingBox())?.y ?? 0)).toBe(8);
  // Wait for the real entrance animation to finish; rounded y=8 can still be
  // an interior frame (the regression trace measured7.7829). Keep exact geometry.
  await expect.poll(async () => {const box=await toolbar.boundingBox(), state=await page.evaluate(()=>window.__viewportFixture.inspect());return !!box && box.x===state.model.systemControls?.left && box.y===state.model.systemControls?.top;}).toBe(true);
  const bounds = await toolbar.boundingBox();
  for (const name of ['ESC', 'R']) {
    const control = await page.getByRole('button', {name, exact: true}).boundingBox();
    expect(control && bounds && control.x + control.width <= bounds.x).toBe(true);
  }
  await page.getByRole('link', {name: '游戏操作说明'}).click();
  await expect(page.getByRole('dialog', {name: '操作说明', exact: true})).toBeVisible();
  expect((await page.evaluate(() => window.__viewportFixture.inspect())).model.pointerCount).toBe(0);
  await page.keyboard.press('Escape');
  expect((await page.evaluate(() => window.__viewportFixture.inspect())).sameFrame).toBe(true);
});
