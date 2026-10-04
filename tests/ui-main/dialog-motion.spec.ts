import {test as base, expect, type Page} from '@playwright/test';
import type {} from './dialog-motion-fixture';

// Real Radix/Motion shell, synthetic contents only. Run through authorized CI,
// across the existing desktop engines and default-motion mobile viewport.
const origin = process.env.UI_RUNTIME_FIXTURE_ORIGIN ?? 'http://127.0.0.1:4175';
const fixtureUrl = `${origin}/__ui_tests__/dialog-motion.html`;
const surface = '[data-animated-dialog]';
const test = base.extend<{browserErrors: string[]}>({browserErrors: [async ({page}, use) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await use(errors);
  expect(errors).toEqual([]);
}, {auto: true}]});

async function load(page: Page, reducedMotion: 'reduce' | 'no-preference' = 'no-preference') {
  await page.emulateMedia({reducedMotion});
  await page.goto(fixtureUrl);
  await expect(page.getByRole('heading', {name: 'Synthetic dialog motion fixture, no game execution'})).toBeVisible();
}

test('default entry reverses to exit and back continuously, retaining one surface, draft, and empty frame', async ({page}) => {
  await load(page);
  const result = await page.evaluate(async () => {
    const fixture = window.__dialogMotionFixture;
    const frame = document.querySelector('[data-empty-frame]');
    const read = () => {
      const node = document.querySelector<HTMLElement>('[data-animated-dialog]');
      if (!node) return null;
      const style = getComputedStyle(node);
      return {opacity: Number(style.opacity), y: style.transform === 'none' ? 0 : new DOMMatrixReadOnly(style.transform).m42};
    };
    // Observe actual animation frames, rather than relying on fixed sleeps or
    // replacing production durations with a test-only animation configuration.
    async function until(predicate: (value: NonNullable<ReturnType<typeof read>>) => boolean) {
      const deadline = performance.now() + 4000;
      while (performance.now() < deadline) {
        await new Promise(requestAnimationFrame);
        const value = read();
        if (value && predicate(value)) return value;
      }
      throw new Error('Expected dialog animation state was not observed');
    }
    document.getElementById('opener')!.focus();
    fixture.setOpen(true);
    const entering = await until(value => value.opacity > .15 && value.opacity < .9 && value.y > 0);
    const node = document.querySelector<HTMLElement>('[data-animated-dialog]')!;
    const draft = document.getElementById('draft') as HTMLInputElement;
    draft.value = 'retained through reversals';
    fixture.setOpen(false);
    const justClosed = read()!;
    const retainedOnExit = node === document.querySelector('[data-animated-dialog]');
    const inaccessibleOnExit = node.inert && node.getAttribute('aria-hidden') === 'true';
    const noPointerOnExit = getComputedStyle(node).pointerEvents === 'none';
    const closing = await until(value => value.opacity > .01 && value.opacity < justClosed.opacity - .015);
    fixture.setOpen(true);
    const justReopened = read()!;
    const resumedIdentity = node === document.querySelector('[data-animated-dialog]');
    const settled = await until(value => value.opacity > .999 && Math.abs(value.y) < .01);
    return {
      entering, justClosed, closing, justReopened, settled,
      retainedOnExit, inaccessibleOnExit, noPointerOnExit, resumedIdentity,
      surfaceCount: document.querySelectorAll('[data-animated-dialog]').length,
      overlayCount: document.querySelectorAll('[data-dialog-overlay]').length,
      draftIdentity: draft === document.getElementById('draft'), draft: draft.value,
      frameIdentity: frame === document.querySelector('[data-empty-frame]'),
      frameCount: document.querySelectorAll('[data-empty-frame]').length,
      focusedInside: node.contains(document.activeElement),
      accessibleAfterReopen: !node.inert && !node.hasAttribute('aria-hidden'),
      events: fixture.inspect(),
    };
  });
  expect(Math.abs(result.justClosed.opacity - result.entering.opacity)).toBeLessThan(.025);
  expect(Math.abs(result.justClosed.y - result.entering.y)).toBeLessThan(.3);
  expect(Math.abs(result.justReopened.opacity - result.closing.opacity)).toBeLessThan(.025);
  expect(Math.abs(result.justReopened.y - result.closing.y)).toBeLessThan(.3);
  expect(result.retainedOnExit && result.inaccessibleOnExit && result.noPointerOnExit).toBe(true);
  expect(result.resumedIdentity && result.draftIdentity && result.frameIdentity).toBe(true);
  expect(result.surfaceCount).toBe(1);
  expect(result.overlayCount).toBe(1);
  expect(result.frameCount).toBe(1);
  expect(result.draft).toBe('retained through reversals');
  expect(result.focusedInside && result.accessibleAfterReopen).toBe(true);
  expect(result.events.close).toBe(0);
  expect(result.events.open).toBe(2);
  await page.getByRole('button', {name: 'Dismiss', exact: true}).click();
  await expect(page.locator(surface)).toHaveCount(0);
  await expect(page.locator('#opener')).toBeFocused();
});

