/** Actual React hook/panels in synthetic DOM + Memory Router only.
 * The clock and media queries are explicit fixtures. No browser, rendered CSS,
 * mobile device, native runtime, network or deployment validation is claimed.
 */
import test, {before, after, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir, mkdtemp, rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {installMountedDom} from './mounted-dom-environment.mjs';

const project = fileURLToPath(new URL('../../', import.meta.url));
let env, work, React, createRoot, createMemoryRouter, RouterProvider, useLocation, useNavigate, owners;
let mounted = null;

before(async () => {
  env = installMountedDom();
  React = await import('react');
  ({createRoot} = await import('react-dom/client'));
  ({createMemoryRouter, RouterProvider, useLocation, useNavigate} = await import('react-router'));
  await mkdir(resolve(project, '.cache'), {recursive: true});
  work = await mkdtemp(resolve(project, '.cache/options-presence-'));
  const output = resolve(work, 'actual-owners.mjs');
  await build({absWorkingDir: project, stdin: {resolveDir: project, loader: 'ts', contents: `
    export {OptionsOwnership} from './app/components/launcher/options-ownership.ts';
    export {useLibraryOptionsPresence} from './app/components/launcher/use-library-options-presence.ts';
    export {OptionsPanel} from './app/components/launcher/OptionsPanel.tsx';
    export {LibrarySurface} from './app/components/launcher/LibrarySurface.tsx';
    export {LibraryCards} from './app/components/launcher/LibraryCards.tsx';
    export {LobbyOptionsHost} from './app/components/launcher/LobbyOptionsHost.tsx';
    export {MainSelect} from './app/components/launcher/MainSelect.tsx';
    export {LocaleProvider} from './app/i18n.tsx';
    export {createLibraryProducts} from './app/components/launcher/products.ts';
  `}, bundle: true, platform: 'node', format: 'esm', jsx: 'automatic', outfile: output,
  packages: 'external', logLevel: 'silent'});
  owners = await import(pathToFileURL(output).href);
});

afterEach(async () => {
  if (mounted) {
    await unmount();
    mounted.clock.restore();
    mounted.router.dispose();
    mounted = null;
  }
  assert.deepEqual(env.errors, [], 'uncaught DOM/React errors fail this synthetic fixture');
  assert.equal(env.document.querySelectorAll('.mizuki-select-menu').length, 0, 'detached menus are disposed');
  assert.equal(env.document.body.classList.contains('library-tools-open'), false);
  assert.equal(env.document.body.classList.contains('library-tools-closing'), false);
  env.document.body.replaceChildren();
});
after(async () => {env?.close(); if (work) await rm(work, {recursive: true, force: true});});

function syntheticClock() {
  const originalSet = env.window.setTimeout, originalClear = env.window.clearTimeout;
  const tasks = new Map();
  let now = 0, nextId = 1;
  env.window.setTimeout = (callback, delay = 0, ...args) => {
    const id = nextId++;
    tasks.set(id, {id, delay, at: now + delay, run: () => callback(...args)});
    return id;
  };
  env.window.clearTimeout = id => {tasks.delete(id);};
  return {
    tasks,
    async advance(milliseconds) {
      const end = now + milliseconds;
      while (true) {
        const next = [...tasks.values()].filter(task => task.at <= end).sort((a, b) => a.at - b.at)[0];
        if (!next) break;
        now = next.at; tasks.delete(next.id);
        await React.act(async () => {next.run();});
      }
      now = end;
    },
    restore() {env.window.setTimeout = originalSet; env.window.clearTimeout = originalClear; tasks.clear();},
  };
}

async function mount({entry = '/?game=th06', mobile = true, coarse = false, noHover = false,
  reduced = false, lessMotion = false, strict = false} = {}) {
  env.errors.length = 0;
  env.window.matchMedia = query => ({media: query,
    matches: query.includes('prefers-reduced-motion') ? reduced :
      (query.includes('max-width: 780px') && mobile) || (query.includes('pointer: coarse') && coarse) || (query.includes('hover: none') && noHover),
    onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent() {return true;}});
  globalThis.matchMedia = env.window.matchMedia;
  const clock = syntheticClock();
  const products = owners.createLibraryProducts(['th06', 'th07'], path => `/fixtures/${path}`, id => `/?game=${id}`);
  const observed = [];
  function Fixture() {
    const location = useLocation(), navigate = useNavigate();
    const productId = new URLSearchParams(location.search).get('game');
    const context = location.pathname === '/lobby.html' ? 'lobby' : 'library';
    const presence = owners.useLibraryOptionsPresence({open: productId !== null, context,
      product: products.find(product => product.id === productId), lessMotion, concealed: location.hash === '#playing'});
    observed.push(presence);
    const onBack = () => navigate(context === 'lobby' ? '/lobby.html' : '/');
    const panel = presence.product && React.createElement(owners.OptionsPanel, {product: presence.product,
      open: presence.open, onBack, assetUrl: path => `/fixtures/${path}`},
    React.createElement(owners.MainSelect, {id: 'presenceSelect', 'aria-label': 'Synthetic options select', defaultValue: 'a'},
      React.createElement('option', {value: 'a'}, 'A'), React.createElement('option', {value: 'b'}, 'B')));
    return React.createElement(owners.OptionsOwnership, {value: presence.targets}, React.createElement(owners.LocaleProvider, {locale: 'en'},
      context === 'library' ? React.createElement(owners.LibrarySurface, {products,
        selectedProduct: 'th06', openedProduct: presence.openedProduct, optionsOpen: presence.open,
        onSelect() {}, onActivate: id => navigate(`/?game=${id}`), onBack,
        masthead: null, footer: null, lobbyHref: '/lobby.html', roomUsersArtwork: '/fixtures/room-users.svg'}, panel)
        : React.createElement('div', {'data-fixture-lobby': true, className: 'main library-layout'},
          React.createElement('div', {className: 'game-library', inert: presence.open},
            React.createElement(owners.LibraryCards, {products, variant: 'lobby', selectedProduct: 'th06', openedProduct: presence.openedProduct,
              onSelect() {}, onActivate: id => navigate(`/lobby.html?game=${id}`)})),
          React.createElement(owners.LobbyOptionsHost, {open: presence.open, onCloseRequest: onBack, foregroundActive: location.hash === '#playing'}, panel))));
  }
  const fixture = React.createElement(Fixture);
  const router = createMemoryRouter([{path: '*', element: strict ? React.createElement(React.StrictMode, null, fixture) : fixture}], {initialEntries: [entry]});
  const container = env.document.createElement('div'); env.document.body.append(container);
  const root = createRoot(container);
  mounted = {clock, router, root, observed, isMounted: true};
  await React.act(async () => {root.render(React.createElement(RouterProvider, {router}));});
  return mounted;
}

async function unmount() {
  if (!mounted?.isMounted) return;
  mounted.isMounted = false;
  await React.act(async () => {mounted.root.unmount();});
}
async function navigate(url) {await React.act(async () => {await mounted.router.navigate(url);});}
function node(selector) {const found = env.document.querySelector(selector); assert.ok(found, `missing ${selector}`); return found;}
function hasBodyClass(name) {return env.document.body.classList.contains(name);}
function watchFocus(element) {
  const actual = element.focus.bind(element), calls = [];
  element.focus = options => {
    calls.push({options, inert: !!element.closest('[inert]'), open: hasBodyClass('library-tools-open'), closing: hasBodyClass('library-tools-closing')});
    actual(options);
  };
  return calls;
}
function assertOpen(product = 'th06') {
  assert.equal(hasBodyClass('library-tools-open'), true);
  assert.equal(node('.tools').getAttribute('role'), 'dialog');
  assert.equal(node('.tools').getAttribute('aria-modal'), 'true');
  assert.equal(node('.tools').getAttribute('aria-hidden'), 'false');
  assert.equal(node('.tools').classList.contains('is-open'), true);
  assert.ok(node('.game-library').hasAttribute('inert'));
  assert.equal(node('.game.selected').dataset.game, product);
  assert.equal(node('.game.selected').getAttribute('aria-current'), 'page');
}
function assertClosed() {
  assert.equal(hasBodyClass('library-tools-open'), false);
  assert.equal(hasBodyClass('library-tools-closing'), false);
  assert.equal(node('.tools').getAttribute('role'), 'complementary');
  assert.equal(node('.tools').getAttribute('aria-modal'), 'false');
  assert.equal(node('.tools').getAttribute('aria-hidden'), 'true');
  assert.equal(node('.tools').classList.contains('is-open'), false);
  assert.equal(node('.game-library').hasAttribute('inert'), false);
  assert.equal(env.document.querySelector('.game.selected'), null);
  assert.equal(node('.game-th06').getAttribute('aria-current'), 'false');
}

test('mobile close retains exact panel/selection for 240 ms, closes detached menus, then restores focus', async () => {
  const {clock} = await mount();
  const panel = node('.tools'), selected = node('.game.selected'), focusCalls = watchFocus(selected);
  const trigger = node('.mizuki-select-trigger');
  await React.act(async () => {trigger.click();});
  const menu = node('.mizuki-select-menu');
  assert.equal(menu.parentNode, env.document.body, 'menu is genuinely detached from the panel');
  assert.equal(menu.hidden, false);
  await React.act(async () => {node('#libraryBack').click();});
  assert.equal(mounted.router.state.location.search, '', 'Router commits home before visual exit');
  const committedKey = mounted.router.state.location.key;
  assertOpen();
  assert.equal(hasBodyClass('library-tools-closing'), true);
  assert.equal(menu.hidden, true);
  assert.equal(trigger.getAttribute('aria-expanded'), 'false');
  assert.equal(node('.tools'), panel);
  assert.equal([...clock.tasks.values()].filter(task => task.delay === 240).length, 1);
  assert.deepEqual(focusCalls, []);
  await clock.advance(239);
  assertOpen();
  await clock.advance(1);
  assertClosed();
  assert.equal(node('.tools'), panel, 'original panel remains mounted even at home');
  assert.equal(mounted.router.state.location.key, committedKey, 'settling never writes another history entry');
  assert.equal(env.document.activeElement, selected);
  assert.deepEqual(focusCalls, [{options: {preventScroll: true}, inert: false, open: false, closing: false}]);
});

for (const media of [{}, {mobile: false}, {reduced: true}, {lessMotion: true}, {mobile: false, coarse: true}]) {
  test(`directory native carrier follows the shared close deadline and keeps selected card focus ${JSON.stringify(media)}`, async () => {
    const {clock} = await mount({entry: '/lobby.html?game=th06', ...media});
    const panel = node('.tools'), dialog = node('#lobbyOptionsDialog'), card = node('.game.selected');
    assertOpen(); assert.equal(dialog.open, true);
    await React.act(async () => node('#libraryBack').click());
    assert.equal(mounted.router.state.location.pathname, '/lobby.html');
    const immediate = media.reduced || media.lessMotion;
    const deadline = media.mobile === false && !media.coarse ? 520 : 240;
    if (!immediate) {
      assertOpen(); assert.equal(dialog.open, true); assert.equal(hasBodyClass('library-tools-closing'), true);
      assert.equal([...clock.tasks.values()].filter(task => task.delay === deadline).length, 1, 'one common owner, no carrier timer');
      await clock.advance(deadline - 1); assert.equal(dialog.open, true);
      await clock.advance(1);
    }
    assertClosed(); assert.equal(dialog.open, false); assert.equal(node('.tools'), panel);
    assert.equal(env.document.activeElement, card); assert.equal([...clock.tasks.values()].some(task => task.delay === 240 || task.delay === 520 || task.delay === 650), false);
  });
}
test('directory reopen cancels a shared exit without closing the retained native carrier', async () => {
  const {clock} = await mount({entry: '/lobby.html?game=th06'});
  const dialog = node('#lobbyOptionsDialog'), panel = node('.tools');
  await navigate('/lobby.html');
  const pending = [...clock.tasks.values()].find(task => task.delay === 240); assert.ok(pending);
  await clock.advance(100); await navigate('/lobby.html?game=th07');
  await React.act(async () => pending.run()); await clock.advance(500);
  assertOpen('th07'); assert.equal(dialog.open, true); assert.equal(node('.tools'), panel);
  assert.equal(hasBodyClass('library-tools-closing'), false);
});

test('desktop close retains the established slide/fade for 520 ms before releasing selection and focus', async () => {
  const {clock} = await mount({mobile: false});
  const selected = node('.game.selected'), focusCalls = watchFocus(selected);
  await navigate('/'); assertOpen(); assert.equal(hasBodyClass('library-tools-closing'), true);
  await clock.advance(519); assertOpen(); assert.deepEqual(focusCalls, []);
  await clock.advance(1); assertClosed(); assert.equal(env.document.activeElement, selected);
});
for (const [label, media] of [
  ['reduced motion', {reduced: true}],
  ['site less motion', {lessMotion: true}],
]) test(`${label}: close settles immediately with no exit timer`, async () => {
  const {clock} = await mount(media);
  const selected = node('.game.selected'), focusCalls = watchFocus(selected);
  await navigate('/');
  assertClosed();
  assert.equal([...clock.tasks.values()].some(task => task.delay === 240), false);
  assert.equal(env.document.activeElement, selected);
  assert.deepEqual(focusCalls, [{options: {preventScroll: true}, inert: false, open: false, closing: false}]);
});

for (const [label, media] of [['coarse pointer', {coarse: true}], ['no hover', {noHover: true}]]) {
  test(`wide ${label} still uses original mobile exit query`, async () => {
    const {clock} = await mount({mobile: false, ...media});
    await navigate('/');
    assertOpen();
    assert.equal(hasBodyClass('library-tools-closing'), true);
    await clock.advance(240);
    assertClosed();
  });
}

test('reopen cancels an old completion and retains the newly selected product', async () => {
  const {clock} = await mount();
  const firstCard = node('.game.selected'), firstFocus = watchFocus(firstCard);
  await navigate('/');
  const oldCompletion = [...clock.tasks.values()].find(task => task.delay === 240);
  assert.ok(oldCompletion);
  await clock.advance(100);
  await navigate('/?game=th07');
  assertOpen('th07');
  assert.equal(hasBodyClass('library-tools-closing'), false);
  assert.equal(node('#gameId').dataset.game, 'th07');
  assert.equal(clock.tasks.has(oldCompletion.id), false);
  await React.act(async () => {oldCompletion.run();});
  await clock.advance(500);
  assertOpen('th07');
  assert.deepEqual(firstFocus, [], 'obsolete callback cannot focus the old selected card');
  const nextCard = node('.game.selected'), nextFocus = watchFocus(nextCard);
  await navigate('/'); await clock.advance(240);
  assertClosed();
  assert.equal(env.document.activeElement, nextCard);
  assert.equal(nextFocus.length, 1);
});

test('repeated closed Router updates do not restart the original deadline', async () => {
  const {clock} = await mount();
  await navigate('/');
  const original = [...clock.tasks.values()].find(task => task.delay === 240);
  await clock.advance(100);
  await navigate('/?keep=still-home');
  assert.equal([...clock.tasks.values()].find(task => task.delay === 240), original);
  await clock.advance(140);
  assertClosed();
  assert.equal(mounted.router.state.location.search, '?keep=still-home');
});

test('context switch retires a library exit without stealing focus in the lobby', async () => {
  const {clock} = await mount();
  const oldCard = node('.game.selected'), focusCalls = watchFocus(oldCard);
  await navigate('/');
  const oldCompletion = [...clock.tasks.values()].find(task => task.delay === 240);
  await navigate('/lobby.html');
  assert.equal(hasBodyClass('library-tools-open'), false);
  assert.equal(hasBodyClass('library-tools-closing'), false);
  assert.equal(clock.tasks.has(oldCompletion.id), false);
  await React.act(async () => {oldCompletion.run();});
  assert.deepEqual(focusCalls, []);
  assert.ok(node('[data-fixture-lobby]'));
});

test('lobby route commits before the shared visual close retires its native carrier', async () => {
  const {clock, observed} = await mount({entry: '/lobby.html?game=th06'});
  await navigate('/lobby.html');
  assert.equal(mounted.router.state.location.search, '');
  assert.equal(observed.at(-1).open, true);
  assert.equal(observed.at(-1).closing, true);
  assert.equal(node('#lobbyOptionsDialog').open, true);
  await clock.advance(240);
  assert.equal(observed.at(-1).open, false);
  assert.equal(observed.at(-1).closing, false);
  assert.equal(hasBodyClass('library-tools-open'), false);
  assert.equal([...clock.tasks.values()].some(task => task.delay === 240), false);
});

test('StrictMode and unmount leave no timer, stale focus callback or body state', async () => {
  const {clock} = await mount({strict: true});
  assertOpen();
  const selected = node('.game.selected'), focusCalls = watchFocus(selected);
  await navigate('/');
  assertOpen();
  const completion = [...clock.tasks.values()].find(task => task.delay === 240);
  assert.ok(completion);
  await unmount();
  assert.equal(clock.tasks.has(completion.id), false);
  await React.act(async () => {completion.run();});
  await clock.advance(500);
  assert.deepEqual(focusCalls, []);
  assert.equal(hasBodyClass('library-tools-open'), false);
  assert.equal(hasBodyClass('library-tools-closing'), false);
});

test('initial closed state never creates a selection or restores focus', async () => {
  const {clock, observed} = await mount({entry: '/', strict: true});
  assert.equal(observed.at(-1).open, false);
  assert.equal(hasBodyClass('library-tools-open'), false);
  assert.equal(hasBodyClass('library-tools-closing'), false);
  assert.equal(env.document.querySelector('.game.selected'), null);
  assert.equal([...clock.tasks.values()].some(task => task.delay === 240), false);
});

// main4564–4573: a running game conceals retained Options; it does not close
// selection or move focus back into the library behind the Player.
test('launched Player conceals retained Options without a close animation or card focus', async () => {
  const {clock} = await mount();
  const panel = node('.tools'), selected = node('.game.selected'), focusCalls = watchFocus(selected);
  await navigate('/?game=th06#playing');
  assertClosed();
  assert.equal(node('.tools'), panel);
  assert.equal(mounted.router.state.location.search, '?game=th06');
  await clock.advance(240);
  assert.equal(focusCalls.length, 0);
  await navigate('/?game=th06');
  assertOpen();
  assert.equal(node('.tools'), panel);
});

for (const context of ['library', 'lobby']) for (const [mobile, duration] of [[true, 200], [false, 480], [true, 360]]) {
  test(`${context}: one common closing CSS change drives the ${duration} ms transform plus margin`, async () => {
    const home = context === 'lobby' ? '/lobby.html' : '/';
    const {clock} = await mount({mobile, entry: `${home}?game=th06`});
    const css = env.document.createElement('style');
    css.textContent = `.tools {transition-property: opacity, transform; transition-duration: 9s, 7s; transition-delay: 0s;} body.library-tools-closing .tools {transition-duration: 9s, ${duration}ms;}`;
    env.document.body.append(css);
    await navigate(home);
    assertOpen();
    assert.equal([...clock.tasks.values()].filter(task => task.delay === duration + 40).length, 1);
    if (context === 'lobby') assert.equal(node('#lobbyOptionsDialog').open, true);
    await clock.advance(duration + 39); assertOpen();
    await clock.advance(1); assertClosed();
    if (context === 'lobby') assert.equal(node('#lobbyOptionsDialog').open, false);
  });
}

test('authored zero transform motion retires immediately rather than using the no-CSS fallback', async () => {
  const {clock} = await mount();
  node('.tools').style.transitionProperty = 'transform';
  node('.tools').style.transitionDuration = '0s';
  await navigate('/'); assertClosed();
  assert.equal([...clock.tasks.values()].some(task => task.delay === 240 || task.delay === 40), false);
});

test('inactive retained carrier cannot capture active card return focus or entrance measurement', async () => {
  const decoy = env.document.createElement('section');
  decoy.innerHTML = '<a class="game selected" href="#wrong">Inactive</a><div class="main library-layout"><aside class="tools"></aside></div>';
  env.document.body.prepend(decoy);
  const wrong = decoy.querySelector('a'), wrongFocus = watchFocus(wrong);
  let measurements = 0;
  decoy.querySelector('.tools').getBoundingClientRect = () => {measurements++; return new env.window.DOMRect();};
  const {clock} = await mount();
  const active = env.document.querySelector('.sheet .game.selected');
  await navigate('/'); await clock.advance(240);
  assert.equal(env.document.activeElement, active);
  assert.deepEqual(wrongFocus, []);
  assert.equal(measurements, 0);
});
