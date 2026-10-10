/** Main-derived synthetic keyboard/focus fixture. Real HostedKeyboard helper,
 * actual player-keyboard service, jsdom events and deterministic timers only.
 * No browser keyboard, native iframe, Android device or game-input proof.
 * Main app:3033–3060,5094–5110,5138–5169 and test-hosted-key-release.mjs.
 */
import test, {before, after, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir, mkdtemp, rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {JSDOM} from 'jsdom';
const project = fileURLToPath(new URL('../../', import.meta.url));
let work, createPlayerKeyboard; const fixtures = [];
before(async () => {
  await mkdir(resolve(project, '.cache'), {recursive: true}); work = await mkdtemp(resolve(project, '.cache/react-main-keyboard-'));
  const outfile = resolve(work, 'actual-keyboard.mjs');
  // HostedKeyboard has only a type-only sibling import. No behavior is mocked.
  await build({absWorkingDir: project, entryPoints: ['app/services/player-keyboard.ts'], outfile,
    bundle: true, platform: 'node', format: 'esm', packages: 'external', logLevel: 'silent'});
  ({createPlayerKeyboard} = await import(pathToFileURL(outfile).href));
});
afterEach(() => {for (const f of fixtures.splice(0)) {f.owner.dispose(); assert.equal(f.clock.pending.size, 0); f.dom.window.close();}});
after(async () => {if (work) await rm(work, {recursive: true, force: true});});
function tracked(target) {
  const active = new Map(), add = target.addEventListener.bind(target), remove = target.removeEventListener.bind(target);
  const capture = options => typeof options === 'boolean' ? options : options?.capture === true;
  target.addEventListener = (type, callback, options) => {
    const key = `${type}:${capture(options)}`; if (!active.has(key)) active.set(key, new Set()); active.get(key).add(callback); add(type, callback, options);
  };
  target.removeEventListener = (type, callback, options) => {active.get(`${type}:${capture(options)}`)?.delete(callback); remove(type, callback, options);};
  return {target, active, count: type => [...active].filter(([key]) => !type || key.startsWith(`${type}:`)).reduce((sum,[,set]) => sum + set.size, 0)};
}
function clock() {
  let now = 1, serial = 0; const pending = new Map();
  return {pending, now: () => now, setInterval(callback, ms) {const id = ++serial; pending.set(id, {callback, ms, at: now + ms}); return id;},
    clearInterval(id) {pending.delete(id);}, advance(ms) {const end = now + ms; while (true) {
      const next = [...pending].filter(([,item]) => item.at <= end).sort((a,b) => a[1].at - b[1].at)[0]; if (!next) break;
      const [id,item] = next; now = item.at; item.at += item.ms; item.callback();
    } now = end;}};
}
function fixture({android = false} = {}) {
  const dom = new JSDOM('<!doctype html><html><body><div id="gameTarget" tabindex="0"></div><input id="input"><select id="select"><option>A</option></select><textarea id="textarea"></textarea><button id="button">Button</button><dialog id="dialog"><span id="dialogChild"></span></dialog><div role="dialog"><span id="roleDialogChild"></span></div></body></html>', {url: 'https://launcher.invalid/', pretendToBeVisual: true});
  const {window} = dom, {document} = window, win = tracked(window), doc = tracked(document), time = clock();
  let visibility = 'visible', playerOpen = true, fullscreen = false, frameWindow;
  Object.defineProperty(document, 'visibilityState', {configurable: true, get: () => visibility});
  const input = {target: null, game: 'th15', epoch: 1, launched: true, ready: true, spectator: false,
    targetOrigin: 'https://launcher.invalid', protocol: 'eagler-touhou/1'};
  const snapshot = {ready: true, launched: true, firstFrame: false};
  const nativeTargets = [], messages = [], calls = {release: 0, cancel: 0, toggle: 0, frameFocus: [], nativeFocus: 0};
  function makeNative() {
    const item = tracked(new window.EventTarget()); item.target.focus = () => calls.nativeFocus++; nativeTargets.push(item); return item;
  }
  let native = makeNative(), nativeContext = {epoch: 1, game: 'th15', document: {}, target: native.target, music: 'none'};
  input.target = native.target; frameWindow = native.target;
  const frame = tracked(new window.EventTarget()); frame.target.focus = options => calls.frameFocus.push(options);
  Object.defineProperty(frame.target, 'contentWindow', {get: () => frameWindow});
  const listeners = new Set();
  const runtime = {getInputContext: () => ({...input}), getMidiEventContext: () => nativeContext,
    getSnapshot: () => ({...snapshot}), postInput(command, payload) {messages.push({command, payload, epoch: input.epoch, target: input.target}); return true;},
    subscribe(listener) {listeners.add(listener); return () => listeners.delete(listener);}};
  const owner = createPlayerKeyboard({runtime, window, document, frame: frame.target, playerOpen: () => playerOpen,
    launcherOwnsTarget: target => target instanceof window.Element && !!target.closest('input,select,textarea,button,dialog,[role="dialog"]'),
    releaseHeldTouchFire: () => calls.release++, cancelTouchFunction: () => calls.cancel++, toggleFullscreen: () => calls.toggle++,
    isPlayerFullscreen: () => fullscreen, android, now: time.now, setInterval: time.setInterval, clearInterval: time.clearInterval});
  const notify = () => {for (const listener of listeners) listener();};
  const key = (type, fields = {}, target = document.getElementById('gameTarget')) => {
    const event = new window.KeyboardEvent(type, {bubbles: true, cancelable: true, code: 'KeyU', key: 'u', keyCode: 85, location: 0, ...fields});
    target.dispatchEvent(event); return event;
  };
  // jsdom may lazily install its own keyboard/focus listeners after first input.
  // Snapshot only listeners installed by this service construction.
  const ownedWindowListeners = [...win.active].flatMap(([key,set]) => [...set].map(listener => [key,listener]));
  const ownedDocumentListeners = [...doc.active].flatMap(([key,set]) => [...set].map(listener => [key,listener]));
  const result = {ownedWindowListeners, ownedDocumentListeners, dom, owner, runtime, input, snapshot, messages, calls, clock: time, window, document, win, doc, frame, nativeTargets, listeners, key, notify,
    native: () => native, setVisibility(value) {visibility = value; document.dispatchEvent(new window.Event('visibilitychange'));},
    setOpen(value) {playerOpen = value;}, setFrameWindow(value) {frameWindow = value;},
    setFullscreen(value, type = 'fullscreenchange') {fullscreen = value; document.dispatchEvent(new window.Event(type));},
    replaceContext({epoch = input.epoch + 1, documentOnly = false, notifyNow = true} = {}) {
      if (!documentOnly) native = makeNative(); input.target = native.target; input.epoch = epoch; frameWindow = native.target;
      nativeContext = {epoch, game: input.game, document: {}, target: native.target, music: 'none'}; if (notifyNow) notify();
    },
    invalidateNativeDocument() {nativeContext = null; input.target = null;},
  }; fixtures.push(result); return result;
}
const keyboard = f => f.messages.filter(item => item.command === 'keyboard');

test('keyboard: TH15 U forwards with exact key identity and prevents handled defaults', () => {
  const f = fixture(); const down = f.key('keydown'), up = f.key('keyup');
  assert.deepEqual(keyboard(f).map(item => item.payload), [
    {down: true, code: 'KeyU', key: 'u', keyCode: 85, location: 0}, {down: false, code: 'KeyU', key: 'u', keyCode: 85, location: 0}]);
  assert.equal(down.defaultPrevented, true); assert.equal(up.defaultPrevented, true); assert.ok(f.messages.every(item => item.epoch === 1));
  const unknown = f.key('keydown', {code: 'KeyA', key: 'a', keyCode: 65}); assert.equal(unknown.defaultPrevented, false); assert.equal(keyboard(f).length, 2);
});

test('keyboard: launcher input/dialog owns new keys; a held game key releases even after focus and identity change', () => {
  const f = fixture();
  for (const id of ['input','select','textarea','button','dialogChild','roleDialogChild']) {
    const target = f.document.getElementById(id); target.focus?.();
    assert.equal(f.key('keydown', {}, target).defaultPrevented, false); f.key('keyup', {}, target);
  }
  assert.equal(f.messages.length, 0);
  f.key('keydown', {code: 'ShiftLeft', key: 'Shift', keyCode: 16, location: 1});
  const input = f.document.getElementById('input'); input.focus();
  const up = f.key('keyup', {code: 'Unidentified', key: 'Shift', keyCode: 0, location: 0, altKey: true}, input);
  assert.equal(up.defaultPrevented, true);
  assert.deepEqual(keyboard(f).map(item => item.payload), [
    {down: true, code: 'ShiftLeft', key: 'Shift', keyCode: 16, location: 1},
    {down: false, code: 'ShiftLeft', key: 'Shift', keyCode: 16, location: 1}]);
});

test('keyboard: both modifier owners retain separate original release identities', () => {
  const f = fixture(), input = f.document.getElementById('input');
  for (const side of ['Left','Right']) f.key('keydown', {code: `Shift${side}`, key: 'Shift', keyCode: 16, location: 0});
  f.key('keyup', {code: 'Unidentified', key: 'Shift', keyCode: 0, location: 0}, input);
  assert.deepEqual(keyboard(f).map(item => [item.payload.down,item.payload.code,item.payload.location]), [
    [true,'ShiftLeft',1],[true,'ShiftRight',2],[false,'ShiftLeft',1],[false,'ShiftRight',2]]);
});

for (const reason of ['blur','hidden','pagehide']) test(`keyboard: ${reason} releases all owners and repeat/orphan UP cannot re-arm`, () => {
  const f = fixture(); f.key('keydown', {code: 'KeyZ', key: 'z', keyCode: 90});
  if (reason === 'hidden') f.setVisibility('hidden'); else f.window.dispatchEvent(new f.window.Event(reason));
  assert.equal(f.calls.release, 1); assert.equal(f.calls.cancel, 1); assert.equal(f.messages.at(-1).command, 'keyboard-clear');
  const before = f.messages.length;
  f.key('keydown', {code: 'KeyZ', key: 'z', keyCode: 90, repeat: true}); f.key('keyup', {code: 'KeyZ', key: 'z', keyCode: 90});
  assert.equal(f.messages.length, before);
  if (reason === 'hidden') f.setVisibility('visible');
  f.key('keydown', {code: 'KeyZ', key: 'z', keyCode: 90}); assert.equal(f.messages.length, before + 1);
});

test('keyboard: spectator and inactive player states do not forward host key input', () => {
  const f = fixture(); f.input.spectator = true; f.key('keydown'); f.key('keyup'); assert.equal(f.messages.length, 0);
  f.input.spectator = false; f.snapshot.launched = false; f.key('keydown'); f.key('keyup'); assert.equal(f.messages.length, 0);
  f.snapshot.launched = true; f.setOpen(false); f.key('keydown'); f.key('keyup'); assert.equal(f.messages.length, 0);
  f.setOpen(true); f.setFrameWindow(null); f.key('keydown'); f.key('keyup'); assert.equal(f.messages.length, 0);
  f.setFrameWindow(f.native().target); f.key('keydown'); f.key('keyup'); assert.equal(keyboard(f).length, 2);
});

test('keyboard: Alt+Enter is a current-native-window chord with repeat suppression and Alt-released keyup', () => {
  const f = fixture(), target = f.native().target;
  const chord = (type, more = {}) => f.key(type, {code: 'Enter', key: 'Enter', keyCode: 13, altKey: true, ...more}, target);
  let passed = 0; target.addEventListener('keydown', () => passed++);
  assert.equal(chord('keydown').defaultPrevented, true); assert.equal(f.calls.toggle, 1); assert.equal(passed, 0);
  chord('keydown', {repeat: true}); chord('keydown'); assert.equal(f.calls.toggle, 1);
  assert.equal(chord('keyup', {altKey: false}).defaultPrevented, true);
  chord('keydown'); assert.equal(f.calls.toggle, 2); chord('keyup');
  for (const modifier of ['ctrlKey','metaKey']) assert.equal(chord('keydown', {[modifier]: true}).defaultPrevented, false);
  assert.equal(f.calls.toggle, 2); assert.equal(passed, 2);
  assert.equal(keyboard(f).length, 0, 'native key events are not re-forwarded through host keyboard');
});

test('keyboard: fullscreen exit resets chord; stale native window/document cannot toggle or release successor chord', () => {
  const f = fixture(), old = f.native();
  f.key('keydown', {code: 'Enter', altKey: true}, old.target); assert.equal(f.calls.toggle, 1);
  f.setFullscreen(false, 'webkitfullscreenchange'); f.key('keydown', {code: 'Enter', altKey: true}, old.target); assert.equal(f.calls.toggle, 2);
  f.replaceContext({notifyNow: false});
  const stale = f.key('keydown', {code: 'Enter', altKey: true}, old.target); assert.equal(stale.defaultPrevented, false); assert.equal(f.calls.toggle, 2);
  f.notify(); assert.equal(old.count('keydown'), 0); assert.equal(old.count('keyup'), 0);
  const current = f.native(); f.key('keydown', {code: 'Enter', altKey: true}, current.target); assert.equal(f.calls.toggle, 3);
  f.key('keyup', {code: 'Enter', altKey: false}, old.target); f.key('keydown', {code: 'Enter', altKey: true}, current.target); assert.equal(f.calls.toggle, 3);
  f.invalidateNativeDocument(); const changedDocument = f.key('keyup', {code: 'Enter'}, current.target);
  assert.equal(changedDocument.defaultPrevented, false, 'a replaced document is not the authenticated native context');
  f.frame.target.dispatchEvent(new f.window.Event('load')); assert.equal(current.count('keydown'), 0); assert.equal(current.count('keyup'), 0);
});

test('keyboard: epoch change retires held host keys without releasing them into the successor', () => {
  const f = fixture(); f.key('keydown'); f.replaceContext(); const before = f.messages.length;
  f.key('keyup', {}, f.document.getElementById('input')); f.key('keydown', {repeat: true}); assert.equal(f.messages.length, before);
  assert.equal(f.calls.release, 1); assert.equal(f.calls.cancel, 1); f.key('keydown'); assert.equal(f.messages.at(-1).epoch, 2);
});

test('focus: Android relay runs every 100ms only while visible/open and expires exactly at 15 seconds', () => {
  const f = fixture({android: true}); f.owner.startFocusRelay(); assert.equal(f.calls.nativeFocus, 1);
  assert.deepEqual(f.calls.frameFocus, [{preventScroll: true}]); assert.equal(f.clock.pending.size, 1);
  assert.equal([...f.clock.pending.values()][0].ms, 100);
  f.clock.advance(99); assert.equal(f.calls.nativeFocus, 1); f.clock.advance(1); assert.equal(f.calls.nativeFocus, 2);
  f.setVisibility('hidden'); f.clock.advance(1000); assert.equal(f.calls.nativeFocus, 2);
  f.setVisibility('visible'); f.clock.advance(100); assert.equal(f.calls.nativeFocus, 3);
  f.setOpen(false); f.clock.advance(100); assert.equal(f.calls.nativeFocus, 3);
  f.setOpen(true); f.clock.advance(100); assert.equal(f.calls.nativeFocus, 4);
  f.clock.advance(13599); assert.equal(f.clock.pending.size, 1); const before = f.calls.nativeFocus;
  f.clock.advance(1); assert.equal(f.clock.pending.size, 0); assert.equal(f.calls.nativeFocus, before);
});

test('focus: non-Android does nothing; first-frame and reset stop Android startup relay', () => {
  const desktop = fixture(); desktop.owner.startFocusRelay(); desktop.owner.focusBrowsingContext(); assert.equal(desktop.clock.pending.size, 0); assert.equal(desktop.calls.nativeFocus, 0);
  const f = fixture({android: true}); f.owner.startFocusRelay(); f.snapshot.firstFrame = true; f.notify();
  assert.equal(f.clock.pending.size, 0); let before = f.calls.nativeFocus; f.clock.advance(1000); assert.equal(f.calls.nativeFocus, before);
  f.snapshot.firstFrame = false; f.owner.startFocusRelay(); f.snapshot.ready = false; f.notify(); assert.equal(f.clock.pending.size, 0);
  f.snapshot.ready = true; f.owner.startFocusRelay(); f.replaceContext(); assert.equal(f.clock.pending.size, 0);
});

test('keyboard: disposal removes owned listeners, subscriptions and focus interval; later events are inert', () => {
  const f = fixture({android: true}); f.key('keydown'); f.owner.startFocusRelay(); f.owner.dispose();
  const before = {messages: f.messages.length, release: f.calls.release, cancel: f.calls.cancel, toggle: f.calls.toggle, focus: f.calls.nativeFocus};
  assert.equal(f.listeners.size, 0); assert.equal(f.clock.pending.size, 0);
  for (const [key,listener] of f.ownedWindowListeners) assert.equal(f.win.active.get(key)?.has(listener), false, `service window listener removed: ${key}`);
  for (const [key,listener] of f.ownedDocumentListeners) assert.equal(f.doc.active.get(key)?.has(listener), false, `service document listener removed: ${key}`);
  assert.equal(f.frame.count('load'), 0); assert.equal(f.native().count('keydown'), 0); assert.equal(f.native().count('keyup'), 0);
  f.key('keydown'); f.key('keyup'); f.window.dispatchEvent(new f.window.Event('blur')); f.setVisibility('hidden');
  f.key('keydown', {code: 'Enter', altKey: true}, f.native().target); f.notify(); f.owner.startFocusRelay(); f.clock.advance(16000); f.owner.dispose();
  assert.deepEqual({messages: f.messages.length, release: f.calls.release, cancel: f.calls.cancel, toggle: f.calls.toggle, focus: f.calls.nativeFocus}, before);
});
