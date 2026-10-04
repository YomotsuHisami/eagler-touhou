/** These synthetic browser regressions are authored for authorized CI only. */
import {test, expect, type Page} from '@playwright/test';
import type {} from './room-panels-fixture';
const origin = process.env.UI_RUNTIME_FIXTURE_ORIGIN ?? 'http://127.0.0.1:4175';
const base = '/play/th06mp?uiLocale=en&mpRoom=1234&room=1234&extra=a%2Bb#kept';
async function load(page: Page, initial = base) {
  await page.emulateMedia({reducedMotion: 'reduce'});
  await page.goto(`${origin}/__ui_tests__/room-panels.html?initial=${encodeURIComponent(initial)}`);
  await expect(page.locator('section[aria-label="Multiplayer room"]')).toBeVisible();
}
async function retained(page: Page) {
  expect(await page.evaluate(() => window.__roomPanelsFixture.inspect())).toMatchObject({joins: 1, leaves: 0, sockets: 0, requests: 1, roomCode: '1234'});
}
for (const [kind, label] of [['personal', 'Personal settings / Loadout'], ['game', 'Room / Difficulty settings'], ['network', 'Network diagnostics / Input timing'], ['spectators', 'Spectators (0)']] as const) {
  test(`${kind} sheet closes with Back and Escape, keeps room/frame and restores its trigger`, async ({page}) => {
    const errors: string[] = [];page.on('pageerror', error => errors.push(error.message));await load(page);
    const frame = await page.locator('#retained-room-frame').elementHandle(), trigger = page.getByRole('button', {name: label, exact: true});
    await trigger.click();await expect(page.getByRole('dialog', {name: label, exact: true})).toBeVisible();await expect(page).toHaveURL(new RegExp(`roomPanel=${kind}`));
    await page.goBack();await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page).toHaveURL(origin + base);await expect(trigger).toBeFocused();await retained(page);
    await page.goForward();await expect(page.getByRole('dialog', {name: label, exact: true})).toBeVisible();await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page).toHaveURL(origin + base);
    expect(await frame?.evaluate(node => node === document.getElementById('retained-room-frame'))).toBe(true);await retained(page);expect(errors).toEqual([]);
  });
}
test('personal game/touch settings reuse one dialog/history slot; nested Help returns to room controls', async ({page}) => {
  await load(page);const trigger = page.getByRole('button', {name: 'Personal settings / Loadout', exact: true});await trigger.click();
  const dialog = await page.getByRole('dialog').elementHandle();
  await page.getByRole('button', {name: 'Game / Touch settings', exact: true}).click();await expect(page).toHaveURL(/roomOptions=1/);await expect(page).not.toHaveURL(/roomPanel=/);
  await expect(page.getByRole('dialog')).toHaveCount(1);expect(await dialog?.evaluate(node => node === document.querySelector('[role="dialog"]'))).toBe(true);
  await expect(page.getByRole('form', {name: 'Game settings', exact: true})).toBeVisible();await page.keyboard.press('Escape');await expect(page).toHaveURL(origin + base);await expect(trigger).toBeFocused();
  await trigger.click();await page.getByRole('link', {name: 'Controls help', exact: true}).click();await expect(page).toHaveURL(/panel=help/);await page.keyboard.press('Escape');await expect(page).not.toHaveURL(/panel=help/);
  await expect(page.getByRole('dialog', {name: 'Personal settings / Loadout', exact: true})).toBeVisible();await page.keyboard.press('Escape');await expect(page).toHaveURL(origin + base);await retained(page);
});
test('direct-linked panels and old roomOptions close locally preserving query and hash', async ({page}) => {
  for (const extra of ['roomPanel=network', 'roomOptions=1']) {
    await load(page, base.replace('#kept', `&${extra}#kept`));await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page).toHaveURL(origin + base);await retained(page);
  }
});
test('Escape during a held Router open closes only after its entry commits, with no extra Back', async ({page}) => {
  await load(page);await page.evaluate(() => window.__roomPanelsFixture.holdNext());
  await page.getByRole('button', {name: 'Personal settings / Loadout', exact: true}).click();await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');await page.keyboard.press('Escape');await expect.poll(() => page.evaluate(() => window.__roomPanelsFixture.inspect().held)).toBe(1);
  await page.evaluate(() => window.__roomPanelsFixture.release());await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page).toHaveURL(origin + base);await retained(page);
});
test('newer room-preserving navigation wins over an old pending Escape', async ({page}) => {
  await load(page);await page.evaluate(() => window.__roomPanelsFixture.holdNext());await page.getByRole('button', {name: 'Network diagnostics / Input timing', exact: true}).click();await page.keyboard.press('Escape');
  const newer = base.replace('#kept', '&newer=1#newer');await page.evaluate(to => window.__roomPanelsFixture.navigate(to), newer);await page.evaluate(() => window.__roomPanelsFixture.release());
  await expect(page).toHaveURL(origin + newer);await expect(page.getByRole('dialog')).toHaveCount(0);await retained(page);
});
test('room code falls back on insecure/missing and denied Clipboard API, and reports actual failure', async ({page}) => {
  await load(page);const copy = page.getByRole('button', {name: /1234.*Copy/});
  for (const mode of ['missing', 'reject'] as const) {await page.evaluate(mode => window.__roomPanelsFixture.copyMode(mode), mode);await copy.click();await expect(page.getByText('Room code copied', {exact: true})).toBeVisible();await expect(copy).toBeFocused();}
  expect(await page.evaluate(() => window.__roomPanelsFixture.inspect().copied)).toEqual(['1234', '1234']);
  await page.evaluate(() => window.__roomPanelsFixture.copyMode('fail'));await copy.click();await expect(page.getByText('Could not copy automatically. Select the room code and copy it manually.', {exact: true})).toBeVisible();
  await expect(page.locator('textarea')).toHaveCount(0);await retained(page);
});
