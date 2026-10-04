import {test as base, expect, type Page} from '@playwright/test';
import type {DialogMotionSample} from './dialog-motion-fixture';

// Real Radix/Motion shell, synthetic contents only. Run through authorized CI,
// across the existing desktop engines and default-motion mobile viewport.
const origin = process.env.UI_RUNTIME_FIXTURE_ORIGIN ?? 'http://127.0.0.1:4175';
const fixtureUrl = `${origin}/__ui_tests__/dialog-motion.html`;
const surface = '[data-animated-dialog]';
const test = base.extend<{browserErrors: string[]}>({browserErrors: [async ({page}, use, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await use(errors);
  // Keep the diagnostic history when evaluate throws too, so a missed frame
  // does not erase the stage, native timing, and earlier interruption evidence.
  const frames = await page.evaluate(() => window.__dialogMotionFixture?.motionFrames() ?? []).catch(() => []);
  if (frames.length) await testInfo.attach('dialog-frame-history', {body: JSON.stringify(frames, null, 2), contentType: 'application/json'});
  expect(errors).toEqual([]);
}, {auto: true}]});

async function load(page: Page, reducedMotion: 'reduce' | 'no-preference' = 'no-preference') {
  await page.emulateMedia({reducedMotion});
  await page.goto(fixtureUrl);
  await expect(page.getByRole('heading', {name: 'Synthetic dialog motion fixture, no game execution'})).toBeVisible();
}

