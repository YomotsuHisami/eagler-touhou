/** Source-owned synthetic evidence only; not live relay/gameplay/phone validation. */
import {test, expect} from '@playwright/test';
import type {} from './lobby-directory-fixture';
const origin = process.env.UI_RUNTIME_FIXTURE_ORIGIN ?? 'http://127.0.0.1:4175';
test('source-owned populated directory and create/join forms preserve primary layout evidence', async ({page}, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  info.annotations.push({type: 'synthetic-data', description: 'All room codes, seats and state are source-owned fixture data. No real directory service or relay is constructed.'});
  await page.goto(`${origin}/__ui_tests__/lobby-directory.html`);
  await expect(page.getByRole('heading', {name: 'Multiplayer lobby', exact: true})).toBeVisible();
  await expect(page.getByText('#4321', {exact: false})).toBeVisible();
  await page.screenshot({path: info.outputPath('synthetic-populated-directory.png'), fullPage: true});
  for (const [name, filename] of [['Create room', 'create'], ['Enter room code', 'join']]) {
    const trigger = page.getByRole('button', {name, exact: true}); await trigger.click();
    const dialog = page.getByRole('dialog', {name, exact: true}); await expect(dialog).toBeVisible();
    await expect(dialog).toHaveCSS('opacity', '1');
    await expect(dialog).toHaveAttribute('data-dialog-layout', 'lobby-dialog');
    await expect(dialog).toHaveCSS('padding-top', page.viewportSize()!.width <= 820 ? '24px' : '28px');
    expect(Math.abs((await dialog.boundingBox())!.width - Math.min(440, page.viewportSize()!.width - 32))).toBeLessThan(2);
    await page.screenshot({path: info.outputPath(`synthetic-directory-${filename}.png`), fullPage: true});
    await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0); await expect(trigger).toBeFocused();
  }
  await page.evaluate(() => window.__directoryEvidence.navigate('/lobby?uiLocale=en&game=th06mp&empty=1'));
  await expect(page.getByRole('heading', {name: 'No public rooms right now', exact: true})).toBeVisible();
  await expect(page.getByRole('heading', {name: 'No public rooms right now', exact: true}).locator('..')).toHaveCSS('min-height', page.viewportSize()!.width <= 820 ? '280px' : '340px');
  await page.screenshot({path: info.outputPath('synthetic-empty-directory.png'), fullPage: true});
  expect(await page.evaluate(() => window.__directoryEvidence.inspect())).toEqual({commands: 0, sourceOwned: true});
  expect(errors).toEqual([]);
});
