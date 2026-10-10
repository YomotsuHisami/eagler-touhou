/** Source-only checks. No Service Worker, browser, or network is started. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createAppShellClient, matchesAppShellRegistration} from '../../src/launcher/app-shell-client.mts';
const identity = {scopeUrl: 'https://isolated.invalid/review/', workerUrl: 'https://isolated.invalid/review/app-shell-sw.js'};
class Target {
  listeners = new Map();
  addEventListener(name, fn) {this.listeners.set(name, [...this.listeners.get(name) ?? [], fn]);}
  removeEventListener(name, fn) {this.listeners.set(name, (this.listeners.get(name) ?? []).filter(value => value !== fn));}
  emit(name) {for (const fn of this.listeners.get(name) ?? []) fn();}
}
function worker(scriptURL = identity.workerUrl, state = 'activated') {return Object.assign(new Target(), {scriptURL, state, messages: [], postMessage(message) {this.messages.push(message);}});}
function registration(scope = identity.scopeUrl, scriptURL = identity.workerUrl) {return Object.assign(new Target(), {scope, active: worker(scriptURL), waiting: null, installing: null, updates: 0, async update() {this.updates++;}});}
function client({existing = null, registered = registration(), registerError = false, controller = null, defer = true} = {}) {
  let calls = 0, reloads = 0;
  const container = {controller, async getRegistration() {return existing;}, async register() {calls++; if (registerError) throw new Error('offline'); return registered;}};
  const owner = createAppShellClient({serviceWorker: container, secureContext: true, workerUrl: identity.workerUrl, scope: identity.scopeUrl,
    registrationIdentity: identity, shouldDeferReload: () => defer, activationRetryMs: 0, activationTimeoutMs: 50, schedule: fn => fn(), reload: () => reloads++, logger: {warn() {}}});
  return {owner, calls: () => calls, reloads: () => reloads};
}
test('scope lookup must match normalized exact scope and every live script', () => {
  assert.equal(matchesAppShellRegistration(registration(), identity), true);
  assert.equal(matchesAppShellRegistration(registration('https://ISOLATED.invalid:443/review/'), identity), true);
  for (const value of [null, {}, registration('https://isolated.invalid/'), registration(identity.scopeUrl, 'https://isolated.invalid/production-sw.js')]) assert.equal(matchesAppShellRegistration(value, identity), false);
  const mixed = registration(); mixed.waiting = worker('https://isolated.invalid/review/other-sw.js', 'installed');
  assert.equal(matchesAppShellRegistration(mixed, identity), false);
});
test('failed nested registration never adopts or updates an ancestor', async () => {
  const parent = registration('https://isolated.invalid/', 'https://isolated.invalid/app-shell-sw.js');
  const f = client({existing: parent, registerError: true});
  assert.equal(await f.owner.ready, null); assert.equal(parent.updates, 0); assert.equal(f.calls(), 1);
});
test('existing foreign worker at exact mount prevents register from replacing it', async () => {
  const foreign = registration(identity.scopeUrl, 'https://isolated.invalid/review/other-sw.js');
  const f = client({existing: foreign});
  assert.equal(await f.owner.ready, null); assert.equal(f.calls(), 0); assert.equal(foreign.updates, 0);
});
test('the exact expected offline registration remains usable after register failure', async () => {
  const expected = registration(); const f = client({existing: expected, registerError: true});
  assert.equal(await f.owner.ready, expected);
});
test('register resolution itself cannot substitute an unexpected registration', async () => {
  const f = client({registered: registration('https://isolated.invalid/')});
  assert.equal(await f.owner.ready, null);
});
test('parent-controlled first install waits for its own activation without reload', async () => {
  const child = registration(); child.active = null; child.installing = worker(identity.workerUrl, 'installing');
  const f = client({registered: child, controller: worker('https://isolated.invalid/app-shell-sw.js')});
  let ready = false; void f.owner.ready.then(() => {ready = true;});
  await new Promise(resolve => setImmediate(resolve)); assert.equal(ready, false);
  child.active = child.installing; child.installing.state = 'activated'; child.installing.emit('statechange');
  assert.equal(await f.owner.ready, child); assert.equal(child.updates, 0); assert.equal(f.reloads(), 0);
});
test('unexpected updatefound worker cannot be activated by a formerly valid owner', async () => {
  const expected = registration(); const f = client({registered: expected, controller: worker(), defer: false});
  await f.owner.ready;
  const foreign = worker('https://isolated.invalid/review/other-sw.js', 'installed');
  expected.waiting = foreign; expected.installing = foreign; expected.emit('updatefound');
  await f.owner.maybeActivateWaiting(); assert.deepEqual(foreign.messages, []); assert.equal(await f.owner.checkForUpdate(), false); assert.equal(f.reloads(), 0);
});
