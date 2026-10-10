/** Deterministic state/timer tests and a pinned-original differential oracle.
 * Synthetic DOM only: no browser, layout, audio playback or deployment claim.
 */
import test, {before, after} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdir, mkdtemp, rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {JSDOM} from 'jsdom';
import {authoredSourcesPlugin} from './authored-sources.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const originalRevision = 'edee9633';
let work, createMultiplayerQuickChatModel, OriginalQuickChat, CurrentQuickChat, oracleVoice, currentVoice, phrases;
before(async () => {
  await mkdir(resolve(root, '.cache'), {recursive: true});
  work = await mkdtemp(resolve(root, '.cache/quick-chat-model-'));
  const modelFile = resolve(work, 'model.mjs');
  await build({entryPoints: [resolve(root, 'src/launcher/multiplayer-quick-chat-model.mts')], outfile: modelFile,
    bundle: true, format: 'esm', platform: 'node', logLevel: 'silent', plugins: [authoredSourcesPlugin(root)]});
  ({createMultiplayerQuickChatModel} = await import(pathToFileURL(modelFile).href));
  // Load the implementation and vocabulary from the pinned commit, rather than
  // importing either rewritten view as its own expected-behavior oracle.
  const pinned = path => execFileSync('git', ['show', `${originalRevision}:${path}`], {cwd: root, encoding: 'utf8'});
  const oracleFile = resolve(work, 'original.mjs');
  await build({stdin: {contents: pinned('src/launcher/multiplayer-quick-chat.mts') +
    '\nexport {voiceCalls} from "./quick-chat-voice.mjs";\nexport {QUICK_CHAT_PHRASES} from "../contracts/multiplayer-quick-chat.mjs";',
    loader: 'ts', sourcefile: 'pinned-multiplayer-quick-chat.mts', resolveDir: resolve(root, 'src/launcher')},
    outfile: oracleFile, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent', plugins: [{name: 'pinned-oracle-ports', setup(ctx) {
      ctx.onResolve({filter: /quick-chat-voice\.mjs$/}, () => ({path: 'voice', namespace: 'oracle'}));
      ctx.onResolve({filter: /contracts\/multiplayer-quick-chat\.mjs$/}, () => ({path: 'vocabulary', namespace: 'oracle'}));
      ctx.onLoad({filter: /.*/, namespace: 'oracle'}, args => ({loader: 'ts', contents: args.path === 'voice'
        ? 'export const voiceCalls = []; export function playQuickChatVoice(id) {voiceCalls.push(id);}'
        : pinned('src/contracts/multiplayer-quick-chat.mts')}));
    }}]});
  ({MultiplayerQuickChat: OriginalQuickChat, voiceCalls: oracleVoice, QUICK_CHAT_PHRASES: phrases} = await import(pathToFileURL(oracleFile).href));
  const adapterFile = resolve(work, 'current-adapter.mjs');
  await build({stdin: {contents: 'export {MultiplayerQuickChat} from "./multiplayer-quick-chat.mts"; export {voiceCalls} from "./quick-chat-voice.mjs";',
    loader: 'ts', sourcefile: 'current-adapter-entry.mts', resolveDir: resolve(root, 'src/launcher')},
    outfile: adapterFile, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent', plugins: [{name: 'adapter-voice-port', setup(ctx) {
      ctx.onResolve({filter: /quick-chat-voice\.mjs$/}, () => ({path: 'voice', namespace: 'adapter'}));
      ctx.onLoad({filter: /.*/, namespace: 'adapter'}, () => ({loader: 'ts',
        contents: 'export const voiceCalls = []; export function playQuickChatVoice(id) {voiceCalls.push(id);}'}));
    }}, authoredSourcesPlugin(root)]});
  ({MultiplayerQuickChat: CurrentQuickChat, voiceCalls: currentVoice} = await import(pathToFileURL(adapterFile).href));
});
after(async () => {if (work) await rm(work, {recursive: true, force: true});});

