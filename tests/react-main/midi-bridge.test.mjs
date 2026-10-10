/** Main1661–1700/4991–5022 behavior with synthetic MIDI/focus/event ports.
 * No real AudioContext, permission dialog, MIDI hardware or audible output PASS. */
import test, {before, after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir, mkdtemp, rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {build} from 'esbuild';
const root = fileURLToPath(new URL('../../', import.meta.url)); let work, createMidiBridge;
before(async () => {
  await mkdir(resolve(root, '.cache'), {recursive: true}); work = await mkdtemp(resolve(root, '.cache/midi-main-'));
  const outfile = resolve(work, 'bridge.mjs');
  await build({entryPoints: [resolve(root, 'app/services/midi-bridge.ts')], bundle: true, platform: 'node', format: 'esm', outfile, logLevel: 'silent'});
  ({createMidiBridge} = await import(pathToFileURL(outfile).href));
});
after(async () => {if (work) await rm(work, {recursive: true, force: true});});
function fixture({available = true, missing = false, factoryGate = null} = {}) {
  const frame = new EventTarget(), window = new EventTarget(), document = new EventTarget();
  Object.assign(document, {hidden: false, focused: true, activeElement: frame, hasFocus() {return this.focused;}});
  let context = {epoch: 1, game: 'th06', document: {}, target: new EventTarget(), music: 'midi'};
  let launched = true, open = true, external = false, externalWasActive = false;
  const events = [], streams = [], hardware = [], listeners = new Set();
  const audio = {state: 'suspended', async resume() {events.push('resume'); this.state = 'running';}, async suspend() {events.push('suspend'); this.state = 'suspended';}};
  class Synth {
    constructor(options) {events.push(['construct', options]);}
    getAudioContext() {return audio;}
    reset() {events.push('reset');}
    send(bytes) {streams.push(bytes);}
  }
  const bridge = createMidiBridge({runtime: {
    getMidiEventContext: () => context, getSnapshot: () => ({launched}),
    subscribe(listener) {listeners.add(listener); return () => listeners.delete(listener);},
  }, external: {
    async prepare() {events.push('external-prepare');}, panic() {events.push('panic'); externalWasActive = false;},
    deliver(bytes) {if (external && !externalWasActive) bridge.resetSynth(); externalWasActive = external; if (external) hardware.push(bytes); return external;},
  }, async loadSynth() {events.push('load'); if (factoryGate) await factoryGate.promise; return missing ? undefined : Synth;},
  webAudioAvailable: available, translate: key => key, frame, window, document, playerOpen: () => open});
  return {bridge, frame, window, document, audio, events, streams, hardware,
    context: () => context,
    change(value, notify = true) {context = value; if (notify) for (const listener of listeners) listener();},
    launched(value) {launched = value;}, open(value) {open = value;}, external(value) {external = value;},
    midi(bytes, target = context.target) {target.dispatchEvent(new CustomEvent('touhou-midi', {detail: {bytes}}));},
  };
}
test('prepares exactly one retained TinySynth with original options and supports OGG fallback stream', async () => {
  const f = fixture(); await Promise.all([f.bridge.prepare('midi'), f.bridge.prepare('ogg-stream')]);
  assert.equal(f.events.filter(x => x === 'load').length, 1);
  assert.deepEqual(f.events.filter(Array.isArray), [['construct', {quality: 1, useReverb: 1, voices: 64}]]);
  f.change({...f.context(), music: 'ogg'}); f.midi([144, 60, 127, 'x']);
  assert.deepEqual(f.streams, [[144, 60, 127]]); f.bridge.dispose();
});
test('one audible owner: hardware takeover resets browser held notes before exclusive delivery', async () => {
  const f = fixture(); await f.bridge.prepare('midi'); f.midi([144, 60, 100]); f.external(true); f.midi([128, 60, 0]);
  assert.deepEqual(f.streams, [[144, 60, 100]]); assert.deepEqual(f.hardware, [[128, 60, 0]]);
  assert.equal(f.events.filter(x => x === 'reset').length, 1); f.bridge.dispose();
});
test('none mode and unauthenticated old document events cannot reach either output', async () => {
  const f = fixture(); await f.bridge.prepare('midi'); const old = f.context();
  f.change({...old, document: {}}, false); f.midi([144, 60, 1], old.target);
  assert.deepEqual(f.streams, []);
  f.bridge.rebind(); f.change({...f.context(), music: 'none'}); f.midi([144, 60, 1]);
  assert.deepEqual(f.streams, []); f.bridge.dispose();
});
test('rebind removes old stream and close listeners, authentic new close resets and panics', async () => {
  const f = fixture(); await f.bridge.prepare('midi'); const old = f.context();
  const next = {...old, epoch: 2, document: {}, target: new EventTarget()}; f.change(next); f.events.length = 0;
  f.midi([144, 60, 1], old.target); old.target.dispatchEvent(new Event('touhou-midi-close'));
  assert.deepEqual(f.events, []); assert.deepEqual(f.streams, []);
  next.target.dispatchEvent(new Event('touhou-midi-close')); assert.deepEqual(f.events, ['reset', 'panic']); f.bridge.dispose();
});
test('blur suspends without reset/panic; resume requires every original focus condition', async () => {
  const f = fixture(); await f.bridge.prepare('midi'); f.events.length = 0;
  f.window.dispatchEvent(new Event('blur')); assert.deepEqual(f.events, ['suspend']);
  f.document.hidden = true; f.frame.dispatchEvent(new Event('focus')); assert.equal(f.audio.state, 'suspended');
  f.document.hidden = false; f.document.focused = false; f.frame.dispatchEvent(new Event('focus')); assert.equal(f.audio.state, 'suspended');
  f.document.focused = true; f.document.activeElement = {}; f.frame.dispatchEvent(new Event('focus')); assert.equal(f.audio.state, 'suspended');
  f.document.activeElement = f.frame; f.open(false); f.frame.dispatchEvent(new Event('focus')); assert.equal(f.audio.state, 'suspended');
  f.open(true); f.launched(false); f.frame.dispatchEvent(new Event('focus')); assert.equal(f.audio.state, 'suspended');
  f.launched(true); f.frame.dispatchEvent(new Event('focus')); assert.equal(f.audio.state, 'running');
  assert.deepEqual(f.events, ['suspend', 'resume']); f.bridge.dispose();
});
test('pagehide panics external hardware without inventing a synth reset', async () => {
  const f = fixture(); await f.bridge.prepare('midi'); f.events.length = 0;
  f.window.dispatchEvent(new Event('pagehide')); assert.deepEqual(f.events, ['panic']); f.bridge.dispose();
});
test('unsupported WebAudio and missing synth retain original error keys; none needs neither', async () => {
  const f = fixture({available: false}); await f.bridge.prepare('none'); assert.deepEqual(f.events, []);
  await assert.rejects(f.bridge.prepare('midi'), /music.webAudioUnsupported/); f.bridge.dispose();
  const g = fixture({missing: true}); await assert.rejects(g.bridge.prepare('midi'), /music.synthMissing/); g.bridge.dispose();
});
test('dispose fences a pending synth load and removes all focus/native listeners', async () => {
  let resolve; const gate = {promise: new Promise(r => {resolve = r;})};
  const f = fixture({factoryGate: gate}); const preparing = f.bridge.prepare('midi'); f.bridge.dispose(); resolve(); await preparing;
  assert.equal(f.events.some(Array.isArray), false); f.events.length = 0;
  f.window.dispatchEvent(new Event('pagehide')); f.frame.dispatchEvent(new Event('focus')); f.midi([144, 60, 1]);
  assert.deepEqual(f.events, []); assert.deepEqual(f.streams, []);
});
