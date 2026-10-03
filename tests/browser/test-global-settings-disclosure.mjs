/** Offline Chromium component test using the actual uploaded HTML and CSS.
 * No website navigation, no relay, and no game Runtime are involved.
 * EAGLER_TEST_CHROMIUM=/path/to/chromium node tests/browser/test-global-settings-disclosure.mjs
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { parse, serializeOuter } from 'parse5';
import puppeteer from 'puppeteer-core';
const project = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const tree = parse(await readFile(resolve(project, 'public/index.html'), 'utf8'));
function byId(node, id) {
  if (node.attrs?.some(attribute => attribute.name === 'id' && attribute.value === id)) return node;
  for (const child of node.childNodes || []) { const result = byId(child, id); if (result) return result; }
}
const originalMarkup = ['globalSettingsDialog', 'advancedOptions', 'mobileOptions']
  .map(id => { const node = byId(tree, id); assert.ok(node, id); return serializeOuter(node); }).join('\n');
const css = await readFile(resolve(project, process.env.EAGLER_TEST_STYLES || 'public/styles.css'), 'utf8');
const executablePath = process.env.EAGLER_TEST_CHROMIUM || ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'].find(existsSync);
assert.ok(executablePath, 'Set EAGLER_TEST_CHROMIUM to your Chromium executable');
const browser = await puppeteer.launch({ executablePath, headless: process.env.EAGLER_TEST_HEADFUL !== '1',
  args: process.getuid?.() === 0 ? ['--no-sandbox', '--disable-dev-shm-usage'] : [] });
const results = [];
try {
  const page = await browser.newPage();
  for (const [width, height] of [[1365, 1000], [390, 844]]) {
    await page.setViewport({ width, height, hasTouch: width < 780 });
    await page.setContent(`<html lang="zh-CN"><head><meta charset="utf-8"><style>${css}</style></head><body>${originalMarkup}</body></html>`);
    await page.evaluate(() => {
      // Apply the same reparenting used by app.mts; keep native <details> behavior.
      document.querySelector('#globalSettingsContent').append(document.querySelector('#advancedOptions'), document.querySelector('#mobileOptions'));
      document.querySelector('#globalSettingsDialog').showModal();
    });
    await delay(100);
    const styles = await page.evaluate(() => ({
      pointer: matchMedia('(pointer:fine)').matches ? 'fine' : 'not-fine',
      supported: CSS.supports('interpolate-size', 'allow-keywords') && CSS.supports('selector(::details-content)'),
      advanced: getComputedStyle(document.querySelector('#advancedOptions'), '::details-content').transitionDuration.split(', ').slice(0, 2),
      touch: getComputedStyle(document.querySelector('#mobileOptionsBody')).transitionDuration.split(', ').slice(0, 2),
    }));
    assert.ok(styles.supported, 'This test requires Chromium with native details-content size interpolation');
    assert.deepEqual(styles.advanced, styles.touch, 'Advanced should match touch slide/fade timing');
    async function captureToggle() {
      return page.evaluate(async () => {
        const element = document.querySelector('#advancedOptions');
        const sample = () => ({ height: element.getBoundingClientRect().height,
          opacity: Number(getComputedStyle(element, '::details-content').opacity) });
        const samples = [sample()];
        element.querySelector('summary').click();
        for (let i = 0; i < 34; i++) { await new Promise(requestAnimationFrame); samples.push(sample()); }
        return { open: element.open, samples };
      });
    }
    const opened = await captureToggle();
    assert.equal(opened.open, true);
    const low = opened.samples[0].height, high = opened.samples.at(-1).height;
    assert.ok(high > low + 150, `Expanded height: ${low} -> ${high}`);
    assert.ok(opened.samples.some(sample => sample.height > low + 1 && sample.height < high - 1), 'Opening must have intermediate heights');
    assert.ok(opened.samples.some(sample => sample.opacity > 0 && sample.opacity < 1), 'Opening must fade');
    const closed = await captureToggle();
    assert.equal(closed.open, false);
    assert.ok(Math.abs(closed.samples.at(-1).height - low) < 1);
    assert.ok(closed.samples.some(sample => sample.height > low + 1 && sample.height < high - 1), 'Closing must animate too');
    // Rapid reversal must not leave a stuck fixed height or an incorrect open state.
    await page.evaluate(async () => {
      const summary = document.querySelector('#advancedOptions > summary');
      for (let i = 0; i < 3; i++) { summary.click(); await new Promise(resolve => setTimeout(resolve, 35)); }
    });
    await delay(550);
    assert.ok(await page.$eval('#advancedOptions', element => element.open));
    const full = await page.evaluate(() => {
      const element = document.querySelector('#advancedOptions');
      const body = element.querySelector('.options-advanced-body');
      return { content: parseFloat(getComputedStyle(element, '::details-content').height), body: body.getBoundingClientRect().height };
    });
    assert.ok(Math.abs(full.content - full.body) < 1, 'Expanded content should not be clipped');
    // Native summary keyboard interaction is unchanged.
    await page.focus('#advancedOptions > summary');
    await page.keyboard.press('Enter'); await delay(550);
    assert.equal(await page.$eval('#advancedOptions', element => element.open), false);
    await page.keyboard.press('Space'); await delay(550);
    assert.equal(await page.$eval('#advancedOptions', element => element.open), true);
    for (const reduced of ['system', 'site']) {
      if (reduced === 'system') await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
      else { await page.emulateMediaFeatures([]); await page.evaluate(() => document.body.classList.add('less-motion')); }
      assert.ok(await page.$eval('#advancedOptions', element => getComputedStyle(element, '::details-content').transitionDuration.split(', ').every(value => parseFloat(value) === 0)), `${reduced} reduced motion`);
    }
    await page.emulateMediaFeatures([]);
    results.push({ width, height, pointer: styles.pointer, timing: styles.advanced, collapsedHeight: low, expandedHeight: high,
      opening: 'PASS', closing: 'PASS', reversal: 'PASS', keyboard: 'PASS', reducedMotion: 'PASS' });
  }
  console.log(JSON.stringify({ result: 'PASS', coverage: 'offline native disclosure component, not full-site browser navigation', results }, null, 2));
} finally { await browser.close(); }
