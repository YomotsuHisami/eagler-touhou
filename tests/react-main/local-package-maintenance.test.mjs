import {authoredSourcesPlugin} from './authored-sources.mjs';
/** Supplemental scheduling/port fixtures for original app1396–1468; no browser or real storage acceptance. */
import test, {before, after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir, mkdtemp, rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {build} from 'esbuild';

const project = fileURLToPath(new URL('../../', import.meta.url));
let work, createLocalPackageMaintenance;
before(async () => {
  await mkdir(resolve(project, '.cache'), {recursive: true});
  work = await mkdtemp(resolve(project, '.cache/react-main-maintenance-'));
  const outfile = resolve(work, 'actual-service.mjs');
  await build({absWorkingDir: project, entryPoints: ['app/services/local-package-maintenance.ts'], outfile,
    bundle: true, platform: 'node', format: 'esm', packages: 'external', logLevel: 'silent',
    plugins: [authoredSourcesPlugin(project)],
  });
  ({createLocalPackageMaintenance} = await import(pathToFileURL(outfile).href));
});
after(async () => {if (work) await rm(work, {recursive: true, force: true});});
const flush = async () => {for (let i = 0; i < 40; i++) await Promise.resolve();};
function fixture(overrides = {}) {
  const frames = new Map(), timers = new Map(), events = [];
  let serial = 0;
  const scheduler = {
    requestFrame(fn) {const id = ++serial; frames.set(id, fn); return id;}, cancelFrame(id) {frames.delete(id);},
    setTimer(fn) {const id = ++serial; timers.set(id, fn); return id;}, clearTimer(id) {timers.delete(id);},
  };
  const generation = {descriptor: {revision: 'installed-r1'}};
  const feature = {
    async migrateLegacyStoredImport(game, input) {events.push(['migrate', game, input]); return {status: 'migrated'};},
    async installParsedPackageZip(parsed) {events.push(['install', parsed]); return {committed: true};},
  };
  let available = {th07: {gameData: {version: 'legacy'}}};
  const options = {getGames: () => available, origin: 'https://example.invalid', scheduler,
    onInstalled: (game, hint) => events.push(['hint', game, hint]), onHydrated: () => events.push(['hydrated']),
    logger: {info: (...args) => events.push(['info', ...args]), warn: (...args) => events.push(['warn', ...args])},
    dependencies: {loadPackageFeature: async () => {events.push(['load']); return feature;},
      readCurrent: async game => {events.push(['read', game]); return {generation};},
      garbageCollect: async () => {events.push(['gc']); return {generationsDeleted: 0, objectsDeleted: 0};}},
  };
  Object.assign(options, overrides);
  const service = createLocalPackageMaintenance(options);
  const runFrame = () => {for (const [id, fn] of [...frames]) {frames.delete(id); fn();}};
  const runTimer = async () => {for (const [id, fn] of [...timers]) {timers.delete(id); fn();} await flush();};
  return {service, options, feature, events, frames, timers, generation, setGames: value => {available = value;}, runFrame, runTimer};
}

test('construction does no I/O; schedule coalesces and waits a painted frame plus timer', async () => {
  const f = fixture();
  assert.deepEqual(f.events, []);
  f.service.schedule(); f.service.schedule();
  assert.equal(f.frames.size, 1); assert.deepEqual(f.events, []);
  f.runFrame(); assert.equal(f.timers.size, 1); assert.deepEqual(f.events, []);
  await f.runTimer();
  assert.deepEqual(f.events.map(e => e[0]), ['load', 'read', 'migrate', 'read', 'hint', 'info', 'read', 'hint', 'gc', 'hydrated']);
  const input = f.events.find(e => e[0] === 'migrate')[2];
  assert.equal(input.protocol, 'eagler-touhou/1'); assert.equal(input.origin, 'https://example.invalid');
  assert.equal(input.currentRevision, 'installed-r1'); assert.deepEqual(input.fallbackGameData, {version: 'legacy'});
  const parsed = {opaque: 'canonical input'}; await input.install(parsed);
  assert.deepEqual(f.events.at(-1), ['install', parsed]);
  f.service.dispose();
});

test('incomplete and failed migration preserve compatibility ownership and do not stop later games or GC', async () => {
  const f = fixture(); f.setGames({th06: {}, th07: {}, th08: {}});
  f.feature.migrateLegacyStoredImport = async game => {
    f.events.push(['migrate', game]);
    if (game === 'th06') return {status: 'incomplete', missing: 'data'};
    if (game === 'th07') throw new Error('canonical install rejected');
    return {status: 'already-current'};
  };
  f.service.schedule(); f.runFrame(); await f.runTimer();
  assert.deepEqual(f.events.filter(e => e[0] === 'migrate').map(e => e[1]), ['th06', 'th07', 'th08']);
  assert.equal(f.events.filter(e => e[0] === 'warn').length, 2);
  assert.equal(f.events.filter(e => e[0] === 'hint' && e[1] === 'th08').length, 2);
  assert.equal(f.events.filter(e => e[0] === 'hint' && e[1] === 'th06').length, 1);
  assert.deepEqual(f.events.slice(-2).map(e => e[0]), ['gc', 'hydrated']);
  f.service.dispose();
});

test('Host success during running maintenance requests one deferred rerun with latest games', async () => {
  const f = fixture(); let release;
  const held = new Promise(resolve => {release = resolve;});
  f.feature.migrateLegacyStoredImport = async game => {f.events.push(['migrate', game]); await held; return {status: 'absent'};};
  f.service.schedule(); f.runFrame(); await f.runTimer();
  f.setGames({th08: {}});
  f.service.schedule(); f.service.schedule(); f.runFrame(); await f.runTimer();
  assert.equal(f.events.filter(e => e[0] === 'migrate').length, 1);
  release(); await flush();
  assert.equal(f.frames.size, 1);
  f.runFrame(); await f.runTimer();
  assert.deepEqual(f.events.filter(e => e[0] === 'migrate').map(e => e[1]), ['th07', 'th08']);
  assert.equal(f.events.filter(e => e[0] === 'load').length, 1);
  f.service.dispose();
});

test('disposal cancels queued work and suppresses late hints/GC without interrupting canonical migration', async () => {
  const queued = fixture(); queued.service.schedule(); queued.service.dispose(); queued.runFrame(); await queued.runTimer();
  assert.deepEqual(queued.events, []);
  const f = fixture(); let release;
  f.feature.migrateLegacyStoredImport = async () => {await new Promise(resolve => {release = resolve;}); f.events.push(['commit-finished']); return {status: 'migrated'};};
  f.service.schedule(); f.runFrame(); await f.runTimer();
  f.service.dispose(); release(); await flush();
  assert.equal(f.events.at(-1)[0], 'commit-finished');
  assert.equal(f.events.some(e => ['hint', 'gc', 'hydrated'].includes(e[0])), false);
});

test('canonical read and GC failures remain non-blocking and retain prior hints', async () => {
  const f = fixture(); f.options.dependencies.readCurrent = async () => {throw new Error('slow or unavailable IDB');};
  // Dependencies are captured at construction, so make another actual owner with the supplied failure ports.
  f.service.dispose();
  f.options.dependencies.garbageCollect = async () => {throw new Error('GC failure');};
  const service = createLocalPackageMaintenance(f.options);
  service.schedule(); f.runFrame(); await f.runTimer();
  assert.equal(f.events.some(e => e[0] === 'hint'), false);
  assert.equal(f.events.at(-1)[0], 'hydrated');
  service.dispose();
});
