/** Main netplay-calibration-{connection,report} source contracts. Synthetic
 * authenticated-epoch inputs/clock/DOM only; no live transport or upload. */
import test, {before, after, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir, mkdtemp, rm} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {resolve, dirname} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {installMountedDom} from './mounted-dom-environment.mjs';
const project = fileURLToPath(new URL('../../', import.meta.url));
let work, owner, env, React, createRoot, root;
before(async () => {
  env = installMountedDom(); React = await import('react'); ({createRoot} = await import('react-dom/client'));
  await mkdir(resolve(project, '.cache'), {recursive: true}); work = await mkdtemp(resolve(project, '.cache/calibration-'));
  const file = resolve(work, 'owner.mjs');
  await build({absWorkingDir: project, stdin: {resolveDir: project, loader: 'ts', contents: `
    export * from './app/models/netplay-calibration.ts';
    export {NetplayConnectionWindow} from './app/components/NetplayConnectionWindow.tsx';
    export {NetplayCalibrationReport} from './app/components/NetplayCalibrationReport.tsx';
  `}, outfile: file, bundle: true, platform: 'node', format: 'esm', jsx: 'automatic', packages: 'external', logLevel: 'silent',
    plugins: [{name: 'main-authored-siblings', setup(context) {context.onResolve({filter: /^\.\.?\/.*\.mjs$/}, args => {
      const source = resolve(dirname(args.importer), args.path), authored = source.slice(0, -4) + '.mts';
      return source.replaceAll('\\', '/').startsWith(resolve(project, 'src').replaceAll('\\', '/') + '/') && existsSync(authored) ? {path: authored} : undefined;
    });}}]});
  owner = await import(pathToFileURL(file).href);
});
afterEach(async () => {if (root) {await React.act(async () => root.unmount()); root = null;} env.document.body.replaceChildren();});
after(async () => {env.close(); if (work) await rm(work, {recursive: true, force: true});});
class Clock {
  now = 0; tasks = new Map(); sequence = 0;
  setTimeout = (callback, delay) => {const id = ++this.sequence; this.tasks.set(id, {callback, at: this.now + delay}); return id;};
  clearTimeout = id => {this.tasks.delete(id);};
  tick(ms) {this.now += ms; for (const [id, task] of [...this.tasks]) if (task.at <= this.now) {this.tasks.delete(id); task.callback();}}
}
function fixture() {
  const clock = new Clock(), model = owner.createNetplayCalibration({epoch: 1, userAgent: 'synthetic-agent', now: () => clock.now, timers: clock});
  return {clock, model};
}
const ready = (overrides = {}) => ({phase: 'ready', automatic: true, adonisMode: 2, inputDelay: 1, fullDelay: 3,
  predictionReserve: 2, rttP95Us: 100000, samples: 120, lost: 0, route: 'rtc', calibration: {game: 'th10mp', build: 'fixture-build', completedAt: 100,
    localPlayer: 0, players: [0, 1].map(player => ({player, p95Us: 100000, samples: 120, lost: 0, minUs: 1000, maxUs: 150000, meanUs: 50000}))}, ...overrides});

test('calibration exact timing validation, spectator exclusion, eight-second result, dismiss and stale reset', () => {
  const {model, clock} = fixture(); model.record({phase: 'measuring', probes: 10, replies: 8}, 1);
  assert.equal(model.getSnapshot().connection.phase, 'measuring');
  model.record(ready({inputDelay: 2}), 1); assert.equal(model.getSnapshot().connection.phase, 'measuring', 'invalid D does not overwrite valid prior progress');
  model.record(ready({route: 'spectator'}), 1); assert.equal(model.getSnapshot().report, null);
  model.record(ready(), 1); assert.ok(model.getSnapshot().report); clock.tick(7999); assert.equal(model.getSnapshot().connection.phase, 'ready');
  clock.tick(1); assert.equal(model.getSnapshot().connection, null); assert.ok(model.getSnapshot().report, 'expiry retains report');
  model.record(ready(), 1); model.dismiss(); clock.tick(8000); assert.equal(model.getSnapshot().connection, null);
  model.openReport('live RTC'); assert.ok(model.getSnapshot().reportText); model.reset(2);
  model.record(ready(), 1); assert.equal(model.getSnapshot().report, null); assert.equal(model.getSnapshot().reportText, null);
  model.record(ready(), 2); model.record({phase: 'closed'}, 2);
  assert.equal(model.getSnapshot().connection, null); assert.ok(model.getSnapshot().report, 'closed progress does not reset report'); model.dispose();
});

