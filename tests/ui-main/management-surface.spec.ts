/** Synthetic empty-frame UI proof only, using normal actionability-checked
 * clicks. This fixture neither prepares nor starts a native game/Runtime. */
import {test, expect} from '@playwright/test';
import type {} from './runtime-controls-fixture';
const origin = process.env.UI_RUNTIME_FIXTURE_ORIGIN ?? 'http://127.0.0.1:4175';
async function prepared(page: import('@playwright/test').Page) {
  await page.goto(`${origin}/__ui_tests__/runtime-controls.html?management=1`);
  await page.evaluate(() => window.__runtimeControlsFixture.navigate('/play/th06'));
  await page.evaluate(() => window.__runtimeControlsFixture.start('prepared'));
  const panel = page.getByRole('dialog', {name: 'Synthetic management surface', exact: true});
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('button', {name: '启动 TH06', exact: true})).toBeVisible();
  await expect(panel.getByRole('button', {name: '退出游戏', exact: true})).toBeVisible();
  return panel;
}
test('prepared Start is accessible in the active modal, obeys file busy, and releases the slot while launching', async ({page}, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const panel = await prepared(page), frame = await page.locator('[data-synthetic-runtime-frame]').elementHandle();
  const start = panel.getByRole('button', {name: '启动 TH06', exact: true});
  await page.evaluate(() => window.__runtimeControlsFixture.setFileBusy(true)); await expect(start).toBeDisabled();
  expect(await page.evaluate(() => window.__runtimeControlsFixture.inspect().launches)).toBe(0);
  await page.evaluate(() => window.__runtimeControlsFixture.setFileBusy(false)); await expect(start).toBeEnabled();
  await start.focus(); await expect(start).toBeFocused();
  await page.screenshot({path: info.outputPath('synthetic-prepared-management-controls.png'), fullPage: true});
  await start.click();
  await expect.poll(() => page.evaluate(() => window.__runtimeControlsFixture.inspect().snapshot.phase)).toBe('launching');
  await expect(panel).toHaveCount(0);
  await expect(page.getByRole('toolbar', {name: '游戏会话控制', exact: true})).toBeVisible();
  expect(await page.evaluate(() => window.__runtimeControlsFixture.inspect().launches)).toBe(1);
  await page.evaluate(() => window.__runtimeControlsFixture.resolveLaunch());
  await expect.poll(() => page.evaluate(() => window.__runtimeControlsFixture.inspect().snapshot.phase)).toBe('running');
  expect(await frame!.evaluate(element => element === document.querySelector('[data-synthetic-runtime-frame]'))).toBe(true);
  await expect(page.locator('[data-synthetic-runtime-frame]')).toHaveCount(1); expect(errors).toEqual([]);
});
test('prepared Exit stays with the existing guarded writer through a save failure, retry and dismissal', async ({page}) => {
  const panel = await prepared(page), frame = await page.locator('[data-synthetic-runtime-frame]').elementHandle();
  const exit = panel.getByRole('button', {name: '退出游戏', exact: true});
  await exit.click();
  const confirmation = page.getByRole('dialog', {name: '结束当前游戏？', exact: true}); await expect(confirmation).toBeVisible();
  expect(await page.evaluate(() => window.__runtimeControlsFixture.inspect().calls)).toEqual({close: 0, sync: 0, discard: 0, completed: 0});
  await confirmation.getByRole('button', {name: '保存并退出', exact: true}).click();
  await expect.poll(() => page.evaluate(() => window.__runtimeControlsFixture.inspect().syncPending)).toBe(true);
  await page.evaluate(() => window.__runtimeControlsFixture.rejectSync('Synthetic management save failed'));
  const failure = page.getByRole('dialog', {name: '保存未完成', exact: true}); await expect(failure).toBeVisible();
  await failure.getByRole('button', {name: '重试保存并退出', exact: true}).click();
  await expect.poll(() => page.evaluate(() => window.__runtimeControlsFixture.inspect().syncPending)).toBe(true);
  await page.evaluate(() => window.__runtimeControlsFixture.resolveSync());
  await expect(failure).toHaveCount(0); await expect(panel).toBeVisible();
  expect(await page.evaluate(() => window.__runtimeControlsFixture.inspect().calls)).toEqual({close: 2, sync: 2, discard: 0, completed: 1});
  expect(await frame!.evaluate(element => element === document.querySelector('[data-synthetic-runtime-frame]'))).toBe(true);
  await expect(page.locator('[data-synthetic-runtime-frame]')).toHaveCount(1);
});