function fakeClock() {
  let now = 0, serial = 0;
  const jobs = new Map();
  return {
    jobs,
    setTimeout(handler, ms) {const id = ++serial; jobs.set(id, {handler, due: now + ms, ms}); return id;},
    clearTimeout(id) {jobs.delete(id);},
    advance(ms) {
      const target = now + ms;
      for (;;) {
        const next = [...jobs].filter(([, job]) => job.due <= target).sort((a, b) => a[1].due - b[1].due || a[0] - b[0])[0];
        if (!next) break;
        const [id, job] = next; now = job.due; jobs.delete(id); job.handler();
      }
      now = target;
    },
    deadlines() {return [...jobs.values()].map(job => job.due - now).sort((a, b) => a - b);},
  };
}
function context(overrides = {}) {
  return {visible: true, room: 'ROOM', serial: 7, localSeat: 0, connected: true, language: 'en', lessMotion: true,
    seats: [{clientId: 'local', name: 'Reimu'}, {clientId: 'peer', name: 'Marisa'}, null, {clientId: 'other', name: 'Sanae'}], ...overrides};
}
function message(overrides = {}) {return {type: 'quick-chat', room: 'ROOM', serial: 7, seat: 1, clientId: 'peer', phrase: 'thanks', ...overrides};}
function fixture(t, initial = context()) {
  const clock = fakeClock(), sends = [], voices = [], effects = [];
  const model = createMultiplayerQuickChatModel({timers: clock,
    send(value) {sends.push(value); effects.push(['send', value]);}, voice(id) {voices.push(id); effects.push(['voice', id]);}});
  t.after(() => model.dispose());
  if (initial) model.update(initial);
  return {model, clock, sends, voices, effects};
}
const projectEntries = entries => entries.map(({clientId, seat, name, phrase}) => ({clientId, seat, name, phrase}));
const flush = async () => {await Promise.resolve(); await Promise.resolve();};
function deferred() {let resolve; const promise = new Promise(done => {resolve = done;}); return {promise, resolve};}

test('snapshot identity is stable for no-op updates and subscriptions unsubscribe', t => {
  const {model} = fixture(t, null);
  const empty = model.getSnapshot();
  assert.equal(empty.context, null); assert.deepEqual(empty.entries, []); assert.deepEqual(empty.muted, []);
  assert.equal(model.getSnapshot(), empty);
  let notifications = 0;
  const unsubscribe = model.subscribe(() => notifications++);
  model.update(context()); const first = model.getSnapshot();
  assert.notEqual(first, empty); assert.equal(notifications, 1);
  model.update(context()); assert.equal(model.getSnapshot(), first); assert.equal(notifications, 1);
  model.update(context({seats: context().seats.map(seat => seat ? {...seat} : null)}));
  assert.equal(model.getSnapshot(), first); assert.equal(notifications, 1);
  unsubscribe(); model.togglePicker(); assert.equal(notifications, 1);
});

test('context seats are copied and previously published snapshots retain their values', t => {
  const {model} = fixture(t, null), input = context();
  model.update(input); const previous = model.getSnapshot();
  input.seats[1].name = 'Mutated outside model'; input.seats.push({clientId: 'extra', name: 'Extra'});
  assert.equal(previous.context.seats[1].name, 'Marisa'); assert.equal(previous.context.seats.length, 4);
  model.receive(message()); const received = model.getSnapshot();
  assert.deepEqual(previous.entries, []); assert.equal(received.entries[0].name, 'Marisa');
  model.toggleMember('peer'); assert.deepEqual(received.muted, []);
  model.update(context({seats: [context().seats[0], {clientId: 'peer', name: 'Renamed'}, null]}));
  assert.equal(model.getSnapshot().entries[0].name, 'Marisa');
  assert.equal(received.context.seats[1].name, 'Marisa');
});

test('receive rejects invalid room, serial, phrase, integer seat and seat identity without effects', t => {
  const {model, clock, voices} = fixture(t, null);
  model.receive(message()); assert.equal(model.getSnapshot().entries.length, 0);
  model.update(context()); const before = model.getSnapshot();
  const invalid = [
    {room: 'OTHER'}, {room: undefined}, {serial: 8}, {serial: '7'}, {phrase: 'arbitrary text'}, {phrase: 1},
    {phrase: undefined}, {seat: '1'}, {seat: 1.1}, {seat: NaN}, {seat: Infinity}, {seat: -1}, {seat: 2},
    {seat: 4}, {clientId: 'impostor'}, {clientId: undefined},
  ];
  for (const patch of invalid) {
    model.receive(message(patch)); assert.equal(model.getSnapshot(), before, JSON.stringify(patch));
  }
  assert.deepEqual(voices, []); assert.equal(clock.jobs.size, 0);
  model.update(context({visible: false})); const hidden = model.getSnapshot();
  model.receive(message()); assert.equal(model.getSnapshot(), hidden);
});

