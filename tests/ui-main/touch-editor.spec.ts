/** Source-owned controls/empty Runtime evidence. Browser runs belong to CI;
 * responsive emulation is not physical-phone or gameplay acceptance. */
import {test as base, expect} from './synthetic-ui-test';
const test = base.extend<{browserErrors: string[]}>({browserErrors: [async ({page}, use) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {localStorage.setItem('eagler-touhou-first-use-notice-seen-v1', '1');localStorage.setItem('eagler-touhou-site-notice-enabled-v1', '0');});
  await use(errors); expect(errors).toEqual([]);
}, {auto: true}]});
const scene = '[data-touch-editor-scene]', workbench = '[data-touch-workbench]';
test('warned movement and touch enable preferences are committed only after confirmation', async ({page}) => {
  await page.emulateMedia({reducedMotion: 'reduce'}); await page.goto('/play/th06?touchLayout=1');
  await expect(page.locator(scene)).toHaveAttribute('data-touch-editor-ready', 'true');
  const movement = page.getByLabel(/移动方法|Movement method/);
  await movement.selectOption('touch-unlimited');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', {name: /取消|Cancel/}).click();
  await expect(movement).toHaveValue('touch');
  await movement.selectOption('touch-unlimited');
  await page.getByRole('button', {name: /启用|Enable/}).click();
  await expect(movement).toHaveValue('touch-unlimited');
  const focus = page.getByLabel(/低速方法|Focus method/);
  await focus.selectOption('two-finger'); await expect(focus).toHaveValue('two-finger');
  await focus.selectOption('hold-button'); await expect(focus).toHaveValue('hold-button');
  const sensitivity = page.getByRole('group', {name:/触控灵敏度档位|Touch sensitivity presets/});
  await sensitivity.getByRole('button', {name:'自定义'}).click();
  const customSensitivity = page.getByLabel(/自定义灵敏度|Custom sensitivity/);
  await expect(customSensitivity).toBeVisible(); await customSensitivity.focus(); await customSensitivity.press('ArrowRight');
  await expect(customSensitivity).toHaveValue('151');
  await sensitivity.getByRole('button', {name:'150%'}).click(); await expect(customSensitivity).toBeHidden();
  const doubleTapBomb = page.getByRole('switch', {name:/双击 Bomb|Double-tap Bomb/});
  await doubleTapBomb.click(); await expect(doubleTapBomb).toBeChecked();
  const restart = page.getByRole('switch', {name:/^R\b/});
  await restart.click(); await expect(restart).toBeChecked();
  await page.keyboard.press('Escape'); await expect(page.locator(scene)).toHaveCount(0);

  await page.locator('.game-settings-touch > summary').click();
  const enabled = page.getByRole('switch', {name: /启用触摸功能|Enable touch controls/});
  await enabled.click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', {name: /取消|Cancel/}).click();
  await expect(enabled).not.toBeChecked();
  await enabled.click();
  await page.getByRole('button', {name: /启用|Enable/}).click();
  await expect(enabled).toBeChecked();
});

test('workbench uses measured device orientation and exposes the current-profile reset', async ({page}) => {
  await page.emulateMedia({reducedMotion: 'reduce'}); await page.goto('/play/th06?touchLayout=1');
  await expect(page.locator(scene)).toHaveAttribute('data-touch-editor-ready', 'true');
  const orientation = page.getByRole('group', {name: /切换横竖屏|Switch orientation/});
  await expect(orientation).toHaveAttribute('data-touch-orientation-controls', 'landscape');
  await expect(orientation.locator('[data-touch-preview-orientation]')).toHaveCount(0);
  await expect(orientation.getByRole('button', {name: /恢复本方向默认|Restore this orientation/})).toBeVisible();
  await page.setViewportSize({width: 390, height: 844});
  await expect.poll(() => orientation.getAttribute('data-touch-orientation-controls')).toBe('portrait');
});

