import {test, expect, type Page} from '@playwright/test';
import type {} from './title-room-entry-fixture';
const origin = process.env.UI_RUNTIME_FIXTURE_ORIGIN ?? 'http://127.0.0.1:4175';
async function load(page: Page) {
  await page.emulateMedia({reducedMotion: 'reduce'});
  await page.goto(`${origin}/__ui_tests__/title-room-entry.html`);
  await expect(page.locator('[data-title-owner]')).toHaveText('Ready');
}
async function request(page: Page) {await page.evaluate(() => window.__titleRoomFixture.request());await expect(page.getByRole('dialog')).toBeVisible();}

test('title create/Back/dismiss preserves the frame, releases room membership and cannot reopen via Forward', async ({page}) => {
  const errors: string[] = [];page.on('pageerror', error => errors.push(error.message)); await load(page);
  const frame = await page.locator('#synthetic-title-frame').elementHandle();
  await request(page);await page.getByRole('button', {name: 'Create room', exact: true}).click();
  await expect(page.getByRole('region', {name: 'Multiplayer room', exact: true})).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__titleRoomFixture.inspect().room)).toMatch(/^\d{4}$/);
  const bounds = await page.getByRole('dialog').boundingBox(), viewport = page.viewportSize()!;
  expect(bounds?.x).toBe(0);expect(bounds?.y).toBe(0);expect(bounds?.width).toBe(viewport.width);expect(bounds?.height).toBe(viewport.height);
  await page.goBack();await expect(page.getByRole('button', {name: 'Create room', exact: true})).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__titleRoomFixture.inspect().room)).toBeNull();
  expect(await page.evaluate(() => window.__titleRoomFixture.inspect().cancel)).toBe(0);
  await page.goBack();await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__titleRoomFixture.inspect().cancel)).toBe(1);
  await page.goForward();await expect(page).not.toHaveURL(/titleRoom=/);await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await frame?.evaluate(node => node === document.getElementById('synthetic-title-frame'))).toBe(true);
  expect(await page.evaluate(() => window.__titleRoomFixture.inspect().sockets)).toBe(0);expect(errors).toEqual([]);
});
test('numeric join and room close resume the title once; repeated/stale requests cannot create duplicate dialogs', async ({page}) => {
  await load(page);await page.evaluate(() => window.__titleRoomFixture.request(6));await expect(page.getByRole('dialog')).toHaveCount(0);
  await request(page);await page.evaluate(() => {window.__titleRoomFixture.request();window.__titleRoomFixture.request();});await expect(page.getByRole('dialog')).toHaveCount(1);
  await page.getByRole('textbox', {name: 'Room code', exact: true}).fill('123456');await page.getByRole('button', {name: 'Join room', exact: true}).click();
  await expect.poll(() => page.evaluate(() => window.__titleRoomFixture.inspect().room)).toBe('123456');
  await page.getByRole('button', {name: 'Close', exact: true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__titleRoomFixture.inspect().cancel)).toBe(1);
  await expect.poll(() => page.evaluate(() => window.__titleRoomFixture.inspect().room)).toBeNull();
  expect(await page.evaluate(() => window.__titleRoomFixture.inspect().close)).toBe(0);
});
test('a replacement title epoch clears stale UI without sending cancellation to the replacement', async ({page}) => {
  await load(page);await request(page);await page.evaluate(() => window.__titleRoomFixture.replace());
  await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page).not.toHaveURL(/titleRoom=/);
  expect(await page.evaluate(() => window.__titleRoomFixture.inspect().cancel)).toBe(0);
});
test('embedded TH09 secondary settings Back/Escape retain room membership and its native title epoch', async ({page}) => {
  await load(page);await request(page);await page.getByRole('button', {name: 'Create room', exact: true}).click();
  await expect(page.getByRole('region', {name: 'Multiplayer room', exact: true})).toBeVisible();
  const before = await page.evaluate(() => window.__titleRoomFixture.inspect()), frame = await page.locator('#synthetic-title-frame').elementHandle();
  const trigger = page.getByRole('button', {name: 'Personal settings / Loadout', exact: true});await trigger.click();
  await expect(page.getByRole('dialog', {name: 'Personal settings / Loadout', exact: true})).toBeVisible();
  await page.getByRole('button', {name: 'Game / Touch settings', exact: true}).click();await expect(page).toHaveURL(/\/play\/th09\?.*titleRoom=7.*roomOptions=1/);
  await expect(page.getByRole('form', {name: 'Game settings', exact: true})).toBeVisible();
  await page.goBack();await expect(page).not.toHaveURL(/roomOptions=|roomPanel=/);await expect(trigger).toBeFocused();
  expect(await page.evaluate(() => window.__titleRoomFixture.inspect())).toEqual(before);
  await trigger.click();await page.keyboard.press('Escape');await expect(page).not.toHaveURL(/roomPanel=/);await expect(trigger).toBeFocused();
  expect(await page.evaluate(() => window.__titleRoomFixture.inspect())).toEqual(before);
  expect(await frame?.evaluate(node => node === document.getElementById('synthetic-title-frame'))).toBe(true);
});

test('synthetic pagehide/pageshow retains the existing title receipt and never cancels its Runtime', async ({page}) => {
  const errors: string[] = [];page.on('pageerror', error => errors.push(error.message));await load(page);await request(page);
  const before = await page.evaluate(() => window.__titleRoomFixture.inspect()), url = page.url();
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', {persisted: true})));
  await expect(page.locator('[data-title-owner]')).toHaveText('Loading');
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', {persisted: true})));
  await expect(page.locator('[data-title-owner]')).toHaveText('Ready');
  await expect(page.getByRole('dialog', {name: 'Phantasmagoria of Flower View · Versus', exact: true})).toBeVisible();
  await expect(page).toHaveURL(url);
  expect(await page.evaluate(() => window.__titleRoomFixture.inspect())).toEqual(before);
  expect(errors).toEqual([]);
});
