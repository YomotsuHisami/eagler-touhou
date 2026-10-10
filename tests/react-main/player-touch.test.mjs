/** Main8980–9480 touch behavior. Synthetic DOM/geometry/native-message ports;
 * not device pointer, mobile Safari, visual, playable game or latency acceptance. */
import test, {before, after, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir, mkdtemp, rm} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {resolve, dirname} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {installMountedDom} from './mounted-dom-environment.mjs';
const root = fileURLToPath(new URL('../../', import.meta.url));
let work, env, createPlayerTouch, active = [];
before(async () => {
  env = installMountedDom(); await mkdir(resolve(root, '.cache'), {recursive: true});
  work = await mkdtemp(resolve(root, '.cache/touch-main-')); const outfile = resolve(work, 'touch.mjs');
  await build({entryPoints: [resolve(root, 'app/services/player-touch.ts')], outfile, bundle: true, platform: 'node', format: 'esm', logLevel: 'silent',
    plugins: [{name: 'authored-main', setup(ctx) {ctx.onResolve({filter: /^\.\.?\/.*\.mjs$/}, args => {
      const path = resolve(dirname(args.importer), args.path), authored = path.slice(0, -4) + '.mts';
      if (path.startsWith(resolve(root, 'src') + '/') && existsSync(authored)) return {path: authored};
    });}}]}); ({createPlayerTouch} = await import(pathToFileURL(outfile).href));
});
afterEach(() => {for (const f of active) f.touch.dispose(); active = []; env.document.body.replaceChildren(); assert.deepEqual(env.errors, []);});
after(async () => {env?.close(); if (work) await rm(work, {recursive: true, force: true});});
function fixture({game = 'th06', ios = false, movement = 'touch', focus = 'hold-button', spectator = false, fireState} = {}) {
  const elements = Object.fromEntries(['frame', 'directSurface', 'fire', 'focus', 'functionKey', 'escape', 'bomb', 'restart', 'joystick', 'joystickKnob', 'thpracBackspace'].map(name => [name, env.document.createElement('div')]));
  const u = env.document.createElement('button'); u.dataset.thpracKey = 'U'; elements.thpracKeys = [u];
  for (const element of [...Object.values(elements).filter(x => !Array.isArray(x)), u]) env.document.body.append(element);
  let measures = 0, editing = false, refocused = 0, zoomActive = false;
  elements.frame.getBoundingClientRect = () => {measures++; return {left: 10, top: 20, width: 400, height: 600};};
  elements.joystick.getBoundingClientRect = () => ({left: 0, top: 0, width: 100, height: 100});
  const sent = [], listeners = new Set(), zoomCalls = [];
  let context = {target: {postMessage(message) {sent.push(message);}}, targetOrigin: 'https://launcher.invalid', protocol: 'eagler-touhou/1', game, epoch: 1, ready: true, launched: true, spectator};
  const native = {target: new env.window.EventTarget(), epoch: 1, document: {}, game, music: 'none'};
  const settings = {gameId: game, options: {touchEnabled: true, touchMovementMode: movement, touchFocusMode: focus, touchSensitivity: 1, thpracTouchControlsEnabled: true}};
  let fireEnabled = true;
  fireState ??= {getEnabled: () => fireEnabled, setEnabled(value) {fireEnabled = value;}};
  const touch = createPlayerTouch({runtime: {getInputContext: () => context, getSnapshot: () => context,
    getMidiEventContext: () => native, subscribe(fn) {listeners.add(fn); return () => listeners.delete(fn);}},
    getSettings: () => settings, fireState, editing: () => editing, playerOpen: () => true, iosWebKitTouch: ios,
    refocus() {refocused++;}, elements, zoom: {isActive: () => zoomActive, beginPointer(e) {zoomCalls.push(['down', e.pointerId]);}, movePointer(e) {zoomCalls.push(['move', e.pointerId]);}, endPointer(e) {zoomCalls.push(['up', e.pointerId]);}},
    document: env.document, window: env.window});
  const f = {touch, elements, sent, settings, native, zoomCalls, measures: () => measures, refocused: () => refocused,
    edit(value) {editing = value; touch.sync();}, zoom(value) {zoomActive = value;},
    epoch(value) {context = {...context, epoch: value}; native.epoch = value; for (const fn of listeners) fn();},
    pointer(name, type, values = {}) {const event = new env.window.PointerEvent(type, {bubbles: true, cancelable: true, pointerId: 1, pointerType: 'touch', clientX: 210, clientY: 320, ...values}); elements[name].dispatchEvent(event); return event;},
    click(name, detail = 0) {elements[name].dispatchEvent(new env.window.MouseEvent('click', {bubbles: true, cancelable: true, detail}));},
    iosEvent(name, type, touches) {const event = new env.window.Event(type, {bubbles: true, cancelable: true}); Object.defineProperty(event, 'changedTouches', {value: touches}); elements[name].dispatchEvent(event); return event;},
  }; active.push(f); return f;
}
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
test('direct contacts preserve independent IDs and normalized iframe coordinates with gesture-cached rect', () => {
  const f = fixture(); f.pointer('directSurface', 'pointerdown'); f.pointer('directSurface', 'pointermove', {clientX: 410, clientY: 620});
  f.pointer('directSurface', 'pointerdown', {pointerId: 2, clientX: 110, clientY: 170});
  f.pointer('directSurface', 'pointerup', {pointerId: 1}); f.pointer('directSurface', 'pointercancel', {pointerId: 2});
  assert.deepEqual(f.sent.map(x => [x.type, x.id]), [['down', -1000000], ['move', -1000000], ['down', -1000001], ['up', -1000000], ['up', -1000001]]);
  assert.equal(f.sent[0].x, .5); assert.equal(f.sent[1].x, 1); assert.equal(f.sent[1].y, 1); assert.equal(f.measures(), 1);
});
test('direct lost capture releases once; mouse and hidden surface create no movement', () => {
  const f = fixture(); f.pointer('directSurface', 'pointerdown'); f.pointer('directSurface', 'lostpointercapture'); f.pointer('directSurface', 'pointerup');
  assert.equal(f.sent.filter(x => x.type === 'up').length, 1); f.sent.length = 0;
  f.pointer('directSurface', 'pointerdown', {pointerType: 'mouse'}); f.elements.directSurface.hidden = true; f.pointer('directSurface', 'pointerdown'); assert.deepEqual(f.sent, []);
});
test('iOS owns native touch sequence and HUD does not refocus an active movement contact', () => {
  const f = fixture({ios: true}); const contact = {identifier: 7, clientX: 210, clientY: 320};
  f.pointer('directSurface', 'pointerdown'); assert.deepEqual(f.sent, []);
  f.iosEvent('directSurface', 'touchstart', [contact]); f.pointer('bomb', 'pointerdown'); assert.equal(f.refocused(), 0);
  f.iosEvent('directSurface', 'touchend', [contact]); f.pointer('bomb', 'pointerdown'); assert.equal(f.refocused(), 1);
  assert.deepEqual(f.sent.filter(x => x.command === 'direct-touch').map(x => x.type), ['down', 'up']);
});
test('zoom path remeasures moving frame and uses same direct stream', () => {
  const f = fixture(); f.zoom(true); f.pointer('directSurface', 'pointerdown'); f.pointer('directSurface', 'pointermove'); f.pointer('directSurface', 'pointerup');
  assert.equal(f.measures(), 3); assert.deepEqual(f.zoomCalls, [['down', 1], ['move', 1], ['up', 1]]);
});
test('TH09 held fire never also enables automatic pulse stream and releases on lost capture', () => {
  const f = fixture({game: 'th09'}); f.pointer('fire', 'pointerdown'); f.touch.syncControls(); f.pointer('fire', 'lostpointercapture');
  assert.deepEqual(f.sent.filter(x => x.command === 'keyboard').map(x => [x.code, x.down]), [['KeyZ', true], ['KeyZ', false]]);
  assert.equal(f.sent.find(x => x.command === 'touch-controls').fireEnabled, false);
});
test('toggle fire ignores compatibility click; intentional detail-zero keyboard activation works', () => {
  const f = fixture(); f.pointer('fire', 'pointerdown'); f.click('fire', 1); assert.equal(f.touch.getSnapshot().fireEnabled, false);
  f.click('fire'); assert.equal(f.touch.getSnapshot().fireEnabled, true);
});
test('hold focus releases on lost capture and toggle focus persists until next explicit activation', () => {
  const f = fixture(); f.pointer('focus', 'pointerdown'); assert.equal(f.touch.getSnapshot().focusEnabled, true);
  f.pointer('focus', 'lostpointercapture'); assert.equal(f.touch.getSnapshot().focusEnabled, false);
  f.settings.options.touchFocusMode = 'toggle-button'; f.pointer('focus', 'pointerdown'); f.pointer('focus', 'pointerup'); assert.equal(f.touch.getSnapshot().focusEnabled, true);
  f.click('focus'); assert.equal(f.touch.getSnapshot().focusEnabled, false);
});
test('ordinary C pulse survives pointerup followed by lost-capture and releases after sampled interval', async () => {
  const f = fixture({game: 'th11'}); f.pointer('functionKey', 'pointerdown'); f.pointer('functionKey', 'pointerup'); f.pointer('functionKey', 'lostpointercapture');
  assert.deepEqual(f.sent.filter(x => x.command === 'keyboard').map(x => x.down), [true]);
  await wait(60); assert.deepEqual(f.sent.filter(x => x.command === 'keyboard').map(x => [x.code, x.down]), [['KeyC', true], ['KeyC', false]]);
});
test('joystick uses original dead zone and signed axes; cancellation cannot restore stale RAF movement', async () => {
  const f = fixture({movement: 'joystick'}); f.pointer('joystick', 'pointerdown', {clientX: 52, clientY: 50}); await wait(25);
  assert.equal(f.sent.at(-1).joystickX, 0);
  f.pointer('joystick', 'pointermove', {clientX: 84, clientY: 50}); f.touch.cancelPointers(); await wait(25);
  assert.equal(f.sent.at(-1).joystickX, 0); assert.equal(f.sent.at(-1).joystickY, 0);
  assert.equal(f.elements.joystickKnob.style.transform, 'translate(-50%,-50%)');
});
test('TH15 U pulse keeps original key identity and stale epoch timer cannot release into replacement', async () => {
  const f = fixture({game: 'th15'}); f.touch.pulseThprac('U'); f.epoch(2); await wait(80);
  assert.deepEqual(f.sent.filter(x => x.command === 'keyboard').map(x => [x.code, x.down, x.epoch]), [['KeyU', true, 1]]);
});
test('spectator and layout editor cannot create gameplay input', () => {
  const f = fixture({spectator: true}); f.pointer('bomb', 'pointerdown'); f.pointer('directSurface', 'pointerdown'); f.touch.pulseThprac('U'); assert.deepEqual(f.sent, []);
  const g = fixture(); g.edit(true); g.sent.length = 0; g.pointer('fire', 'pointerdown'); g.pointer('functionKey', 'pointerdown'); g.pointer('directSurface', 'pointerdown'); assert.deepEqual(g.sent, []);
});
test('epoch reset clears transient owners but retains deliberate fire toggle', () => {
  const f = fixture(); f.pointer('fire', 'pointerdown'); f.pointer('focus', 'pointerdown'); f.epoch(2);
  assert.equal(f.touch.getSnapshot().fireEnabled, false); assert.equal(f.touch.getSnapshot().focusEnabled, false);
  assert.equal(f.touch.getSnapshot().bombSerial, 0);
});

