import {test as base, expect, type Page} from '@playwright/test';
import type {} from './runtime-history-fixture';

// Uses the real service and real browser joint history with a synthetic peer.
// Browser execution is reserved for the authorized CI lane, never game proof.
const origin = process.env.UI_RUNTIME_FIXTURE_ORIGIN ?? 'http://127.0.0.1:4175';
const fixtureUrl = `${origin}/__ui_tests__/runtime-history.html`;
const test = base.extend<{browserErrors: string[]}>({browserErrors: [async ({page}, use) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await use(errors); expect(errors).toEqual([]);
}, {auto: true}]});
const inspect = (page: Page) => page.evaluate(() => window.__runtimeHistoryFixture.inspect());
async function settledChild(page: Page, idle = false) {
  await expect.poll(async () => (await inspect(page)).childReadyState).toBe('complete');
  if (idle) await expect.poll(async () => (await inspect(page)).childUrl).toBe('about:blank');
  else await expect(page.frameLocator('[data-runtime-history-frame]').locator('#status')).toHaveText('Synthetic protocol peer ready, no game or persistence');
}
async function stableHistory(page: Page, length: number, hostId: string) {
  const current = await inspect(page);
  expect(current.historyLength).toBe(length);
  expect(current.hostDocumentId).toBe(hostId);
  expect(current.sameHostDocument).toBe(true); expect(current.sameFrame).toBe(true); expect(current.sameProxy).toBe(true);
  await expect(page.locator('[data-runtime-history-frame]')).toHaveCount(1);
}
test.beforeEach(async ({page}) => {
  await page.goto(fixtureUrl);
  await expect(page.getByTestId('history-runtime-phase')).toHaveText('idle');
  await page.getByRole('link', {name: 'Synthetic product route', exact: true}).click();
  await expect(page).toHaveURL(`${origin}/games/th06`);
});

test('real service replacements do not append joint history through prepare/start/close/reprepare/cancel/fallback', async ({page}) => {
  const initial = await inspect(page);
  for (let cycle = 0; cycle < 2; cycle++) {
    await page.evaluate(() => window.__runtimeHistoryFixture.prepare()); await settledChild(page);
    await stableHistory(page, initial.historyLength, initial.hostDocumentId);
    await page.evaluate(() => {window.__runtimeHistoryFixture.rememberRuntime();});
    await page.evaluate(() => window.__runtimeHistoryFixture.launch());
    expect((await inspect(page)).sameChildDocument).toBe(true);
    expect(await page.evaluate(() => window.__runtimeHistoryFixture.close())).toBe(true);
    await settledChild(page, true); await stableHistory(page, initial.historyLength, initial.hostDocumentId);
  }
  await page.evaluate(() => window.__runtimeHistoryFixture.prepare()); await settledChild(page);
  await page.evaluate(() => window.__runtimeHistoryFixture.cancel());
  await settledChild(page, true); await stableHistory(page, initial.historyLength, initial.hostDocumentId);

  await page.evaluate(() => window.__runtimeHistoryFixture.beginPausedPreparation());
  await expect(page.frameLocator('[data-runtime-history-frame]').locator('#status')).toHaveText('Synthetic readiness intentionally paused');
  await page.evaluate(() => window.__runtimeHistoryFixture.cancel());
  await expect.poll(async () => (await inspect(page)).pendingPreparation).toBe(false);
  await settledChild(page, true); await stableHistory(page, initial.historyLength, initial.hostDocumentId);

  await page.evaluate(() => window.__runtimeHistoryFixture.prepare({fallback: true})); await settledChild(page);
  const recovered = await inspect(page);
  expect(recovered.snapshot.codeGeneration).toBe('b'.repeat(64));
  expect(recovered.codeExclusions).toEqual([[], ['a'.repeat(64)]]);
  await stableHistory(page, initial.historyLength, initial.hostDocumentId);
  expect(await page.evaluate(() => window.__runtimeHistoryFixture.close())).toBe(true);
  await settledChild(page, true); await stableHistory(page, initial.historyLength, initial.hostDocumentId);
});

test('public Router POP reaches the close decision and cancel retains the actual child document', async ({page}) => {
  const initial = await inspect(page);
  await page.evaluate(() => window.__runtimeHistoryFixture.prepare()); await settledChild(page);
  await page.evaluate(() => window.__runtimeHistoryFixture.launch());
  await page.evaluate(() => window.__runtimeHistoryFixture.rememberRuntime());
  const running = await inspect(page);
  await stableHistory(page, initial.historyLength, initial.hostDocumentId);

  // Public numeric navigation invokes browser history traversal. Do not await
  // a document load: the Router intentionally blocks this same-document POP.
  await page.evaluate(() => {void window.__runtimeHistoryFixture.navigate(-1);});
  await expect(page.getByRole('dialog', {name: '结束当前游戏？'})).toBeVisible();
  await expect(page).toHaveURL(`${origin}/games/th06`);
  expect((await inspect(page)).sameChildDocument).toBe(true);
  await page.getByRole('button', {name: '取消', exact: true}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect((await inspect(page)).snapshot.epoch).toBe(running.snapshot.epoch);
  expect((await inspect(page)).sameChildDocument).toBe(true);

  await page.evaluate(() => {void window.__runtimeHistoryFixture.navigate(-1);});
  await expect(page.getByRole('dialog', {name: '结束当前游戏？'})).toBeVisible();
  await page.getByRole('button', {name: '保存并退出', exact: true}).click();
  await expect(page).toHaveURL(fixtureUrl);
  await expect(page.getByTestId('history-runtime-phase')).toHaveText('idle');
  await settledChild(page, true); await stableHistory(page, initial.historyLength, initial.hostDocumentId);
});
