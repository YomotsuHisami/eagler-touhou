/** These synthetic browser regressions are authored for authorized CI only. */
import {test, expect, type Locator, type Page} from '@playwright/test';
import type {} from './room-panels-fixture';
const origin = process.env.UI_RUNTIME_FIXTURE_ORIGIN ?? 'http://127.0.0.1:4175';
const base = '/play/th06mp?uiLocale=en&mpRoom=1234&room=1234&extra=a%2Bb#kept';
async function load(page: Page, initial = base, populated = false) {
  await page.emulateMedia({reducedMotion: 'reduce'});
  await page.goto(`${origin}/__ui_tests__/room-panels.html?${populated ? 'populated=1&' : ''}initial=${encodeURIComponent(initial)}`);
  await expect(page.locator('section[aria-label="Multiplayer room"]')).toBeVisible();
}
async function retained(page: Page) {
  expect(await page.evaluate(() => window.__roomPanelsFixture.inspect())).toMatchObject({joins: 1, leaves: 0, sockets: 0, requests: 1, roomCode: '1234'});
}
/** Visibility alone includes opacity-zero entry frames and offscreen content.
 * Evidence must show the settled surface inside the actual CSS viewport. */
async function settledEvidenceSurface(page: Page, surface: Locator, dialog = false) {
  await expect(surface).toBeVisible();
  if (dialog) {
    await expect(surface).toHaveAttribute('data-presence', 'present');
    await expect(surface).toHaveCSS('opacity', '1');
    await expect(page.locator('[data-dialog-overlay]')).toHaveCSS('opacity', '1');
  }
  await expect.poll(() => surface.evaluate(element => {
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && rect.left >= 0 && rect.top >= 0 &&
      rect.right <= window.innerWidth + 1 && rect.bottom <= window.innerHeight + 1 &&
      document.documentElement.scrollWidth <= window.innerWidth;
  })).toBe(true);
}
async function retiredEvidenceDialogs(page: Page) {
  // Exiting Radix content is aria-hidden before Motion removes the portal.
  // A role query alone can therefore acknowledge dismissal too early.
  await expect(page.locator('[data-animated-dialog]')).toHaveCount(0);
  await expect(page.locator('[data-dialog-overlay]')).toHaveCount(0);
}
for (const [kind, label] of [['personal', 'Personal settings / Loadout'], ['game', 'Room / Difficulty settings'], ['network', 'Network diagnostics / Input timing'], ['spectators', 'Spectators (0)']] as const) {
  test(`${kind} sheet closes with Back and Escape, keeps room/frame and restores its trigger`, async ({page}) => {
    const errors: string[] = [];page.on('pageerror', error => errors.push(error.message));await load(page, base, kind === 'personal');
    const frame = await page.locator('#retained-room-frame').elementHandle(), trigger = page.getByRole('button', {name: label, exact: true});
    await trigger.click();await expect(page.getByRole('dialog', {name: label, exact: true})).toBeVisible();await expect(page).toHaveURL(new RegExp(`roomPanel=${kind}`));
    await page.goBack();await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page).toHaveURL(origin + base);await expect(trigger).toBeFocused();await retained(page);
    await page.goForward();await expect(page.getByRole('dialog', {name: label, exact: true})).toBeVisible();await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page).toHaveURL(origin + base);
    expect(await frame?.evaluate(node => node === document.getElementById('retained-room-frame'))).toBe(true);await retained(page);expect(errors).toEqual([]);
  });
}
test('personal game/touch settings reuse one dialog/history slot; nested Help returns to room controls', async ({page}) => {
  await load(page, base, true);const trigger = page.getByRole('button', {name: 'Personal settings / Loadout', exact: true});await trigger.click();
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
  await load(page, base, true);await page.evaluate(() => window.__roomPanelsFixture.holdNext());
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

test('Host recovery retries only when the fixture room clock advances, without replacing membership', async ({page}) => {
  await load(page);await retained(page);
  await expect(page.getByRole('status').filter({hasText: /^Reconnecting$/})).toBeVisible();
  await page.evaluate(() => window.__roomPanelsFixture.advanceRoomTime(649));await retained(page);
  await page.evaluate(() => window.__roomPanelsFixture.advanceRoomTime(1));
  await expect.poll(() => page.evaluate(() => window.__roomPanelsFixture.inspect().requests)).toBe(2);
  expect(await page.evaluate(() => window.__roomPanelsFixture.inspect())).toMatchObject({joins: 1, leaves: 0, sockets: 0, requests: 2, roomCode: '1234'});
  await expect(page).toHaveURL(origin + base);
});

test('source-owned populated room and every secondary surface produce reviewable evidence', async ({page}, info) => {
  info.annotations.push({type: 'synthetic-data', description: 'Fixture nicknames, membership and prepared state are fixed source-owned display data; room surfaces expose only initials and loadout labels. Fixture remains unavailable with zero relay sockets.'});
  await page.emulateMedia({reducedMotion: 'reduce'});
  await page.goto(`${origin}/__ui_tests__/room-panels.html?populated=1&initial=${encodeURIComponent(base)}`);
  await expect(page.locator('#mpRoomView .mp-seat-glyph')).toHaveText(['S', 'S']);
  await expect(page.locator('#mpRoomView .mp-seat-name')).toHaveText(['Reimu A', 'Reimu B']);
  expect(await page.locator('#mpRoomView').innerText()).not.toContain('Sample host');
  expect(await page.locator('#mpRoomView').innerText()).not.toContain('Sample guest');
  await expect(page.locator('#mpRoomView .mp-network-summary')).toContainText('Unavailable');
  await settledEvidenceSurface(page, page.locator('section[aria-label="Multiplayer room"]'));
  // Keep the source-owned room evidence at the viewport size used by the
  // compact dock rather than expanding it around fixture content behind it.
  await page.screenshot({path: info.outputPath('synthetic-populated-room.png'), fullPage: false});
  for (const [name, kind] of [['Personal settings / Loadout', 'personal'], ['Room / Difficulty settings', 'game'], ['Network diagnostics / Input timing', 'network'], ['Spectators (1)', 'spectators']]) {
    await retiredEvidenceDialogs(page);
    const trigger = kind === 'personal' ? page.locator('.mp-seat-edit') : page.getByRole('button', {name, exact: true});
    await trigger.click();
    await settledEvidenceSurface(page, page.getByRole('dialog', {name, exact: true}), true);
    if (kind === 'spectators') {
      await expect(page.locator('.mp-spectator-copy strong')).toHaveText(['Spectator 1']);
      expect(await page.locator('[role="dialog"]').innerText()).not.toContain('Sample viewer');
    }
    await page.screenshot({path: info.outputPath(`synthetic-room-${kind}.png`), fullPage: false});
    if (kind === 'personal') {
      await page.getByRole('button', {name: 'Game / Touch settings', exact: true}).click();
      await expect(page.getByRole('form', {name: 'Game settings', exact: true})).toBeVisible();
      await settledEvidenceSurface(page, page.locator('[data-dialog-layout="library-panel"]'), true);
      await page.screenshot({path: info.outputPath('synthetic-room-options.png'), fullPage: false});
    }
    await page.keyboard.press('Escape'); await expect(page.getByRole('dialog')).toHaveCount(0);
    await retiredEvidenceDialogs(page);
  }
  await retained(page);
});

async function retractRoomOptions(page: Page) {
  const header = page.locator('[data-swipe-to-close="right"] [data-product-cover]');
  await expect(header).toBeVisible();
  const box = (await header.boundingBox())!;
  const x = box.x + Math.min(140, box.width / 3), y = box.y + 78;
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 80, y + 1, {steps: 8}); await page.mouse.up();
}
for (const direct of [false, true]) test(`room options right swipe uses ${direct ? 'direct-link replacement' : 'owned Back'} without leaving its room`, async ({page}) => {
  await load(page, direct ? base.replace('#kept', '&roomOptions=1#kept') : base);
  const frame = await page.locator('#retained-room-frame').elementHandle();
  if (!direct) await page.getByRole('button', {name: 'Game / Touch settings', exact: true}).click();
  await expect(page.locator('[data-swipe-to-close="right"]')).toBeVisible(); await retractRoomOptions(page);
  await expect(page.getByRole('dialog')).toHaveCount(0); await expect(page).toHaveURL(origin + base); await retained(page);
  expect(await frame!.evaluate(node => node === document.getElementById('retained-room-frame'))).toBe(true);
  if (!direct) await expect(page.getByRole('button', {name: 'Game / Touch settings', exact: true})).toBeFocused();
});
test('room options swipe during held routing dismisses one acknowledged entry and cannot replace newer navigation', async ({page}) => {
  await load(page); await page.evaluate(() => window.__roomPanelsFixture.holdNext()); await page.getByRole('button', {name: 'Game / Touch settings', exact: true}).click();
  await retractRoomOptions(page); await expect.poll(() => page.evaluate(() => window.__roomPanelsFixture.inspect().held)).toBe(1);
  await page.evaluate(() => window.__roomPanelsFixture.release()); await expect(page.getByRole('dialog')).toHaveCount(0); await expect(page).toHaveURL(origin + base);
  await page.getByRole('button', {name: 'Game / Touch settings', exact: true}).click();
  const header = (await page.locator('[data-swipe-to-close="right"] [data-product-cover]').boundingBox())!;
  await page.mouse.move(header.x + 140, header.y + 78); await page.mouse.down(); await page.mouse.move(header.x + 165, header.y + 78);
  const newer = base.replace('#kept', '&roomOptions=1&newer=1#newer'); await page.evaluate(to => window.__roomPanelsFixture.navigate(to), newer);
  await page.mouse.move(header.x + 230, header.y + 78); await page.mouse.up();
  await expect(page).toHaveURL(origin + newer); await expect(page.locator('[data-swipe-to-close="right"]')).toBeVisible(); await retained(page);
});
test('room close swipe leaves slider editing, nested Help and touch-editor drag ownership alone', async ({page}) => {
  const options = base.replace('#kept', '&roomOptions=1#kept'); await load(page, options);
  await page.locator('[data-swipe-to-close="right"] details.game-settings-touch > summary').click();
  await page.getByRole('button', {name: 'Button layout & touch settings', exact: true}).click();
  await expect(page.locator('.touch-editor-shell')).toBeVisible();
  const slider = page.locator('.touch-editor-shell .touch-settings-opacity input[type="range"]'); await slider.scrollIntoViewIfNeeded();
  const range = (await slider.boundingBox())!; await page.mouse.move(range.x + 20, range.y + range.height / 2); await page.mouse.down(); await page.mouse.move(range.x + Math.min(range.width - 10, 110), range.y + range.height / 2, {steps: 6}); await page.mouse.up();
  await expect(page).toHaveURL(origin + options.replace('#kept', '&touchLayout=1#kept'));
  await page.getByRole('button', {name: 'Exit', exact: true}).click();
  await expect(page.locator('.touch-editor-shell')).toHaveCount(0); await expect(page).toHaveURL(origin + options);
  await page.evaluate(to => window.__roomPanelsFixture.navigate(to), options.replace('#kept', '&panel=help#kept'));
  const help = page.locator('[data-dialog-layout="dialog"]'); await expect(help).toBeVisible();
  const title = (await help.locator('h2').first().boundingBox())!; await page.mouse.move(title.x + 15, title.y + title.height / 2); await page.mouse.down(); await page.mouse.move(title.x + 95, title.y + title.height / 2, {steps: 6}); await page.mouse.up();
  await expect(page).toHaveURL(/roomOptions=1&panel=help/); await expect(help).toBeVisible(); await page.keyboard.press('Escape');
  await expect(page.locator('[data-swipe-to-close="right"]')).toBeVisible();
  await page.getByRole('button', {name: 'Button layout & touch settings', exact: true}).click(); await expect(page.locator('[data-touch-editor-scene]')).toHaveAttribute('data-touch-editor-ready', 'true');
  const bomb = (await page.locator('[data-touch-layout-control="bomb"]').boundingBox())!; await page.mouse.move(bomb.x + bomb.width / 2, bomb.y + bomb.height / 2); await page.mouse.down(); await page.mouse.move(bomb.x + bomb.width / 2 + 80, bomb.y + bomb.height / 2, {steps: 6}); await page.mouse.up();
  await expect(page).toHaveURL(/roomOptions=1.*touchLayout=1/); await expect(page.locator('[data-touch-editor-scene]')).toBeVisible(); await retained(page);
});
