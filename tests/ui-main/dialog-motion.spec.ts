import {test as base, expect, type Page} from '@playwright/test';
import type {DialogMotionSample} from './dialog-motion-fixture';

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

interface Handoff {
  before: DialogMotionSample;
  after: DialogMotionSample;
  incoming: DialogMotionSample;
}

function opacityAt(animation: NonNullable<DialogMotionSample['native']>, elapsed: number) {
  const points = animation.easing.match(/^cubic-bezier\(([^)]+)\)$/)?.[1].split(',').map(Number);
  if (!points || points.length !== 4) throw new Error(`Unrecognized production easing: ${animation.easing}`);
  const [x1, y1, x2, y2] = points;
  const t = Math.min(1, Math.max(0, (elapsed - animation.delay) / animation.duration));
  const bezier = (u: number, p1: number, p2: number) => 3 * (1 - u) ** 2 * u * p1 + 3 * (1 - u) * u ** 2 * p2 + u ** 3;
  let lo = 0, hi = 1;
  for (let iteration = 0; iteration < 32; iteration++) {
    const mid = (lo + hi) / 2;
    if (bezier(mid, x1, x2) < t) lo = mid; else hi = mid;
  }
  const progress = bezier((lo + hi) / 2, y1, y2);
  return animation.keyframes[0].opacity + (animation.keyframes.at(-1)!.opacity - animation.keyframes[0].opacity) * progress;
}

function expectContinuousHandoff(handoff: Handoff, target: 0 | 1) {
  const {before, after, incoming} = handoff;
  expect(before.native).not.toBeNull();
  expect(incoming.native).not.toBeNull();
  const outgoing = before.native!, next = incoming.native!;
  expect(outgoing.startTime).not.toBeNull();
  expect(outgoing.currentTime).not.toBeNull();
  expect(outgoing.playState).toBe('running');
  expect(next.id).not.toBe(outgoing.id);
  expect(next.duration).toBe(180);
  expect(next.keyframes.at(-1)!.opacity).toBe(target);
  // Motion 14 samples stopped WAAPI animations using wall-clock elapsed time,
  // with a 10ms minimum sample. A computed style read uses the compositor's
  // currentTime instead. Compare the handoff against the outgoing easing over
  // that measured time interval, not equality across two different clocks.
  const elapsedBefore = Math.max(10, before.at - outgoing.startTime!);
  const elapsedAfter = Math.max(10, after.sampledAt - outgoing.startTime!);
  const lowerTime = Math.min(outgoing.currentTime!, elapsedBefore);
  const upperTime = Math.max(outgoing.currentTime!, elapsedAfter);
  const a = opacityAt(outgoing, lowerTime), b = opacityAt(outgoing, upperTime);
  // This epsilon covers CSS scalar serialization and Motion's 12-step bezier
  // approximation; elapsed work is accounted for above, never hidden by it.
  const scalarPrecision = .002;
  expect(after.opacity).toBeGreaterThanOrEqual(Math.min(a, b) - scalarPrecision);
  expect(after.opacity).toBeLessThanOrEqual(Math.max(a, b) + scalarPrecision);
  // The next animation must start at the interrupted value, never restart at
  // its original 0/1 endpoint. This is independent of how long React took.
  expect(Math.abs(next.keyframes[0].opacity - after.opacity)).toBeLessThan(.00001);
  expect(after.opacity).toBeGreaterThan(0);
  expect(after.opacity).toBeLessThan(1);
  expect(Math.abs(after.y - before.y)).toBeLessThan(.3);
}