test('repeated close/reopen interruptions have no stale exit or queued state', async ({page}) => {
  await load(page);
  const result = await page.evaluate(async () => {
    const fixture = window.__dialogMotionFixture;
    document.getElementById('opener')!.focus();
    fixture.setOpen(true);
    const node = document.querySelector<HTMLElement>('[data-animated-dialog]')!;
    const frame = document.querySelector('[data-empty-frame]');
    const sample = () => Number(getComputedStyle(node).opacity);
    async function until(predicate: (opacity: number) => boolean) {
      const deadline = performance.now() + 4000;
      while (performance.now() < deadline) {
        await new Promise(requestAnimationFrame);
        if (!node.isConnected) throw new Error('Retained dialog was replaced');
        if (predicate(sample())) return;
      }
      throw new Error('Dialog did not reach the requested direction');
    }
    await until(value => value > .999);
    for (let round = 0; round < 4; round++) {
      fixture.setOpen(false);
      await until(value => value > .01 && value < .9);
      const before = sample();
      fixture.setOpen(true);
      if (Math.abs(before - sample()) > .025) throw new Error('Reopen snapped to an endpoint');
      await until(value => value > .999);
    }
    return {same: node === document.querySelector('[data-animated-dialog]'),
      focusedInside: node.contains(document.activeElement),
      oneSurface: document.querySelectorAll('[data-animated-dialog]').length === 1,
      sameFrame: frame === document.querySelector('[data-empty-frame]'), events: fixture.inspect()};
  });
  expect(result.same && result.oneSurface && result.sameFrame && result.focusedInside).toBe(true);
  expect(result.events.close).toBe(0);
  expect(result.events.open).toBe(5);
  await page.keyboard.press('Escape');
  await expect(page.locator(surface)).toHaveCount(0);
  await expect(page.locator('#opener')).toBeFocused();
  expect(await page.evaluate(() => window.__dialogMotionFixture.inspect().close)).toBe(1);
});

test('Radix focus, dismissal guards, and the actual opener remain caller controlled', async ({page}) => {
  await load(page);
  await page.locator('#other-opener').click();
  await expect(page.locator('#draft')).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByRole('button', {name: 'Dismiss', exact: true})).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.locator('#draft')).toBeFocused();
  await page.evaluate(() => window.__dialogMotionFixture.setBusy(true));
  await page.keyboard.press('Escape');
  await page.locator('[data-dialog-overlay]').click({position: {x: 4, y: 4}});
  await expect(page.getByRole('dialog', {name: 'Synthetic dialog'})).toBeVisible();
  expect(await page.evaluate(() => window.__dialogMotionFixture.inspect().requests)).toEqual([]);
  await page.getByRole('button', {name: 'Dismiss', exact: true}).click();
  await expect(page.getByRole('dialog', {name: 'Synthetic dialog'})).toBeVisible();
  expect(await page.evaluate(() => window.__dialogMotionFixture.inspect().requests)).toEqual([false]);
  await page.evaluate(() => window.__dialogMotionFixture.setBusy(false));
  await page.keyboard.press('Escape');
  await expect(page.locator(surface)).toHaveCount(0);
  await expect(page.locator('#other-opener')).toBeFocused();
  expect(await page.evaluate(() => window.__dialogMotionFixture.inspect().requests)).toEqual([false, false]);
});

test('disconnected opener falls back to a current ref, then stable main content', async ({page}) => {
  await load(page);
  await page.locator('#opener').click();
  await page.evaluate(() => window.__dialogMotionFixture.removeOpener());
  await page.keyboard.press('Escape');
  await expect(page.locator(surface)).toHaveCount(0);
  await expect(page.locator('#fallback')).toBeFocused();
  await page.evaluate(() => {
    window.__dialogMotionFixture.removeFallback();
    window.__dialogMotionFixture.setOpen(true);
  });
  await expect(page.locator('#draft')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator(surface)).toHaveCount(0);
  await expect(page.locator('#main-content')).toBeFocused();
});

for (const invalid of ['disabled', 'hidden'] as const) {
  test(`a connected but ${invalid} opener is not a valid focus destination`, async ({page}) => {
    await load(page);
    await page.locator('#opener').click();
    await page.locator('#opener').evaluate((node, invalid) => {
      if (invalid === 'disabled') (node as HTMLButtonElement).disabled = true;
      else (node as HTMLElement).hidden = true;
    }, invalid);
    await page.keyboard.press('Escape');
    await expect(page.locator(surface)).toHaveCount(0);
    await expect(page.locator('#fallback')).toBeFocused();
  });
}

