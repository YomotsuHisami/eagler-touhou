/** Synthetic carrier/parsing/timing checks only. Real-browser XSS remains unrun. */
import test, {before} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parse} from 'acorn';
import {build, transform} from 'esbuild';
import {JSDOM} from 'jsdom';
import {buildOriginalComponentFixture} from './original-component-fixture.mjs';
import {authoredSourcesPlugin} from '../react-main/authored-sources.mjs';
const project = fileURLToPath(new URL('../../', import.meta.url));
const baseline = 'edee9633e5e3ee79cd2e1aa334f84f6caf755090';
const path = 'tests/browser/test-content-fragments.mjs';
const pinned = name => execFileSync('git', ['show', `${baseline}:${name}`], {cwd: project, encoding: 'utf8'});
function nodes(source) {
  const result = [];
  function visit(node) {if (!node || typeof node !== 'object') return; if (node.type) result.push(node); for (const value of Object.values(node)) if (Array.isArray(value)) value.forEach(visit); else if (value && typeof value === 'object') visit(value);}
  visit(parse(source, {ecmaVersion: 'latest', sourceType: 'module'})); return result;
}
const original = pinned(path), tree = nodes(original);
const evaluate = tree.find(node => node.type === 'CallExpression' && node.callee.type === 'MemberExpression' && node.callee.object.name === 'page' && node.callee.property.name === 'evaluate').arguments[0];
const bodySource = original.slice(evaluate.start, evaluate.end)
  .replace("await import('/modules/first-use-notice.mjs')", 'window.Subject')
  .replace("await import('/modules/multiplayer-guide.mjs')", 'window.Subject');
const payloadNode = tree.find(node => node.type === 'VariableDeclarator' && node.id.name === 'payload').init;
const payloadSource = original.slice(payloadNode.start, payloadNode.end);
const fixtureMarkupNode = tree.find(node => node.type === 'AssignmentExpression' && original.slice(node.left.start, node.left.end) === 'document.body.innerHTML').right;
const fixtureMarkupSource = original.slice(fixtureMarkupNode.start, fixtureMarkupNode.end);
let scripts;
before(async () => {
  assert.equal(await readFile(resolve(project, 'src/launcher/content-fragment.mts'), 'utf8'), pinned('src/launcher/content-fragment.mts'));
  const current = await buildOriginalComponentFixture('content-fragments');
  for (const owner of ['app/components/notices/FirstUseNotice.tsx', 'app/components/notices/MultiplayerGuideDialog.tsx', 'src/launcher/content-fragment.mts']) assert.ok(current.inputs.includes(owner));
  assert.ok(!current.inputs.includes('src/launcher/first-use-notice.mts'));
  assert.ok(!current.inputs.includes('src/launcher/multiplayer-guide.mts'));
  const old = await build({absWorkingDir: project, stdin: {resolveDir: project, loader: 'ts', contents: `
    export {createFirstUseNoticeController} from 'pinned:first-use-notice.mts';
    export {createMultiplayerGuideController} from 'pinned:multiplayer-guide.mts';
  `}, bundle: true, platform: 'browser', format: 'iife', globalName: 'Subject', write: false,
    plugins: [{name: 'pinned-content-owners', setup(ctx) {
      ctx.onResolve({filter: /^pinned:/}, args => ({path: args.path.slice(7), namespace: 'pinned'}));
      ctx.onLoad({filter: /.*/, namespace: 'pinned'}, args => ({contents: pinned(`src/launcher/${args.path}`), resolveDir: resolve(project, 'src/launcher'), loader: 'ts'}));
    }}, authoredSourcesPlugin(project)], logLevel: 'silent'});
  scripts = {main: old.outputFiles[0].text, react: (await transform(current.module, {format: 'iife', globalName: 'Subject'})).code};
});
function realm(script) {
  const dom = new JSDOM('<!doctype html><title>Content security</title>', {url: 'http://127.0.0.1:18900/', runScripts: 'outside-only'});
  const {window} = dom, errors = [];
  window.Response = Response;
  window.matchMedia = query => ({matches: true, media: query});
  window.HTMLDialogElement.prototype.showModal = function () {this.open = true;};
  window.HTMLDialogElement.prototype.close = function () {this.open = false; this.dispatchEvent(new window.Event('close'));};
  window.HTMLElement.prototype.scrollTo = function () {};
  window.HTMLElement.prototype.scrollIntoView = function () {};
  window.addEventListener('error', event => errors.push(event.error || event.message));
  window.eval(script);
  return {window, errors, close() {window.dispatchEvent(new window.Event('pagehide')); window.close();}};
}
const plain = value => JSON.parse(JSON.stringify(value));
const deferred = () => {let resolve; const promise = new Promise(done => {resolve = done;}); return {promise, resolve};};
const checkpoint = async () => {for (let i = 0; i < 5; i++) await Promise.resolve();};

test('original security payload/actions/assertions and main response path stay byte-identical', async () => {
  const current = await readFile(resolve(project, path), 'utf8');
  assert.equal(current.slice(current.indexOf('let browser;')), original.slice(original.indexOf('let browser;')));
  const assertions = source => nodes(source).filter(node => node.type === 'CallExpression' && node.callee.type === 'MemberExpression' && node.callee.object.name === 'assert').map(node => source.slice(node.start, node.end));
  assert.deepEqual(assertions(current), assertions(original));
  assert.ok(current.includes("response.end(await readFile(resolve(project, '.cache/build/browser/assets/launcher', name)))"));
});