test('calibration report validates ordered samples, preserves exact fields and captures live display at open only', () => {
  const {model, clock} = fixture(); const invalid = ready(); invalid.calibration.players[1].lost = 1;
  model.record(invalid, 1); assert.equal(model.getSnapshot().connection.phase, 'ready'); assert.equal(model.getSnapshot().report, null);
  const input = ready(); input.calibration.game = 'unknown'; model.record(input, 1);
  assert.equal(model.getSnapshot().report.game, 'th09mp'); assert.equal(model.getSnapshot().report.schema, 'eagler-touhou/th09-calibration-report/1');
  clock.tick(500); model.openReport('RTC P95 is different from live RTT'); const report = JSON.parse(model.getSnapshot().reportText);
  assert.equal(report.copiedAt, '1970-01-01T00:00:00.500Z'); assert.equal(report.userAgent, 'synthetic-agent');
  assert.equal(report.liveNetworkDisplay, 'RTC P95 is different from live RTT'); assert.equal(report.players[0].meanUs, 50000);
  assert.equal(report.formula, 'B=max(1,ceil(floor(max(players.p95Us)/2)*60/1000000)); automatic hybrid P=min(configuredReserve,B-1), configuredReserve<=2; automatic D=B-P>=1');
  clock.tick(1000); assert.equal(JSON.parse(model.getSnapshot().reportText).copiedAt, report.copiedAt); model.dispose();
});

test('calibration connection preserves original bilingual copy and measured P95 rather than mean', async () => {
  const {model} = fixture(); model.record(ready(), 1);
  const network = {connection: {hidden: true, peerRows: []}, calibrationEligible: true, returnToRoom: false};
  const container = env.document.createElement('div'); env.document.body.append(container); root = createRoot(container);
  await React.act(async () => root.render(React.createElement(owner.NetplayConnectionWindow, {network, calibration: model, english: true, onReturn() {}})));
  assert.equal(env.document.getElementById('netplayConnectionTitle').textContent, 'Connection measured');
  assert.deepEqual([...env.document.querySelectorAll('tbody tr:first-child td')].map(node => node.textContent), ['100.00 ms', '150.00 ms']);
  assert.equal(env.document.getElementById('netplayCalibrationDismiss').textContent, 'Dismiss');
  await React.act(async () => model.record({phase: 'unavailable', reason: 8}, 1));
  assert.equal(env.document.getElementById('netplayConnectionSummary').textContent, 'The measured delay is too high. Return to the room and choose a manual delay.');
  const copy = owner.calibrationConnectionCopy({phase: 'retrying', attempt: 2, maxAttempts: 4}, false);
  assert.equal(copy.title, '连接波动，正在重新测量…'); assert.equal(copy.summary, '准备第 2/4 次测量，正在等待所有玩家恢复。');
  await React.act(async () => root.render(React.createElement(owner.NetplayConnectionWindow, {network: {...network, calibrationEligible: false}, calibration: model, english: true, onReturn() {}})));
  assert.equal(env.document.getElementById('netplayConnectionWindow').hidden, true, 'ineligible native connection suppresses calibration override'); model.dispose();
});

test('calibration report clipboard is click-only; failure selects text; reset closes and stale success cannot affect successor', async () => {
  const {model} = fixture(); model.record(ready(), 1); let writes = 0, fail = true, resolveWrite;
  const clipboard = {writeText: async value => {writes++; assert.equal(JSON.parse(value).liveNetworkDisplay, 'live 77/0ms'); if (fail) throw new Error('denied'); await new Promise(resolve => {resolveWrite = resolve;});}};
  const container = env.document.createElement('div'); env.document.body.append(container); root = createRoot(container);
  await React.act(async () => root.render(React.createElement(owner.NetplayCalibrationReport, {model, english: false, currentNetwork: () => 'live 77/0ms', clipboard})));
  assert.equal(writes, 0); await React.act(async () => env.document.getElementById('netplayCalibrationReport').click());
  assert.equal(writes, 0); assert.equal(env.document.getElementById('netplayCalibrationDialog').open, true);
  await React.act(async () => env.document.getElementById('netplayCalibrationCopy').click());
  assert.equal(writes, 1); assert.equal(env.document.getElementById('netplayCalibrationCopy').textContent, '已选中，请手动复制');
  const text = env.document.getElementById('netplayCalibrationText'); assert.equal(env.document.activeElement, text); assert.equal(text.selectionEnd, text.value.length);
  fail = false; await React.act(async () => env.document.getElementById('netplayCalibrationCopy').click());
  await React.act(async () => model.reset(2)); assert.equal(env.document.getElementById('netplayCalibrationDialog').open, false);
  await React.act(async () => {model.record(ready(), 2); model.openReport('new live');});
  await React.act(async () => resolveWrite()); assert.equal(env.document.getElementById('netplayCalibrationCopy').textContent, '复制报告'); model.dispose();
});