test('a reopen after removal cannot receive an old deferred close-autofocus callback', async ({page}) => {
  await load(page);
  await page.locator('#opener').click();
  await expect(page.locator(surface)).toHaveCSS('opacity', '1');
  await page.evaluate(() => new Promise<void>(resolve => {
    const old = document.querySelector('[data-animated-dialog]')!;
    const observer = new MutationObserver(() => {
      if (old.isConnected) return;
      observer.disconnect();
      // FocusScope defers its old close event with setTimeout(0). Reopen in the
      // removal microtask, before that timer, without making production delays.
      window.__dialogMotionFixture.setOpen(true);
      resolve();
    });
    observer.observe(document.body, {childList: true, subtree: true});
    window.__dialogMotionFixture.setOpen(false);
  }));
  await expect(page.locator(surface)).toHaveCSS('opacity', '1');
  await expect(page.locator('#draft')).toBeFocused();
  expect(await page.evaluate(() => window.__dialogMotionFixture.inspect().close)).toBe(0);
});

test('the latest close callback can cancel restoration', async ({page}) => {
  await load(page);
  await page.locator('#opener').click();
  await page.evaluate(() => {
    window.__dialogMotionFixture.setOpen(false);
    window.__dialogMotionFixture.setRestore(false);
  });
  await expect(page.locator(surface)).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__dialogMotionFixture.inspect().close)).toBe(1);
  await expect(page.locator('#opener')).not.toBeFocused();
});

test('system reduced motion removes travel and completes open/close with keyboard focus', async ({page}) => {
  await load(page, 'reduce');
  const opening = await page.evaluate(async () => {
    document.getElementById('opener')!.focus();
    window.__dialogMotionFixture.setOpen(true);
    const samples: Array<{opacity: number; y: number}> = [];
    const deadline = performance.now() + 4000;
    while (performance.now() < deadline) {
      const node = document.querySelector('[data-animated-dialog]');
      if (node) {
        const style = getComputedStyle(node);
        const value = {opacity: Number(style.opacity), y: style.transform === 'none' ? 0 : new DOMMatrixReadOnly(style.transform).m42};
        samples.push(value);
        if (value.opacity === 1) return samples;
      }
      await new Promise(requestAnimationFrame);
    }
    throw new Error('Reduced-motion dialog did not settle');
  });
  expect(opening.length).toBeGreaterThan(0);
  expect(opening.every(value => value.y === 0 && (value.opacity === 0 || value.opacity === 1))).toBe(true);
  await expect(page.locator('#draft')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator(surface)).toHaveCount(0);
  await expect(page.locator('#opener')).toBeFocused();
  // The persistent shell must also observe the OS setting changing after mount.
  await page.emulateMedia({reducedMotion: 'no-preference'});
  const sawTravel = await page.evaluate(async () => {
    document.getElementById('opener')!.focus();
    window.__dialogMotionFixture.setOpen(true);
    const deadline = performance.now() + 4000;
    while (performance.now() < deadline) {
      await new Promise(requestAnimationFrame);
      const node = document.querySelector('[data-animated-dialog]');
      if (!node) continue;
      const style = getComputedStyle(node);
      if (Number(style.opacity) > 0 && Number(style.opacity) < .99 && style.transform !== 'none') return true;
    }
    return false;
  });
  expect(sawTravel).toBe(true);
  await expect(page.locator(surface)).toHaveCSS('opacity', '1');
  await expect(page.locator(surface)).toHaveAttribute('data-reduced-motion', 'false');
  await page.emulateMedia({reducedMotion: 'reduce'});
  await expect(page.locator(surface)).toHaveAttribute('data-reduced-motion', 'true');
  const closing = await page.evaluate(async () => {
    window.__dialogMotionFixture.setOpen(false);
    const samples: Array<{opacity: number; y: number}> = [];
    const deadline = performance.now() + 4000;
    while (performance.now() < deadline) {
      const node = document.querySelector('[data-animated-dialog]');
      if (!node) return samples;
      const style = getComputedStyle(node);
      samples.push({opacity: Number(style.opacity), y: style.transform === 'none' ? 0 : new DOMMatrixReadOnly(style.transform).m42});
      await new Promise(requestAnimationFrame);
    }
    throw new Error('Reduced-motion dialog did not unmount');
  });
  expect(closing.every(value => value.y === 0 && (value.opacity === 0 || value.opacity === 1))).toBe(true);
  await expect(page.locator('#opener')).toBeFocused();
});
