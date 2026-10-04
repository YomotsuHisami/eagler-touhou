import assert from 'node:assert/strict';
import {bundleRuntimeKeyboard} from './support/bundle-runtime-keyboard.mjs';

// Execute the same binding imported by RuntimeHost, including its real
// HostedKeyboard and Alt+Enter sequence. No source slicing or built launcher.
const moduleSource = await bundleRuntimeKeyboard();
const {HostedKeyboard, bindRuntimeKeyboard} = await import(`data:text/javascript;base64,${Buffer.from(moduleSource).toString('base64')}`);
const handlers = {}, documentHandlers = {}, messages = [];
const registrations = [];
function target(handlers) {
  return {
    addEventListener(kind, callback, capture = false) {
      assert.equal(handlers[kind], undefined, `${kind} must have one owner`);
      handlers[kind] = {callback, capture};
      registrations.push({kind, capture});
    },
    removeEventListener(kind, callback, capture = false) {
      assert.equal(handlers[kind]?.callback, callback, `${kind} removes the installed listener`);
      assert.equal(handlers[kind]?.capture, capture, `${kind} removes the original capture phase`);
      delete handlers[kind];
    },
    emit(kind, event) { handlers[kind]?.callback(event); },
  };
}
const focusSelectors = ['input','select','textarea','button','a','summary','[contenteditable]','dialog','[role="dialog"]','[role="button"]'];
class Element {
  constructor(selector = null) { this.selector = selector; }
  closest(selector) {
    assert.deepEqual(selector.split(','), focusSelectors, 'actual host focus exclusion is preserved');
    return selector.split(',').includes(this.selector) ? this : null;
  }
}
const context = {target: {}, game: 'th07', epoch: 1, launched: true, ready: true, spectator: false};
const host = target(handlers);
const document = {visibilityState: 'visible', ...target(documentHandlers)};
let frame = {isConnected: true};
let contextReads = 0;
const keyboard = new HostedKeyboard();
const service = {
  getInputContext() {contextReads++;return {...context};},
  postInput(command, payload) {messages.push({command, ...payload});return true;},
};
const bind = () => bindRuntimeKeyboard({host, document, element: Element, frame: () => frame, service, keyboard});
let detach = bind();
assert.deepEqual(registrations, [
  {kind:'keydown',capture:true}, {kind:'keyup',capture:true},
  {kind:'blur',capture:false}, {kind:'pagehide',capture:false}, {kind:'visibilitychange',capture:false},
], 'capture input and lifecycle listeners are installed exactly once');
const event = (type, fields = {}) => ({type, target: new Element(), code: 'ShiftLeft', key: 'Shift',
  keyCode: 16, location: 1, altKey: false, metaKey: false, repeat: false,
  defaultPrevented: false, preventDefault() {this.defaultPrevented = true;}, ...fields});
const down = fields => {const e = event('keydown', fields);host.emit('keydown', e);return e;};
const up = fields => {const e = event('keyup', fields);host.emit('keyup', e);return e;};
const chrome = new Element('button');
const downs = () => messages.filter(message => message.command === 'keyboard').map(message => message.down);
const reset = () => {host.emit('blur');messages.length = 0;};
reset();

for (const fields of [
  {code:'KeyC',key:'c',keyCode:67},
  {code:'Unidentified',key:'c',keyCode:0},
  {code:'Unidentified',key:'Unidentified',keyCode:67},
]) {
  reset();
  down(fields);
  up({...fields,target:chrome});
  assert.deepEqual(downs(),[true,false],'C forwards and releases with each keyboard identity fallback');
  reset();
  down(fields);
  host.emit('blur');
  assert.equal(messages.at(-1).command,'keyboard-clear','blur clears held C');
  const before=messages.length;
  down({...fields,repeat:true});
  up(fields);
  assert.equal(messages.length,before,'retired C cannot re-arm from repeat or orphan UP');
}
reset();

