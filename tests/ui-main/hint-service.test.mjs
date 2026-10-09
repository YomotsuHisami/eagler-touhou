/** TH10 hint-file policy tests using a synthetic Runtime file session only. */
import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import {existsSync} from 'node:fs';
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {build} from 'esbuild';
const root = fileURLToPath(new URL('../..', import.meta.url));
await mkdir(join(root, '.cache'), {recursive: true});
const directory = await mkdtemp(join(root, '.cache/ui-hints-test-'));
after(() => rm(directory, {recursive: true, force: true}));
const bundle = await build({stdin: {contents: "export * from './app/services/hints.client.ts';", resolveDir: root}, bundle: true, format: 'esm', platform: 'node', packages: 'external', write: false,
  plugins: [{name: 'authored-mts-contracts', setup(builder) {
    builder.onResolve({filter: /\.mjs$/}, args => {
      if (!args.path.startsWith('.')) return;
      const path = resolve(dirname(args.importer), args.path).replace(/\.mjs$/, '.mts');
      if (path.startsWith(join(root, 'src') + '/') && existsSync(path)) return {path};
    });
  }}]});
const modulePath = join(directory, 'hints.mjs'); await writeFile(modulePath, bundle.outputFiles[0].text);
const {createHintController} = await import(pathToFileURL(modulePath).href);
function deferred() {let resolve, reject; const promise = new Promise((yes, no) => {resolve = yes; reject = no;}); return {promise, resolve, reject};}
function upload(name, values) {const bytes = Uint8Array.from(values); return {name, size: bytes.length, async arrayBuffer() {return bytes.slice().buffer;}};}
function fileIdentity(game, runtimeVariant = 'normal') {
  if (!game) return {runtimeVariant: undefined, saveRoot: null, scoreFile: null};
  return {runtimeVariant, saveRoot: `/saves${game}`, scoreFile: ['th10', 'th11', 'th15', 'th20'].includes(game) ? `score${game}.dat` : 'score.dat'};
}
function fixture({initial = {}, game = null, runtimeVariant = 'normal', phase = 'idle', launched = false, closeResult = true} = {}) {
  const persisted = new Map(Object.entries(initial).map(([path, bytes]) => [path, Uint8Array.from(bytes)]));
  let files = new Map([...persisted].map(([path, bytes]) => [path, bytes.slice()]));
  let live = {game, ...fileIdentity(game, game ? runtimeVariant : undefined), phase, epoch: phase === 'idle' ? null : 1,
    ready: phase !== 'idle', launched, saveUnavailable: false, fileOperationBusy: false};
  let lease = null; const listeners = new Set(), calls = [];
  const change = patch => {
    live = {...live, ...patch};
    if (Object.hasOwn(patch, 'game')) Object.assign(live, fileIdentity(patch.game, patch.game ? patch.runtimeVariant ?? 'normal' : undefined));
    for (const listener of [...listeners]) listener();
  };
  function access(owner, epoch, identity, readOnly) {
    const check = () => {
      const identityMatches = live.game === identity.game && live.runtimeVariant === identity.runtimeVariant &&
        live.saveRoot === identity.saveRoot && live.scoreFile === identity.scoreFile;
      const phaseAllowed = live.phase === 'prepared' && !live.launched || readOnly && live.phase === 'running' && live.launched;
      if (lease !== owner || live.epoch !== epoch || !identityMatches || !phaseAllowed || !live.ready || live.saveUnavailable) throw new Error('Session replaced');
    };
    return {
      epoch,
      async sync() {check(); calls.push(['sync', epoch]); check();},
      async send(command, payload) {
        check();
        if (readOnly && !['list', 'read'].includes(command)) throw new Error('Read-only Runtime file session');
        calls.push([command, payload, epoch]);
        if (command === 'list') return {files: [...files].map(([path, bytes]) => ({path, size: bytes.length}))};
        if (command === 'read') {if (!files.has(payload.path)) throw new Error('Missing file'); return {bytes: [...files.get(payload.path)]};}
        if (command === 'write') {files.set(payload.path, Uint8Array.from(payload.bytes)); persisted.set(payload.path, Uint8Array.from(payload.bytes)); return {ok: true};}
        if (command === 'remove') {files.delete(payload.path); persisted.delete(payload.path); return {ok: true};}
        throw new Error('Unexpected file command');
      },
      async restart() {
        if (readOnly) throw new Error('Read-only Runtime file session cannot restart');
        check(); calls.push(['restart', epoch]);
        const next = epoch + 1; change({phase: 'loading', ready: false, launched: false});
        files = new Map([...persisted].map(([path, bytes]) => [path, bytes.slice()]));
        change({game: identity.game, runtimeVariant: identity.runtimeVariant, epoch: next, phase: 'prepared', ready: true});
        return access(owner, next, identity, readOnly);
      },
      async retire() {check();calls.push(['retire',epoch]);change({phase:'idle',game:null,epoch:null,ready:false,launched:false});},
    };
  }
  const runtime = {
    getSnapshot: () => live,
    subscribe(listener) {listeners.add(listener); return () => listeners.delete(listener);},
    async close() {calls.push(['close']); if (!closeResult) return false; change({phase: 'idle', epoch: null, ready: false, launched: false, game: null}); return true;},
    withFileSession(gameId, operation, options = {}) {
      const readOnly = options.readOnly === true, runtimeVariant = options.runtimeVariant ?? 'normal';
      const identity = {game: gameId, ...fileIdentity(gameId, runtimeVariant)};
      const runningRead = readOnly && live.phase === 'running' && live.launched;
      if (lease || live.game !== gameId || live.runtimeVariant !== runtimeVariant || live.saveRoot !== identity.saveRoot || live.scoreFile !== identity.scoreFile ||
          (options.epoch !== undefined && live.epoch !== options.epoch) || (!runningRead && (live.phase !== 'prepared' || live.launched)) ||
          !live.ready || live.saveUnavailable) return Promise.reject(new Error('Runtime unavailable'));
      const owner = lease = {};
      change({fileOperationBusy: true});
      return Promise.resolve().then(() => operation(access(owner, live.epoch, identity, readOnly)))
        .finally(() => {if (lease === owner) {lease = null; change({fileOperationBusy: false});}});
    },
  };
  return {runtime, calls, files: () => files, persisted, get live() {return live;}, change};
}
function setup(t, options = {}) {
  const h = fixture(options), controller = createHintController({runtimeService: h.runtime,
    prepareProduct: async product => {h.calls.push(['prepare', product]); h.change({game: 'th10', epoch: (h.live.epoch ?? 0) + 1, phase: 'prepared', ready: true, launched: false});}});
  t.after(() => controller.dispose()); controller.loadProduct('th10'); return {runtime: h.runtime, calls: h.calls, files: h.files, persisted: h.persisted,
    get live() {return h.live;}, change: h.change, controller, state: () => controller.getSnapshot('th10')};
}

