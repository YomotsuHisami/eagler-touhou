/** Pinned-main published HTML before JS/hydration; no browser/rendering claim. */
import test, {before, after, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {runInNewContext} from 'node:vm';
import {build} from 'esbuild';
import {authoredSourcesPlugin} from './authored-sources.mjs';
import {installMountedDom} from './mounted-dom-environment.mjs';

const project = fileURLToPath(new URL('../../', import.meta.url));
const pinnedMain = 'edee9633e5e3ee79cd2e1aa334f84f6caf755090';
const pinned = path => execFileSync('git', ['show', `${pinnedMain}:${path}`], {cwd: project, encoding: 'utf8'});
let work, env, api, React, renderToStaticMarkup, createRoot, MemoryRouter, root;
let originalLibrary, originalLobby, expectedCards;
const el = (type, props, ...children) => React.createElement(type, props, ...children);
const parse = html => new env.window.DOMParser().parseFromString(html, 'text/html');
const normal = text => text.replace(/\s+/g, ' ').trim();
function cardContract(document) {
  return [...document.querySelectorAll('.game')].map(card => ({
    id: card.dataset.product || card.dataset.game, className: card.className,
    href: card.getAttribute('href'), hidden: card.hidden,
    style: [...card.style].map(key => [key, card.style.getPropertyValue(key)]).sort(),
    title: normal(card.querySelector('h2').textContent), subtitle: card.querySelector('small').textContent,
    number: card.querySelector('.no-label').textContent,
    art: [...card.querySelectorAll('.card-art-image')].map(image => ['src', 'width', 'height', 'fetchpriority'].map(key => image.getAttribute(key))),
    current: card.getAttribute('aria-current'),
  }));
}
function minimapContract(document) {
  return [...document.querySelectorAll('[data-minimap-preview]')].map(button => Object.fromEntries(
    ['data-minimap-preview', 'aria-label', 'aria-controls', 'aria-describedby', 'aria-current', 'hidden'].map(key => [key, button.getAttribute(key)])));
}
function assertUniqueIds(document) {
  const ids = [...document.querySelectorAll('[id]')].map(node => node.id);
  assert.equal(new Set(ids).size, ids.length, 'Static document must not include duplicate owners');
}
before(async () => {
  env = installMountedDom();
  React = await import('react'); ({renderToStaticMarkup} = await import('react-dom/server'));
  ({createRoot} = await import('react-dom/client')); ({MemoryRouter} = await import('react-router'));
  work = await mkdtemp(resolve(project, '.cache/initial-presentation-'));
  const outfile = resolve(work, 'actual.mjs');
  await build({absWorkingDir: project, stdin: {resolveDir: project, loader: 'ts', contents: `
    export {BrowserLauncher} from './app/BrowserLauncher.tsx';
    export * from './app/components/startup/InitialLauncher.tsx';
    export * from './src/contracts/product-catalog.mts';
    export {translate} from './app/i18n.tsx';
  `}, outfile, bundle: true, platform: 'node', format: 'esm', jsx: 'automatic', packages: 'external', logLevel: 'silent', plugins: [authoredSourcesPlugin(project)]});
  api = await import(pathToFileURL(outfile).href);
  originalLibrary = parse(pinned('public/index.html')); originalLobby = parse(pinned('public/lobby.html'));
  // Execute the pinned compiler's pure card generator, not a copied template
  // or a warm legacy UI build. The original HTML marker has no authored cards.
  const compiler = pinned('lib/launcher-optimization.mjs');
  const start = compiler.indexOf('function escapeHtml('), end = compiler.indexOf('\nfunction splitFeatureStyles(', start);
  assert.ok(start > 0 && end > start);
  const generate = runInNewContext(compiler.slice(start, end) + '\ngenerateProductCards');
  expectedCards = parse(generate(api));
});
afterEach(async () => {
  if (root) await React.act(async () => root.unmount()); root = null;
  env.document.body.replaceChildren(); assert.deepEqual(env.errors.splice(0), []);
});
after(async () => {env?.close(); if (work) await rm(work, {recursive: true, force: true});});
function initialMarkup(path) {return renderToStaticMarkup(el(MemoryRouter, {initialEntries: [path]}, el(api.BrowserLauncher)));}
for (const path of ['/', '/index.html', '/en.html', '/nested/', '/nested/en.html', '/?game=th20&test=1']) {
  test(`actual BrowserLauncher server render preserves original default static card gate: ${path}`, () => {
    const document = parse(initialMarkup(path)), locale = path.includes('en.html') ? 'en' : 'zh-CN';
    assert.deepEqual(cardContract(document), cardContract(expectedCards));
    assert.deepEqual(minimapContract(document), minimapContract(expectedCards));
    for (const game of ['th08', 'th10', 'th15', 'th11']) assert.equal(document.querySelector(`.game[data-game=${game}]`).hidden, false);
    assert.equal(document.querySelector('.game[data-game=th20]').hidden, true);
    assert.equal(document.querySelector('#singleplayerHeading').textContent, api.translate(locale, 'library.singleplayer'));
    assert.equal(document.querySelector('#multiplayerHeading').textContent, api.translate(locale, 'library.multiplayer'));
    assert.equal(document.querySelector('#uiLanguageSelect').value, locale);
    assert.deepEqual([...document.querySelectorAll('.site-footer p')].map(node => normal(node.textContent)), [...originalLibrary.querySelectorAll('.site-footer p')].map(node => normal(node.textContent)));
    assert.equal(document.querySelector('.shelf-lobby-link').getAttribute('href'), 'lobby.html');
    assert.equal(document.querySelector('#originMigrationOpen').hidden, true);
    assert.equal(document.querySelector('iframe'), null);
    assert.equal(document.querySelector('dialog[open]'), null);
    assertUniqueIds(document);
  });
}
for (const path of ['/lobby.html', '/lobby', '/nested/lobby.html?game=th09mp']) test(`original empty lobby boot presentation: ${path}`, () => {
  const document = parse(initialMarkup(path));
  assert.equal(document.querySelector('.lobby-main').hasAttribute('inert'), true);
  assert.equal(document.querySelector('#lobbyGameRail').children.length, 0);
  assert.equal(document.querySelector('#filters').children.length, 0);
  assert.equal(document.querySelector('#roomList').children.length, 0);
  for (const id of ['createButton', 'codeButton', 'refreshRooms', 'lobbyGuideOpen', 'lobbyNetworkCheck']) {
    const actual = document.getElementById(id), original = originalLobby.getElementById(id);
    assert.equal(actual.disabled, original.disabled, id); assert.equal(normal(actual.textContent), normal(original.textContent), id);
  }
  assert.equal(document.querySelector('#listHead').hidden, true);
  assert.equal(document.querySelector('#listLoading').hidden, false);
  assert.equal(document.querySelector('#roomList').getAttribute('aria-busy'), 'true');
  assert.equal(document.querySelector('.site-footer'), null); assert.equal(document.querySelector('.brand'), null);
  assert.equal(document.querySelector('iframe'), null); assertUniqueIds(document);
});
for (const lobby of [false, true]) test(`exact original ${lobby ? 'lobby' : 'library'} noscript copy`, () => {
  const output = renderToStaticMarkup(el(api.OriginalNoscript, {lobby}));
  const original = [...pinned(`public/${lobby ? 'lobby' : 'index'}.html`).matchAll(/<noscript>([\s\S]*?)<\/noscript>/g)].at(-1)[0];
  assert.equal(output, original);
});
test('initial presentation starts no rail observers/RAF and removes its document handlers on replacement', async () => {
  const activeClicks = new Set(), add = env.document.addEventListener, remove = env.document.removeEventListener;
  const previousObserver = globalThis.ResizeObserver, previousFrame = globalThis.requestAnimationFrame;
  let observers = 0, frames = 0;
  env.document.addEventListener = function (type, fn, options) {if (type === 'click') activeClicks.add(fn); return add.call(this, type, fn, options);};
  env.document.removeEventListener = function (type, fn, options) {if (type === 'click') activeClicks.delete(fn); return remove.call(this, type, fn, options);};
  globalThis.ResizeObserver = class {constructor() {observers++;} observe() {} disconnect() {}};
  globalThis.requestAnimationFrame = () => {frames++; return 1;};
  try {
    const container = env.document.createElement('div'); env.document.body.append(container); root = createRoot(container);
    await React.act(async () => root.render(el(MemoryRouter, null, el(api.InitialLauncher))));
    const initial = [...container.querySelectorAll('[id]')];
    assert.ok(initial.some(node => node.id === 'singleplayerRail')); assert.equal(observers, 0); assert.equal(frames, 0); assert.equal(activeClicks.size, 0);
    await React.act(async () => root.render(el('main', {id: 'real-session-boundary'})));
    assert.equal(activeClicks.size, 0); assert.ok(initial.every(node => !node.isConnected)); assertUniqueIds(env.document);
  } finally {
    env.document.addEventListener = add; env.document.removeEventListener = remove;
    globalThis.ResizeObserver = previousObserver; globalThis.requestAnimationFrame = previousFrame;
  }
});

for (const initialLobby of [false, true]) test(`document body seed preserves live class owners across library/lobby changes (${initialLobby})`, async () => {
  const document = env.document;
  root = createRoot(document.documentElement);
  const render = lobby => el(React.Fragment, null, el('head'), el(api.InitialDocumentBody, {lobby}, el('main', {'data-route': lobby ? 'lobby' : 'library'})));
  try {
    await React.act(async () => root.render(render(initialLobby)));
    assert.equal(document.body.classList.contains('lobby-page'), initialLobby);
    document.body.classList.add('less-motion', 'player-active', 'app-shell-activation-pending');
    const body = document.body;
    // The existing LauncherApplication effect is the live token owner. Only
    // its one token changes; the document component must never rewrite it.
    for (const lobby of [!initialLobby, initialLobby, !initialLobby]) {
      document.body.classList.toggle('lobby-page', lobby);
      await React.act(async () => root.render(render(lobby)));
      assert.equal(document.body, body);
      assert.deepEqual([...body.classList].sort(), ['less-motion', 'player-active', 'app-shell-activation-pending', ...(lobby ? ['lobby-page'] : [])].sort());
    }
  } finally {
    await React.act(async () => root.unmount()); root = null;
    document.documentElement.innerHTML = '<head></head><body></body>';
  }
});

test('actual root/nested builds publish shared initial cards and route-specific original lobby/noscript', {timeout: 240000}, async () => {
  for (const [name, mountPath] of [['root', '/'], ['nested', '/preview/']]) {
    const output = resolve(work, name);
    execFileSync(process.execPath, ['node_modules/@react-router/dev/bin.cjs', 'build'], {cwd: project,
      env: {...process.env, EAGLER_REACT_BUILD_DIRECTORY: output, EAGLER_REACT_MOUNT_PATH: mountPath, EAGLER_REACT_APP_SHELL: '', EAGLER_REACT_APP_SHELL_ORIGIN: ''},
      stdio: 'pipe', timeout: 120000});
    for (const entry of ['index.html', 'en.html', 'lobby.html']) {
      const document = parse(await readFile(resolve(output, 'client', entry), 'utf8')), lobby = entry === 'lobby.html';
      assert.equal(document.documentElement.lang, entry === 'en.html' ? 'en' : 'zh-CN');
      assert.equal(document.body.classList.contains('lobby-page'), lobby);
      assert.equal(document.documentElement.dataset.originalEntry, lobby ? 'lobby' : 'library');
      assert.equal(document.documentElement.getAttribute('data-lobby-boot'), lobby ? 'loading' : null);
      if (lobby) {assert.equal(document.querySelectorAll('.game').length, 0); assert.ok(document.querySelector('noscript').textContent.includes('联机大厅需要启用 JavaScript'));}
      else assert.deepEqual(cardContract(document), cardContract(expectedCards));
      assert.equal(document.querySelector('iframe'), null); assertUniqueIds(document);
    }
  }
});