test('receive uses authoritative seat names and ignores connection, spectator and extra packet fields', t => {
  const {model, voices} = fixture(t, context({connected: false, localSeat: null}));
  model.receive(message({type: 'other', name: '<forged sender>', text: 'arbitrary text'}));
  const entry = model.getSnapshot().entries[0];
  assert.equal(entry.clientId, 'peer'); assert.equal(entry.seat, 1); assert.equal(entry.name, 'Marisa');
  assert.deepEqual(entry.phrase, phrases.find(phrase => phrase.id === 'thanks'));
  assert.equal(typeof entry.id, 'number'); assert.deepEqual(voices, ['thanks']);
});

test('picker, mute/back and dismiss preserve the original transition table', t => {
  const {model} = fixture(t);
  const expect = (pickerOpen, muteOpen) => {
    assert.equal(model.getSnapshot().pickerOpen, pickerOpen); assert.equal(model.getSnapshot().muteOpen, muteOpen);
  };
  expect(false, false);
  model.togglePicker(); expect(true, false);
  model.togglePicker(); expect(false, false);
  model.toggleMute(); expect(false, true);
  model.toggleMute(); expect(true, false);
  model.toggleMute(); expect(false, true);
  model.togglePicker(); expect(false, false);
  model.togglePicker(); model.dismiss(); expect(false, false);
  const dismissed = model.getSnapshot(); model.dismiss(); assert.deepEqual(model.getSnapshot(), dismissed);
});

test('outbound voice precedes the exact relay payload, closes picker and has no local throttle or optimistic echo', t => {
  const {model, effects, sends, voices, clock} = fixture(t);
  model.togglePicker(); model.sendPhrase('follow-me'); model.sendPhrase('follow-me'); model.sendPhrase('stop-fire');
  assert.deepEqual(sends, [
    {type: 'quick-chat', phrase: 'follow-me', serial: 7},
    {type: 'quick-chat', phrase: 'follow-me', serial: 7},
    {type: 'quick-chat', phrase: 'stop-fire', serial: 7},
  ]);
  assert.deepEqual(voices, ['follow-me', 'follow-me', 'stop-fire']);
  assert.deepEqual(effects.map(effect => effect[0]), ['voice', 'send', 'voice', 'send', 'voice', 'send']);
  assert.equal(model.getSnapshot().pickerOpen, false); assert.deepEqual(model.getSnapshot().entries, []);
  assert.equal(clock.jobs.size, 0);
  model.update(context({serial: 9})); model.sendPhrase('1'); assert.equal(sends.at(-1).serial, 9);
});

test('outbound invalid phrase, disconnected and spectator guards do not emit voice or payload', t => {
  const {model, sends, voices} = fixture(t, null);
  model.sendPhrase('thanks'); model.update(context()); model.sendPhrase('missing'); model.sendPhrase(1);
  model.update(context({connected: false})); model.sendPhrase('thanks');
  model.update(context({localSeat: null})); model.sendPhrase('thanks');
  assert.deepEqual(sends, []); assert.deepEqual(voices, []);
  // The pinned sender checks seat and connection, without a visibility guard.
  model.update(context({visible: false})); model.sendPhrase('thanks'); assert.equal(sends.length, 1);
});

test('muted messages are retained with timers, suppress only inbound voice and remain available when unmuted', t => {
  const {model, voices, clock} = fixture(t);
  model.receive(message()); model.toggleMember('peer'); model.receive(message({phrase: 'follow-me'}));
  const snapshot = model.getSnapshot();
  assert.deepEqual(snapshot.muted, ['peer']); assert.equal(snapshot.entries.length, 2); assert.equal(clock.jobs.size, 2);
  assert.deepEqual(voices, ['thanks']);
  model.sendPhrase('thanks'); assert.deepEqual(voices, ['thanks', 'thanks']);
  model.toggleMember('peer'); assert.deepEqual(model.getSnapshot().muted, []);
  assert.deepEqual(model.getSnapshot().entries.map(entry => entry.phrase.id), ['thanks', 'follow-me']);
  assert.deepEqual(voices, ['thanks', 'thanks']);
});

