/** Adapter regression against main app6220–6440/6850–6889 event order.
 * Synthetic Runtime/file ports only: no native persistence/browser/download PASS.
 * Original main tests remain unchanged. No abandoned candidate tests imported. */
import test, {before, after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir, mkdtemp, rm} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {resolve, dirname} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {build} from 'esbuild';
const project = fileURLToPath(new URL('../../', import.meta.url));
let work, createFileActions, createReplayMutationQueue;
before(async () => {
  await mkdir(resolve(project, '.cache'), {recursive: true});
  work = await mkdtemp(resolve(project, '.cache/files-main-'));
  const outfile = resolve(work, 'files.mjs');
  await build({absWorkingDir: project, stdin: {resolveDir: project, loader: 'ts', contents:
    `export {createFileActions} from './app/services/files.ts'; export {createReplayMutationQueue} from './src/launcher/replay-files.mts';`},
    bundle: true, platform: 'node', format: 'esm', packages: 'external', outfile, logLevel: 'silent',
    plugins: [{name: 'main-authored-siblings', setup(ctx) {
      ctx.onResolve({filter: /^\.\.?\/.*\.mjs$/}, args => {
        const path = resolve(dirname(args.importer), args.path), authored = path.slice(0, -4) + '.mts';
        if (path.startsWith(resolve(project, 'src') + '/') && existsSync(authored)) return {path: authored};
      });
    }}]});
  ({createFileActions, createReplayMutationQueue} = await import(pathToFileURL(outfile).href));
});
after(async () => {if (work) await rm(work, {recursive: true, force: true});});
function fixture({ready = true, launched = false, confirm = true, corrupt = false, keepHint = false, prepareReady = Promise.resolve(), assertImportOwnership = () => {}, capturePresentation = false, editionStores = null} = {}) {
  const events = [], stored = new Map(), downloads = [], feedback = [], decisions = [];
  const state = {ready, launched};
  let picked = null, locked = false, managerOpen = false, retired = false;
  let active = 1, importContext = 'initial', activeEdition = null;
  const mutations = createReplayMutationQueue(), capturedContexts = [], completedContexts = [], presentationGuards = [];
  function access(epoch) {
    const assertCurrent = () => {assert.equal(retired, false); assert.equal(epoch, active); assert.equal(locked, true);};
    return {
      epoch,
      async sync() {assertCurrent(); events.push('sync');},
      async send(command, payload) {
        assertCurrent(); events.push(`${command}:${payload.path ?? ''}`);
        if (command === 'write') {stored.set(payload.path, [...payload.bytes]); return {};}
        if (command === 'remove') {if (!keepHint) stored.delete(payload.path); return {};}
        if (command === 'list') return {files: [...stored].map(([path, bytes]) => ({path, size: bytes.length}))};
        if (!stored.has(payload.path)) throw Object.assign(new Error('missing'), {errno: 44});
        return {bytes: corrupt && active > 1 ? [255] : stored.get(payload.path)};
      },
      async restart({sync = true} = {}) {assertCurrent(); events.push(`restart:sync=${sync}`); active++; return access(active);},
      async retire() {assertCurrent(); events.push('retire'); retired = true; state.ready = false; state.launched = false;},
    };
  }
  const actions = createFileActions({
    runtime: {
      getSnapshot: () => state,
      async withFileSession(game, operation, options) {
        assert.equal(locked, false, 'all accesses use a single exclusive owner');
        locked = true; events.push(`lock:${game}:${options.runtimeVariant}`);
        try {return await operation(access(active));} finally {events.push('unlock'); locked = false;}
      },
    },
    async prepareFiles(product, {retireRunning = false, ownsPresentation, edition} = {}) {
      if(editionStores){activeEdition=edition;events.push(`edition:${edition}`);stored.clear();for(const [path,data] of editionStores[edition])stored.set(path,[...data]);}
      if (ownsPresentation) presentationGuards.push(ownsPresentation);
      assert.equal(locked, false); events.push(`prepare:${product}:retire=${retireRunning}`);
      if (retireRunning && state.launched) {events.push('live-sync', 'live-retire'); state.launched = false;}
      state.ready = true; retired = false; await prepareReady;
    },
    async releasePrepared(product) {if(editionStores&&activeEdition){editionStores[activeEdition].clear();for(const [path,data] of stored)editionStores[activeEdition].set(path,[...data]);}assert.equal(locked, false); events.push(`release:${product}`); state.ready = false; retired = true;},
    translate: (key, params) => key + (params ? JSON.stringify(params) : ''),
    async confirm(decision) {events.push('confirm'); decisions.push(decision); return confirm;},
    async pickFile(accept) {events.push(`pick:${accept}`); return picked;},
    download(name, bytes, mime) {events.push('download'); downloads.push({name, bytes: [...new Uint8Array(bytes)], mime});},
    feedback: Object.fromEntries(['toast', 'status', 'playerStatus'].map(kind => [kind, value => feedback.push([kind, value])])),
    replayManager: {
      async open() {managerOpen = true;},
      async refresh() {assert.equal(locked, false, 'manager refresh after native file lock releases'); events.push('manager-refresh');},
      isOpen: () => managerOpen,
      close() {managerOpen = false; events.push('manager-close');},
    },
    replayMutations: mutations,
    captureImportContext(product) {
      const context = importContext; capturedContexts.push(context);
      return {...(capturePresentation ? {ownsPresentation: () => context === importContext} : {}), assertRuntimeOwnership() {assertImportOwnership(context);}, complete() {completedContexts.push(context); events.push(`imported:${product}`);}};
    },
  });
  return {actions, events, stored, downloads, feedback, decisions, state, mutations, capturedContexts, completedContexts, presentationGuards, setImportContext(value) {importContext = value;}, pick(file) {picked = file;}, managerOpen() {managerOpen = true;}};
}
const save = () => new File([new Uint8Array([3, 7, 9])], 'any.dat');
test('save import flushes active writer then writes/reopens/verifies before success', async () => {
  const f = fixture({launched: true});
  await f.actions.importFile('save', save(), 'th10');
  assert.deepEqual(f.events, ['prepare:th10:retire=true', 'live-sync', 'live-retire', 'lock:th10:normal',
    'write:scoreth10.dat', 'restart:sync=false', 'read:scoreth10.dat', 'retire', 'unlock', 'imported:th10']);
  assert.deepEqual(f.stored.get('scoreth10.dat'), [3, 7, 9]);
  assert.ok(f.feedback.some(([, text]) => text === 'file.importedRestart{"count":1}'));
});
test('failed reopen verification never retires as success or announces imported', async () => {
  const f = fixture({corrupt: true});
  await assert.rejects(f.actions.importFile('save', save(), 'th06'), /file.saveVerifyFailed/);
  assert.equal(f.events.includes('retire'), false);
  assert.equal(f.events.some(x => x.startsWith('imported:')), false);
  assert.equal(f.feedback.some(([, x]) => x.startsWith('file.importedRestart')), false);
});
test('overwrite decision precedes picker; cancellation performs no file preparation', async () => {
  const f = fixture({confirm: false});
  await f.actions.run('import-save', 'th06');
  assert.deepEqual(f.events, ['confirm']);
  assert.equal(f.decisions[0].message, 'file.importSaveOverwrite');
  assert.equal(f.decisions[0].tone, 'danger');
});
test('picker cancellation after overwrite leaves existing runtime untouched', async () => {
  const f = fixture();
  await f.actions.run('import-save', 'th06');
  assert.deepEqual(f.events, ['confirm', 'pick:.dat']);
});
test('live export flushes and downloads while retaining original owner', async () => {
  const f = fixture({launched: true}); f.stored.set('score.dat', [1, 2]);
  await f.actions.run('export-save', 'th06mp');
  assert.deepEqual(f.events, ['prepare:th06mp:retire=false', 'lock:th06:multiplayer', 'sync', 'read:score.dat', 'download', 'unlock']);
  assert.equal(f.state.launched, true);
  assert.deepEqual(f.downloads, [{name: 'score.dat', bytes: [1, 2], mime: 'application/octet-stream'}]);
});
test('cold export releases temporary owner after lock, before completion feedback', async () => {
  const f = fixture({ready: false}); f.stored.set('score.dat', [1]);
  await f.actions.run('export-save', 'th06');
  assert.deepEqual(f.events.slice(-2), ['unlock', 'release:th06']);
  assert.equal(f.state.ready, false);
});
test('missing score errno44 offers original import choice after cold cleanup', async () => {
  const f = fixture({ready: false});
  await f.actions.run('export-save', 'th06');
  assert.deepEqual(f.events.slice(-3), ['release:th06', 'confirm', 'pick:.dat']);
  assert.equal(f.decisions[0].message, 'file.missingSavePrompt');
  assert.equal(f.feedback.some(([, x]) => x.startsWith('file.exported')), false);
});
test('empty and oversized imports fail before any native preparation', async () => {
  const f = fixture();
  await assert.rejects(f.actions.importFile('save', new File([], 'empty.dat'), 'th06'), /file.emptyImport/);
  await assert.rejects(f.actions.importFile('save', {size: 128 * 1024 * 1024 + 1}, 'th06'), /file.importTooLarge/);
  assert.deepEqual(f.events, []);
});
test('hint delete flushes active writer and verifies absence after reopen', async () => {
  const f = fixture({launched: true}); f.stored.set('hint/hint_user.txt', [1]); f.stored.set('hint/hint_auto.txt', [2]);
  await f.actions.run('delete-hint', 'th10');
  assert.deepEqual(f.events, ['prepare:th10:retire=true', 'live-sync', 'live-retire', 'lock:th10:normal',
    'list:', 'remove:hint/hint_user.txt', 'remove:hint/hint_auto.txt', 'restart:sync=false', 'list:', 'unlock', 'release:th10']);
});
test('failed hint deletion verification cleans temporary owner and reports exact failure', async () => {
  const f = fixture({keepHint: true}); f.stored.set('hint/hint_user.txt', [1]);
  await f.actions.run('delete-hint', 'th10');
  assert.equal(f.events.at(-1), 'release:th10');
  assert.ok(f.feedback.some(([, x]) => x.includes('file.hintDeleteVerifyFailed')));
  assert.equal(f.feedback.some(([, x]) => x === 'file.hintDeleted'), false);
});
test('replay import keeps live owner until write and refreshes manager only after lock release', async () => {
  const f = fixture({launched: true}); f.managerOpen();
  await f.actions.importFile('replay', new File([new Uint8Array([8])], 'th6_01.rpy'), 'th06');
  assert.equal(f.events.includes('live-retire'), false);
  assert.equal(f.events[0], 'prepare:th06:retire=false');
  assert.ok(f.events.some(x => x.startsWith('write:replay/')));
  assert.deepEqual(f.events.slice(-4), ['retire', 'unlock', 'manager-refresh', 'imported:th06']);
});