test('default entry reverses to exit and back continuously, retaining one surface, draft, and empty frame', async ({page}, testInfo) => {
  await load(page);
  const result = await page.evaluate(async () => {
    const fixture = window.__dialogMotionFixture;
    const frame = document.querySelector('[data-empty-frame]');
    const read = fixture.sampleMotion;
    async function until(predicate: (value: NonNullable<ReturnType<typeof read>>) => boolean) {
      const deadline = performance.now() + 4000;
      let last = read();
      while (performance.now() < deadline) {
        await new Promise(requestAnimationFrame);
        last = read();
        if (last && predicate(last)) return last;
      }
      throw new Error(`Expected dialog animation state was not observed: ${JSON.stringify(last)}`);
    }
    document.getElementById('opener')!.focus();
    fixture.setOpen(true);
    await until(value => !!value.native && value.opacity > .15 && value.opacity < .9 && value.y > 0);
    const node = document.querySelector<HTMLElement>('[data-animated-dialog]')!;
    const draft = document.getElementById('draft') as HTMLInputElement;
    draft.value = 'retained through reversals';
    const beforeClose = read()!;
    fixture.setOpen(false);
    const afterClose = read()!;
    const retainedOnExit = node === document.querySelector('[data-animated-dialog]');
    const inaccessibleOnExit = node.inert && node.getAttribute('aria-hidden') === 'true';
    const noPointerOnExit = getComputedStyle(node).pointerEvents === 'none';
    const closing = await until(value => !!value.native && value.native.id !== beforeClose.native!.id && value.opacity > .01 && value.opacity < afterClose.opacity - .015);
    const beforeReopen = read()!;
    fixture.setOpen(true);
    const afterReopen = read()!;
    const resumedIdentity = node === document.querySelector('[data-animated-dialog]');
    const resuming = await until(value => !!value.native && value.native.id !== beforeReopen.native!.id);
    const settled = await until(value => value.opacity > .999 && Math.abs(value.y) < .01);
    return {
      close: {before: beforeClose, after: afterClose, incoming: closing},
      reopen: {before: beforeReopen, after: afterReopen, incoming: resuming}, settled,
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
  await testInfo.attach('dialog-default-interruption-measurements', {body: JSON.stringify(result, null, 2), contentType: 'application/json'});
  expectContinuousHandoff(result.close, 0);
  expectContinuousHandoff(result.reopen, 1);
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

test('repeated close/reopen interruptions have no stale exit or queued state', async ({page}, testInfo) => {
  await load(page);
  const result = await page.evaluate(async () => {
    const fixture = window.__dialogMotionFixture;
    document.getElementById('opener')!.focus();
    fixture.setOpen(true);
    const node = document.querySelector<HTMLElement>('[data-animated-dialog]')!;
    const frame = document.querySelector('[data-empty-frame]');
    const read = fixture.sampleMotion;
    async function until(predicate: (sample: NonNullable<ReturnType<typeof read>>) => boolean) {
      const deadline = performance.now() + 4000;
      let last = read();
      while (performance.now() < deadline) {
        await new Promise(requestAnimationFrame);
        if (!node.isConnected) throw new Error('Retained dialog was replaced');
        last = read();
        if (last && predicate(last)) return last;
      }
      throw new Error(`Dialog did not reach the requested direction: ${JSON.stringify(last)}`);
    }
    const reversals: Array<{before: NonNullable<ReturnType<typeof read>>; after: NonNullable<ReturnType<typeof read>>; incoming: NonNullable<ReturnType<typeof read>>}> = [];
    await until(value => value.opacity > .999);
    for (let round = 0; round < 4; round++) {
      fixture.setOpen(false);
      await until(value => !!value.native && value.opacity > .01 && value.opacity < .9);
      const before = read()!;
      fixture.setOpen(true);
      const after = read()!;
      const incoming = await until(value => !!value.native && value.native.id !== before.native!.id);
      reversals.push({before, after, incoming});
      await until(value => value.opacity > .999);
    }
    return {same: node === document.querySelector('[data-animated-dialog]'), reversals,
      focusedInside: node.contains(document.activeElement),
      oneSurface: document.querySelectorAll('[data-animated-dialog]').length === 1,
      sameFrame: frame === document.querySelector('[data-empty-frame]'), events: fixture.inspect()};
  });
  await testInfo.attach('dialog-repeated-interruption-measurements', {body: JSON.stringify(result, null, 2), contentType: 'application/json'});
  for (const handoff of result.reversals) expectContinuousHandoff(handoff, 1);
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