test('main1874/8983: recreated Player bindings retain document fire choice across games without retaining transient input', () => {
  let enabled = true; const writes = [];
  const fireState = {getEnabled: () => enabled, setEnabled(value) {enabled = value; writes.push(value);}};
  const first = fixture({fireState});
  first.pointer('fire', 'pointerdown'); first.pointer('focus', 'pointerdown');
  first.pointer('bomb', 'pointerdown'); first.pointer('escape', 'pointerdown'); first.touch.dispose();
  assert.equal(enabled, false); assert.deepEqual(writes, [false]);

  const held = fixture({game: 'th09', fireState});
  assert.equal(held.touch.getSnapshot().fireEnabled, false);
  assert.equal(held.touch.getSnapshot().focusEnabled, false);
  assert.equal(held.touch.getSnapshot().bombSerial, 0); assert.equal(held.touch.getSnapshot().escapeSerial, 0);
  held.pointer('fire', 'pointerdown'); held.pointer('fire', 'pointerup'); held.touch.dispose();
  assert.deepEqual(writes, [false], 'TH09 held-key fire does not overwrite the document auto-fire choice');

  const next = fixture({game: 'th07', fireState}); next.touch.syncControls();
  assert.equal(next.sent.at(-1).fireEnabled, false);
  next.click('fire'); assert.equal(enabled, true); assert.deepEqual(writes, [false, true]); next.touch.dispose();
  assert.deepEqual(writes, [false, true], 'dispose resets transient input only');
  assert.equal(fixture().touch.getSnapshot().fireEnabled, true, 'a fresh document starts with main\'s true default');
});
