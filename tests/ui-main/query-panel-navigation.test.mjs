import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import {mkdtemp, rm, writeFile, readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
const folder = await mkdtemp(join(tmpdir(), 'ui-query-panels-')); after(() => rm(folder, {recursive: true, force: true}));
const bundled = await build({stdin: {contents: "export * from './app/services/query-panel-navigation';", resolveDir: process.cwd()}, bundle: true, platform: 'browser', format: 'esm', write: false});
await writeFile(join(folder, 'entry.mjs'), bundled.outputFiles[0].text);
const {createQueryPanelNavigation, queryPanelAddress} = await import(pathToFileURL(join(folder, 'entry.mjs')).href);
const base = {pathname: '/play/th06', search: '?uiLocale=en&filter=a%2Bb&filter=two', hash: '#details', key: 'product', state: {keep: 'state'}};
const deferred = () => {let resolve; const promise = new Promise(done => {resolve = done;}); return {promise, resolve};};
function fixture(panel, location = base) {
  const calls = []; let current = {location, navigation: {state: 'idle'}};
  const owner = createQueryPanelNavigation(panel, 'test', (target, options) => {const gate = deferred(); calls.push({target, options, gate}); return gate.promise;}, current);
  function update(value) {current = value; owner.update(value);}
  function entry(index = calls.length - 1) {const call = calls[index]; return {...call.target, key: `entry-${index}`, state: call.options.state};}
  function pending(index = calls.length - 1) {update({location: current.location, navigation: {state: 'loading', location: entry(index)}});}
  async function commit(index = calls.length - 1) {update({location: entry(index), navigation: {state: 'idle'}}); calls[index].gate.resolve(); await Promise.resolve();}
  return {owner, calls, update, entry, pending, commit};
}
for (const panel of ['help', 'donation']) {
  test(`${panel}: preserves query/hash/state, suppresses duplicate push, waits for commit before one dismissal`, async () => {
    const f = fixture(panel); f.owner.open(); f.owner.open(); assert.equal(f.calls.length, 1);
    assert.deepEqual(f.calls[0].target, queryPanelAddress(base, panel)); assert.equal(f.calls[0].options.state.keep, 'state');
    assert.equal(f.calls[0].options.flushSync, true);
    f.pending(); f.owner.close(); f.owner.close(); assert.equal(f.calls.length, 1);
    await f.commit(); assert.equal(f.calls.length, 2); assert.equal(f.calls[1].target, -1);
    f.owner.close(); assert.equal(f.calls.length, 2);
    f.update({location: base, navigation: {state: 'idle'}});
    f.update({location: f.entry(0), navigation: {state: 'idle'}}); f.owner.close(); assert.equal(f.calls[2].target, -1, 'Forward closes to the same parent');
  });
  test(`${panel}: direct/refreshed/forged entry is replaced locally without guessing Back`, () => {
    const location = {...base, ...queryPanelAddress(base, panel), state: {keep: 'state', [`${panel}RequestId`]: 'test-1', returnTo: base.pathname}};
    const f = fixture(panel, location); f.owner.close(); f.owner.close();
    assert.equal(f.calls.length, 1); assert.deepEqual(f.calls[0].target, queryPanelAddress(base, null));
    assert.equal(f.calls[0].options.replace, true); assert.equal(f.calls[0].options.state.keep, 'state');
    assert.equal(f.calls[0].options.state[`${panel}RequestId`], undefined);
  });
  test(`${panel}: old aborted navigation cannot dismiss a newer route or acknowledge its newer panel`, async () => {
    const f = fixture(panel); f.owner.open(); f.pending(); f.owner.close();
    const newer = {...base, key: 'new', search: '?filter=newer', hash: '#new'};
    f.update({location: newer, navigation: {state: 'idle'}});
    f.owner.open(); f.pending(1); f.owner.close();
    f.calls[0].gate.resolve(); await Promise.resolve(); assert.equal(f.calls.length, 2);
    await f.commit(1); assert.equal(f.calls[2].target, -1); assert.equal(f.calls.length, 3);
    assert.deepEqual(f.calls[1].target, queryPanelAddress(newer, panel));
  });
  test(`${panel}: disposal fences pending receipts and changed query never follows an old parent`, async () => {
    const disposed = fixture(panel); disposed.owner.open(); disposed.pending(); disposed.owner.close(); disposed.owner.dispose();
    await disposed.commit(); assert.equal(disposed.calls.length, 1);
    const changed = fixture(panel); changed.owner.open(); await changed.commit();
    changed.update({location: {...changed.entry(0), key: 'changed', search: changed.entry(0).search + '&newer=1'}, navigation: {state: 'idle'}});
    changed.owner.close(); assert.equal(changed.calls[1].options.replace, true); assert.match(changed.calls[1].target.search, /newer=1/);
  });
}
test('switching to a newer panel cancels an older held dismissal', async () => {
  const help = fixture('help'); help.owner.open(); help.pending(); help.owner.close();
  const donation = {...base, ...queryPanelAddress(base, 'donation'), key: 'donation', state: {donationRequestId: 'newer'}};
  help.update({location: base, navigation: {state: 'loading', location: donation}});
  help.update({location: donation, navigation: {state: 'idle'}});
  help.calls[0].gate.resolve(); await Promise.resolve(); assert.equal(help.calls.length, 1);
});
test('shell and Help share the Router adapter and a single donation image window', async () => {
  const [shell, donation, help] = await Promise.all(['LauncherShell', 'DonationPanel', 'HelpPanel'].map(name => readFile(`app/components/${name}.tsx`, 'utf8')));
  assert.equal((shell.match(/<DonationPanel /g) ?? []).length, 1);
  assert.equal((shell.match(/hidden=\{!donation.available\}/g) ?? []).length, 2);
  assert.doesNotMatch(shell, /href=\{donationImage\}|to=\{donationImage\}/);
  assert.equal((donation.match(/<img /g) ?? []).length, 1); assert.equal((donation.match(/<AnimatedDialog /g) ?? []).length, 1);
  assert.match(donation, /useQueryPanelNavigation\('donation'\)/); assert.match(help, /useQueryPanelNavigation\('help'\)/);
});