test('mobile workbench action requests a real screen lock and does not rotate the editor preview', async ({page}) => {
  await page.emulateMedia({reducedMotion: 'reduce'});
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'userAgentData', {configurable:true, value:{mobile:true}});
    (window as unknown as {orientationLockRequests:string[]}).orientationLockRequests = [];
    Object.defineProperty(screen.orientation, 'lock', {configurable:true, value:async (value:string) => {
      (window as unknown as {orientationLockRequests:string[]}).orientationLockRequests.push(value);
    }});
  });
  await page.goto('/play/th06?touchLayout=1');
  await expect(page.locator(scene)).toHaveAttribute('data-touch-editor-ready', 'true');
  const orientation = page.getByRole('group', {name:/切换横竖屏|Switch orientation/});
  await orientation.getByRole('button', {name:/切换到竖屏|Switch to portrait/}).click();
  await expect(page.locator('[data-player-orientation-status]')).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as unknown as {orientationLockRequests:string[]}).orientationLockRequests)).toContain('portrait');
  await expect(orientation).toHaveAttribute('data-touch-orientation-controls', 'landscape');
  await expect(orientation.locator('[data-touch-preview-orientation]')).toHaveCount(0);
});

test('compact entry opens the measured editor on the existing fullscreen owner and releases only its fullscreen', async ({page}) => {
  await page.emulateMedia({reducedMotion: 'reduce'}); await page.goto('/play/th06');
  await page.locator('.game-settings-touch > summary').click();
  await page.getByRole('button', {name: '按键布局 & 触控设置', exact: true}).click();
  await expect(page.locator(scene)).toHaveAttribute('data-touch-editor-ready', 'true');
  await expect.poll(() => page.evaluate(() => document.fullscreenElement === document.querySelector('[data-player-surface]'))).toBe(true);
  await expect(page.locator('[data-runtime-host] iframe')).toHaveCount(1);
  await page.locator('[data-touch-workbench]').getByRole('button', {name: '退出'}).click();
  await expect(page.locator(scene)).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => document.fullscreenElement === null)).toBe(true);
  await expect(page.locator('[data-runtime-host] iframe')).toHaveCount(1);
});

