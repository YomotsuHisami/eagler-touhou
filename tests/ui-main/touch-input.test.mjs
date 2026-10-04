/** Injected geometry/persistence evidence only; does not prove browser or physical-device interaction. */
import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import {existsSync} from 'node:fs';
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {build} from 'esbuild';
const root = fileURLToPath(new URL('../..', import.meta.url));
await mkdir(join(root, '.cache'), {recursive: true});
const directory = await mkdtemp(join(root, '.cache/ui-touch-input-test-'));
after(() => rm(directory, {recursive: true, force: true}));
const bundle = await build({
  stdin: {contents: `
    export * from './app/services/touch-input.client.ts';
  `, resolveDir: root, loader: 'ts'},
  bundle: true, format: 'esm', platform: 'node', packages: 'external', write: false,
  plugins: [{name: 'authored-mts-contracts', setup(builder) {
    builder.onResolve({filter: /\.mjs$/}, args => {
      if (!args.path.startsWith('.')) return;
      const path = resolve(dirname(args.importer), args.path).replace(/\.mjs$/, '.mts');
      if (path.startsWith(join(root, 'src') + '/') && existsSync(path)) return {path};
    });
  }}],
});
const file = join(directory, 'touch-layout.mjs');
await writeFile(file, bundle.outputFiles[0].text);
const {createTouchInputController, touchJoystickVector} = await import(pathToFileURL(file).href);
function fixture(overrides = {}, lifecycle = {}) {
  let now = 0, sequence = 0;
  const timers = new Map(), frames = new Map(), messages = [];
  const current = {epoch: 1, ready: true, launched: true, spectator: false, ...lifecycle};
  const config = {epoch: 1, game: 'th06', options: {touchEnabled: true, touchMovementMode: 'touch', touchSensitivity: 150, touchFocusMode: 'hold-button'},
    launcherControls: {restartButtonEnabled: true, thpracTouchControlsEnabled: true}, ...overrides};
  const owner = createTouchInputController(config, {
    current: () => current,
    post(command, payload) {messages.push({command, ...structuredClone(payload)});return true;},
    schedule(callback, ms) {const id = ++sequence;timers.set(id, {at: now + ms, callback});return id;},
    cancel: id => timers.delete(id),
    requestFrame(callback) {const id = ++sequence;frames.set(id, callback);return id;},
    cancelFrame: id => frames.delete(id),
  });
  return {owner, config, current, messages, timers, frames,
    frame() {const pending = [...frames.values()];frames.clear();for (const callback of pending) callback();},
    tick(ms) {const until = now + ms;while (true) {const next = [...timers.entries()].sort((a, b) => a[1].at - b[1].at)[0];if (!next || next[1].at > until) break;now = next[1].at;timers.delete(next[0]);next[1].callback();}now = until;},
  };
}
const controls = fixture => fixture.messages.filter(message => message.command === 'touch-controls');
const keys = fixture => fixture.messages.filter(message => message.command === 'keyboard').map(({code, down}) => [code, down]);
const rect = {left: 10, top: 20, width: 640, height: 480};

test('startup and all events require the captured current, ready, launched nonspectator epoch', () => {
  for (const lifecycle of [{epoch: 2}, {ready: false}, {launched: false}, {spectator: true}]) {
    const f = fixture({}, lifecycle);f.owner.start();assert.equal(f.owner.down('bomb', 1), false);
    assert.equal(f.owner.directDown(2, 30, 40, rect), false);f.owner.dispose();assert.deepEqual(f.messages, []);
  }
  const disabled = fixture({options: {touchEnabled: false}});disabled.owner.start();disabled.owner.down('fire', 1);disabled.owner.dispose();assert.deepEqual(disabled.messages, []);
});

