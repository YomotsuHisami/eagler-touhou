/** Original main app303–334/1175; synthetic service-worker status port only. */
import test, {before, after} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdir, mkdtemp, rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
let directory, createBrandUpdateAge;
before(async () => {
  await mkdir(resolve('.cache'), {recursive: true});
  directory = await mkdtemp(resolve('.cache/brand-age-'));
  const outfile = resolve(directory, 'model.mjs');
  await build({entryPoints: ['app/models/brand-update-age.ts'], outfile, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent'});
  ({createBrandUpdateAge} = await import(pathToFileURL(outfile).href));
});
after(async () => {if (directory) await rm(directory, {recursive: true, force: true});});
function fixture(fetcher) {
  const requests = [], timers = new Map(); let time = 61000, serial = 0, locale = 'zh';
  const model = createBrandUpdateAge({baseUrl: 'https://site.invalid/sub/', now: () => time,
    translate: (key, params) => `${locale}:${key}:${params?.age ?? ''}`,
    fetchImpl: async (...args) => {requests.push(args); return fetcher ? fetcher(...args) : {ok: true, json: async () => ({updated: true, appliedAt: 1000})};},
    timers: {setTimeout(fn, ms) {const id = ++serial; timers.set(id, {fn, ms}); return id;}, clearTimeout(id) {timers.delete(id);}}});
  return {model, requests, timers, advance(ms) {time += ms;}, locale(value) {locale = value; model.refreshLocale();}};
}
test('does no request until actual shell ready and controlled; uncontrolled page remains neutral', async () => {
  const f = fixture(); let resolveReady; const ready = new Promise(r => {resolveReady = r;});
  const binding = f.model.bind(ready, () => false); assert.equal(f.requests.length, 0); resolveReady(); await binding;
  assert.equal(f.requests.length, 0); assert.equal(f.model.getSnapshot().dateTime, undefined); f.model.dispose();
});
test('reads only original no-store status and uses canonical age boundaries', async () => {
  const f = fixture(); await f.model.bind(Promise.resolve(), () => true);
  assert.equal(String(f.requests[0][0]), 'https://site.invalid/sub/__app-shell-update-status__');
  assert.deepEqual(f.requests[0][1], {cache: 'no-store'});
  assert.equal(f.model.getSnapshot().text, 'zh:brand.updatedAgo:1min');
  assert.equal(f.model.getSnapshot().dateTime, new Date(1000).toISOString());
  assert.equal([...f.timers.values()][0].ms, 60000);
  f.advance(60000); [...f.timers.values()][0].fn(); assert.equal(f.model.getSnapshot().text, 'zh:brand.updatedAgo:2min');
  f.locale('en'); assert.equal(f.model.getSnapshot().text, 'en:brand.updatedAgo:2min');
  f.model.dispose(); assert.equal(f.timers.size, 0);
});
test('fresh install or invalid status never invents a last-update timestamp', async () => {
  for (const status of [{updated: false, appliedAt: 1000}, {updated: true, appliedAt: -1}, null]) {
    const f = fixture(async () => ({ok: true, json: async () => status}));
    await f.model.bind(Promise.resolve(), () => true); assert.equal(f.model.getSnapshot().dateTime, undefined); assert.equal(f.timers.size, 0); f.model.dispose();
  }
});
test('disposal and superseded bindings cannot publish delayed status', async () => {
  let resolveJson; const delayed = new Promise(r => {resolveJson = r;});
  const f = fixture(async () => ({ok: true, json: () => delayed}));
  const old = f.model.bind(Promise.resolve(), () => true); await new Promise(r => setImmediate(r));
  await f.model.bind(Promise.resolve(), () => false); resolveJson({updated: true, appliedAt: 1000}); await old;
  assert.equal(f.model.getSnapshot().dateTime, undefined); f.model.dispose();
});
