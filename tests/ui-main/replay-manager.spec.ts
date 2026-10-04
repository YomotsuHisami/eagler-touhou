import {test, expect, type Page} from '@playwright/test';
import type {} from './replay-manager-fixture';
// Synthetic React/Router/Radix + file-port coverage, not Runtime persistence.
const origin=process.env.UI_RUNTIME_FIXTURE_ORIGIN ?? 'http://127.0.0.1:4175';
const dialogTitle='Enter a new replay filename';
async function openRename(page:Page) {
  await page.getByRole('button',{name:'Rename th6_01.rpy',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:dialogTitle,exact:true});
  await expect(dialog).toBeVisible();await expect(dialog.getByLabel('New replay filename')).toBeFocused();
  return dialog;
}
async function writes(page:Page) {return page.evaluate(()=>window.__replayManagerFixture.inspect().calls.filter(command=>command==='write'||command==='remove'));}
test.beforeEach(async({page})=>{
  await page.goto(`${origin}/__ui_tests__/replay-manager.html`);
  await page.evaluate(()=>window.__replayManagerFixture.navigate('/play/th06/replays?uiLocale=en'));
  await expect(page.getByRole('button',{name:'Rename th6_01.rpy',exact:true})).toBeVisible();
});

test('rename uses an accessible localized dialog, keeps invalid/colliding drafts editable, and updates the list after persistence acknowledgement',async({page})=>{
  const dialog=await openRename(page),input=dialog.getByLabel('New replay filename');
  await expect(input).toHaveValue('th6_01.rpy');
  await input.fill('th7_03.rpy');await input.press('Enter');
  await expect(dialog.getByRole('alert')).toContainText('Filename must match th6_01.rpy');
  expect(await writes(page)).toEqual([]);
  await input.fill('TH6_02.RPY');await input.press('Enter');
  await expect(dialog.getByRole('alert')).toHaveText('A replay with that name already exists');
  expect(await writes(page)).toEqual([]);
  await input.fill('th6_03.rpyx');await input.press('Enter');
  await expect(dialog).toHaveCount(0);await expect(page.getByRole('button',{name:'Rename th6_03.rpyx',exact:true})).toBeVisible();
  await expect(page.getByRole('status').filter({hasText:'Renamed to th6_03.rpyx.'})).toBeVisible();
  expect(await writes(page)).toEqual(['write','remove']);
  expect((await page.evaluate(()=>window.__replayManagerFixture.inspect())).files).toEqual({'replay/th6_02.rpy':[9],'replay/th6_03.rpyx':[0,128,255]});
});

test('Escape, Cancel, navigation and Back dismiss drafts without changing replay files or reopening stale dialogs',async({page})=>{
  let dialog=await openRename(page);await dialog.getByLabel('New replay filename').fill('th6_03.rpy');await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);await expect(page.getByRole('button',{name:'Rename th6_01.rpy',exact:true})).toBeFocused();
  dialog=await openRename(page);await expect(dialog.getByLabel('New replay filename')).toHaveValue('th6_01.rpy');
  await dialog.getByRole('button',{name:'Cancel',exact:true}).click();await expect(dialog).toHaveCount(0);
  await openRename(page);await page.evaluate(()=>window.__replayManagerFixture.navigate('/other?uiLocale=en'));
  await expect(page.getByRole('dialog')).toHaveCount(0);await page.goBack();
  await expect(page.getByRole('button',{name:'Rename th6_01.rpy',exact:true})).toBeVisible();await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await writes(page)).toEqual([]);
});

test('same-tick submits cannot queue writes, and accepted work survives route dismissal',async({page})=>{
  const dialog=await openRename(page);await dialog.getByLabel('New replay filename').fill('th6_03.rpy');
  await page.evaluate(()=>window.__replayManagerFixture.holdRead());
  await dialog.locator('form').evaluate(form=>{if (!(form instanceof HTMLFormElement)) throw new Error('Expected rename form');form.requestSubmit();form.requestSubmit();});
  await expect(dialog.getByRole('button',{name:'Rename',exact:true})).toBeDisabled();
  await page.evaluate(()=>window.__replayManagerFixture.navigate('/other?uiLocale=en'));
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.evaluate(()=>window.__replayManagerFixture.releaseRead());
  await expect.poll(()=>writes(page)).toEqual(['write','remove']);
  await page.goBack();await expect(page.getByRole('button',{name:'Rename th6_03.rpy',exact:true})).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('external file work disables rename and replacement epochs close drafts and stop late writes',async({page})=>{
  await page.evaluate(()=>window.__replayManagerFixture.externalBusy(true));
  await expect(page.getByRole('button',{name:'Rename th6_01.rpy',exact:true})).toBeDisabled();
  await page.evaluate(()=>window.__replayManagerFixture.externalBusy(false));
  const dialog=await openRename(page);await dialog.getByLabel('New replay filename').fill('th6_03.rpy');
  await page.evaluate(()=>window.__replayManagerFixture.holdRead());await dialog.getByRole('button',{name:'Rename',exact:true}).click();
  await expect(dialog.getByRole('button',{name:'Rename',exact:true})).toBeDisabled();
  await page.evaluate(()=>{window.__replayManagerFixture.replaceSession();window.__replayManagerFixture.releaseRead();});
  await expect(dialog).toHaveCount(0);await expect(page.getByRole('alert')).toBeVisible();
  expect(await writes(page)).toEqual([]);
  expect((await page.evaluate(()=>window.__replayManagerFixture.inspect())).files['replay/th6_01.rpy']).toEqual([0,128,255]);
});
