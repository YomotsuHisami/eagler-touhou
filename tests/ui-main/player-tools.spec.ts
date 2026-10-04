/** Run only in the authorized CI browser lane. Fullscreen/clipboard are injected;
 * these tests do not measure a real game or certify physical-device behavior. */
import {test, expect} from '@playwright/test';
const fixture = 'http://127.0.0.1:4175/__ui_tests__/player-tools.html?uiLocale=en';
test('fullscreen retry preserves frame/document and all dialogs remain under the fullscreen surface', async ({page}) => {
  await page.goto(fixture);await page.evaluate(() => window.__playerToolsFixture.mode('deny'));
  await page.getByRole('button', {name: 'Enter fullscreen', exact: true}).click();
  await expect(page.getByRole('alert')).toContainText('Synthetic fullscreen blocked');
  await page.evaluate(() => window.__playerToolsFixture.mode('success'));
  await page.getByRole('button', {name: 'Retry fullscreen', exact: true}).click();
  await expect(page.getByRole('button', {name: 'Exit fullscreen', exact: true})).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', {name: 'Runtime diagnostics', exact: true}).click();
  await expect(page.getByRole('dialog', {name: 'Runtime diagnostics', exact: true})).toBeVisible();
  expect(await page.evaluate(() => window.__playerToolsFixture.inspect())).toMatchObject({sameFrame:true,sameDocument:true,fullscreen:true,dialogInsideSurface:true});
  await page.getByRole('button', {name: 'Close', exact: true}).click();
  await page.evaluate(() => window.__playerToolsFixture.escapeFullscreen());
  await expect(page.getByRole('button', {name: 'Enter fullscreen', exact: true})).toHaveAttribute('aria-pressed', 'false');
});
test('late fullscreen grant cannot focus or keep a retired Runtime fullscreen', async ({page}) => {
  await page.goto(fixture);await page.evaluate(() => window.__playerToolsFixture.mode('hold'));
  await page.getByRole('button', {name: 'Enter fullscreen', exact: true}).click();
  await expect(page.getByRole('button', {name: 'Switching fullscreen…', exact: true})).toBeDisabled();
  await page.evaluate(() => {window.__playerToolsFixture.setSession({epoch:2,launched:false,ready:false});window.__playerToolsFixture.resolveFullscreen();});
  await expect.poll(() => page.evaluate(() => window.__playerToolsFixture.inspect().fullscreen)).toBe(false);
  expect(await page.evaluate(() => window.__playerToolsFixture.inspect())).toMatchObject({sameFrame:true,sameDocument:true,frameFocused:false});
});
test('Help uses Router history and restores only the captured frame epoch', async ({page}) => {
  await page.goto(fixture);const start = page.url();
  await page.getByRole('link', {name:'Input help',exact:true}).click();
  await expect(page).toHaveURL(/panel=help/);await expect(page.getByRole('dialog')).toHaveCount(1);
  await page.getByRole('button', {name:'Close',exact:true}).click();await expect(page).toHaveURL(start);
  await expect.poll(() => page.evaluate(() => window.__playerToolsFixture.inspect().frameFocused)).toBe(true);
  await page.getByRole('link', {name:'Input help',exact:true}).click();
  await page.evaluate(() => window.__playerToolsFixture.setSession({epoch:2}));
  await page.getByRole('button', {name:'Close',exact:true}).click();await expect(page).toHaveURL(start);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await page.evaluate(() => window.__playerToolsFixture.inspect().frameFocused)).toBe(false);
});
test('clipboard fallback, close/reopen pending completion and download URLs have bounded lifetimes', async ({page}) => {
  await page.goto(fixture);await page.getByRole('button',{name:'Runtime diagnostics',exact:true}).click();
  await page.evaluate(() => window.__playerToolsFixture.copyMode('deny'));
  await page.getByRole('button',{name:'Copy report',exact:true}).click();await expect(page.getByRole('alert')).toContainText('Synthetic clipboard denied');
  await expect(page.getByRole('textbox',{name:'Diagnostic report',exact:true}).last()).toHaveValue(/player-diagnostics\/1/);
  await page.evaluate(() => window.__playerToolsFixture.copyMode('hold'));await page.getByRole('button',{name:'Copy report',exact:true}).click();
  await page.getByRole('button',{name:'Close',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button',{name:'Runtime diagnostics',exact:true}).click();await page.evaluate(() => window.__playerToolsFixture.resolveCopy());
  await expect(page.getByText('Report copied',{exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'Download report',exact:true}).click();await page.getByRole('button',{name:'Download report',exact:true}).click();
  expect(await page.evaluate(() => window.__playerToolsFixture.inspect().calls.revoked.length)).toBe(1);
  await page.getByRole('button',{name:'Close',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await page.evaluate(() => window.__playerToolsFixture.inspect().calls.revoked.length)).toBe(2);
});
test('compact menu preserves the two-cell system reservation and closes on actions', async ({page}) => {
  await page.goto(`${fixture}&compact=1`);const toolbar=page.getByRole('toolbar',{name:'Synthetic player tools'});
  await expect(toolbar.locator(':scope > *')).toHaveCount(2);
  await expect(page.getByRole('button',{name:'Back or pause',exact:true})).not.toBeVisible();
  await page.locator('[data-player-tools-menu] summary').click();await page.keyboard.press('Escape');
  await expect(page.locator('[data-player-tools-menu]')).not.toHaveAttribute('open','');
  await page.locator('[data-player-tools-menu] summary').click();
  await page.getByRole('button',{name:'Back or pause',exact:true}).click();
  await expect(page.locator('[data-player-tools-menu]')).not.toHaveAttribute('open','');
  await expect.poll(() => page.evaluate(() => window.__playerToolsFixture.inspect().calls.inputs.length)).toBe(2);
  expect(await page.evaluate(() => window.__playerToolsFixture.inspect().calls.inputs)).toMatchObject([{command:'keyboard',code:'Escape',down:true},{command:'keyboard',code:'Escape',down:false}]);
});

test('saved diagnostics choice wins over test-build default and browser/native figures have separate labels', async ({page}) => {
  await page.addInitScript(() => {if (!localStorage.getItem('synthetic-seeded')) {localStorage.setItem('eagler-touhou-runtime-diagnostics-v1','0');localStorage.setItem('synthetic-seeded','1');}});
  await page.goto(`${fixture}&testBuild=1`);
  await expect(page.locator('[data-player-diagnostics-hud]')).toHaveCount(0);
  await expect(page.getByRole('switch',{name:'Show debug information',exact:true})).toHaveAttribute('aria-checked','false');
  await page.getByRole('switch',{name:'Show debug information',exact:true}).click();
  const hud=page.locator('[data-player-diagnostics-hud]');await expect(hud).toBeVisible();
  await expect(hud).toContainText('Browser scheduling: host');await expect(hud).toContainText('Native presentation: 60 FPS');
  expect(await page.evaluate(() => localStorage.getItem('eagler-touhou-runtime-diagnostics-v1'))).toBe('1');
  await page.reload();await expect(page.locator('[data-player-diagnostics-hud]')).toBeVisible();
  await page.getByRole('switch',{name:'Show debug information',exact:true}).click();await expect(page.locator('[data-player-diagnostics-hud]')).toHaveCount(0);
});

test('Alt+Enter works with iframe focus, consumes both native Enter edges and ignores repeat', async ({page}) => {
  await page.goto(fixture);
  await page.getByRole('button',{name:'Enter fullscreen',exact:true}).waitFor({state:'visible'});
  await expect(page.getByRole('button',{name:'Enter fullscreen',exact:true})).toBeEnabled();
  await page.locator('iframe').evaluate(frame => (frame as HTMLIFrameElement).focus());
  await page.keyboard.down('Alt');await page.keyboard.down('Enter');await page.keyboard.down('Enter');
  await expect.poll(() => page.evaluate(() => window.__playerToolsFixture.inspect().calls.requests)).toBe(1);
  await page.keyboard.up('Alt');await page.keyboard.up('Enter');
  expect(await page.evaluate(() => window.__playerToolsFixture.inspect().calls)).toMatchObject({nativeEnter:0,parentEnter:0,requests:1,exits:0,inputs:[]});
  await page.keyboard.press('Enter');
  expect(await page.evaluate(() => window.__playerToolsFixture.inspect().calls.nativeEnter)).toBe(2);
  await page.keyboard.press('Alt+Enter');
  await expect.poll(() => page.evaluate(() => window.__playerToolsFixture.inspect().calls.exits)).toBe(1);
  expect(await page.evaluate(() => window.__playerToolsFixture.inspect())).toMatchObject({sameFrame:true,sameDocument:true,fullscreen:false});
});
