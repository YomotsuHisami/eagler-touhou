/** Current root-lived notice service; visual close/reopen and reduced-motion
 * ownership are exercised by tests/ui-main/dialog-motion.spec.ts. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {importUiModule} from './support/import-ui-module.mjs';

const {createNoticesService, FIRST_USE_NOTICE_SEEN_STORAGE_KEY, LEGACY_FIRST_USE_KEYS} =
  await importUiModule('app/services/notices.client.ts');
const {FIRST_USE_NOTICE_FILE} = await importUiModule('src/launcher/first-use-notice.mts');
const baseUrl = 'https://launcher.example/mount/';
const noticeHtml = '<div class="first-use-notice-list"><section class="first-use-notice-item"><h2>开始前请注意</h2><p>Item</p></section></div>';

function storageFrom(values = new Map()) {
  return {values, writes: [], getItem: key => values.get(key) ?? null,
    setItem(key, value) {this.writes.push([key, value]);values.set(key, String(value));}};
}
function deferred() {
  let resolve;const promise = new Promise(yes => {resolve = yes;});return {promise, resolve};
}
function setup(t, {storage = storageFrom(), fetchImpl, body = noticeHtml, status = 200} = {}) {
  const calls = [], timers = new Map();
  const service = createNoticesService({baseUrl, storage,
    timers: {set(callback, delay) {const key = {};timers.set(key, {callback, delay});return key;}, clear(key) {timers.delete(key);}},
    fetchImpl: (url, options) => {calls.push({url, options});return fetchImpl ? fetchImpl(url, options) : Promise.resolve(new Response(body, {status}));},
  });
  t.after(() => service.dispose());
  return {service, storage, calls, timers, state: () => service.getSnapshot()};
}

test('new browsers present the packaged notice once and preserve its source and seen key', async t => {
  const h = setup(t);
  assert.equal(FIRST_USE_NOTICE_FILE, 'content/FIRST_USE_NOTICE.html');
  assert.equal(FIRST_USE_NOTICE_SEEN_STORAGE_KEY, 'eagler-touhou-first-use-notice-seen-v1');
  assert.equal(await h.service.showFirstUse(true), true);
  assert.equal(h.calls[0].url, new URL(FIRST_USE_NOTICE_FILE, baseUrl).href);
  assert.equal(h.calls[0].options.cache, 'no-store');
  assert.equal(h.state().firstUseOpen, true);
  assert.equal(h.state().contents['first-use'].html, noticeHtml);
  assert.equal(h.state().contents['first-use'].nodes[0].attributes.className, 'first-use-notice-list');
  assert.equal(h.storage.values.get(FIRST_USE_NOTICE_SEEN_STORAGE_KEY), '1');
  assert.equal(h.timers.size, 0, 'a completed load leaves no request timer');
  h.service.closeFirstUse();
  assert.equal(h.state().firstUseOpen, false, 'closing intent is immediate; AnimatedDialog owns visual exit');
  assert.equal(await h.service.showFirstUse(true), false);
  assert.equal(h.calls.length, 1);
});

test('returning users are not interrupted by content changes; manual access remains available', async t => {
  const storage = storageFrom(new Map([[FIRST_USE_NOTICE_SEEN_STORAGE_KEY, '1']]));
  const h = setup(t, {storage, body: noticeHtml.replace('Item', 'Changed')});
  assert.equal(await h.service.showFirstUse(true), false);
  assert.equal(h.calls.length, 0, 'returning startup does not fetch to decide whether to show onboarding');
  assert.equal(h.state().firstUseOpen, false);
  assert.equal(await h.service.showFirstUse(), true);
  assert.match(h.state().contents['first-use'].html, /Changed/);
  h.service.closeFirstUse();await h.service.showFirstUse();
  assert.equal(h.calls.length, 1, 'available content is cached for manual reopen');
});

test('all historical nonempty seen values migrate exactly once without fetching', async t => {
  const expected = ['eagler-touhou-new-player-notice-seen-v1', 'eagler-touhou-changelog-seen-v2', 'eagler-touhou-changelog-seen-20260822-1'];
  assert.deepEqual(LEGACY_FIRST_USE_KEYS, expected);
  for (const key of expected) {
    const h = setup(t, {storage: storageFrom(new Map([[key, 'legacy-seen']]))});
    assert.equal(await h.service.showFirstUse(true), false, key);
    assert.equal(h.calls.length, 0);assert.equal(h.state().firstUseSeen, true);
    assert.deepEqual(h.storage.writes, [[FIRST_USE_NOTICE_SEEN_STORAGE_KEY, '1']]);
    h.service.hydrate();await h.service.showFirstUse(true);
    assert.equal(h.storage.writes.length, 1);
  }
});

test('empty content is cached without interruption or acknowledgment and is still manually viewable', async t => {
  const h = setup(t, {body: '\uFEFF\n\r\n'});
  assert.equal(await h.service.showFirstUse(true), false);
  assert.equal(h.state().firstUseOpen, false);assert.equal(h.state().contents['first-use'].status, 'empty');
  assert.equal(await h.service.showFirstUse(), true);assert.equal(h.state().firstUseOpen, true);
  assert.deepEqual(h.state().contents['first-use'].nodes, []);
  assert.equal(h.state().firstUseSeen, false);assert.deepEqual(h.storage.writes, []);assert.equal(h.calls.length, 1);
});

test('network and HTTP failures stay nonblocking automatically, open manually, and retry successfully', async t => {
  for (const failure of ['offline', 'http']) {
    let attempts = 0;
    const h = setup(t, {fetchImpl: async () => {
      attempts++;
      if (attempts <= 2) {
        if (failure === 'offline') throw Error('offline');
        return new Response('Unavailable', {status: 503});
      }
      return new Response(noticeHtml);
    }});
    assert.equal(await h.service.showFirstUse(true), false);assert.equal(h.state().firstUseOpen, false);
    assert.equal(h.state().contents['first-use'].error, failure === 'offline' ? 'offline' : 'HTTP 503');
    assert.equal(await h.service.showFirstUse(), true);assert.equal(h.state().contents['first-use'].status, 'error');
    assert.equal(h.state().firstUseSeen, false);assert.deepEqual(h.storage.writes, []);
    h.service.closeFirstUse();assert.equal(await h.service.showFirstUse(), true);
    assert.equal(h.state().contents['first-use'].status, 'available');assert.equal(h.state().firstUseSeen, true);
    assert.equal(attempts, 3);assert.equal(h.timers.size, 0);
  }
});

test('close/reopen coalesces pending content and only the latest presentation acknowledges it', async t => {
  const pending = deferred(), h = setup(t, {fetchImpl: () => pending.promise});
  const first = h.service.showFirstUse();h.service.closeFirstUse();
  const reopened = h.service.showFirstUse();
  assert.equal(h.calls.length, 1);assert.deepEqual(h.storage.writes, []);
  pending.resolve(new Response(noticeHtml));
  assert.equal(await first, false);assert.equal(await reopened, true);
  assert.equal(h.state().firstUseOpen, true);assert.equal(h.storage.writes.length, 1);
  assert.equal(h.timers.size, 0, 'the service does not retain a legacy close timer that could close the reopened dialog');
});

test('closing or disposing a pending notice cannot reopen or acknowledge stale content', async t => {
  for (const action of ['closeFirstUse', 'dispose']) {
    const pending = deferred(), h = setup(t, {fetchImpl: () => pending.promise});
    const showing = h.service.showFirstUse();h.service[action]();
    pending.resolve(new Response(noticeHtml));
    assert.equal(await showing, false);assert.equal(h.state().firstUseOpen, false);
    assert.deepEqual(h.storage.writes, []);assert.equal(h.timers.size, 0);
    if (action === 'dispose') assert.equal(h.calls[0].options.signal.aborted, true);
  }
});

test('unavailable storage still allows current-document acknowledgment and manual close/reopen', async t => {
  for (const storage of [null, {getItem() {throw Error('denied');}, setItem() {throw Error('denied');}}]) {
    const h = setup(t, {storage});
    assert.equal(await h.service.showFirstUse(true), true);assert.equal(h.state().firstUseSeen, true);
    h.service.closeFirstUse();assert.equal(await h.service.showFirstUse(true), false);
    assert.equal(await h.service.showFirstUse(), true);assert.equal(h.calls.length, 1);
  }
});
