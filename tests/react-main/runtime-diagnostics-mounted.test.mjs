/** Mounted actual RuntimeDiagnostics + createRuntimeDiagnostics, synthetic DOM,
 * authenticated-runtime ports and bounded scheduling inputs only. No browser,
 * CSS-pixel, live performance, transport or calibration-report claim.
 * Original main edee9633: index1066–1078, app2244–2312/2720–2749. */
import test, {before, after, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {mkdir, mkdtemp, rm} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {installMountedDom} from './mounted-dom-environment.mjs';

const project = fileURLToPath(new URL('../../', import.meta.url));
const pinnedMain = 'edee9633e5e3ee79cd2e1aa334f84f6caf755090';
const pinned = path => execFileSync('git', ['show', `${pinnedMain}:${path}`], {cwd: project, encoding: 'utf8'});
const preferenceKey = 'eagler-touhou-runtime-diagnostics-v1';
const runtimeIds = ['runtimeBrowserDiag', 'runtimeAudioDiag', 'runtimeRendererDiag', 'runtimeGapDiag'];
const netplayIds = ['runtimeNetplaySessionDiag', 'runtimeNetplayInputDelayDiag', 'runtimeNetplayRouteDiag',
  'runtimeNetplayFrameDiag', 'runtimeNetplayRollbackDiag', 'runtimeNetplayQualityDiag', 'runtimeNetplayIceDiag'];
const diagnosticKeys = ['aria', 'browser', 'audio', 'graphics', 'frameShort', 'audioRobust', 'audioUnderruns'];
const mounts = new Set(), originalMessages = new Map();
let env, work, api, React, createRoot, originalAside;

before(async () => {
  env = installMountedDom();
  React = await import('react'); ({createRoot} = await import('react-dom/client'));
  const template = env.document.createElement('template'); template.innerHTML = pinned('public/index.html');
  originalAside = template.content.querySelector('#runtimeDiagnostics'); assert.ok(originalAside);
  // Only this view's copy is pinned; unrelated catalog additions do not fail it.
  const catalog = pinned('src/launcher/i18n.mts');
  for (const match of catalog.matchAll(/\["diagnostics\.[^"]+",\s*"(?:\\.|[^"\\])*",\s*"(?:\\.|[^"\\])*"\]/g)) {
    const [key, zh, en] = JSON.parse(match[0]); originalMessages.set(key, {'zh-CN': zh, en});
  }
  for (const key of diagnosticKeys) assert.ok(originalMessages.has(`diagnostics.${key}`), `pinned copy: ${key}`);
  await mkdir(resolve(project, '.cache'), {recursive: true});
  work = await mkdtemp(resolve(project, '.cache/react-main-runtime-diagnostics-view-'));
  const outfile = resolve(work, 'actual-view.mjs');
  await build({absWorkingDir: project, stdin: {resolveDir: project, loader: 'ts', contents: `
    export {createRuntimeDiagnostics} from './app/models/runtime-diagnostics.ts';
    export {RuntimeDiagnostics} from './app/components/player/RuntimeDiagnostics.tsx';
    export {LocaleProvider, translate} from './app/i18n.tsx';
  `}, outfile, bundle: true, platform: 'node', format: 'esm', packages: 'external', jsx: 'automatic', logLevel: 'silent',
    plugins: [{name: 'main-authored-mts', setup(context) {context.onResolve({filter: /^\.\.?\/.*\.mjs$/}, args => {
      const source = resolve(dirname(args.importer), args.path), authored = source.slice(0, -4) + '.mts';
      return source.startsWith(resolve(project, 'src') + '/') && existsSync(authored) ? {path: authored} : undefined;
    });}}],
  });
  api = await import(pathToFileURL(outfile).href);
});

afterEach(async () => {
  try {
    for (const fixture of [...mounts]) await fixture.dispose();
    assert.deepEqual(env.errors.splice(0), [], 'No React or synthetic DOM errors');
  } finally {env.document.body.replaceChildren();}
});
after(async () => {env?.close(); if (work) await rm(work, {recursive: true, force: true});});

const element = id => {const node = env.document.getElementById(id); assert.ok(node, `original #${id} exists`); return node;};
const attributes = node => Object.fromEntries([...node.attributes].map(({name, value}) => [name, value]).sort(([a], [b]) => a.localeCompare(b)));
const originalText = (locale, key, params = {}) => originalMessages.get(`diagnostics.${key}`)[locale]
  .replace(/\{([A-Za-z0-9_]+)\}/g, (_, name) => String(params[name] ?? `{${name}}`));

async function mount({locale = 'zh-CN', saved = null, testBuild = true, strict = false, children} = {}) {
  const updates = new Set(), events = new Set(), storageEvents = new Set();
  const hostFrames = new Map(), childFrames = new Map(), intervals = new Map(), writes = [];
  const subscriptions = {active: 0, added: 0, removed: 0, notifications: 0};
  let serial = 0, time = 0, frameLimit60 = false, state = {epoch: 1, launched: false, firstFrame: false};
  const documentIdentity = {};
  const child = {requestAnimationFrame(fn) {childFrames.set(++serial, fn); return serial;}, cancelAnimationFrame(id) {childFrames.delete(id);}};
  const window = {
    requestAnimationFrame(fn) {hostFrames.set(++serial, fn); return serial;}, cancelAnimationFrame(id) {hostFrames.delete(id);},
    setInterval(fn, delay) {intervals.set(++serial, {fn, delay}); return serial;}, clearInterval(id) {intervals.delete(id);},
    addEventListener(type, fn) {assert.equal(type, 'storage'); storageEvents.add(fn);},
    removeEventListener(type, fn) {assert.equal(type, 'storage'); storageEvents.delete(fn);},
  };
  const runtime = {
    getSnapshot: () => state, getMidiEventContext: () => ({epoch: state.epoch, document: documentIdentity}),
    subscribe(fn) {updates.add(fn); return () => updates.delete(fn);},
    subscribeEvents(fn) {events.add(fn); return () => events.delete(fn);},
  };
  const model = api.createRuntimeDiagnostics({runtime, window, frame: {contentWindow: child}, now: () => time,
    browser: () => 'Synthetic Browser 100', testBuild: () => testBuild, frameLimit60: () => frameLimit60,
    storage: {getItem(key) {assert.equal(key, preferenceKey); return saved;}, setItem(...args) {writes.push(args);}},
    translate: (key, params) => api.translate(locale, key, params)});
  // Instrument the real store's subscription boundary, never replace its state.
  const observedModel = {getSnapshot: model.getSnapshot, subscribe(listener) {
    subscriptions.active++; subscriptions.added++;
    const remove = model.subscribe(() => {subscriptions.notifications++; listener();});
    return () => {subscriptions.active--; subscriptions.removed++; remove();};
  }};
  const host = env.document.createElement('div'); env.document.body.append(host);
  let root = createRoot(host), netplay;
  const fixture = {model, subscriptions, updates, events, storageEvents, hostFrames, childFrames, intervals, writes,
    update(change) {state = {...state, ...change}; for (const fn of updates) fn();},
    event(message) {for (const fn of events) fn(message);},
    storage(key, newValue) {for (const fn of storageEvents) fn({key, newValue});},
    setTestBuild(value) {testBuild = value; model.refresh();},
    setFrameLimit(value) {frameLimit60 = value; model.refresh();},
    step(timeValue, includeChild = true) {
      time = timeValue;
      for (const [id, fn] of [...hostFrames]) {hostFrames.delete(id); fn();}
      if (includeChild) for (const [id, fn] of [...childFrames]) {childFrames.delete(id); fn();}
    },
    sample() {for (const {fn, delay} of [...intervals.values()]) {assert.equal(delay, 500); fn();}},
    async render(next = {}) {
      if (Object.hasOwn(next, 'locale')) locale = next.locale;
      if (Object.hasOwn(next, 'netplay')) netplay = next.netplay;
      if (!root) root = createRoot(host);
      await React.act(async () => {
        model.refresh();
        const view = React.createElement(api.LocaleProvider, {locale}, React.createElement(api.RuntimeDiagnostics, {model: observedModel, netplay}, children));
        root.render(strict ? React.createElement(React.StrictMode, null, view) : view);
      });
    },
    async unmount() {if (root) {await React.act(async () => root.unmount()); root = null;}},
    async dispose() {
      try {
        await fixture.unmount();
        assert.equal(subscriptions.active, 0, 'View unsubscribes on unmount');
        assert.equal(subscriptions.added, subscriptions.removed, 'Every view subscription is released');
      } finally {model.dispose(); mounts.delete(fixture);}
      for (const [name, port] of Object.entries({updates, events, storageEvents, hostFrames, childFrames, intervals})) {
        assert.equal(port.size, 0, `Owner disposal releases ${name}`);
      }
    },
  };
  mounts.add(fixture); await fixture.render(); return fixture;
}

for (const locale of ['zh-CN', 'en']) {
  test(`original diagnostic IDs/classes/aria and initially hidden MP rows (${locale})`, async () => {
    await mount({locale});
    const actual = element('runtimeDiagnostics'), expected = originalAside.cloneNode(true);
    expected.removeAttribute('data-i18n-aria-label'); // LocaleProvider replaces the original DOM translation marker.
    expected.setAttribute('aria-label', originalText(locale, 'aria'));
    assert.equal(actual.tagName, 'ASIDE'); assert.deepEqual(attributes(actual), attributes(expected));
    assert.deepEqual([...actual.children].map(node => node.id), [...runtimeIds, ...netplayIds]);
    assert.equal(actual.children.length, expected.children.length);
    for (let index = 0; index < actual.children.length; index++) {
      assert.equal(actual.children[index].tagName, expected.children[index].tagName);
      assert.deepEqual(attributes(actual.children[index]), attributes(expected.children[index]));
    }
    assert.deepEqual(runtimeIds.map(id => element(id).textContent), [originalText(locale, 'browser', {value: 'Synthetic Browser 100'}),
      originalText(locale, 'audio', {value: '--'}), originalText(locale, 'graphics', {value: '--'}),
      `${originalText(locale, 'frameShort', {hz: '--', age: ''})} - C-- - P-- - gap -- - lock off`]);
    for (const id of netplayIds) {
      assert.equal(element(id).hidden, true);
      assert.equal(element(id).textContent, originalAside.querySelector(`#${id}`).textContent);
    }
  });

  test(`synthetic authenticated runtime events render exact fields and severity classes (${locale})`, async () => {
    const f = await mount({locale});
    await React.act(async () => {
      f.update({launched: true});
      f.event({event: 'runtime-info', renderer: 'ANGLE (Synthetic Vendor, Synthetic GPU, Synthetic API)'});
      f.event({event: 'frame-health', fps: 59.6, maxGapMs: 35.4});
      f.event({event: 'audio-health', minQueuedMs: 19.6, backend: 'worklet', underruns: 0, robust: true});
      f.setFrameLimit(true);
    });
    assert.equal(element('runtimeDiagnostics').hidden, false);
    assert.equal(element('runtimeDiagnostics').className, 'runtime-diagnostics warn');
    assert.equal(element('runtimeRendererDiag').textContent, originalText(locale, 'graphics', {value: 'Synthetic GPU'}));
    assert.equal(element('runtimeAudioDiag').textContent, originalText(locale, 'audio', {value: `20ms AW ${originalText(locale, 'audioRobust')}`}));
    assert.equal(element('runtimeGapDiag').textContent, `${originalText(locale, 'frameShort', {hz: '--', age: ''})} - C-- - P60 - gap 35ms - lock 60`);
    await React.act(async () => f.event({event: 'audio-health', minQueuedMs: 4, backend: 'script', underruns: 2, robust: false}));
    assert.equal(element('runtimeDiagnostics').className, 'runtime-diagnostics bad', 'bad replaces warn');
    assert.equal(element('runtimeAudioDiag').textContent, originalText(locale, 'audio', {value: `4ms SP ${originalText(locale, 'audioUnderruns', {count: 2})}`}));
    await React.act(async () => {
      f.event({event: 'audio-health', minQueuedMs: 20, backend: 'worklet', underruns: 0});
      f.event({event: 'frame-health', fps: 60, maxGapMs: 34});
    });
    assert.equal(element('runtimeDiagnostics').className, 'runtime-diagnostics', 'healthy input removes both severity classes');
    await React.act(async () => f.event({event: 'frame-health', fps: 60, maxGapMs: 80}));
    assert.equal(element('runtimeDiagnostics').className, 'runtime-diagnostics bad');
    await React.act(async () => {
      f.event({event: 'frame-health', fps: 60, maxGapMs: 0});
      f.event({event: 'runtime-info', renderer: 'Synthetic SwiftShader'});
    });
    assert.equal(element('runtimeDiagnostics').className, 'runtime-diagnostics bad', 'software renderer remains bad with healthy audio/frame data');
    assert.equal(element('runtimeRendererDiag').textContent, originalText(locale, 'graphics', {value: 'Synthetic SwiftShader'}));
  });

  test(`explicit synthetic MP lines reveal only their original model-ID rows (${locale})`, async () => {
    const f = await mount({locale});
    await React.act(async () => f.update({launched: true}));
    const runtimeBefore = runtimeIds.map(id => element(id).textContent);
    // Actual gameplay diagnostics are keyed by full element ID, not row aliases.
    await f.render({netplay: {session: 'Synthetic invalid alias'}});
    for (const id of netplayIds) assert.equal(element(id).hidden, true);
    for (const selected of netplayIds) {
      await f.render({netplay: {[selected]: `Synthetic owner line: ${selected}`}});
      for (const id of netplayIds) {
        assert.equal(element(id).hidden, id !== selected, `Only ${selected} is shown`);
        assert.equal(element(id).textContent, id === selected ? `Synthetic owner line: ${id}` : originalAside.querySelector(`#${id}`).textContent);
      }
    }
    const lines = Object.fromEntries(netplayIds.map(id => [id, `Synthetic owner line: ${id}`]));
    await f.render({netplay: lines});
    for (const id of netplayIds) {assert.equal(element(id).hidden, false); assert.equal(element(id).textContent, lines[id]);}
    await f.render({netplay: {...lines, runtimeNetplaySessionDiag: '', runtimeNetplayIceDiag: undefined}});
    assert.equal(element('runtimeNetplaySessionDiag').hidden, false, 'Defined empty text is not an absent line');
    assert.equal(element('runtimeNetplaySessionDiag').textContent, '');
    assert.equal(element('runtimeNetplayIceDiag').hidden, true);
    await f.render({netplay: undefined});
    for (const id of netplayIds) assert.equal(element(id).hidden, true, 'Removed owner lines hide again');
    assert.deepEqual(runtimeIds.map(id => element(id).textContent), runtimeBefore, 'MP prop updates do not manufacture runtime metrics');
  });
}

for (const [saved, testBuild, enabled] of [[null, false, false], [null, true, true], ['0', true, false], ['1', false, true]]) {
  test(`real visibility uses launched state, test-build default and saved preference (${saved ?? 'unset'}/${testBuild})`, async () => {
    const f = await mount({saved, testBuild});
    assert.equal(element('runtimeDiagnostics').hidden, true, 'Not launched is always hidden');
    await React.act(async () => f.update({launched: true}));
    assert.equal(element('runtimeDiagnostics').hidden, !enabled);
    await React.act(async () => f.model.toggle());
    assert.equal(element('runtimeDiagnostics').hidden, enabled);
    assert.deepEqual(f.writes, [[preferenceKey, enabled ? '0' : '1']]);
    await React.act(async () => f.update({launched: false}));
    assert.equal(element('runtimeDiagnostics').hidden, true);
  });
}

test('storage and live manifest changes update the mounted visibility through the real owner', async () => {
  const f = await mount({testBuild: false});
  await React.act(async () => f.update({launched: true}));
  await React.act(async () => f.setTestBuild(true)); assert.equal(element('runtimeDiagnostics').hidden, false);
  await React.act(async () => f.storage('unrelated-synthetic-key', '0')); assert.equal(element('runtimeDiagnostics').hidden, false);
  await React.act(async () => f.storage(preferenceKey, '0')); assert.equal(element('runtimeDiagnostics').hidden, true);
  await React.act(async () => f.setTestBuild(false));
  await React.act(async () => f.setTestBuild(true)); assert.equal(element('runtimeDiagnostics').hidden, true);
  await React.act(async () => f.storage(preferenceKey, 'invalid-synthetic-preference')); assert.equal(element('runtimeDiagnostics').hidden, false);
  assert.deepEqual(f.writes, [], 'Reading storage notifications does not write preferences');
});

test('synthetic host/child callbacks reach the mounted frame field and epoch reset clears metrics', async () => {
  const f = await mount({locale: 'en'});
  await React.act(async () => f.update({launched: true}));
  assert.equal(f.hostFrames.size, 0, 'No frame probe before the first frame');
  await React.act(async () => {
    f.update({firstFrame: true});
    f.event({event: 'frame-health', fps: 60, maxGapMs: 80});
    f.event({event: 'runtime-info', renderer: 'Synthetic GPU'});
    f.event({event: 'audio-health', minQueuedMs: 4, backend: 'script', underruns: 1});
    // Four host callbacks and two child callbacks in exactly 500 synthetic ms.
    for (let tick = 1; tick <= 4; tick++) f.step(tick * 125, tick % 2 === 0);
    f.sample();
  });
  assert.equal(element('runtimeGapDiag').textContent, 'Frame H8 - C4 - P60 - gap 80ms - lock off');
  assert.equal(element('runtimeDiagnostics').className, 'runtime-diagnostics bad');
  await React.act(async () => f.update({epoch: 2, launched: false, firstFrame: false}));
  assert.equal(element('runtimeDiagnostics').hidden, true);
  assert.equal(element('runtimeDiagnostics').className, 'runtime-diagnostics');
  assert.equal(element('runtimeAudioDiag').textContent, 'Audio --');
  assert.equal(element('runtimeRendererDiag').textContent, 'Graphics --');
  assert.equal(element('runtimeGapDiag').textContent, 'Frame H-- - C-- - P-- - gap -- - lock off');
  assert.equal(f.hostFrames.size, 0); assert.equal(f.childFrames.size, 0); assert.equal(f.intervals.size, 0);
});

test('locale changes update aria and actual model fields without remounting the view', async () => {
  const f = await mount({locale: 'zh-CN'}), aside = element('runtimeDiagnostics');
  await React.act(async () => {
    f.update({launched: true});
    f.event({event: 'audio-health', minQueuedMs: 12, backend: 'worklet', underruns: 1, robust: true});
  });
  await f.render({locale: 'en'});
  assert.equal(element('runtimeDiagnostics'), aside);
  assert.equal(aside.getAttribute('aria-label'), 'Runtime diagnostics');
  assert.equal(element('runtimeBrowserDiag').textContent, 'Browser Synthetic Browser 100');
  assert.equal(element('runtimeAudioDiag').textContent, 'Audio 12ms AW robust underruns 1');
  assert.equal(element('runtimeGapDiag').textContent, 'Frame H-- - C-- - P-- - gap -- - lock off');
  await f.render({locale: 'zh-CN'});
  assert.equal(aside.getAttribute('aria-label'), '运行诊断');
  assert.equal(element('runtimeAudioDiag').textContent, '音频 12ms AW 增强 欠载1');
});

test('calibration-report child slot preserves child identity, state and callback through model/MP updates', async () => {
  // Deliberate stateful slot probe, not a replacement calibration implementation.
  // Calibration report parsing/dialog/clipboard behavior has its own owner suite.
  function SyntheticCalibrationSlot() {
    const [clicks, setClicks] = React.useState(0);
    return React.createElement('button', {id: 'netplayCalibrationReport', type: 'button', onClick: () => setClicks(value => value + 1)}, `Synthetic calibration slot ${clicks}`);
  }
  const f = await mount({children: React.createElement(SyntheticCalibrationSlot)});
  const child = element('netplayCalibrationReport');
  assert.equal(child.parentElement, element('runtimeDiagnostics'));
  assert.equal(child.previousElementSibling.id, 'runtimeNetplayIceDiag');
  await React.act(async () => child.click()); assert.equal(child.textContent, 'Synthetic calibration slot 1');
  await React.act(async () => {f.update({launched: true}); f.event({event: 'frame-health', fps: 60, maxGapMs: 80});});
  await f.render({netplay: {runtimeNetplayQualityDiag: 'Synthetic owner quality line'}});
  assert.equal(element('netplayCalibrationReport'), child); assert.equal(child.textContent, 'Synthetic calibration slot 1');
  await React.act(async () => f.model.toggle()); assert.equal(element('runtimeDiagnostics').hidden, true);
  await React.act(async () => f.model.toggle());
  await React.act(async () => child.click()); assert.equal(child.textContent, 'Synthetic calibration slot 2');
});

test('StrictMode balances real-store subscriptions; view cleanup leaves owner lifetime explicit', async () => {
  const f = await mount({strict: true});
  assert.ok(f.subscriptions.added >= 2, 'StrictMode performs subscription setup/cleanup/replay');
  assert.equal(f.subscriptions.active, 1); assert.equal(f.subscriptions.removed, f.subscriptions.added - 1);
  assert.equal(f.updates.size, 1); assert.equal(f.events.size, 1); assert.equal(f.storageEvents.size, 1);
  await React.act(async () => f.update({launched: true, firstFrame: true}));
  assert.equal(f.hostFrames.size, 1); assert.equal(f.childFrames.size, 1); assert.equal(f.intervals.size, 1);
  await f.unmount();
  assert.equal(f.subscriptions.active, 0); assert.equal(f.subscriptions.added, f.subscriptions.removed);
  const notifications = f.subscriptions.notifications;
  await React.act(async () => f.event({event: 'audio-health', minQueuedMs: 4, backend: 'worklet', underruns: 1}));
  assert.equal(f.subscriptions.notifications, notifications, 'Retired view receives no callbacks');
  assert.equal(f.model.getSnapshot().severity, 'bad', 'Unmount does not dispose a session-owned model');
  await f.render();
  assert.equal(f.subscriptions.active, 1); assert.equal(element('runtimeDiagnostics').className, 'runtime-diagnostics bad');
  await f.dispose();
  assert.equal(env.document.getElementById('runtimeDiagnostics'), null);
  assert.equal(f.subscriptions.added, f.subscriptions.removed);
});