test('visibility, connection, language, seat changes and motion preserve entries/mutes; only room or serial reset', t => {
  const {model, clock} = fixture(t);
  model.receive(message()); model.toggleMember('peer'); model.toggleMute();
  const entry = model.getSnapshot().entries[0];
  for (const patch of [{visible: false}, {connected: false}, {language: 'zh'}, {localSeat: null},
    {lessMotion: false}, {seats: [{clientId: 'new', name: 'New'}]}, {}]) {
    model.update(context(patch)); const snapshot = model.getSnapshot();
    assert.deepEqual(snapshot.entries, [entry]); assert.deepEqual(snapshot.muted, ['peer']);
    assert.equal(snapshot.muteOpen, true); assert.equal(clock.jobs.size, 1);
  }
  model.update(context({serial: 8}));
  assert.deepEqual(model.getSnapshot().entries, []); assert.deepEqual(model.getSnapshot().muted, []);
  assert.equal(model.getSnapshot().muteOpen, false); assert.equal(model.getSnapshot().pickerOpen, false); assert.equal(clock.jobs.size, 0);
  model.receive(message({serial: 8})); model.toggleMember('peer'); model.togglePicker();
  model.update(context({room: 'NEXT', serial: 8}));
  assert.deepEqual(model.getSnapshot().entries, []); assert.deepEqual(model.getSnapshot().muted, []);
  assert.equal(model.getSnapshot().pickerOpen, false); assert.equal(clock.jobs.size, 0);
});

test('the 50-entry bound includes muted entries, evicts oldest first and cancels its timer', t => {
  const {model, clock, voices} = fixture(t);
  model.toggleMember('peer');
  for (let index = 0; index < 55; index++) model.receive(message({phrase: phrases[index % phrases.length].id}));
  const {entries} = model.getSnapshot();
  assert.equal(entries.length, 50); assert.equal(new Set(entries.map(entry => entry.id)).size, 50);
  assert.deepEqual(entries.map(entry => entry.phrase.id), Array.from({length: 50}, (_, index) => phrases[(index + 5) % phrases.length].id));
  assert.deepEqual(voices, []); assert.equal(clock.jobs.size, 50);
  model.toggleMember('peer'); assert.equal(model.getSnapshot().entries.length, 50);
  clock.advance(3000); assert.deepEqual(model.getSnapshot().entries, []); assert.equal(clock.jobs.size, 0);
});

test('each duplicate has an independent identity and expires at exactly 3000 ms', t => {
  const {model, clock} = fixture(t);
  model.receive(message()); clock.advance(1000); model.receive(message());
  const [first, second] = model.getSnapshot().entries;
  assert.notEqual(first.id, second.id); assert.deepEqual(clock.deadlines(), [2000, 3000]);
  clock.advance(1999); assert.equal(model.getSnapshot().entries.length, 2);
  clock.advance(1); assert.deepEqual(model.getSnapshot().entries, [second]);
  clock.advance(999); assert.deepEqual(model.getSnapshot().entries, [second]);
  clock.advance(1); assert.deepEqual(model.getSnapshot().entries, []);
});

test('expiry presenter starts after 3000 ms and owns completion without extending the original timer', async t => {
  const {model, clock} = fixture(t), gate = deferred(), presented = [];
  model.setExpiryPresenter(entry => {presented.push(entry); return gate.promise;});
  model.receive(message()); const entry = model.getSnapshot().entries[0];
  clock.advance(2999); assert.deepEqual(presented, []);
  clock.advance(1); assert.deepEqual(presented, [entry]); assert.deepEqual(model.getSnapshot().entries, [entry]);
  assert.equal(clock.jobs.size, 0);
  gate.resolve(); await flush(); assert.deepEqual(model.getSnapshot().entries, []);
});

test('a synchronous expiry presenter removes immediately and detaching restores timer-only removal', t => {
  const {model, clock} = fixture(t), presented = [];
  const detach = model.setExpiryPresenter(entry => {presented.push(entry.id);});
  model.receive(message()); const id = model.getSnapshot().entries[0].id;
  clock.advance(3000); assert.deepEqual(presented, [id]); assert.deepEqual(model.getSnapshot().entries, []);
  detach(); model.receive(message()); clock.advance(3000);
  assert.deepEqual(presented, [id]); assert.deepEqual(model.getSnapshot().entries, []);
});

