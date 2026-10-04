/** Real browser pointer events over source-owned UI in authorized CI only.
 * Emulated phone viewports do not establish physical-device acceptance. */
import {test as base, expect} from './synthetic-ui-test';
const test = base.extend<{browserErrors: string[]}>({browserErrors: [async ({page}, use) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem('eagler-touhou-card-filter-v1', 'multiplayer');
    localStorage.setItem('eagler-touhou-first-use-notice-seen-v1', '1');
    localStorage.setItem('eagler-touhou-site-notice-enabled-v1', '0');
  });
  await use(errors); expect(errors).toEqual([]);
}, {auto: true}]});
const panels = '[data-dialog-layout="library-panel"]';
test('retired filter never hides shelves; wheels cannot pan and a held mouse rail drag captures without opening a card', async ({page}, info) => {
  await page.goto('/'); await expect(page.locator('[data-library-shelf]')).toHaveCount(2);
  const rail = page.locator('#singleplayer-rail');
  await rail.evaluate(element => element.addEventListener('gotpointercapture', event => {element.setAttribute('data-test-native-capture', String((event as PointerEvent).pointerId));}));
  const bounds = (await rail.boundingBox())!, x = bounds.x + Math.min(220, bounds.width - 30), y = bounds.y + 90;
  await page.mouse.move(x, y);
  if(info.project.name==='mobile-viewport'){
    // Mobile WebKit has no mouse.wheel API. Exercise the same event guard and
    // label that boundary; the three desktop engines send a native wheel.
    info.annotations.push({type:'synthetic-wheel',description:'Mobile WebKit does not expose native wheel injection; pointer capture/drag below still uses native mouse events.'});
    expect(await rail.evaluate(element=>element.dispatchEvent(new WheelEvent('wheel',{deltaX:180,bubbles:true,cancelable:true})))).toBe(false);
  } else await page.mouse.wheel(180, 0);
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  expect(await rail.evaluate(element => element.scrollLeft)).toBe(0);
  await page.mouse.down(); await expect(rail).toHaveAttribute('data-library-dragging', 'true');
  await page.mouse.move(x - 80, y, {steps: 6});
  await expect.poll(() => rail.evaluate(element => element.scrollLeft)).toBeGreaterThan(60);
  expect(await rail.evaluate(element => element.hasPointerCapture(Number(element.getAttribute('data-test-native-capture'))))).toBe(true);
  await page.mouse.up(); await expect(rail).toHaveAttribute('data-library-dragging', 'false');
  await expect(page.locator(panels)).toHaveCount(0);
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('');
  expect(await rail.locator('a,img').evaluateAll(elements => elements.some(element => (element as HTMLElement).draggable))).toBe(false);
  await info.attach('native-library-drag', {body: JSON.stringify(await rail.evaluate(element => ({left: element.scrollLeft, pointer: element.getAttribute('data-test-native-capture')}))), contentType: 'application/json'});
});
test('native number hold and immediate scrub cross gaps, drift below buttons, reverse, and retain the next short press', async ({page}) => {
  await page.goto('/');
  const dock = page.locator('[data-library-minimap="singleplayer"]'), first = dock.locator('[data-library-preview]').first(), last = dock.locator('[data-library-preview]').last();
  await first.hover(); await expect(page.locator(panels)).toHaveCount(0);
  for (const hold of [true, false]) {
    const a = (await first.boundingBox())!, b = (await last.boundingBox())!, firstX = a.x + a.width / 2, lastX = b.x + b.width / 2, y = a.y + a.height / 2;
    await first.evaluate(element => element.addEventListener('gotpointercapture', event => {element.setAttribute('data-test-native-capture', String((event as PointerEvent).pointerId));}, {once: true}));
    await page.mouse.move(firstX, y); await page.mouse.down();
    if (hold) await expect(dock).toHaveAttribute('data-library-scrubbing', 'true');
    await page.mouse.move(lastX, y, {steps: 4}); await expect(last).toHaveAttribute('aria-current', 'true');
    expect(await first.evaluate(element => element.hasPointerCapture(Number(element.getAttribute('data-test-native-capture'))))).toBe(true);
    await expect(first).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await page.mouse.move(firstX, y + 36, {steps: 4}); await expect(first).toHaveAttribute('aria-current', 'true');
    await page.mouse.move(lastX, y + 36, {steps: 4}); await page.mouse.up(); await expect(last).toHaveAttribute('aria-current', 'true');
    await expect(dock).toHaveAttribute('data-library-scrubbing', 'false'); await expect(page.locator(panels)).toHaveCount(0);
  }
  await first.click(); await expect(first).toHaveAttribute('aria-current', 'true'); await expect(page.locator(panels)).toHaveCount(0);
  await first.click(); await expect(page.locator(panels)).toBeVisible();
  await page.getByRole('button', {name: '返回游戏库', exact: true}).click(); await expect(page.locator(panels)).toHaveCount(0);
});
test('number/card keyboard and select-first solo versus first-click multiplayer match main behavior', async ({page}) => {
  await page.emulateMedia({reducedMotion: 'reduce'}); await page.goto('/');
  const dock = page.locator('[data-library-minimap="singleplayer"]'), first = dock.locator('[data-library-preview]').first(), last = dock.locator('[data-library-preview]').last();
  await first.focus(); await page.keyboard.press('End'); await expect(last).toBeFocused(); await expect(last).toHaveAttribute('aria-current', 'true');
  await page.keyboard.press('Home'); await expect(first).toBeFocused(); await expect(first).toHaveAttribute('aria-current', 'true');
  await page.keyboard.press('Escape'); await expect(first).toBeFocused(); await expect(page.locator(panels)).toHaveCount(0);
  const card = page.locator('[data-library-shelf="singleplayer"] [data-library-product]').last();
  await card.click(); await expect(card).toHaveAttribute('data-library-selected', 'true'); await expect(page.locator(panels)).toHaveCount(0);
  await card.click(); await expect(page.locator(panels)).toBeVisible(); await page.keyboard.press('Escape'); await expect(page.locator(panels)).toHaveCount(0); await expect(card).toBeFocused();
  await page.keyboard.press('Home'); await expect(page.locator('[data-library-product="th06"]')).toBeFocused();
  const multiplayer = page.locator('[data-library-shelf="multiplayer"] [data-library-product]').last();
  await multiplayer.click(); await expect(page.locator(panels)).toBeVisible(); await expect(multiplayer).toHaveAttribute('data-library-selected', 'true');
});
test('default rail motion has an interior position, retargets without a jump, and follows live reduced motion', async ({page}, info) => {
  await page.emulateMedia({reducedMotion: 'no-preference'}); await page.goto('/');
  const sample = await page.locator('[data-library-minimap="singleplayer"] [data-library-preview]').last().evaluate(async (button: HTMLButtonElement) => {
    const rail = document.getElementById('singleplayer-rail')!;
    await document.fonts.ready;
    await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));
    const maximum=rail.scrollWidth-rail.clientWidth;
    const first=document.querySelector<HTMLButtonElement>('[data-library-minimap="singleplayer"] [data-library-preview]')!;
    // Observe inside genuine RAF callbacks instead of after two callbacks,
    // when WebKit may already have completed the whole animation.
    const original=window.requestAnimationFrame,frames:Array<{time:number;left:number}>=[];
    return await new Promise<{interior:number;maximum:number;afterRetarget:number;frames:typeof frames}>(resolve=>{
      let done=false;
      const finish=(interior:number)=>{if(done)return;done=true;clearTimeout(timeout);window.requestAnimationFrame=original;first.click();resolve({interior,maximum,afterRetarget:rail.scrollLeft,frames});};
      const timeout=setTimeout(()=>finish(rail.scrollLeft),3000);
      window.requestAnimationFrame=callback=>original.call(window,time=>{
        callback(time);const left=rail.scrollLeft;frames.push({time,left});
        if(left>0 && left<maximum)finish(left);
      });
      button.click();
    });
  });
  expect(sample.interior).toBeGreaterThan(0); expect(sample.interior).toBeLessThan(sample.maximum); expect(sample.afterRetarget).toBe(sample.interior);
  await info.attach('continuous-library-scroll', {body: JSON.stringify(sample), contentType: 'application/json'});
  await page.emulateMedia({reducedMotion: 'reduce'}); await expect.poll(() => page.locator('#singleplayer-rail').evaluate(element => element.scrollLeft)).toBe(0);
  await expect(page.locator('[data-library-minimap="singleplayer"] [data-library-preview]').first()).toHaveCSS('transition-duration', '0s');
  await expect(page.locator('[data-runtime-host] iframe')).toHaveCount(1);
});

test('library lobby entry retains main pink pill geometry and foreground',async({page})=>{
 await page.goto('/');
 const link=page.locator('[data-library-shelf="multiplayer"]').getByRole('link',{name:'联机大厅',exact:true});
 await expect(link).toHaveCSS('background-color','rgb(241, 228, 230)');
 await expect(link).toHaveCSS('color','rgb(169, 50, 67)');
 await expect(link).toHaveCSS('font-size','13px');
 await expect(link).toHaveCSS('padding-left','15px');
 expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
});
