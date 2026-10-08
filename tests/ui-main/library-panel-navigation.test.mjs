/** Public Router receipts and source identity checks; no browser/device claim. */
import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import {mkdtemp, rm, writeFile, readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {build} from 'esbuild';
const root = fileURLToPath(new URL('../..', import.meta.url));
const bundle = await build({stdin: {contents: `export * from './app/services/library-panel-navigation'; export * from './app/runtime/route-session.mts';`, resolveDir: root, loader: 'ts'}, bundle: true, platform: 'browser', format: 'esm', write: false});
const folder = await mkdtemp(join(tmpdir(), 'ui-library-panel-')); after(() => rm(folder, {recursive: true, force: true}));
const file = join(folder, 'entry.mjs'); await writeFile(file, bundle.outputFiles[0].text);
const {createLibraryPanelNavigation, libraryPanelParent, libraryPanelProduct, multiplayerDirectoryAddress, productManagementRoute} = await import(pathToFileURL(file).href);
const base = {pathname: '/', search: '?filter=single&uiLocale=en', hash: '#shelf', key: 'library', state: null};
const address = pathname => ({pathname, search: base.search, hash: base.hash});
const deferred = () => {let resolve; const promise = new Promise(done => {resolve = done;}); return {promise, resolve};};
function fixture(location = base) {
  const calls = []; let current = {location, navigation: {state: 'idle'}};
  const owner = createLibraryPanelNavigation('test', (target, options) => {const gate = deferred(); calls.push({target, options, gate}); return gate.promise;}, current);
  const update = next => {current = next; owner.update(next);};
  const entry = (index = calls.length - 1) => ({...calls[index].target, state: calls[index].options?.state, key: `entry-${index}`});
  const pending = (index = calls.length - 1) => update({location: current.location, navigation: {state: 'loading', location: entry(index)}});
  async function commit(index = calls.length - 1) {update({location: entry(index), navigation: {state: 'idle'}}); calls[index].gate.resolve(); await Promise.resolve();}
  return {owner, calls, update, entry, pending, commit};
}
test('panel and Runtime recognize exactly the same supported product child routes', () => {
  for (const product of ['th06', 'th11', 'th06mp', 'th09mp', 'th20', 'unknown', '%74h06']) for (const tail of ['', '/', '/resources', '/replays', '/saves', '/extra', '/resources/extra']) {
    const pathname = `/play/${product}${tail}`; assert.equal(libraryPanelProduct(pathname), productManagementRoute(pathname), pathname);
  }
});
test('cold opening is eager, repeated clicks share one receipt, and immediate Escape waits for the exact committed push', async () => {
  const f = fixture(); f.owner.open(address('/play/th06')); f.owner.open(address('/play/th06')); assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].options.flushSync, true); assert.equal(f.calls[0].options.preventScrollReset, true);
  f.pending(); f.owner.close(); f.owner.close(); assert.equal(f.calls.length, 1);
  await f.commit(); assert.equal(f.calls.length, 2); assert.equal(f.calls[1].target, -1);
});
test('promise resolution alone cannot close before its matching location commits', async () => {
  const f = fixture(); f.owner.open(address('/play/th06')); f.pending(); f.owner.close(); f.calls[0].gate.resolve(); await Promise.resolve(); assert.equal(f.calls.length, 1);
  await f.commit(); assert.equal(f.calls[1].target, -1);
});
test('browser Back, newer navigation and disposal defeat a stale lazy-route dismissal', async () => {
  for (const kind of ['back', 'newer', 'dispose']) {
    const f = fixture(); f.owner.open(address('/play/th06')); f.pending(); f.owner.close();
    if (kind === 'dispose') f.owner.dispose();
    else f.update({location: {...base, key: 'newer', search: '?newer=1'}, navigation: kind === 'newer' ? {state: 'loading', location: {...base, pathname: '/lobby', key: 'lobby'}} : {state: 'idle'}});
    f.calls[0].gate.resolve(); await Promise.resolve(); assert.equal(f.calls.length, 1, kind);
  }
});
test('settings → resources → Replay → saves dismisses to settings before restoring original library history', async () => {
  const f = fixture(); f.owner.open(address('/play/th06')); await f.commit();
  f.owner.open(address('/play/th06/resources')); await f.commit();
  f.owner.open(address('/play/th06/replays')); await f.commit();
  f.owner.open(address('/play/th06/saves')); await f.commit();
  f.owner.close(); assert.deepEqual(f.calls[4].target, address('/play/th06')); assert.equal(f.calls[4].options.replace, true);
  await f.commit(4); f.owner.close(); assert.equal(f.calls[5].target, -4);
});
test('one child push returns to the exact settings entry, including query and hash', async () => {
  const f = fixture(); f.owner.open(address('/play/th06')); await f.commit(); const settings = f.entry();
  f.owner.open(address('/play/th06/resources')); await f.commit(); f.owner.close(); assert.equal(f.calls[2].target, -1);
  f.update({location: settings, navigation: {state: 'idle'}}); f.owner.close(); assert.equal(f.calls[3].target, -1);
});
test('direct child links and old-document state replace safely to settings, then library', async () => {
  const direct = {...base, ...address('/play/th06/saves'), state: {libraryPanelRequestId: 'old-document-9', keep: 'value'}};
  const f = fixture(direct); f.owner.close(); assert.deepEqual(f.calls[0].target, address('/play/th06')); assert.equal(f.calls[0].options.replace, true); assert.deepEqual(f.calls[0].options.state, {keep: 'value'});
  await f.commit(); f.owner.close(); assert.deepEqual(f.calls[1].target, address('/')); assert.equal(f.calls[1].options.replace, true);
});
test('a cancelled root draft/Runtime blocker does not permanently disable a later dismissal', async () => {
  const f = fixture({...base, ...address('/play/th06')}); f.owner.close(); f.owner.close(); assert.equal(f.calls.length, 1);
  f.calls[0].gate.resolve(); await Promise.resolve(); f.owner.close(); assert.equal(f.calls.length, 2);
});
test('a rapid reopen reverses pending dismissal without pushing or later applying stale Back', async () => {
  const f = fixture(); f.owner.open(address('/play/th06')); f.pending(); f.owner.close(); f.owner.open(address('/play/th06')); await f.commit(); assert.equal(f.calls.length, 1);
  f.owner.close(); assert.equal(f.calls[1].target, -1);
});
test('switching product while lazy code is pending pushes from the committed library, never the unfinished product', async () => {
  const f = fixture(); f.owner.open(address('/play/th06')); f.pending(); f.owner.close(); f.owner.open(address('/play/th07')); f.calls[0].gate.resolve(); await f.commit(1); f.owner.close(); assert.equal(f.calls[2].target, -1);
});
test('direct fallback preserves user context but strips transient panel and room ownership', () => {
  assert.deepEqual(libraryPanelParent({pathname: '/play/th06', search: '?filter=a%2Bb&uiLocale=en&panel=help&touchLayout=1&mpRoom=1234&room=1234&titleRoom=1', hash: '#kept'}), {pathname: '/', search: '?filter=a%2Bb&uiLocale=en', hash: '#kept'});
});
test('Multiplayer card target filters the lobby while retaining locale/context and clearing stale room panels', () => {
  assert.deepEqual(multiplayerDirectoryAddress('th07mp', '?uiLocale=en&filter=single&game=th06&mpRoom=1234&room=1234&titleRoom=1&touchLayout=1&panel=help&lobbyDialog=create&roomPanel=share&roomOptions=1'), {
    pathname: '/lobby', search: '?uiLocale=en&filter=single&game=th07mp', hash: '',
  });
});
test('one pathless layout retains the real library and shared modal; providers/frame stay above it', async () => {
  const routes = await readFile(join(root, 'app/routes.ts'), 'utf8'), library = await readFile(join(root, 'app/routes/library.tsx'), 'utf8'), game = await readFile(join(root, 'app/routes/game.tsx'), 'utf8'), app = await readFile(join(root, 'app/root.tsx'), 'utf8');
  assert.match(routes, /layout\('routes\/library.tsx'/); assert.match(library, /<GameLibrary activeProductId=/);
  assert.equal((library.match(/<AnimatedDialog\s/g) ?? []).length, 1); assert.match(library, /useOutlet\(\)/);
  assert.doesNotMatch(game, /max-w-3xl|<GameLibrary|<RuntimeProvider|createRuntimeService|useBlocker/);
  assert.ok(app.indexOf('<GlobalHelpPanel/>') > app.indexOf('<LauncherShell>'), 'direct-link Help mounts above the primary modal');
  assert.equal((app.match(/<RuntimeProvider>/g) ?? []).length, 1);
});