test('launch configuration is captured and default toggle Fire is separate from bomb/escape serials', () => {
  const f = fixture();f.config.options.touchEnabled = false;f.config.options.touchSensitivity = 300;
  f.owner.start();assert.equal(controls(f).at(-1).fireEnabled, true);assert.equal(controls(f).at(-1).touchSensitivity, 150);
  f.owner.down('fire', 1);f.owner.up('fire', 1);assert.equal(controls(f).at(-1).fireEnabled, false);
  f.owner.down('bomb', 2);f.owner.down('bomb', 3);f.owner.down('escape', 4);
  assert.equal(controls(f).at(-1).bombSerial, 2);assert.equal(controls(f).at(-1).escapeSerial, 1);
  assert.deepEqual(keys(f), []);
});

test('TH09 held-key Fire never also enables the automatic toggle stream and releases only its contact', () => {
  const f = fixture({game: 'th09'});f.owner.start();assert.equal(controls(f).at(-1).fireEnabled, false);
  assert.equal(f.owner.down('fire', 10), true);assert.equal(f.owner.down('fire', 11), false);
  f.owner.up('fire', 11);assert.deepEqual(keys(f), [['KeyZ', true]]);
  f.owner.up('fire', 10);assert.deepEqual(keys(f), [['KeyZ', true], ['KeyZ', false]]);
  f.owner.down('fire', 12);f.owner.cancel();assert.deepEqual(keys(f).slice(-2), [['KeyZ', true], ['KeyZ', false]]);
  assert.equal(f.owner.getSnapshot().heldFire, false);assert.equal(controls(f).at(-1).fireEnabled, false);
  assert.equal(f.owner.activate('fire'), false, 'a synthesized click cannot substitute for charge/hold input');
});

test('hold/toggle focus and two-finger ownership retain their distinct semantics', () => {
  const held = fixture();held.owner.down('focus', 1);assert.equal(held.owner.getSnapshot().focusEnabled, true);
  held.owner.up('focus', 2);assert.equal(held.owner.getSnapshot().focusEnabled, true);
  held.owner.up('focus', 1);assert.equal(held.owner.getSnapshot().focusEnabled, false);
  assert.equal(held.owner.activate('focus'), false, 'a synthetic click must not latch held focus');
  const toggle = fixture({options: {touchEnabled: true, touchFocusMode: 'toggle-button'}});
  toggle.owner.activate('focus');assert.equal(toggle.owner.getSnapshot().focusEnabled, true);
  toggle.owner.activate('focus');assert.equal(toggle.owner.getSnapshot().focusEnabled, false);
  const two = fixture({options: {touchEnabled: true, touchFocusMode: 'two-finger'}});
  assert.equal(two.owner.down('focus', 1), false);assert.deepEqual(two.messages, []);
});

test('TH11 C uses the existing sampled pulse queue and does not leak into another product or epoch', () => {
  const f = fixture({game: 'th11'});
  f.owner.down('function', 1);f.owner.up('function', 1);f.owner.up('function', 1, true);
  f.owner.down('function', 2);f.owner.up('function', 2);
  assert.deepEqual(keys(f), [['KeyC', true]]);
  f.tick(50);assert.deepEqual(keys(f).at(-1), ['KeyC', false]);
  f.tick(50);assert.deepEqual(keys(f).at(-1), ['KeyC', true]);
  f.current.epoch = 2;f.tick(100);assert.equal(keys(f).length, 3, 'old timer must never send into replacement Runtime');
  const other = fixture();assert.equal(other.owner.down('function', 1), false);
});

test('restart and trainer keys are sampled, gated and cancelled without stale releases', () => {
  const f = fixture();f.owner.activate('restart');f.owner.activate('restart');
  assert.deepEqual(keys(f), [['KeyR', true]]);f.tick(70);assert.deepEqual(keys(f).at(-1), ['KeyR', false]);
  f.tick(70);assert.deepEqual(keys(f).at(-1), ['KeyR', true]);f.owner.cancel();assert.deepEqual(keys(f).at(-1), ['KeyR', false]);
  const count = keys(f).length;f.tick(500);assert.equal(keys(f).length, count);
  f.owner.activate('Backspace');f.owner.activate('F12');assert.deepEqual(keys(f).slice(-2), [['Backspace', true], ['F12', true]]);
  const disabled = fixture({launcherControls: {restartButtonEnabled: false, thpracTouchControlsEnabled: false}});
  assert.equal(disabled.owner.activate('restart'), false);assert.equal(disabled.owner.activate('Tab'), false);assert.deepEqual(disabled.messages, []);
});