test('queued Replay imports retain their own invocation completion context', async () => {
  const f = fixture({capturePresentation: true});
  let release;
  const blocker = f.mutations.run(() => new Promise(resolve => {release = resolve;}));
  await Promise.resolve();
  f.setImportContext('first');
  const first = f.actions.importFile('replay', new File([new Uint8Array([8])], 'th6_01.rpy'), 'th06');
  f.setImportContext('second');
  const second = f.actions.importFile('replay', new File([new Uint8Array([9])], 'th6_02.rpy'), 'th06');
  f.setImportContext('newer-player');
  assert.deepEqual(f.capturedContexts, ['first', 'second']);
  assert.deepEqual(f.completedContexts, []);
  release(); await Promise.all([blocker, first, second]);
  assert.deepEqual(f.completedContexts, ['first', 'second'], 'queued completions are per-operation closures, never a replaced global callback');
  assert.equal(f.presentationGuards.length, 2);
  assert.deepEqual(f.presentationGuards.map(owns => owns()), [false, false]);
  f.setImportContext('first'); assert.deepEqual(f.presentationGuards.map(owns => owns()), [true, false], 'preparation retains each enqueue-bound presentation callback');
});

test('an invalid queued import is rejected before preparation can close a newer owner', async () => {
  const f = fixture({launched: true, assertImportOwnership() {throw new Error('superseded import');}});
  await assert.rejects(f.actions.importFile('replay', new File([new Uint8Array([8])], 'th6_01.rpy'), 'th06'), /superseded import/);
  assert.deepEqual(f.events, []); assert.equal(f.state.launched, true);
  assert.deepEqual(f.completedContexts, []);
});
test('import ownership is rechecked after asynchronous preparation before acquiring the native file lock', async () => {
  let release, current = true;
  const prepareReady = new Promise(resolve => {release = resolve;});
  const f = fixture({prepareReady, assertImportOwnership() {if (!current) throw new Error('superseded after preparation');}});
  const pending = f.actions.importFile('replay', new File([new Uint8Array([8])], 'th6_01.rpy'), 'th06');
  await Promise.resolve(); await Promise.resolve();
  assert.deepEqual(f.events, ['prepare:th06:retire=false']);
  current = false; release();
  await assert.rejects(pending, /superseded after preparation/);
  assert.deepEqual(f.events, ['prepare:th06:retire=false'], 'no lock, write, read or retirement follows invalidation');
  assert.deepEqual(f.completedContexts, []); assert.deepEqual(f.feedback, []);
});


