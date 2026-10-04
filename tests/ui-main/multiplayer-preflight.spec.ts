import {test as base, expect, type Page} from '@playwright/test';
import type {} from './multiplayer-preflight-fixture';
// CI-only synthetic protocol coverage. No real native engine or gameplay proof.
const origin = process.env.UI_RUNTIME_FIXTURE_ORIGIN ?? 'http://127.0.0.1:4175';
const test = base.extend<{browserErrors: string[]}>({browserErrors: [async ({page}, use) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await use(errors); expect(errors).toEqual([]);
}, {auto: true}]});
const inspect = (page: Page) => page.evaluate(() => window.__multiplayerPreflightFixture.inspect());
const status = (page: Page, value: string) => page.locator(`[data-multiplayer-check-status="${value}"]`);
async function startCheck(page: Page) {
  await page.locator('[data-multiplayer-check-game]').click();
  await expect(status(page, 'checking')).toBeVisible();
  await expect.poll(async () => (await inspect(page)).runtime.phase).toBe('launching');
}
async function idle(page: Page) {
  await expect.poll(async () => (await inspect(page)).runtime.epoch).toBeNull();
  await expect.poll(async () => (await inspect(page)).childUrl).toBe('about:blank');
}
test.beforeEach(async ({page}) => {
  await page.goto(`${origin}/__ui_tests__/multiplayer-preflight.html`);
  await expect(page.locator('[data-multiplayer-check-game]')).toBeEnabled();
});
test('explicit check waits for current first-frame, preserves route/seat and retires the one frame without sync', async ({page}) => {
  const before = await inspect(page), url = page.url();
  await startCheck(page); await expect(page.locator('[data-multiplayer-check-game]')).toBeDisabled();
  await page.evaluate(() => window.__multiplayerPreflightFixture.stale());
  await expect(status(page, 'passed')).toHaveCount(0);
  await expect.poll(async () => (await inspect(page)).runtime.firstFrame).toBe(false);
  const pending = await inspect(page), configure = pending.traces.find(value => value.command === 'configure');
  expect(configure?.options?.multiplayerPreflight).toBe(true);
  expect(Object.keys(configure?.options ?? {}).some(key => key.startsWith('netplay'))).toBe(false);
  await page.evaluate(() => window.__multiplayerPreflightFixture.firstFrame());
  await expect(status(page, 'passed')).toBeVisible(); await idle(page);
  const after = await inspect(page);
  expect(page.url()).toBe(url); expect(after.room.room?.localSeat).toBe(0); expect(after.room.room?.seats[0]?.ready).toBe(false);
  expect(after.sent.some(value => ['start', 'set-ready'].includes(String(value.type)))).toBe(false);
  expect(after.traces.some(value => value.command === 'sync')).toBe(false);
  expect(after.historyLength).toBe(before.historyLength); expect(after.sameFrame && after.sameProxy).toBe(true);
  expect(after.retains).toBe(after.releases); await expect(page.locator('iframe')).toHaveCount(1);
});
test('cancel, preference replacement and root Close interrupt first-frame wait without reporting pass', async ({page}) => {
  for (const cancel of ['button', 'preferences', 'root']) {
    await startCheck(page);
    if (cancel === 'button') await page.locator('[data-multiplayer-cancel-check]').click();
    else if (cancel === 'preferences') await page.evaluate(() => window.__multiplayerPreflightFixture.changePreferences());
    else await page.evaluate(() => window.__multiplayerPreflightFixture.close());
    await idle(page); await expect(status(page, 'passed')).toHaveCount(0);
    expect((await inspect(page)).room.room?.localSeat).toBe(0);
    await expect(page.locator('[data-multiplayer-check-game]')).toBeEnabled();
  }
  expect((await inspect(page)).traces.some(value => value.command === 'sync')).toBe(false);
});
test('engine failure and first-frame timeout are failed checks with cleanup, never prepared-resource success', async ({page}) => {
  await startCheck(page); await page.evaluate(() => window.__multiplayerPreflightFixture.fail());
  await expect(status(page, 'failed')).toContainText('Synthetic first-frame failure'); await idle(page);
  await startCheck(page); await expect(status(page, 'failed')).toContainText('first-frame', {timeout: 10000}); await idle(page);
  expect((await inspect(page)).room.preparation?.status).toBe('ready');
});
test('server start cancels preflight before networked launch; the real game still needs save-close', async ({page}) => {
  await startCheck(page); const checking = await inspect(page);
  await page.evaluate(() => window.__multiplayerPreflightFixture.start());
  await expect.poll(async () => (await inspect(page)).traces.filter(value => value.command === 'launch').length).toBe(2);
  const started = await inspect(page);
  expect(started.releases).toBe(1); expect(started.runtime.epoch).not.toBe(checking.runtime.epoch);
  expect(started.traces.filter(value => value.command === 'configure').at(-1)?.options?.netplayMode).toBe('lan');
  await page.evaluate(() => window.__multiplayerPreflightFixture.firstFrame());
  await expect.poll(async () => (await inspect(page)).room.launch).toBe('running');
  expect((await inspect(page)).traces.some(value => value.command === 'sync')).toBe(false);
  await page.evaluate(() => window.__multiplayerPreflightFixture.close()); await idle(page);
  expect((await inspect(page)).traces.filter(value => value.command === 'sync').length).toBe(1);
});
test('room replacement after root navigation confirmation cannot publish a stale check pass', async ({page}) => {
  await startCheck(page);
  // Drive the real Router blocker and its existing save/close decision UI.
  await page.evaluate(() => {void window.__multiplayerPreflightFixture.navigate('/lobby?uiLocale=en');});
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', {name: 'Save and exit', exact: true}).click();
  await expect(page).toHaveURL(`${origin}/lobby?uiLocale=en`); await idle(page);
  expect((await inspect(page)).room.route).toBeNull();
  expect((await inspect(page)).room.gameCheck).toBeNull();
  expect((await inspect(page)).traces.some(value => value.command === 'sync')).toBe(false);
});