async function readyForMotion(page: Page) {
  // These are interruption-mechanics assertions, not a cold-load performance
  // gate. Wait for the fixture's fonts and two paint opportunities; never warm
  // up the dialog itself, replace its duration, or drive a virtual clock.
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    window.__dialogMotionFixture.recordMotion('fixture-fonts-and-frames-ready');
  });
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
  await readyForMotion(page);
  const result = await page.evaluate(async () => {
    const fixture = window.__dialogMotionFixture;
    const frame = document.querySelector('[data-empty-frame]');
    document.getElementById('opener')!.focus();
    await new Promise<void>(resolve => requestAnimationFrame(() => {fixture.setOpen(true);resolve();}));
    let node!: HTMLElement, draft!: HTMLInputElement;
    // Interrupt the first genuine interior frame. A cold WebKit CI trace had
    // currentTime=5ms / opacity=.122419, then no rAF for 650ms. Waiting for an
    // arbitrary .15 threshold discarded the only real interruption opportunity.
    // Keep the full frame history: this mechanics check is not a paint-speed gate.
    const closed = await fixture.observeMotion('entry-interrupted-by-close',
      value => fixture.isRunningInteriorMotion(value) && value.y > 0, () => {
        node = document.querySelector<HTMLElement>('[data-animated-dialog]')!;
        draft = document.getElementById('draft') as HTMLInputElement;
        draft.value = 'retained through reversals';
        const before = fixture.recordMotion('close-before')!;
        fixture.setOpen(false);
        const after = fixture.recordMotion('close-after')!;
        return {before, after,
          retainedOnExit: node === document.querySelector('[data-animated-dialog]'),
          inaccessibleOnExit: node.inert && node.getAttribute('aria-hidden') === 'true',
          noPointerOnExit: getComputedStyle(node).pointerEvents === 'none'};
      });
    const reopened = await fixture.observeMotion('exit-interrupted-by-reopen',
      value => !!value.native && value.native.id !== closed.before.native!.id && value.opacity > .01 && value.opacity < closed.after.opacity - .015, incoming => {
        const before = fixture.recordMotion('reopen-before')!;
        fixture.setOpen(true);
        const after = fixture.recordMotion('reopen-after')!;
        return {before, after, closing: incoming, resumedIdentity: node === document.querySelector('[data-animated-dialog]')};
      });
    const resuming = await fixture.observeMotion('reopened-native-animation', value => !!value.native && value.native.id !== reopened.before.native!.id, value => value);
    const settled = await fixture.observeMotion('reopened-settled', value => value.opacity > .999 && Math.abs(value.y) < .01, value => value);
    return {
      close: {before: closed.before, after: closed.after, incoming: reopened.closing},
      reopen: {before: reopened.before, after: reopened.after, incoming: resuming}, settled,
      retainedOnExit: closed.retainedOnExit, inaccessibleOnExit: closed.inaccessibleOnExit,
      noPointerOnExit: closed.noPointerOnExit, resumedIdentity: reopened.resumedIdentity,
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
  await readyForMotion(page);
  const result = await page.evaluate(async () => {
    const fixture = window.__dialogMotionFixture;
    document.getElementById('opener')!.focus();
    await new Promise<void>(resolve => requestAnimationFrame(() => {fixture.setOpen(true);resolve();}));
    const node = document.querySelector<HTMLElement>('[data-animated-dialog]')!;
    const frame = document.querySelector('[data-empty-frame]');
    const reversals: Array<{before: NonNullable<ReturnType<typeof fixture.sampleMotion>>; after: NonNullable<ReturnType<typeof fixture.sampleMotion>>; incoming: NonNullable<ReturnType<typeof fixture.sampleMotion>>}> = [];
    await fixture.observeMotion('repeat-initial-settled', value => value.opacity > .999, value => value);
    for (let round = 0; round < 4; round++) {
      fixture.setOpen(false);
      const handoff = await fixture.observeMotion(`repeat-${round}-exit-interrupted`, value => !!value.native && value.opacity > .01 && value.opacity < .9, () => {
        if (!node.isConnected) throw new Error('Retained dialog was replaced');
        const before = fixture.recordMotion(`repeat-${round}-before-reopen`)!;
        fixture.setOpen(true);
        const after = fixture.recordMotion(`repeat-${round}-after-reopen`)!;
        return {before, after};
      });
      const incoming = await fixture.observeMotion(`repeat-${round}-incoming`, value => !!value.native && value.native.id !== handoff.before.native!.id, value => value);
      reversals.push({...handoff, incoming});
      await fixture.observeMotion(`repeat-${round}-settled`, value => value.opacity > .999, value => value);
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

test('saved user reduction removes dialog travel and preserves close/reopen draft and focus', async ({page}) => {
  await page.addInitScript(() => localStorage.setItem('eagler-touhou-less-motion-v1', '1'));
  await load(page);
  await expect(page.locator('html')).toHaveAttribute('data-reduced-motion', 'true');
  await page.locator('#opener').click();
  await expect(page.locator(surface)).toHaveAttribute('data-reduced-motion', 'true');
  await expect(page.locator(surface)).toHaveCSS('opacity', '1');
  await expect(page.locator(surface)).toHaveCSS('transform', 'none');
  await page.locator('#draft').fill('kept through a preference change');
  const retained = await page.locator(surface).elementHandle();
  await page.evaluate(() => window.__dialogMotionFixture.setLessMotion(false));
  await expect(page.locator(surface)).toHaveAttribute('data-reduced-motion', 'false');
  expect(await retained!.evaluate(node => node === document.querySelector('[data-animated-dialog]'))).toBe(true);
  await expect(page.locator('#draft')).toHaveValue('kept through a preference change');
  await expect(page.locator('#draft')).toBeFocused();
  await page.evaluate(async () => {
    const fixture = window.__dialogMotionFixture;
    fixture.setOpen(false);
    await fixture.observeMotion('user-restored-motion-exit', sample => sample.opacity > .01 && sample.opacity < .99 && sample.y > 0, () => {
      fixture.setOpen(true);
    });
  });
  await expect(page.locator(surface)).toHaveCSS('opacity', '1');
  await expect(page.locator('#draft')).toHaveValue('kept through a preference change');
  await expect(page.locator('#draft')).toBeFocused();
  await page.evaluate(() => window.__dialogMotionFixture.setLessMotion(true));
  await page.keyboard.press('Escape');
  await expect(page.locator(surface)).toHaveCount(0);
  await expect(page.locator('#opener')).toBeFocused();
});

test('live user choice cannot override system reduction on an already-open dialog', async ({page}) => {
  await load(page, 'reduce');
  await page.locator('#opener').click();
  await page.evaluate(() => {
    window.__dialogMotionFixture.setLessMotion(true);
    window.__dialogMotionFixture.setLessMotion(false);
  });
  await expect(page.locator(surface)).toHaveAttribute('data-reduced-motion', 'true');
  await expect(page.locator('html')).toHaveAttribute('data-reduced-motion', 'true');
  await page.keyboard.press('Escape');
  await expect(page.locator(surface)).toHaveCount(0);
  await expect(page.locator('#opener')).toBeFocused();
});