test('hint controls are declared only for products with hint paths', async t => {
  const h = setup(t);
  assert.equal(h.controller.getSnapshot('th10').supported, true);
  h.controller.loadProduct('th06');
  assert.equal(h.controller.getSnapshot('th06').supported, false);
  await assert.rejects(h.controller.importFile('th06', upload('user.txt', [1])), /没有可管理的提示文件/);
  await assert.rejects(h.controller.deleteFiles('th06'), /没有可管理的提示文件/);
  assert.deepEqual(h.calls, []);
});

test('TH10 accepts bounded .txt uploads to hint_user and verifies the exact bytes after same-session Runtime restart', async t => {
  const h = setup(t, {initial: {'hint/hint_user.txt': [4], 'hint/hint_auto.txt': [8], 'scoreth10.dat': [9]}});
  const result = await h.controller.importFile('th10', upload('notes.TXT', [0, 1, 127, 255]));
  assert.equal(result, 'hint/hint_user.txt');
  assert.deepEqual([...h.persisted.get('hint/hint_user.txt')], [0, 1, 127, 255]);
  assert.deepEqual([...h.persisted.get('hint/hint_auto.txt')], [8]);
  assert.deepEqual([...h.persisted.get('scoreth10.dat')], [9]);
  assert.deepEqual(h.calls.filter(([name]) => ['prepare', 'sync', 'write', 'restart', 'read'].includes(name)).map(([name]) => name), ['prepare', 'sync', 'write', 'restart', 'read']);
  assert.equal(h.live.phase, 'idle'); assert.equal(h.live.launched, false);
  assert.equal(h.state().notice, 'imported'); assert.equal(h.state().busy, null);
});

