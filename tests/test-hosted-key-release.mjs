import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {runInNewContext} from 'node:vm';
import {HostedKeyboard} from '../.cache/build/browser/assets/launcher/hosted-keyboard.mjs';

const source = readFileSync(new URL('../src/launcher/app.mts', import.meta.url), 'utf8');
const start = source.indexOf('const hostedKeyboard =');
const end = source.indexOf('function preventPlayerBrowserGesture(', start);
assert.ok(start >= 0 && end > start);
const handlers = {}, documentHandlers = {}, messages = [];
class Element { constructor(chrome = false) { this.chrome = chrome; } closest() { return this.chrome ? this : null; } }
const context = {target: {}, game: 'th07', epoch: 1, launched: true, spectator: false};
const document = {visibilityState: 'visible', addEventListener: (kind, callback) => documentHandlers[kind] = callback};
runInNewContext(stripTypeScriptTypes(source.slice(start, end)), {
  HostedKeyboard, Element, document,
  window: {addEventListener: (kind, callback) => handlers[kind] = callback},
  state: {launched: true, game: 'th07'}, player: {classList: {contains: () => true}}, frame: {contentWindow: context.target},
  protocol: 'test', releaseHeldTouchFire() {}, touchRuntimeMessageContext: () => ({...context}),
  deliverRuntimeInput: (_context, message) => messages.push(message),
});
const event = (type, fields = {}) => ({type, target: new Element(), code: 'ShiftLeft', key: 'Shift',
  keyCode: 16, location: 1, altKey: false, metaKey: false, repeat: false, preventDefault() {}, ...fields});
const chrome = new Element(true);
const downs = () => messages.filter(message => message.command === 'keyboard').map(message => message.down);
const reset = () => { handlers.blur(); messages.length = 0; };

handlers.keydown(event('keydown'));
handlers.keyup(event('keyup', {target: chrome, code: 'Unidentified', keyCode: 0, location: 0, altKey: true}));
assert.deepEqual(downs(), [true, false], 'focus, code, keyCode, location and modifier changes still release DOWN');
assert.equal(messages[1].code, 'ShiftLeft', 'UP uses the identity actually installed in Runtime');
assert.equal(messages[1].location, 1);
reset();
handlers.keydown(event('keydown', {target: chrome}));
handlers.keyup(event('keyup', {target: chrome}));
assert.equal(messages.length, 0, 'Launcher-only keys do not enter Runtime');

for (const first of ['ShiftLeft', 'ShiftRight']) {
  reset();
  handlers.keydown(event('keydown', {code: 'ShiftLeft', location: 1}));
  handlers.keydown(event('keydown', {code: 'ShiftRight', location: 2}));
  handlers.keyup(event('keyup', {code: first, location: 0, target: chrome}));
  const second = first === 'ShiftLeft' ? 'ShiftRight' : 'ShiftLeft';
  handlers.keyup(event('keyup', {code: second, location: 0, target: chrome}));
  assert.deepEqual(downs(), [true, true, false, false], 'both modifier owners receive separate releases');
  assert.deepEqual(messages.slice(2).map(message => message.code), [first, second]);
}
reset();
handlers.keydown(event('keydown'));
handlers.keydown(event('keydown', {code: 'ShiftRight', location: 2}));
handlers.keyup(event('keyup', {code: 'Unidentified', location: 0, target: chrome}));
assert.deepEqual(downs(), [true, true, false, false], 'ambiguous UP cannot strand another Shift');
reset();
handlers.keydown(event('keydown', {code: 'Unidentified', location: 0}));
handlers.keyup(event('keyup', {code: 'ShiftLeft', location: 1, target: chrome}));
assert.deepEqual(downs(), [true, false], 'UP with improved identity can release unknown DOWN');

for (const cancel of [() => handlers.blur(), () => handlers.pagehide(), () => {
  document.visibilityState = 'hidden'; documentHandlers.visibilitychange(); document.visibilityState = 'visible';
}]) {
  reset();
  handlers.keydown(event('keydown', {code: 'KeyZ', key: 'z', keyCode: 90, location: 0}));
  cancel();
  const before = messages.length;
  handlers.keydown(event('keydown', {code: 'KeyZ', key: 'z', keyCode: 90, location: 0, repeat: true}));
  handlers.keyup(event('keyup', {code: 'KeyZ', key: 'z', keyCode: 90, location: 0}));
  assert.equal(messages.length, before, 'cancelled input cannot re-arm from repeat/orphan UP');
}
reset();
handlers.keydown(event('keydown'));
context.epoch++;
handlers.keyup(event('keyup', {target: chrome}));
assert.deepEqual(downs(), [true], 'an old owner cannot release into a new Runtime epoch');
reset();
context.spectator = true;
handlers.keydown(event('keydown')); handlers.keyup(event('keyup'));
assert.equal(messages.length, 0, 'spectator keyboards are read-only');
context.spectator = false;
handlers.keydown(event('keydown'));
handlers.keyup(event('keyup', {target: chrome}));
assert.deepEqual(downs(), [true, false], 'fresh input resumes normally');
console.log('PASS hosted keyboard ownership: focus/identity changes, both Shift keys, lifecycle, epoch and spectator');