test('late presentation completion after a room reset cannot remove a new-session entry', async t => {
  const {model, clock} = fixture(t), gate = deferred();
  const detach = model.setExpiryPresenter(() => gate.promise);
  model.receive(message()); const old = model.getSnapshot().entries[0]; clock.advance(3000);
  model.update(context({room: 'NEXT'})); detach(); model.receive(message({room: 'NEXT'}));
  const current = model.getSnapshot().entries[0];
  assert.notEqual(current.id, old.id);
  gate.resolve(); await flush(); assert.deepEqual(model.getSnapshot().entries, [current]);
  clock.advance(3000); assert.deepEqual(model.getSnapshot().entries, []);
});

test('dispose clears scheduled expiry and late presenter completion cannot notify subscribers', async t => {
  const {model, clock} = fixture(t), gate = deferred();
  let notifications = 0;
  model.subscribe(() => notifications++); model.setExpiryPresenter(() => gate.promise);
  model.receive(message()); clock.advance(3000); model.receive(message()); assert.equal(clock.jobs.size, 1);
  model.dispose(); const afterDispose = notifications;
  assert.equal(clock.jobs.size, 0); gate.resolve(); await flush(); clock.advance(10000);
  assert.equal(notifications, afterDispose); model.dispose();
});

function oracleFixture(t) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {url: 'https://quick-chat.invalid/'});
  const clock = fakeClock(), descriptors = new Map(), sends = [];
  const expose = (key, value) => {
    descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {configurable: true, writable: true, value});
  };
  expose('document', dom.window.document); expose('window', dom.window);
  expose('matchMedia', () => ({matches: true}));
  expose('getComputedStyle', dom.window.getComputedStyle.bind(dom.window));
  expose('clearTimeout', clock.clearTimeout); dom.window.setTimeout = clock.setTimeout;
  oracleVoice.length = 0;
  const oracle = new OriginalQuickChat(dom.window.document.body, key => key, value => sends.push(value));
  const element = selector => dom.window.document.querySelector(selector);
  t.after(() => {
    oracle.clearEntries();
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
    dom.window.close();
  });
  return {oracle, clock, sends,
    togglePicker() {element('.mp-quick-chat-prompt').click();},
    toggleMute() {element('.mp-quick-chat-mute').click();},
    toggleMember(clientId) {
      const seat = oracle.context.seats.findIndex(member => member?.clientId === clientId);
      const button = [...dom.window.document.querySelectorAll('.mp-quick-chat-mute-member')].find(candidate => candidate.textContent.startsWith(`P${seat + 1} `));
      assert.ok(button); button.click();
    },
    dismiss() {element('.mp-quick-chat').dispatchEvent(new dom.window.KeyboardEvent('keydown', {key: 'Escape', bubbles: true}));},
    sendPhrase(id) {element(`[data-phrase="${id}"]`)?.click();},
    labels() {return [...dom.window.document.querySelectorAll('.mp-quick-chat-log p')].map(row => row.title);},
  };
}
function seedRandom(seed) {let value = seed >>> 0; return limit => {value = (Math.imul(value, 1664525) + 1013904223) >>> 0; return value % limit;};}