test('invalid hint uploads reject before Runtime preparation or writes', async t => {
  const h = setup(t);
  for (const file of [upload('notes.dat', [1]), upload('empty.txt', []), upload('oversized.txt', new Uint8Array(16 * 1024 * 1024 + 1))]) {
    await assert.rejects(h.controller.importFile('th10', file));
  }
  assert.deepEqual(h.calls, []); assert.deepEqual([...h.persisted.keys()], []);
  await assert.rejects(h.controller.importFile('th10', {...upload('changed.txt', [1]), size: 2}), /大小发生变化/);
  assert.equal(h.calls.some(([name]) => name === 'write'), false);
});

test('delete removes only declared hint files and verifies both are absent after reload', async t => {
  const h = setup(t, {initial: {'hint/hint_user.txt': [1], 'hint/hint_auto.txt': [2], 'scoreth10.dat': [9], 'replay/th10_01.rpy': [7]}});
  const removed = await h.controller.deleteFiles('th10');
  assert.deepEqual(removed, ['hint/hint_user.txt', 'hint/hint_auto.txt']);
  assert.equal(h.persisted.has('hint/hint_user.txt'), false); assert.equal(h.persisted.has('hint/hint_auto.txt'), false);
  assert.equal(h.persisted.has('scoreth10.dat'), true); assert.equal(h.persisted.has('replay/th10_01.rpy'), true);
  assert.deepEqual(h.calls.filter(([name]) => name === 'remove').map(([, payload]) => payload.path), ['hint/hint_user.txt', 'hint/hint_auto.txt']);
  assert.equal(h.state().notice, 'deleted'); assert.equal(h.live.phase, 'idle');
});

test('running TH10 is saved and retired before hint mutation; a refused close leaves files intact', async t => {
  const h = setup(t, {initial: {'hint/hint_user.txt': [1]}, game: 'th10', phase: 'running', launched: true});
  await h.controller.importFile('th10', upload('new.txt', [5]));
  assert.ok(h.calls.findIndex(([name]) => name === 'close') < h.calls.findIndex(([name]) => name === 'prepare'));
  assert.ok(h.calls.findIndex(([name]) => name === 'prepare') < h.calls.findIndex(([name]) => name === 'write'));
  const rejected = setup(t, {initial: {'hint/hint_user.txt': [1]}, game: 'th10', phase: 'running', launched: true, closeResult: false});
  await assert.rejects(rejected.controller.importFile('th10', upload('new.txt', [5])), /没有更改/);
  assert.deepEqual([...rejected.persisted.get('hint/hint_user.txt')], [1]);
  assert.equal(rejected.calls.some(([name]) => name === 'prepare' || name === 'write'), false);
});

test('an active import excludes a second file action while decoding; dismissed observers do not mutate twice', async t => {
  const h = setup(t), gate = deferred();
  const first = h.controller.importFile('th10', {name: 'first.txt', size: 1, arrayBuffer: () => gate.promise});
  await Promise.resolve(); await Promise.resolve();
  assert.equal(h.state().busy, 'import');
  await assert.rejects(h.controller.deleteFiles('th10'), /等待/);
  gate.resolve(Uint8Array.of(3).buffer); await first;
  assert.deepEqual([...h.persisted.get('hint/hint_user.txt')], [3]);
  assert.equal(h.calls.filter(([name]) => name === 'write').length, 1);
});

test('TH10 multiplayer Hint publishes busy and errors only to its own product state', async t => {
  const h = fixture({game:'th10',runtimeVariant:'multiplayer',phase:'prepared'}), gate = deferred();
  const controller = createHintController({runtimeService:h.runtime});t.after(()=>controller.dispose());
  controller.loadProduct('th10');controller.loadProduct('th10mp');
  const pending = controller.importFile('th10mp',{name:'hint.txt',size:1,arrayBuffer:()=>gate.promise});
  const rejected = assert.rejects(pending,/decode failed/);
  assert.equal(controller.getSnapshot('th10mp').busy,'import');assert.equal(controller.getSnapshot('th10').busy,null);
  gate.reject(new Error('decode failed'));await rejected;
  assert.equal(controller.getSnapshot('th10mp').busy,null);assert.equal(controller.getSnapshot('th10mp').error,'decode failed');
  assert.equal(controller.getSnapshot('th10').error,null);
});