test('native clear cancellation never acquires a Runtime or touches files',async()=>{
 const f=fixture({confirm:false});f.stored.set('score.dat',[1,2]);await f.actions.run('clear-save','th06');assert.deepEqual(f.events,['confirm']);assert.deepEqual(f.stored.get('score.dat'),[1,2]);assert.equal(f.decisions[0].tone,'danger');
});
test('native clear removes only the score and verifies durable absence before success',async()=>{
 const f=fixture();f.stored.set('score.dat',[1,2]);f.stored.set('th06.cfg',[3]);f.stored.set('replay/th6_01.rpy',[4]);await f.actions.run('clear-save','th06');
 assert.equal(f.stored.has('score.dat'),false);assert.deepEqual(f.stored.get('th06.cfg'),[3]);assert.deepEqual(f.stored.get('replay/th6_01.rpy'),[4]);
 assert.ok(f.events.indexOf('confirm')<f.events.indexOf('prepare:th06:retire=true'));assert.ok(f.events.indexOf('remove:score.dat')<f.events.indexOf('restart:sync=false'));assert.ok(f.events.indexOf('restart:sync=false')<f.events.indexOf('retire'));assert.ok(f.feedback.some(([,value])=>value==='files.nativeCleared'));
});
test('native clear verification failure never reports successful deletion',async()=>{
 const f=fixture({keepHint:true});f.stored.set('score.dat',[1,2]);await f.actions.run('clear-save','th06');assert.equal(f.stored.has('score.dat'),true);assert.equal(f.feedback.some(([,value])=>value==='files.nativeCleared'),false);assert.equal(f.events.includes('retire'),false);assert.equal(f.events.at(-1),'release:th06');
});
test('native clear checks captured ownership after the decision, before preparing a newer Player',async()=>{
 let calls=0;const f=fixture({assertImportOwnership(){calls++;throw Error('superseded');}});f.stored.set('score.dat',[1,2]);await f.actions.run('clear-save','th06');assert.equal(calls,1);assert.equal(f.events.some(value=>value.startsWith('prepare:')),false);assert.deepEqual(f.stored.get('score.dat'),[1,2]);
});


test('TH10 native clear targets both native editions and preserves each edition’s config and replays',async()=>{
 const editionStores={jp:new Map([['scoreth10.dat',[1]],['th10.cfg',[2]],['replay/th10_01.rpy',[3]]]),chs:new Map([['scoreth10.dat',[4]],['th10.cfg',[5]],['replay/th10_02.rpy',[6]]])};
 const f=fixture({editionStores});await f.actions.run('clear-save','th10');assert.deepEqual(f.events.filter(value=>value.startsWith('edition:')),['edition:jp','edition:chs']);
 for(const edition of ['jp','chs'])assert.equal(editionStores[edition].has('scoreth10.dat'),false);assert.deepEqual(editionStores.jp.get('th10.cfg'),[2]);assert.deepEqual(editionStores.chs.get('th10.cfg'),[5]);assert.deepEqual(editionStores.jp.get('replay/th10_01.rpy'),[3]);assert.deepEqual(editionStores.chs.get('replay/th10_02.rpy'),[6]);
});