for (const seed of [1, 0x51a7, 0xc0ffee]) test(`state, effects, rendered labels and timers match pinned ${originalRevision} trace (seed ${seed})`, async t => {
  const f = fixture(t), o = oracleFixture(t), random = seedRandom(seed);
  let ctx = context(); o.oracle.update(ctx);
  const check = label => {
    const actual = f.model.getSnapshot();
    assert.deepEqual({context: actual.context, entries: projectEntries(actual.entries), muted: [...actual.muted], pickerOpen: actual.pickerOpen, muteOpen: actual.muteOpen},
      {context: o.oracle.context, entries: projectEntries(o.oracle.entries), muted: [...o.oracle.muted], pickerOpen: o.oracle.pickerOpen, muteOpen: o.oracle.muteOpen}, label);
    assert.deepEqual(f.sends, o.sends, `${label}: payloads`); assert.deepEqual(f.voices, oracleVoice, `${label}: voice`);
    assert.deepEqual(f.clock.deadlines(), o.clock.deadlines(), `${label}: timers`);
    const labels = actual.entries.filter(entry => !actual.muted.includes(entry.clientId)).map(entry =>
      `P${entry.seat + 1} ${entry.name}: ${actual.context.language === 'en' ? entry.phrase.en : entry.phrase.zh}`);
    assert.deepEqual(labels, o.labels(), `${label}: displayed labels`);
  };
  const update = patch => {ctx = {...ctx, ...patch}; f.model.update(ctx); o.oracle.update(ctx);};
  const receive = patch => {
    const packet = message({room: ctx.room, serial: ctx.serial, ...patch});
    f.model.receive(packet); o.oracle.receive(packet);
  };
  // Guaranteed pressure at the retention limit before the mixed trace.
  f.model.toggleMember('peer'); o.toggleMember('peer');
  for (let index = 0; index < 55; index++) receive({phrase: phrases[index % phrases.length].id});
  check('muted retention boundary');
  f.model.toggleMember('peer'); o.toggleMember('peer'); check('unmuted history');
  for (let step = 0; step < 150; step++) {
    const operation = random(13);
    switch (operation) {
      case 0: case 1: receive({phrase: phrases[random(phrases.length)].id}); break;
      case 2: receive([{room: 'wrong'}, {serial: ctx.serial + 1}, {seat: 1.5}, {clientId: 'wrong'}, {phrase: 'unlisted'}, {seat: 2}][random(6)]); break;
      case 3: if (ctx.connected) {f.model.togglePicker(); o.togglePicker();} break;
      case 4: f.model.toggleMute(); o.toggleMute(); break;
      case 5: f.model.toggleMember('peer'); o.toggleMember('peer'); break;
      case 6: f.model.dismiss(); o.dismiss(); break;
      case 7: {const id = phrases[random(phrases.length)].id; f.model.sendPhrase(id); o.sendPhrase(id); break;}
      case 8: update({visible: !ctx.visible}); break;
      case 9: update({connected: !ctx.connected, localSeat: random(2) ? 0 : null}); break;
      case 10: update({language: ctx.language === 'en' ? 'zh' : 'en', seats: ctx.seats.map((seat, index) => seat && index === 1 ? {...seat, name: `Marisa ${step}`} : seat)}); break;
      case 11: update(random(2) ? {serial: ctx.serial + 1} : {room: `ROOM${step}`}); break;
      case 12: {const ms = [0, 1, 250, 2999, 3000, 3001][random(6)]; f.clock.advance(ms); o.clock.advance(ms); await flush(); break;}
    }
    check(`seed ${seed}, step ${step}, operation ${operation}`);
  }
  f.clock.advance(3000); o.clock.advance(3000); await flush(); check('all timers settled');
});

/** Exercise only each legacy class's constructor/update/receive plus DOM events.
 * Private fields intentionally are not used: the rewritten adapter owns a model.
 */