test('joystick uses continuous signed axes and coalesces one live snapshot per animation frame', () => {
  const f = fixture({options: {touchEnabled: true, touchMovementMode: 'joystick'}}), stick = {left: 0, top: 0, width: 100, height: 100};
  assert.deepEqual(touchJoystickVector(50, 50, stick), {x: 0, y: 0, visualX: 0, visualY: 0});
  assert.equal(f.owner.joystickDown(1, 84, 50, stick), true);f.owner.joystickMove(1, 84, 84, stick);
  assert.equal(f.frames.size, 1);assert.equal(controls(f).length, 0);f.frame();
  assert.ok(controls(f).at(-1).joystickX > 0 && controls(f).at(-1).joystickX < 32767);
  assert.equal(controls(f).at(-1).joystickX, controls(f).at(-1).joystickY);
  f.owner.joystickMove(1, 100, 50, stick);f.owner.joystickUp(1);f.frame();
  assert.equal(controls(f).at(-1).joystickX, 0);assert.equal(controls(f).at(-1).joystickY, 0);
  f.owner.joystickDown(2, 84, 50, stick);f.owner.cancel();assert.equal(f.frames.size, 0);assert.equal(controls(f).at(-1).joystickX, 0);
  assert.equal(f.owner.joystickDown(3, NaN, 50, stick), false);
  f.owner.joystickDown(3, 84, 50, stick);f.current.epoch = 2;const count = controls(f).length;f.frame();assert.equal(controls(f).length, count);
});

test('direct touch owns stable negative IDs, geometry caching, simultaneous contacts and cancellation', () => {
  const f = fixture();assert.equal(f.owner.directDown(4, 330, 260, rect), true);
  assert.deepEqual(f.messages.at(-1), {command: 'direct-touch', type: 'down', id: -1000000, x: .5, y: .5});
  f.owner.directDown(5, 650, 500, {left: 999, top: 999, width: 1, height: 1});
  assert.equal(f.messages.at(-1).id, -1000001);assert.equal(f.messages.at(-1).x, 1, 'one gesture shares the original frame geometry');
  f.owner.directMove(4, 10, 20);assert.equal(f.messages.at(-1).x, 0);
  f.owner.directUp(4, 74, 68);assert.equal(f.messages.at(-1).type, 'up');assert.equal(f.messages.at(-1).x, .1);
  f.owner.cancel();assert.equal(f.owner.getSnapshot().directCount, 0);
  const count = f.messages.length;f.owner.directMove(5, 10, 10);f.owner.directUp(5);assert.equal(f.messages.length, count);
  const joystick = fixture({options: {touchEnabled: true, touchMovementMode: 'joystick'}});assert.equal(joystick.owner.directDown(1, 1, 1, rect), false);
});

test('suspension releases transient input, retains intentional Fire toggle and restores only the same epoch', () => {
  const f = fixture();f.owner.down('fire', 1);f.owner.down('focus', 2);f.owner.directDown(3, 330, 260, rect);
  f.owner.suspend(true);assert.equal(f.owner.getSnapshot().focusEnabled, false);assert.equal(f.owner.getSnapshot().fireEnabled, false);assert.equal(f.owner.getSnapshot().directCount, 0);
  assert.equal(f.owner.down('bomb', 4), false);
  f.owner.suspend(false);assert.equal(f.owner.down('bomb', 4), true);
  f.current.epoch = 2;const count = f.messages.length;f.owner.dispose();f.tick(1000);f.frame();assert.equal(f.messages.length, count);
});