test('actual React carriers parse the unchanged original security fixture like pinned controllers', {timeout: 10000}, async () => {
  const results = {};
  for (const [name, script] of Object.entries(scripts)) {
    const env = realm(script);
    try {results[name] = plain(await env.window.eval(`(${bodySource})()`)); assert.deepEqual(env.errors, []);}
    finally {env.close();}
  }
  assert.deepEqual(results.react, results.main);
  assert.equal(results.react.dialogs, 2);
  assert.equal(results.react.notice.heading, 'Readable heading');
});

for (const kind of ['notice', 'guide']) test(`${kind}: original fetch arguments and show completion wait for actual content commit`, {timeout: 10000}, async () => {
  const results = {};
  for (const [name, script] of Object.entries(scripts)) {
    const env = realm(script), response = deferred(), text = deferred(), calls = [];
    try {
      const {window} = env;
      window.document.body.innerHTML = window.eval(fixtureMarkupSource);
      const fetchImpl = (...args) => {calls.push(plain(args)); return response.promise;};
      const owner = kind === 'notice' ? window.Subject.createFirstUseNoticeController({fetchImpl, storage: null}) : window.Subject.createMultiplayerGuideController({fetchImpl});
      const show = () => kind === 'notice' ? owner.showManual() : owner.show();
      const dialog = window.document.getElementById(kind === 'notice' ? 'firstUseNoticeDialog' : 'mpGuideDialog');
      const content = window.document.getElementById(kind === 'notice' ? 'firstUseNoticeText' : 'mpGuideContent');
      let completed = 0;
      const shows = [show().then(() => completed++)];
      // The original security scenario calls notice.showManual once. Guide's
      // original loading promise also supports concurrent callers. First-use
      // concurrency differs in production and is reported separately.
      if (kind === 'guide') shows.push(show().then(() => completed++));
      await checkpoint(); const beforeResponse = {completed, open: dialog.open, fetches: calls.length};
      response.resolve({ok: true, status: 200, text: () => text.promise});
      await checkpoint(); const beforeText = {completed, headings: content.querySelectorAll('h2').length};
      text.resolve(window.eval(payloadSource));
      await Promise.all(shows);
      const committed = {completed, heading: content.querySelector('h2')?.textContent, open: dialog.open};
      await show();
      results[name] = {calls, beforeResponse, beforeText, committed};
      assert.equal(calls.length, 1, 'Cached show must not fetch again');
      assert.deepEqual(env.errors, []);
    } finally {env.close();}
  }
  assert.deepEqual(results.react, results.main);
  assert.equal(results.react.beforeResponse.completed, 0);
  assert.equal(results.react.beforeText.completed, 0);
  assert.equal(results.react.committed.completed, kind === 'guide' ? 2 : 1);
});

test('guide: empty content, fetch failure, cached unchanged content and close during load all settle', {timeout: 10000}, async () => {
  for (const mode of ['empty', 'failure', 'close-during-load']) {
    const results = {};
    for (const [name, script] of Object.entries(scripts)) {
      const env = realm(script), response = deferred(); let calls = 0;
      try {
        const {window} = env; window.document.body.innerHTML = window.eval(fixtureMarkupSource);
        const owner = window.Subject.createMultiplayerGuideController({fetchImpl: () => {calls++; return response.promise;}});
        const showing = owner.show();
        if (mode === 'close-during-load') {window.document.getElementById('mpGuideClose').click(); await checkpoint();}
        response.resolve({ok: mode !== 'failure', status: mode === 'failure' ? 503 : 200,
          text: async () => mode === 'empty' ? '' : window.eval(payloadSource)});
        assert.equal(await showing, undefined);
        const content = window.document.getElementById('mpGuideContent');
        results[name] = {open: window.document.getElementById('mpGuideDialog').open, calls,
          empty: !content.childNodes.length, error: !!content.querySelector('.multiplayer-guide-error'), heading: content.querySelector('h2')?.textContent};
        if (mode === 'empty') {assert.equal(await owner.show(), undefined); assert.equal(calls, 1, 'Cached empty content resolves without needing another DOM mutation');}
        assert.deepEqual(env.errors, []);
      } finally {env.close();}
    }
    assert.deepEqual(results.react, results.main, mode);
  }
});

test('guide: page teardown rejects pending carrier observation and never waits for removed content', {timeout: 10000}, async () => {
  const env = realm(scripts.react), response = deferred();
  try {
    const {window} = env; window.document.body.innerHTML = window.eval(fixtureMarkupSource);
    const owner = window.Subject.createMultiplayerGuideController({fetchImpl: () => response.promise});
    const showing = owner.show();
    window.dispatchEvent(new window.Event('pagehide'));
    await assert.rejects(showing, /carrier unmounted/);
    response.resolve({ok: true, status: 200, text: async () => window.eval(payloadSource)});
    await checkpoint();
    assert.equal(window.document.getElementById('mpGuideDialog'), null);
    assert.deepEqual(env.errors, []);
  } finally {env.close();}
});