function legacyAdapterPair(t) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {url: 'https://quick-chat.invalid/'});
  const {document} = dom.window, originals = new Map(), errors = [];
  const expose = (key, value) => {
    if (!originals.has(key)) originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {configurable: true, writable: true, value});
  };
  expose('document', document); expose('getComputedStyle', dom.window.getComputedStyle.bind(dom.window));
  expose('matchMedia', () => ({matches: true}));
  dom.window.addEventListener('error', event => {errors.push(event.error?.message ?? event.message); event.preventDefault();});
  oracleVoice.length = currentVoice.length = 0;
  const create = (Class, voices) => {
    const clock = fakeClock(), sends = [], host = document.createElement('main'); document.body.append(host);
    const timerWindow = {setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout};
    const activate = operation => {expose('window', timerWindow); expose('clearTimeout', clock.clearTimeout); return operation();};
    const instance = activate(() => new Class(host, key => key, value => sends.push(value)));
    const find = selector => {const element = host.querySelector(selector); assert.ok(element, selector); return element;};
    return {host, clock, sends, voices,
      update(next) {activate(() => instance.update(next));},
      receive(packet) {activate(() => instance.receive(packet));},
      click(selector) {activate(() => find(selector).click());},
      dispatch(type, options = {}) {
        return activate(() => {
          const event = type.startsWith('key') ? new dom.window.KeyboardEvent(type, {bubbles: true, cancelable: true, ...options})
            : new dom.window.Event(type, {bubbles: true, cancelable: true});
          find('.mp-quick-chat-prompt').dispatchEvent(event); return event.defaultPrevented;
        });
      },
      advance(ms) {activate(() => clock.advance(ms));},
      snapshot() {
        const root = find('.mp-quick-chat'), prompt = find('.mp-quick-chat-prompt'), log = find('.mp-quick-chat-log');
        const pickers = [...host.querySelectorAll('.mp-quick-chat-picker')], mute = host.querySelector('.mp-quick-chat-mute');
        const control = button => ({text: button.textContent, disabled: button.disabled, expanded: button.getAttribute('aria-expanded')});
        return {
          hidden: root.hidden, label: root.getAttribute('aria-label'), prompt: control(prompt),
          menusHidden: pickers.map(element => element.hidden),
          phraseRows: [...host.querySelectorAll('.mp-quick-chat-row')].map(row => ({paired: row.classList.contains('paired'),
            buttons: [...row.children].map(button => ({id: button.dataset.phrase, title: button.title, ...control(button)}))})),
          members: [...host.querySelectorAll('.mp-quick-chat-mute-member')].map(button => ({text: button.textContent, pressed: button.getAttribute('aria-pressed')})),
          mute: mute ? {...control(mute), menu: pickers.indexOf(mute.parentElement)} : null,
          log: {role: log.getAttribute('role'), live: log.getAttribute('aria-live'),
            rows: [...log.children].map(row => ({title: row.title, text: row.textContent, author: row.querySelector('strong')?.textContent}))},
        };
      },
    };
  };
  const current = create(CurrentQuickChat, currentVoice), original = create(OriginalQuickChat, oracleVoice);
  const both = (method, ...args) => {current[method](...args); original[method](...args);};
  const check = label => {
    assert.deepEqual(current.snapshot(), original.snapshot(), `${label}: DOM`);
    assert.deepEqual(current.sends, original.sends, `${label}: relay payloads`);
    assert.deepEqual(current.voices, original.voices, `${label}: voice IDs`);
    assert.deepEqual(current.clock.deadlines(), original.clock.deadlines(), `${label}: expiry timers`);
    assert.deepEqual(errors, [], `${label}: DOM event errors`);
  };
  t.after(() => {
    both('update', context({visible: false, room: 'TEST-CLEANUP', serial: -1}));
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
    dom.window.close();
  });
  return {current, original, both, check};
}

test('rewritten legacy adapter preserves public DOM transitions, disabled actions and exact expiry boundaries', t => {
  const {current, both, check} = legacyAdapterPair(t);
  check('constructor before context');
  both('receive', message()); check('receive before update');
  both('update', context()); check('initial context');
  both('click', '.mp-quick-chat-prompt'); check('picker opened');
  assert.deepEqual(current.snapshot().menusHidden, [false, true]);
  both('click', '[data-phrase="follow-me"]'); check('outbound phrase');
  both('click', '.mp-quick-chat-prompt'); both('click', '.mp-quick-chat-mute'); check('mute list opened');
  both('click', '.mp-quick-chat-mute-member'); check('peer muted');
  both('receive', message()); check('muted receive');
  assert.equal(current.snapshot().log.rows.length, 0); assert.equal(current.clock.jobs.size, 1);
  both('click', '.mp-quick-chat-mute-member'); check('peer unmuted');
  assert.equal(current.snapshot().log.rows.length, 1);
  both('click', '.mp-quick-chat-mute'); check('mute back to picker');
  both('dispatch', 'keydown', {key: 'Escape'}); check('escape dismisses picker');
  both('update', context({connected: false})); check('disconnected disables actions');
  both('click', '.mp-quick-chat-prompt'); both('click', '[data-phrase="thanks"]'); check('disabled clicks ignored');
  assert.equal(current.sends.length, 1);
  both('update', context({localSeat: null, language: 'zh'})); check('spectator localization and mute candidates');
  both('click', '.mp-quick-chat-prompt'); both('click', '[data-phrase="thanks"]'); check('spectator cannot send');
  assert.equal(current.sends.length, 1);
  both('advance', 2999); check('row before expiry'); assert.equal(current.snapshot().log.rows.length, 1);
  both('advance', 1); check('row at expiry'); assert.equal(current.snapshot().log.rows.length, 0);
  both('update', context()); both('receive', message()); both('update', context({visible: false}));
  check('hide preserves row'); both('receive', message()); check('hidden receive ignored');
  both('update', context({room: 'NEXT'})); check('room reset'); assert.equal(current.clock.jobs.size, 0);
  both('receive', message({room: 'NEXT'})); both('update', context({room: 'NEXT', serial: 8})); check('serial reset');
  assert.equal(current.snapshot().log.rows.length, 0); assert.equal(current.clock.jobs.size, 0);
});