down();
up({target: chrome, code: 'Unidentified', keyCode: 0, location: 0, altKey: true});
assert.deepEqual(downs(), [true, false], 'focus, code, keyCode, location and modifier changes still release DOWN');
assert.equal(messages[1].code, 'ShiftLeft', 'UP uses the identity actually installed in Runtime');
assert.equal(messages[1].location, 1);
reset();
down({target: chrome});
up({target: chrome});
assert.equal(messages.length, 0, 'Launcher-only keys do not enter Runtime');

for (const first of ['ShiftLeft', 'ShiftRight']) {
  reset();
  down({code: 'ShiftLeft', location: 1});
  down({code: 'ShiftRight', location: 2});
  up({code: first, location: 0, target: chrome});
  const second = first === 'ShiftLeft' ? 'ShiftRight' : 'ShiftLeft';
  up({code: second, location: 0, target: chrome});
  assert.deepEqual(downs(), [true, true, false, false], 'both modifier owners receive separate releases');
  assert.deepEqual(messages.slice(2).map(message => message.code), [first, second]);
}
reset();
down();
down({code: 'ShiftRight', location: 2});
up({code: 'Unidentified', location: 0, target: chrome});
assert.deepEqual(downs(), [true, true, false, false], 'ambiguous UP cannot strand another Shift');
reset();
down({code: 'Unidentified', location: 0});
up({code: 'ShiftLeft', location: 1, target: chrome});
assert.deepEqual(downs(), [true, false], 'UP with improved identity can release unknown DOWN');

for (const cancel of [() => host.emit('blur'), () => host.emit('pagehide'), () => {
  document.visibilityState = 'hidden'; document.emit('visibilitychange'); document.visibilityState = 'visible';
}]) {
  reset();
  down({code: 'KeyZ', key: 'z', keyCode: 90, location: 0});
  cancel();
  const before = messages.length;
  down({code: 'KeyZ', key: 'z', keyCode: 90, location: 0, repeat: true});
  up({code: 'KeyZ', key: 'z', keyCode: 90, location: 0});
  assert.equal(messages.length, before, 'cancelled input cannot re-arm from repeat/orphan UP');
}
reset();
down();
context.epoch++;
up({target: chrome});
assert.deepEqual(downs(), [true], 'an old owner cannot release into a new Runtime epoch');
reset();
context.spectator = true;
down(); up();
assert.equal(messages.length, 0, 'spectator keyboards are read-only');
context.spectator = false;
down();
up({target: chrome});
assert.deepEqual(downs(), [true, false], 'fresh input resumes normally');

reset();
for (const selector of focusSelectors) {
  const target = new Element(selector);
  assert.equal(down({target}).defaultPrevented, false);
  assert.equal(up({target}).defaultPrevented, false);
}
assert.equal(messages.length, 0, 'all launcher controls and modal descendants retain their input');
assert.equal(down().defaultPrevented, true, 'forwarded DOWN prevents the host browser default');
assert.equal(up({target:chrome}).defaultPrevented, true, 'owned UP prevents default after focus moves');
assert.equal(down({code:'KeyA',key:'a',keyCode:65}).defaultPrevented, false, 'unmapped keys retain browser default');
reset();
up({code:'F12',key:'F12',keyCode:123,location:0});
assert.deepEqual(downs(), [false], 'ordinary release-only vendor input still reaches Runtime');
reset();
for (const modifier of ['altKey','metaKey']) {
  down({[modifier]:true});up({target:chrome});
}
assert.equal(messages.length, 0, 'modified launcher DOWN cannot enter Runtime');
const beforeReads = contextReads;
down();up();
assert.equal(contextReads, beforeReads + 2, 'both event edges read the current service input context');

