import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FIRST_USE_NOTICE_FILE,
  FIRST_USE_NOTICE_SEEN_STORAGE_KEY,
  hasSeenFirstUseNotice,
  markFirstUseNoticeSeen,
} from '../src/launcher/first-use-notice.mts';
import { createFirstUseNoticeService } from '../app/services/first-use-notice.ts';

const legacyKeys = [
  'eagler-touhou-new-player-notice-seen-v1',
  'eagler-touhou-changelog-seen-v2',
  'eagler-touhou-changelog-seen-20260822-1',
];
function memoryStorage(entries = []) {
  const values = new Map(entries);
  const writes = [];
  return { values, writes, getItem: key => values.get(key) ?? null,
    setItem(key, value) { writes.push([key, value]); values.set(key, value); } };
}
const response = (html, status = 200) => ({ ok: status >= 200 && status < 300, status, text: async () => html });
const html = '<section class="first-use-notice-item"><h2>Before starting</h2><p>Existing content</p></section>';

test('existing marker is read without writes and uses its exact existing value', () => {
  const storage = memoryStorage([[FIRST_USE_NOTICE_SEEN_STORAGE_KEY, '1']]);
  assert.equal(hasSeenFirstUseNotice(storage), true);
  assert.equal(hasSeenFirstUseNotice(storage), true);
  assert.deepEqual(storage.writes, []);
  for (const value of ['', '0', 'true']) {
    storage.values.set(FIRST_USE_NOTICE_SEEN_STORAGE_KEY, value);
    assert.equal(hasSeenFirstUseNotice(storage), false);
  }
  assert.deepEqual(storage.writes, []);
});

for (const key of legacyKeys) test(`migrates ${key} once, preserving unrelated state`, () => {
  // Existing migration accepts any nonempty legacy marker, including '0'.
  const storage = memoryStorage([[key, '0'], ['eagler-touhou-site-notice-enabled-v1', '0'], ['product-save', 'untouched']]);
  const service = createFirstUseNoticeService({ storage });
  assert.equal(service.hasSeen(), true);
  assert.equal(service.hasSeen(), true);
  assert.deepEqual(storage.writes, [[FIRST_USE_NOTICE_SEEN_STORAGE_KEY, '1']]);
  assert.equal(storage.values.get(key), '0');
  assert.equal(storage.values.get('eagler-touhou-site-notice-enabled-v1'), '0');
  assert.equal(storage.values.get('product-save'), 'untouched');
});

test('missing/empty legacy markers never acknowledge an unseen browser', () => {
  const storage = memoryStorage(legacyKeys.map(key => [key, '']));
  assert.equal(hasSeenFirstUseNotice(storage), false);
  assert.deepEqual(storage.writes, []);
  assert.equal(hasSeenFirstUseNotice(null), false);
  assert.doesNotThrow(() => markFirstUseNoticeSeen(null));
});

test('read/write denial is safe and preserves existing migration failure semantics', () => {
  const denied = { getItem() { throw Error('read denied'); }, setItem() { throw Error('write denied'); } };
  const service = createFirstUseNoticeService({ storage: denied });
  assert.equal(service.hasSeen(), false);
  assert.doesNotThrow(() => service.markSeen());
  const migrationDenied = { getItem: key => key === legacyKeys[0] ? 'seen' : null,
    setItem() { throw Error('write denied'); } };
  assert.equal(hasSeenFirstUseNotice(migrationDenied), false);
  assert.doesNotThrow(() => markFirstUseNoticeSeen(migrationDenied));
  const currentReadOnly = { ...migrationDenied, getItem: key => key === FIRST_USE_NOTICE_SEEN_STORAGE_KEY ? '1' : null };
  assert.equal(hasSeenFirstUseNotice(currentReadOnly), true);
});

test('available content is cached at the root asset URL without implicitly marking it seen', async () => {
  const storage = memoryStorage();
  const requests = [];
  const service = createFirstUseNoticeService({ storage, fetchImpl: async (...args) => {
    requests.push(args); return response(` \n${html}\n `);
  } });
  const result = await service.load();
  assert.deepEqual(result, { kind: 'available', html });
  assert.equal(Object.isFrozen(result), true);
  assert.equal(await service.load(), result);
  assert.deepEqual(requests, [[`/${FIRST_USE_NOTICE_FILE}`, { cache: 'no-store' }]]);
  assert.equal(service.hasSeen(), false);
  assert.deepEqual(storage.writes, []);
  service.markSeen();
  assert.equal(service.hasSeen(), true);
  assert.deepEqual(storage.writes, [[FIRST_USE_NOTICE_SEEN_STORAGE_KEY, '1']]);
});

test('empty content is cached without acknowledging it or writing other preferences', async () => {
  const storage = memoryStorage(); let calls = 0;
  const service = createFirstUseNoticeService({ storage, fetchImpl: async () => { calls++; return response('\n\r\n  '); } });
  const result = await service.load();
  assert.deepEqual(result, { kind: 'empty' });
  assert.equal(await service.load(), result);
  assert.equal(calls, 1);
  assert.equal(service.hasSeen(), false);
  assert.deepEqual(storage.writes, []);
});

test('concurrent loads share one request and the same settled content', async () => {
  let release; let calls = 0;
  const gate = new Promise(resolve => { release = resolve; });
  const service = createFirstUseNoticeService({ storage: null, fetchImpl: async () => { calls++; await gate; return response(html); } });
  const first = service.load(); const second = service.load();
  assert.equal(first, second);
  assert.equal(calls, 1);
  release();
  assert.equal(await first, await second);
  assert.equal(await service.load(), await first);
});

test('network, HTTP and body-read errors remain retryable and never write seen state', async () => {
  const storage = memoryStorage(); let calls = 0;
  const offline = new Error('offline'); const unreadable = new Error('body unreadable');
  const service = createFirstUseNoticeService({ storage, fetchImpl: async () => {
    switch (++calls) {
      case 1: throw offline;
      case 2: return response('', 404);
      case 3: return { ok: true, status: 200, text: async () => { throw unreadable; } };
      default: return response(html);
    }
  } });
  assert.deepEqual(await service.load(), { kind: 'error', error: offline });
  const notFound = await service.load(); assert.equal(notFound.kind, 'error'); assert.match(notFound.error.message, /HTTP 404/);
  assert.deepEqual(await service.load(), { kind: 'error', error: unreadable });
  assert.deepEqual(await service.load(), { kind: 'available', html });
  await service.load();
  assert.equal(calls, 4);
  assert.deepEqual(storage.writes, []);
});