test('rewritten legacy adapter preserves input event cancellation and propagation boundaries', t => {
  const {current, original, both, check} = legacyAdapterPair(t);
  both('update', context()); both('click', '.mp-quick-chat-prompt');
  for (const type of ['keydown', 'keyup', 'pointerdown', 'pointermove', 'pointerup', 'pointercancel',
    'touchstart', 'touchmove', 'touchend', 'touchcancel', 'mousedown']) {
    const events = [];
    for (const adapter of [current, original]) {
      let bubbled = 0; const onEvent = () => bubbled++;
      adapter.host.addEventListener(type, onEvent);
      const prevented = adapter.dispatch(type, {key: 'Escape'});
      adapter.host.removeEventListener(type, onEvent); events.push({prevented, bubbled});
    }
    assert.deepEqual(events[0], events[1], type);
    assert.equal(events[0].prevented, ['pointerdown', 'mousedown'].includes(type), `${type}: default cancellation`);
    assert.equal(events[0].bubbled, type === 'mousedown' ? 1 : 0, `${type}: propagation`);
    check(type);
  }
});

for (const seed of [0x6440, 0x6580]) test(`rewritten legacy adapter matches pinned public DOM trace (seed ${seed})`, t => {
  const {current, both, check} = legacyAdapterPair(t), random = seedRandom(seed);
  let ctx = context();
  const update = patch => {ctx = {...ctx, ...patch}; both('update', ctx);};
  const receive = patch => both('receive', message({room: ctx.room, serial: ctx.serial, ...patch}));
  update({}); both('click', '.mp-quick-chat-prompt'); both('click', '.mp-quick-chat-mute');
  both('click', '.mp-quick-chat-mute-member');
  for (let index = 0; index < 55; index++) receive({phrase: phrases[index % phrases.length].id});
  check('muted retention cap'); assert.equal(current.clock.jobs.size, 50);
  both('click', '.mp-quick-chat-mute-member'); check('unmuted retained rows');
  assert.equal(current.snapshot().log.rows.length, 50);
  for (let step = 0; step < 100; step++) {
    const operation = random(14);
    switch (operation) {
      case 0: case 1: receive({phrase: phrases[random(phrases.length)].id}); break;
      case 2: receive([{room: 'wrong'}, {serial: ctx.serial + 1}, {seat: 1.5}, {clientId: 'wrong'}, {phrase: 'unlisted'}, {seat: 2}][random(6)]); break;
      case 3: both('click', '.mp-quick-chat-prompt'); break;
      case 4: both('click', '.mp-quick-chat-mute'); break;
      case 5: both('click', '.mp-quick-chat-mute-member'); break;
      case 6: both('dispatch', 'keydown', {key: 'Escape'}); break;
      case 7: both('click', `[data-phrase="${phrases[random(phrases.length)].id}"]`); break;
      case 8: update({visible: !ctx.visible}); break;
      case 9: update({connected: !ctx.connected, localSeat: random(2) ? 0 : null}); break;
      case 10: update({language: ctx.language === 'en' ? 'zh' : 'en', seats: ctx.seats.map((seat, index) => seat && index === 1 ? {...seat, name: `Marisa ${step}`} : seat)}); break;
      case 11: update(random(2) ? {serial: ctx.serial + 1} : {room: `ROOM${step}`}); break;
      case 12: both('advance', [0, 1, 250, 2999, 3000, 3001][random(6)]); break;
      case 13: update({lessMotion: !ctx.lessMotion}); break;
    }
    check(`seed ${seed}, step ${step}, operation ${operation}`);
  }
  both('advance', 3000); check('all expiry timers settled');
  assert.equal(current.clock.jobs.size, 0); assert.equal(current.snapshot().log.rows.length, 0);
});