test('compact movable workbench keeps Save visible, collapses its body and stays in bounds after orientation changes', async ({page}, info) => {
  await page.emulateMedia({reducedMotion: 'reduce'}); await page.goto('/play/th06?touchLayout=1');
  await expect(page.locator(scene)).toHaveAttribute('data-touch-editor-ready', 'true');
  const frame = await page.locator('[data-runtime-host] iframe').elementHandle();
  for (const viewport of [{width: 1280, height: 800}, {width: 390, height: 844}]) {
    await page.setViewportSize(viewport);
    await expect.poll(async () => {
      const box = await page.locator(workbench).boundingBox();
      return !!box && box.width <= 290 && box.height <= 470 && box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width + 1 && box.y + box.height <= viewport.height + 1;
    }).toBe(true);
    await expect(page.locator('[data-touch-workbench-save]')).toBeInViewport();
    await page.screenshot({path: info.outputPath(`synthetic-touch-editor-${viewport.width > viewport.height ? 'landscape' : 'portrait'}.png`), fullPage: true});
  }
  await page.locator('[data-touch-workbench-collapse]').click(); await expect(page.locator(workbench)).toHaveAttribute('data-collapsed', 'true');
  await expect(page.locator('[data-touch-workbench-body]')).toBeHidden();
  await page.locator('[data-touch-workbench-collapse]').click(); await expect(page.locator('[data-touch-workbench-body]')).toBeVisible();
  await expect(page.locator('[data-touch-workbench-save]')).toBeInViewport();
  expect(await frame!.evaluate(node => node === document.querySelector('[data-runtime-host] iframe'))).toBe(true);
});
test('dragging a real layout control fades only the workbench, preserves movement and saves through the existing store', async ({page}) => {
  await page.emulateMedia({reducedMotion: 'reduce'}); await page.goto('/play/th06?touchLayout=1');
  await expect(page.locator(scene)).toHaveAttribute('data-touch-editor-ready', 'true');
  const bomb = page.locator('[data-touch-layout-control="bomb"]'), before = (await bomb.boundingBox())!;
  await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2); await page.mouse.down();
  await page.mouse.move(before.x + before.width / 2 + 20, before.y + before.height / 2 - 20, {steps: 3});
  await expect(page.locator(scene)).toHaveAttribute('data-touch-manipulating', 'true'); await expect(page.locator(workbench)).toHaveCSS('opacity', '0.12');
  await page.mouse.up(); await expect(page.locator(scene)).toHaveAttribute('data-touch-manipulating', 'false'); await expect(page.locator(workbench)).toHaveCSS('opacity', '1');
  const after = (await bomb.boundingBox())!; expect(after.x).toBeGreaterThan(before.x + 10); expect(after.y).toBeLessThan(before.y - 10);
  await page.locator('[data-touch-workbench-save]').click(); await expect(page.getByText('布局已保存到当前浏览器', {exact: true})).toBeVisible();
  await page.keyboard.press('Escape'); await expect(page.locator(scene)).toHaveCount(0); await expect(page).toHaveURL(/\/play\/th06$/);
  await expect(page.locator('[data-runtime-host] iframe')).toHaveCount(1);
});
test('full motion animates the whole settled scene with opacity only and leaves no workbench animation or hidden residue', async ({page}, info) => {
  await page.emulateMedia({reducedMotion: 'no-preference'});
  await page.addInitScript(() => {
    const original = Element.prototype.animate;
    const reports: Array<{duration: number | string; keys: string[]; interior: number | null; panelAnimations: number}> = [];
    (window as unknown as {touchEntryReports: typeof reports}).touchEntryReports = reports;
    Element.prototype.animate = function (frames, options) {
      const animation = original.call(this, frames, options);
      if (this.matches('[data-touch-editor-scene]')) {
        const element = this, timing = animation.effect!.getTiming(), keyframes = (animation.effect as KeyframeEffect).getKeyframes();
        const report = {duration: Number(timing.duration), keys: Object.keys(keyframes[0]).filter(key => !['offset', 'computedOffset', 'easing', 'composite'].includes(key)), interior: null as number | null, panelAnimations: element.querySelector('[data-touch-workbench]')!.getAnimations().length};
        reports.push(report);
        const sample = () => {const opacity = Number(getComputedStyle(element).opacity); if (animation.playState === 'running' && opacity > 0 && opacity < 1) report.interior = opacity; else if (animation.playState !== 'finished' && animation.playState !== 'idle') requestAnimationFrame(sample);};
        requestAnimationFrame(sample);
      }
      return animation;
    };
  });
  await page.goto('/play/th06');
  await page.evaluate(async () => {await document.fonts.ready;await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));});
  await page.locator('.game-settings-touch > summary').click();
  await expect(page.locator('.game-settings-touch')).toHaveAttribute('open', '');
  await expect(page.getByRole('button', {name: '按键布局 & 触控设置', exact: true})).toBeEnabled();
  await page.getByRole('button', {name: '按键布局 & 触控设置', exact: true}).click();
  await expect(page.locator(scene)).toHaveAttribute('data-touch-editor-ready', 'true');
  await expect.poll(() => page.evaluate(() => (window as unknown as {touchEntryReports: Array<{interior: number | null}>}).touchEntryReports.some(report => report.interior != null))).toBe(true);
  const reports = await page.evaluate(() => (window as unknown as {touchEntryReports: Array<{duration: number; keys: string[]; interior: number | null; panelAnimations: number}>}).touchEntryReports);
  for (const report of reports) {expect(report.duration).toBe(340);expect(report.keys).toEqual(['opacity']);expect(report.panelAnimations).toBe(0);}
  await info.attach('whole-touch-scene-entry', {body: JSON.stringify(reports), contentType: 'application/json'});
  await expect.poll(() => page.locator(scene).evaluate(element => element.getAnimations().length)).toBe(0); await expect(page.locator(scene)).toHaveCSS('opacity', '1');
  await page.emulateMedia({reducedMotion: 'reduce'}); await page.keyboard.press('Escape'); await expect(page.locator(scene)).toHaveCount(0);
});
