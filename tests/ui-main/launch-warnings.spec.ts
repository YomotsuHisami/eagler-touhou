/** Synthetic Start/dialog/MIDI call-order coverage. No native game is executed.
 * Authored for the browser CI lane; no local browser acceptance is claimed. */
import {test, expect, type Page} from '@playwright/test';
import type {} from './runtime-controls-fixture';
const origin = process.env.UI_RUNTIME_FIXTURE_ORIGIN ?? 'http://127.0.0.1:4175';
const warning = (page: Page) => page.getByRole('dialog', {name: '确认吗？', exact: true});
async function prepared(page: Page, music: 'none' | 'midi' | 'ogg' = 'none') {
  await page.goto(`${origin}/__ui_tests__/runtime-controls.html?management=1`);
  await page.evaluate(async music => {await window.__runtimeControlsFixture.navigate('/play/th06'); window.__runtimeControlsFixture.start('prepared'); window.__runtimeControlsFixture.setLaunchSettings(music);}, music);
  const panel = page.getByRole('dialog', {name: 'Synthetic management surface', exact: true});
  await expect(panel).toBeVisible(); return panel.getByRole('button', {name: '启动 TH06', exact: true});
}
test('Cancel and Escape restore Start focus; neither warning nor repeated dismissal changes history or frame identity', async ({page}) => {
  const start = await prepared(page), frame = await page.locator('[data-synthetic-runtime-frame]').elementHandle();
  const before = await page.evaluate(() => ({url: location.href, length: history.length}));
  await start.click(); await expect(warning(page)).toBeVisible();
  await expect(warning(page).getByText(/将会在无音乐的情况下继续/)).toBeVisible();
  await expect(warning(page).getByRole('button', {name: '取消', exact: true})).toBeFocused();
  await warning(page).getByRole('button', {name: '取消', exact: true}).click();
  await expect(warning(page)).toHaveCount(0); await expect(start).toBeFocused();
  await start.click(); await warning(page).press('Escape');
  await expect(warning(page)).toHaveCount(0); await expect(start).toBeFocused();
  expect(await page.evaluate(() => window.__runtimeControlsFixture.inspect().launches)).toBe(0);
  expect(await page.evaluate(() => ({url: location.href, length: history.length}))).toEqual(before);
  expect(await frame!.evaluate(element => element === document.querySelector('[data-synthetic-runtime-frame]'))).toBe(true);
});
test('touch-disabled warning precedes MIDI and only final acknowledgment resumes audio under activation and starts once', async ({page}, info) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'maxTouchPoints', {get: () => 5}));
  await page.addInitScript(() => Object.defineProperty(navigator, 'userAgent', {get: () => 'Synthetic iPad'}));
  const start = await prepared(page, 'midi');
  await page.evaluate(() => window.__runtimeControlsFixture.setLaunchSettings('midi', false));
  await start.click(); await expect(page.locator('[data-launch-warning="touch.disabledInputWarning"]')).toBeVisible();
  await warning(page).getByRole('button', {name: '仍要启动', exact: true}).click();
  await expect(page.locator('[data-launch-warning="music.midiLaunchWarning"]')).toBeVisible();
  expect(await page.evaluate(() => window.__runtimeControlsFixture.inspect().midiResumes)).toEqual([]);
  expect(await page.evaluate(() => window.__runtimeControlsFixture.inspect().launches)).toBe(0);
  await page.screenshot({path: info.outputPath('synthetic-midi-prestart-warning.png'), fullPage: true});
  const epoch = await page.evaluate(() => window.__runtimeControlsFixture.inspect().snapshot.epoch);
  await warning(page).getByRole('button', {name: '仍要启动', exact: true}).click();
  await expect.poll(() => page.evaluate(() => window.__runtimeControlsFixture.inspect().launches)).toBe(1);
  expect(await page.evaluate(() => window.__runtimeControlsFixture.inspect().midiResumes)).toEqual([{epoch, active: true}]);
  await page.evaluate(() => window.__runtimeControlsFixture.resolveLaunch());
  await expect(warning(page)).toHaveCount(0); await expect(page.locator('[data-synthetic-runtime-frame]')).toHaveCount(1);
});
test('pending acknowledgment is discarded on superseding epoch, file operation or save guard', async ({page}) => {
  for (const reason of ['epoch', 'file', 'save'] as const) {
    const start = await prepared(page); await start.click(); await expect(warning(page)).toBeVisible();
    await page.evaluate(reason => {
      const fixture = window.__runtimeControlsFixture;
      if (reason === 'epoch') {fixture.start('prepared'); fixture.setLaunchSettings('none');}
      if (reason === 'file') fixture.setFileBusy(true);
      if (reason === 'save') fixture.setSaveError('Synthetic save blocked');
    }, reason);
    await expect(warning(page)).toHaveCount(0);
    expect(await page.evaluate(() => window.__runtimeControlsFixture.inspect().launches)).toBe(0);
    if (reason === 'epoch') {await start.click(); await expect(warning(page)).toBeVisible(); await warning(page).press('Escape');}
    else await expect(start).toBeDisabled();
  }
});
test('initial and reopened warnings own same-click Escape before another event or animation frame', async ({page}, info) => {
  const start = await prepared(page), frame = await page.locator('[data-synthetic-runtime-frame]').elementHandle();
  const before = await page.evaluate(() => ({url: location.href, length: history.length}));
  for (let attempt = 0; attempt < 2; attempt++) {
    // HTMLElement.click() does not focus its target. Establish the same opener
    // as keyboard/pointer activation before testing the uninterrupted key task.
    await start.focus();await expect(start).toBeFocused();
    const immediate = await start.evaluate((button: HTMLButtonElement) => {
      button.click();
      const scope = document.querySelector<HTMLElement>('[data-launch-warning]')?.closest<HTMLElement>('[data-animated-dialog]');
      const focused = document.activeElement;
      const result = {present: scope?.dataset.presence, focusedInside: !!scope?.contains(focused), focusedText: focused?.textContent};
      for (let n = 0; n < 2; n++) document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true, cancelable: true}));
      return result;
    });
    await info.attach(`immediate-warning-scope-${attempt}`, {body: JSON.stringify(immediate), contentType: 'application/json'});
    expect(immediate).toEqual({present: 'present', focusedInside: true, focusedText: '取消'});
    await expect(warning(page)).toHaveCount(0);await expect(start).toBeFocused();
    expect(await page.evaluate(() => window.__runtimeControlsFixture.inspect().launches)).toBe(0);
    expect(await page.evaluate(() => window.__runtimeControlsFixture.inspectManagementInput())).toEqual({dismissals: 0, escapes: 0});
  }
  expect(await page.evaluate(() => ({url: location.href, length: history.length}))).toEqual(before);
  expect(await frame!.evaluate(element => element === document.querySelector('[data-synthetic-runtime-frame]'))).toBe(true);
});