for (const change of [
  () => {context.target = {};},
  () => {context.game = context.game === 'th06' ? 'th07' : 'th06';},
]) {
  reset();down();change();up({target:chrome});
  assert.deepEqual(downs(), [true], 'a replaced target or game cannot receive an old owner release');
}
for (const [field, unavailable] of [['launched',false], ['target',null], ['epoch',0], ['spectator',true]]) {
  reset();down();
  const previous = context[field];context[field] = unavailable;
  up({target:chrome});down();
  assert.deepEqual(downs(), [true], `${field} guard retires old input and blocks new input`);
  context[field] = previous;
  down({repeat:true});up({target:chrome});
  assert.deepEqual(downs(), [true], `${field} recovery requires a fresh DOWN`);
  down();up({target:chrome});
  assert.deepEqual(downs(), [true,true,false], `${field} recovery accepts fresh input`);
}
reset();
down();
document.emit('visibilitychange');
assert.deepEqual(downs(), [true], 'visible documents do not clear input');
assert.equal(messages.length, 1);
up();

const enter = {code:'Enter',key:'Enter',keyCode:13,location:0};
reset();
assert.equal(down({...enter,altKey:true}).defaultPrevented, false, 'input guard leaves fullscreen activation to player chrome');
down({...enter,altKey:true,repeat:true});
up({code:'AltLeft',key:'Alt',keyCode:18,altKey:false});
up({...enter,altKey:false});
assert.equal(messages.length, 0, 'Alt+Enter DOWN, repeat and UP after Alt releases never enter Runtime');
up({...enter,altKey:true});
assert.equal(messages.length, 0, 'release-only Alt+Enter is reserved for fullscreen');
for (const cancel of [() => host.emit('blur'), () => host.emit('pagehide'), () => {
  document.visibilityState = 'hidden';document.emit('visibilitychange');document.visibilityState = 'visible';
}]) {
  reset();down({...enter,altKey:true});cancel();
  const before = messages.length;
  up({...enter,altKey:false});
  assert.equal(messages.length, before, 'retired fullscreen chord cannot become release-only input');
}
reset();down({...enter,altKey:true});context.epoch++;
up({...enter,altKey:false});
assert.equal(messages.length, 0, 'fullscreen guard survives a Runtime epoch change');
down(enter);up(enter);
assert.deepEqual(downs(), [true,false], 'fresh ordinary Enter still forwards after fullscreen retirement');

reset();down();
detach();
assert.equal(messages.at(-1).command, 'keyboard-clear', 'detach clears the connected Runtime');
assert.deepEqual(Object.keys(handlers), []);
assert.deepEqual(Object.keys(documentHandlers), []);
const beforeDetachEvents = messages.length;
down();up();host.emit('blur');host.emit('pagehide');document.emit('visibilitychange');
assert.equal(messages.length, beforeDetachEvents, 'detached listeners cannot forward or clear input');
detach = bind();messages.length = 0;
down({repeat:true});up();
assert.equal(messages.length, 0, 'effect replay retains retired ownership across rebinding');
down();up({target:chrome});
assert.deepEqual(downs(), [true,false], 'the retained keyboard accepts fresh input after rebinding');

for (const detachedFrame of [{isConnected:false}, {}, null]) {
  reset();down();frame = detachedFrame;
  const before = messages.length;
  host.emit('blur');host.emit('pagehide');
  document.visibilityState = 'hidden';document.emit('visibilitychange');document.visibilityState = 'visible';
  assert.equal(messages.length, before, 'a missing, disconnected or unconfirmed frame receives no lifecycle clear');
  up({target:chrome});
  assert.equal(messages.length, before, 'local ownership clears even without a connected frame');
  frame = {isConnected:true};
}
reset();down();frame = {isConnected:false};
const beforeDetachedCleanup = messages.length;
detach();
assert.equal(messages.length, beforeDetachedCleanup, 'detach never posts into a removed frame');
assert.deepEqual(Object.keys(handlers), []);
assert.deepEqual(Object.keys(documentHandlers), []);
console.log('PASS actual RuntimeHost keyboard binding: identity/focus, both Shift keys, lifecycle, epoch/spectator, Alt+Enter and retained-owner detach');
