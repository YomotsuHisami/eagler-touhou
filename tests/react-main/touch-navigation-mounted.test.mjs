/** Main-derived mounted React regression. SYNTHETIC DOM/MEMORY ROUTER ONLY.
 * No browser, CSS geometry, mobile, native Runtime, durable storage or game pass.
 * Original tests/test-route-state.mjs and test-touch-settings-browser.py remain intact.
 */
import test, {before, after, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {mkdir, mkdtemp, rm} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {installMountedDom} from './mounted-dom-environment.mjs';

const project = fileURLToPath(new URL('../../', import.meta.url));
let env, work, owners, React, createRoot, createMemoryRouter, RouterProvider;
let mounted = null;

before(async () => {
  env = installMountedDom();
  React = await import('react');
  ({createRoot} = await import('react-dom/client'));
  ({createMemoryRouter, RouterProvider} = await import('react-router'));
  await mkdir(resolve(project, '.cache'), {recursive: true});
  work = await mkdtemp(resolve(project, '.cache/react-main-mounted-'));
  const output = resolve(work, 'actual-entry.mjs');
  await build({
    absWorkingDir: project, stdin: {resolveDir: project, loader: 'ts', contents: `
      export {LauncherApplication} from './app/LauncherApplication.tsx';
      export {createGameSettingsModel} from './app/models/game-settings.ts';
      export {createTouchLayoutModel} from './app/models/touch-layout.ts';
      export {createLibraryProducts} from './app/components/launcher/products.ts';
      export {translate} from './app/i18n.tsx';
      export {useSurfaceNavigation} from './app/navigation/surface-navigation.tsx';
      export {createDecisionStore} from './app/models/decisions.ts';
      export {touchLayoutStorageKey, touchLayoutVersion, touchLayoutControlNames,
        touchLayoutControlMeta, normalizeTouchLayoutPriorityOrder} from './src/launcher/touch-layout-model.mts';
    `},
    bundle: true, platform: 'node', format: 'esm', jsx: 'automatic', outfile: output,
    packages: 'external', logLevel: 'silent',
    plugins: [{name: 'authored-main-mts-siblings', setup(context) {
      // Main NodeNext authored modules name emitted .mjs siblings. Resolve the
      // same authored owner for this TSX test build; no behavior is substituted.
      context.onResolve({filter: /^\.\.?\/.*\.mjs$/}, args => {
        const source = resolve(dirname(args.importer), args.path);
        const authored = source.slice(0, -4) + '.mts';
        return source.startsWith(resolve(project, 'src') + '/') && existsSync(authored) ? {path: authored} : undefined;
      });
    }}],
  });
  owners = await import(pathToFileURL(output).href);
});

afterEach(async () => {
  if (mounted) {
    const current = mounted; mounted = null;
    await React.act(async () => {current.root.unmount();});
    current.router.dispose(); current.host.decisions?.dispose();
    assert.equal(env.document.querySelectorAll('.mizuki-select-menu').length, 0, 'generated select menus are removed after full entry unmount');
    assert.equal(env.document.querySelectorAll('.mizuki-select').length, 0, 'generated select wrappers are removed after full entry unmount');
    assert.deepEqual(current.errors, [], 'actual entry must not report unexpected errors');
    assert.deepEqual(env.errors, [], 'uncaught DOM and React errors fail the synthetic test, even if route assertions pass');
  }
  env?.document.body.replaceChildren();
});
after(async () => {env?.close(); if (work) await rm(work, {recursive: true, force: true});});

class FixtureStorage {
  values = new Map();
  writes = [];
  failLayoutWrites = false;
  getItem(key) {return this.values.get(key) ?? null;}
  setItem(key, value) {
    if (this.failLayoutWrites && key === owners.touchLayoutStorageKey) throw new Error('Synthetic storage quota failure');
    this.writes.push([key, String(value)]); this.values.set(key, String(value));
  }
  removeItem(key) {
    if (this.failLayoutWrites && key === owners.touchLayoutStorageKey) throw new Error('Synthetic storage quota failure');
    this.writes.push([key, null]); this.values.delete(key);
  }
}
function measuredFixtureProfile() {
  const controls = Object.fromEntries(owners.touchLayoutControlNames.map((name, index) => [name, {
    x: .15 + index % 5 * .12, y: .25 + Math.floor(index / 5) * .3,
    scale: name === 'bomb' ? 1.5 : 1, priority: owners.touchLayoutControlMeta[name].priority,
  }]));
  return {controls: owners.normalizeTouchLayoutPriorityOrder(controls), viewport: {x: 0}};
}
async function mountEntry(initialEntries = ['/?keep=1#retained'], {seedLayout = true, failWrites = false, locale = 'en', roomOptionsProduct = null, realDecisions = false, strictMode = false} = {}) {
  env.errors.length = 0;
  const storage = new FixtureStorage();
  if (seedLayout) storage.values.set(owners.touchLayoutStorageKey, JSON.stringify({
    version: owners.touchLayoutVersion, profiles: {landscape: measuredFixtureProfile(), portrait: null},
  }));
  storage.failLayoutWrites = failWrites;
  const settings = owners.createGameSettingsModel({storage});
  const touchLayout = owners.createTouchLayoutModel({storage}); touchLayout.hydrate();
  const errors = [], feedback = [], confirmations = [], confirmationAnswers = [], nativeCalls = [];
  const unexpected = name => {throw new Error(`Unexpected fixture capability: ${name}`);};
  const midi = Object.freeze({enabled: false, granted: false, busy: false, supported: false, outputs: [], selectedId: '', hint: ''});
  const assetUrl = path => `/fixtures/${path}`;
  const decisions = realDecisions ? owners.createDecisionStore() : undefined;
  const host = {
    decisions, locale, products: owners.createLibraryProducts(['th06', 'th07', 'th06mp', 'th07mp'], assetUrl, id => `/?game=${id}`),
    settings, touchLayout, assetUrl, lobbyHref: '/lobby.html',
    settingsContext: (productId, uiLocale) => ({productId, uiLocale, languages: [{id: 'ja', title: '日本語'}],
      musicAvailability: {audio: true, midiAvailable: true, importServer: false, remoteOggAdvertised: false}, webMidiAvailable: false, mobile: false}),
    settingsActions: {
      async confirm(decision) {confirmations.push(decision); if (decisions) return decisions.askConfirmation(decision); assert.ok(confirmationAnswers.length, 'confirmation answer must be explicit'); return confirmationAnswers.shift();},
      async file() {unexpected('file');}, showAppleNotice() {unexpected('Apple notice');},
      feedback: (message, status) => feedback.push({message, status}), reportError: error => errors.push(String(error?.stack || error)),
      externalMidi: {subscribe: () => () => {}, getSnapshot: () => midi,
        async setEnabled() {unexpected('MIDI enable');}, async selectOutput() {unexpected('MIDI output');}},
    },
    nativeTouch: {
      async enterFullscreen() {nativeCalls.push('enterFullscreen'); return false;},
      async exitFullscreen() {nativeCalls.push('exitFullscreen');},
      canSwitchOrientation: () => false, async switchOrientation() {unexpected('orientation');},
      measureDefaults: () => structuredClone(measuredFixtureProfile()),
    },
    // Explicit host-only fixture slots. Settings/editor/navigation are real.
    masthead: React.createElement('header', {'data-fixture-host': true}), footer: null,
    lobby: {masthead: null, onGuide: null, onNetwork: null,
      roomTools: roomOptionsProduct ? React.createElement(FixtureRoomSettingsAction, {product: roomOptionsProduct}) : null, roomList: null,
      hasRooms: false, loading: false, emptyState: null, roomCount: ''},
  };
  const application = React.createElement(owners.LauncherApplication, {host});
  const router = createMemoryRouter([{path: '*', element: strictMode ? React.createElement(React.StrictMode, null, application) : application}],
    {initialEntries, initialIndex: initialEntries.length - 1});
  const container = env.document.createElement('div'); env.document.body.append(container);
  const root = createRoot(container);
  mounted = {host, root, router, storage, errors, feedback, confirmations, confirmationAnswers, nativeCalls};
  await React.act(async () => {root.render(React.createElement(RouterProvider, {router}));});
  await tick(); return mounted;
}
// Explicit missing room-owner port: only supplies an intent to the REAL provider.
// It never changes URL/state itself or substitutes the mounted settings/editor.
function FixtureRoomSettingsAction({product}) {
  const navigation = owners.useSurfaceNavigation();
  return React.createElement('button', {id: 'fixtureRoomSettings', onClick: () => navigation.openOptions(product)}, 'Fixture room settings intent');
}
function node(selector) {const result = env.document.querySelector(selector); assert.ok(result, `Missing actual control ${selector}`); return result;}
function url() {const loc = mounted.router.state.location; return loc.pathname + loc.search + loc.hash;}
async function tick() {await React.act(async () => {await new Promise(resolve => setTimeout(resolve, 25));});}
async function until(predicate, message) {
  const deadline = Date.now() + 2500;
  while (!predicate() && Date.now() < deadline) await tick();
  assert.ok(predicate(), message);
}
async function click(selector) {await React.act(async () => {node(selector).click();}); await tick();}
function hasOptions(productId) {
  return !!env.document.querySelector('.tools[aria-hidden="false"]') && mounted.host.settings.getSnapshot()?.context.productId === productId;
}
function hasEditor() {return !!env.document.querySelector('#touchLayoutEditor') && mounted.host.touchLayout.getSnapshot().isEditing;}
function hasParent(context) {
  return !env.document.querySelector('.tools[aria-hidden="false"]') && !hasEditor() &&
    !!env.document.querySelector(context === 'lobby' ? '.lobby-main' : '#main');
}
async function openOptions(productId) {
  const selector = productId.endsWith('mp') ? `.game[data-product="${productId}"]` : `.game[data-game="${productId}"]:not([data-product])`;
  for (let attempt = 0; attempt < 2 && !hasOptions(productId); attempt++) await click(selector);
  await until(() => hasOptions(productId), `actual options open for ${productId}`);
}
async function openEditor() {
  const mp = mounted.host.settings.getSnapshot().multiplayer;
  const disclosure = mp ? '#mpMobileOptionsToggle' : '#mobileOptionsToggle';
  if (node(disclosure).getAttribute('aria-expanded') !== 'true') await click(disclosure);
  const parentUrl = url();
  await click(mp ? '#mpTouchLayoutEdit' : '#touchLayoutEdit');
  await until(hasEditor, 'actual touch editor and real draft have opened');
  assert.equal(url(), parentUrl, 'main editor creates a same-URL child history entry');
}
async function traverse(delta) {await React.act(async () => {void mounted.router.navigate(delta);}); await tick();}
async function editBomb() {
  const target = node('#touchBomb');
  await React.act(async () => {
    target.dispatchEvent(new env.window.PointerEvent('pointerdown', {bubbles: true, pointerId: 7, pointerType: 'mouse', button: 0, clientX: 175, clientY: 225}));
    env.document.dispatchEvent(new env.window.PointerEvent('pointermove', {bubbles: true, pointerId: 7, pointerType: 'mouse', clientX: 207, clientY: 241}));
    env.document.dispatchEvent(new env.window.PointerEvent('pointerup', {bubbles: true, pointerId: 7, pointerType: 'mouse', clientX: 207, clientY: 241}));
  });
  assert.equal(mounted.host.touchLayout.getSnapshot().dirty, true, 'actual pointer handler changes the real draft');
}
function assertOriginalDiscardCopy(locale = 'en') {
  const dialog = node('#decisionDialog');
  assert.equal(dialog.open, true);
  assert.equal(node('#decisionMessage').textContent, owners.translate(locale, 'touch.layoutDiscardConfirm'));
  assert.equal(node('#decisionConfirm').textContent, owners.translate(locale, 'touch.discardChanges'));
  assert.equal(node('#decisionCancel').textContent, owners.translate(locale, 'action.cancel'));
  assert.equal(env.document.activeElement, node('#decisionCancel'), 'main initially focuses Cancel');
}

for (const {context, entry, product} of [
  {context: 'library', entry: '/?keep=a%20b#retained', product: 'th06'},
  {context: 'lobby', entry: '/lobby.html?game=th06mp&keep=a%20b#retained', product: 'th06mp'},
]) {
  test(`synthetic mounted ${context}: options → touch → Exit → options → Back parent; repeated/double Exit`, async () => {
    await mountEntry([entry]);
    const frame = node('#gameFrame'), player = node('#player'), viewport = node('#gameViewport');
    function assertStablePlayer() {
      assert.equal(env.document.querySelectorAll('iframe').length, 1, 'one direct iframe exists throughout surface navigation');
      assert.equal(node('#gameFrame'), frame, 'route changes retain the exact iframe node');
      assert.equal(node('#player'), player); assert.equal(node('#gameViewport'), viewport);
    }
    assertStablePlayer();
    for (let cycle = 0; cycle < 3; cycle++) {
      await openOptions(product); assertStablePlayer(); const optionsUrl = url();
      if (context === 'lobby') assert.equal(optionsUrl, entry, 'lobby settings do not mutate directory filter URL');
      await openEditor(); assertStablePlayer(); assert.equal(mounted.host.touchLayout.getSnapshot().dirty, false);
      await React.act(async () => {const exit = node('#touchLayoutExit'); exit.click(); exit.click();});
      await until(() => !hasEditor() && hasOptions(product), 'repeated Exit must consume only the editor layer');
      assertStablePlayer(); assert.equal(url(), optionsUrl); assert.equal(node('#decisionDialog').open, false);
      await click('#libraryBack');
      await until(() => hasParent(context), 'one options Back returns to the originating parent');
      assertStablePlayer(); assert.equal(url(), entry); assert.equal(mounted.host.touchLayout.getSnapshot().isEditing, false);
    }
  });

  test(`synthetic mounted ${context}: same-act double options activation creates one parent layer`, async () => {
    await mountEntry([entry]);
    const selector = product.endsWith('mp') ? `.game[data-product="${product}"]` : `.game[data-game="${product}"]:not([data-product])`;
    await React.act(async () => {const card = node(selector); card.click(); card.click();});
    await until(() => hasOptions(product), 'actual card activation opens options');
    await click('#libraryBack');
    await until(() => hasParent(context), 'one Back consumes one options activation, including same-act repeat');
    assert.equal(url(), entry);
  });

  test(`synthetic mounted ${context}: same-act double touch activation creates one child layer`, async () => {
    await mountEntry([entry]); await openOptions(product);
    const mp = mounted.host.settings.getSnapshot().multiplayer;
    await click(mp ? '#mpMobileOptionsToggle' : '#mobileOptionsToggle');
    const optionsUrl = url();
    await React.act(async () => {const edit = node(mp ? '#mpTouchLayoutEdit' : '#touchLayoutEdit'); edit.click(); edit.click();});
    await until(hasEditor, 'actual repeated touch action opens the editor');
    assert.equal(url(), optionsUrl);
    await click('#touchLayoutExit');
    await until(() => !hasEditor() && hasOptions(product), 'one Exit consumes one touch activation, including same-act repeat');
    await click('#libraryBack'); await until(() => hasParent(context), 'no duplicate child or options entry remains');
    assert.equal(url(), entry);
  });

  test(`synthetic mounted ${context}: dirty cancel retains draft; explicit discard consumes one layer`, async () => {
    await mountEntry([entry]); await openOptions(product); await openEditor(); await editBomb();
    const before = structuredClone(mounted.host.touchLayout.getSnapshot().draft), stored = mounted.storage.getItem(owners.touchLayoutStorageKey), editorUrl = url();
    await click('#touchLayoutExit'); assertOriginalDiscardCopy();
    await click('#decisionCancel');
    assert.ok(hasEditor()); assert.equal(url(), editorUrl);
    assert.deepEqual(mounted.host.touchLayout.getSnapshot().draft, before);
    assert.equal(mounted.storage.getItem(owners.touchLayoutStorageKey), stored);
    await traverse(-1); assertOriginalDiscardCopy();
    await click('#decisionCancel');
    assert.ok(hasEditor()); assert.deepEqual(mounted.host.touchLayout.getSnapshot().draft, before);
    await click('#touchLayoutExit'); assertOriginalDiscardCopy(); await click('#decisionConfirm');
    await until(() => !hasEditor() && hasOptions(product), 'discard returns only to options');
    assert.equal(mounted.storage.getItem(owners.touchLayoutStorageKey), stored, 'discard does not persist draft');
    await click('#libraryBack'); await until(() => hasParent(context), 'no stale guard after discard');
  });

  test(`synthetic mounted ${context}: Save stays editor, clears dirty and survives reopen`, async () => {
    await mountEntry([entry]); await openOptions(product); await openEditor(); await editBomb();
    const changed = structuredClone(mounted.host.touchLayout.getSnapshot().draft), editorUrl = url();
    await click('#touchLayoutSave');
    assert.ok(hasEditor()); assert.equal(url(), editorUrl); assert.equal(mounted.host.touchLayout.getSnapshot().dirty, false);
    assert.deepEqual(JSON.parse(mounted.storage.getItem(owners.touchLayoutStorageKey)), changed);
    assert.equal(mounted.feedback.at(-1).status, owners.translate('en', 'touch.layoutSavedStatus'));
    await click('#touchLayoutExit'); await until(() => !hasEditor(), 'saved Exit closes without prompt');
    assert.equal(node('#decisionDialog').open, false); await openEditor();
    assert.deepEqual(mounted.host.touchLayout.getSnapshot().draft, changed);
    assert.equal(mounted.host.touchLayout.getSnapshot().dirty, false);
  });

  test(`synthetic mounted ${context}: retired Forward shows options, then Back options, then parent`, async () => {
    await mountEntry([entry]); await openOptions(product); const optionsUrl = url(); await openEditor();
    await click('#touchLayoutExit'); await until(() => !hasEditor(), 'Exit closes editor');
    await traverse(1); await until(() => hasOptions(product) && !hasEditor(), 'Forward cannot recreate a retired editor');
    assert.equal(url(), optionsUrl); assert.equal(mounted.router.state.location.state?.launcherTouchEntry, undefined);
    await traverse(-1); assert.ok(hasOptions(product)); assert.ok(!hasEditor()); assert.equal(url(), optionsUrl);
    await traverse(-1); await until(() => hasParent(context), 'next Back reaches original parent'); assert.equal(url(), entry);
  });
}

test('synthetic mounted: blocked storage Save retains session layout and original session-only feedback', async () => {
  await mountEntry(['/?game=th06&keep=1#retained'], {failWrites: true});
  const persistedBefore = mounted.storage.getItem(owners.touchLayoutStorageKey);
  await openEditor(); await editBomb(); const changed = structuredClone(mounted.host.touchLayout.getSnapshot().draft);
  await click('#touchLayoutSave');
  assert.ok(hasEditor()); assert.equal(mounted.host.touchLayout.getSnapshot().dirty, false);
  assert.equal(mounted.host.touchLayout.getSnapshot().lastSave.persisted, false);
  assert.equal(mounted.storage.getItem(owners.touchLayoutStorageKey), persistedBefore);
  assert.deepEqual(mounted.host.touchLayout.getSnapshot().saved, changed);
  assert.deepEqual(mounted.feedback.at(-1), {
    message: owners.translate('en', 'touch.layoutSessionOnly'), status: owners.translate('en', 'touch.layoutSessionOnlyStatus'),
  });
  await click('#touchLayoutExit'); await until(() => !hasEditor(), 'session Save permits clean Exit');
  await openEditor(); assert.deepEqual(mounted.host.touchLayout.getSnapshot().draft, changed, 'same document retains session-only value');
});

test('synthetic mounted: direct options closes by replacement and preserves unrelated address/state', async () => {
  await mountEntry([{pathname: '/', search: '?game=th07&keep=a%20b', hash: '#retained', state: {unrelated: 7}}]);
  assert.ok(hasOptions('th07')); await openEditor(); await click('#touchLayoutExit');
  await until(() => !hasEditor() && hasOptions('th07'), 'direct options is retained beneath editor');
  await click('#libraryBack'); await until(() => hasParent('library'), 'direct options Back has a safe in-app parent');
  assert.equal(mounted.router.state.historyAction, 'REPLACE');
  assert.equal(new URL(url(), 'https://launcher.invalid').searchParams.get('keep'), 'a b');
  assert.equal(mounted.router.state.location.hash, '#retained');
  assert.equal(mounted.router.state.location.state.unrelated, 7);
});

test('synthetic mounted: reloaded retired touch state and obsolete touch query do not invent an editor', async () => {
  const address = '/?game=th06&keep=1#retained';
  await mountEntry([{pathname: '/', search: '?game=th06&keep=1', hash: '#retained', key: 'retired',
    state: {unrelated: 7, launcherTouchEntry: {version: 1, surface: 'touch', parentKey: 'parent', href: address}}}]);
  await until(() => hasOptions('th06') && !mounted.router.state.location.state?.launcherTouchEntry, 'stale touch marker is normalized');
  assert.ok(!hasEditor()); assert.equal(url(), address); assert.equal(mounted.router.state.location.state.unrelated, 7);
  assert.deepEqual(mounted.nativeCalls, [], 'reload does not silently enter native editor capabilities');
  await React.act(async () => {void mounted.router.navigate('/?game=th06&touchLayout=1&keep=1#retained');});
  await until(() => !mounted.router.state.location.search.includes('touchLayout'), 'old candidate touch query normalizes to parent');
  assert.ok(hasOptions('th06')); assert.ok(!hasEditor());
});

test('synthetic mounted: reset is draft-only; discard retains prior stored layout', async () => {
  await mountEntry(['/?game=th06']); await openEditor(); await editBomb(); await click('#touchLayoutSave');
  const stored = mounted.storage.getItem(owners.touchLayoutStorageKey);
  mounted.confirmationAnswers.push(true); await click('#touchLayoutReset');
  assert.equal(mounted.confirmations.at(-1).confirmText, owners.translate('en', 'touch.restoreDefault'));
  assert.equal(mounted.storage.getItem(owners.touchLayoutStorageKey), stored, 'Reset does not persist before Save');
  assert.equal(mounted.host.touchLayout.getSnapshot().dirty, true);
  await click('#touchLayoutExit'); assertOriginalDiscardCopy(); await click('#decisionConfirm');
  await until(() => !hasEditor(), 'discard after Reset closes editor');
  assert.equal(mounted.storage.getItem(owners.touchLayoutStorageKey), stored);
});

test('synthetic mounted lobby: another room product opens settings without replacing directory filter or encoded URL', async () => {
  const entry = '/lobby.html?game=th06mp&keep=a%20b#retained';
  await mountEntry([entry], {roomOptionsProduct: 'th07mp'});
  await click('#fixtureRoomSettings'); await until(() => hasOptions('th07mp'), 'real shared settings use the room product');
  assert.equal(url(), entry, 'settings product is independent of directory filter');
  assert.equal(node('#lobbyGameRail .game.nav-preview').dataset.product, 'th06mp', 'directory rail retains its own filter selection');
  await openEditor(); await click('#touchLayoutExit'); await until(() => !hasEditor(), 'room-origin editor closes');
  await traverse(1); await until(() => hasOptions('th07mp') && !hasEditor(), 'retired Forward retains room product options');
  assert.equal(url(), entry, 'retired marker cleanup preserves raw query encoding');
  assert.equal(mounted.router.state.location.state.launcherSurfaceEntry.productId, 'th07mp');
  assert.equal(mounted.router.state.location.state.launcherTouchEntry, undefined);
  await traverse(-1); assert.ok(hasOptions('th07mp')); await traverse(-1);
  await until(() => hasParent('lobby'), 'room options predecessor remains directory'); assert.equal(url(), entry);
});

test('synthetic mounted: native dialog cancel (Escape contract) retains dirty draft and consumes no parent navigation', async () => {
  await mountEntry(['/?game=th06'], {locale: 'zh-CN'}); await openEditor(); await editBomb();
  const before = structuredClone(mounted.host.touchLayout.getSnapshot().draft), address = url();
  await click('#touchLayoutExit'); assertOriginalDiscardCopy('zh-CN');
  await React.act(async () => {node('#decisionDialog').dispatchEvent(new env.window.Event('cancel', {cancelable: true}));});
  await tick(); assert.equal(node('#decisionDialog').open, false); assert.ok(hasEditor()); assert.equal(url(), address);
  assert.deepEqual(mounted.host.touchLayout.getSnapshot().draft, before);
  await click('#touchLayoutExit'); assertOriginalDiscardCopy('zh-CN'); await click('#decisionConfirm');
  await until(() => !hasEditor() && hasOptions('th06'), 'later explicit discard still closes exactly one layer');
});

test('synthetic mounted: superseded blocked destination never reuses old discard consent', async () => {
  await mountEntry(['/?game=th06&keep=1']); await openEditor(); await editBomb();
  const before = structuredClone(mounted.host.touchLayout.getSnapshot().draft), address = url();
  await click('#touchLayoutExit'); assertOriginalDiscardCopy();
  const previousConfirm = node('#decisionConfirm');
  await React.act(async () => {void mounted.router.navigate('/?game=th07&keep=1');});
  await until(() => !node('#decisionDialog').open, 'superseded destination cancels the previous decision');
  assert.ok(hasEditor()); assert.equal(url(), address);
  assert.deepEqual(mounted.host.touchLayout.getSnapshot().draft, before);
  await React.act(async () => {previousConfirm.click();}); await tick();
  assert.ok(hasEditor()); assert.deepEqual(mounted.host.touchLayout.getSnapshot().draft, before, 'stale confirm cannot discard the current draft');
  await click('#touchLayoutExit'); assertOriginalDiscardCopy(); await click('#decisionConfirm');
  await until(() => !hasEditor() && hasOptions('th06'), 'new explicit consent applies only to the new close intent');
});


test('main-derived decision store: occupied request is not replaced; secondary/cancel map false; disposal cancels', async () => {
  const store = owners.createDecisionStore();
  const first = store.askDecision({message: 'Original request', secondaryText: 'Background'}), original = store.getSnapshot();
  assert.equal(await store.askDecision({message: 'Must not replace'}), 'cancel'); assert.equal(store.getSnapshot(), original);
  store.resolve('secondary'); assert.equal(await first, 'secondary');
  for (const choice of ['secondary', 'cancel', 'confirm']) {
    const pending = store.askConfirmation({}); store.resolve(choice); assert.equal(await pending, choice === 'confirm');
  }
  store.setNavigationDecisionOpen(true); assert.equal(await store.askDecision({}), 'cancel'); assert.equal(store.getSnapshot(), null);
  store.setNavigationDecisionOpen(false); const pending = store.askDecision({}); store.dispose(); assert.equal(await pending, 'cancel');
});

test('synthetic mounted decisions: secondary and hidden Cancel retain original focus/Enter/returnValue semantics without history', async () => {
  await mountEntry(['/?game=th06'], {realDecisions: true});
  node('#libraryBack').focus(); const originalFocus = env.document.activeElement, key = mounted.router.state.location.key;
  let first;
  await React.act(async () => {first = mounted.host.decisions.askDecision({message: 'Fixture decision', secondaryText: 'Background', confirmOnEnter: false});});
  const firstDialog = node('#decisionDialog');
  assert.equal(env.document.querySelectorAll('#decisionDialog').length, 1); assert.equal(firstDialog.dataset.options, '3');
  assert.equal(env.document.activeElement, node('#decisionCancel'));
  await React.act(async () => {node('#decisionConfirm').dispatchEvent(new env.window.KeyboardEvent('keydown', {key: 'Enter', bubbles: true, cancelable: true}));});
  assert.ok(node('#decisionDialog').open, 'Enter does not confirm unless explicitly enabled');
  await click('#decisionSecondary'); assert.equal(await first, 'secondary'); assert.equal(firstDialog.open, false); assert.equal(firstDialog.returnValue, 'secondary');
  assert.equal(env.document.activeElement, originalFocus); assert.equal(mounted.router.state.location.key, key);
  let second;
  await React.act(async () => {second = mounted.host.decisions.askDecision({message: 'No cancel button', secondaryText: 'Other', hideCancel: true, confirmOnEnter: true});});
  const secondDialog = node('#decisionDialog');
  assert.equal(node('#decisionCancel').hidden, true); assert.equal(secondDialog.dataset.options, '2');
  assert.equal(env.document.activeElement, node('#decisionConfirm'));
  await React.act(async () => {node('#decisionConfirm').dispatchEvent(new env.window.KeyboardEvent('keydown', {key: 'Enter', bubbles: true, cancelable: true}));});
  assert.equal(await second, 'confirm'); assert.equal(secondDialog.open, false); assert.equal(secondDialog.returnValue, 'confirm');
  assert.equal(mounted.router.state.location.key, key); assert.equal(env.document.activeElement, originalFocus);
});

test('synthetic mounted decisions: existing application prompt wins over dirty Back; blocker rejects competing app prompt', async () => {
  await mountEntry(['/?game=th06'], {realDecisions: true}); await openEditor(); await editBomb();
  const draft = structuredClone(mounted.host.touchLayout.getSnapshot().draft), address = url(); let appDecision;
  await React.act(async () => {appDecision = mounted.host.decisions.askDecision({message: 'Application prompt'});});
  await traverse(-1); assert.equal(node('#decisionMessage').textContent, 'Application prompt'); assert.ok(hasEditor()); assert.equal(url(), address);
  assert.deepEqual(mounted.host.touchLayout.getSnapshot().draft, draft);
  await click('#decisionCancel'); assert.equal(await appDecision, 'cancel');
  await click('#touchLayoutExit'); assertOriginalDiscardCopy();
  assert.equal(await mounted.host.decisions.askDecision({message: 'Competing app prompt'}), 'cancel'); assertOriginalDiscardCopy();
  await click('#decisionCancel'); assert.ok(hasEditor()); assert.deepEqual(mounted.host.touchLayout.getSnapshot().draft, draft);
});

test('synthetic mounted StrictMode: cancelled touch movement restores actual native/custom select across repeated editor mounts', async () => {
  await mountEntry(['/?keep=1'], {realDecisions: true, strictMode: true});
  for (let cycle = 0; cycle < 3; cycle++) {
    await openOptions('th06'); const retainedSelects = env.document.querySelectorAll('.mizuki-select').length; await openEditor();
    const select = node('#touchMovementMode'), wrapper = select.closest('.mizuki-select'); assert.ok(wrapper);
    assert.equal(wrapper.querySelectorAll('.mizuki-select-trigger').length, 1);
    assert.equal(env.document.querySelectorAll('#touchMovementMode').length, 1);
    const trigger = wrapper.querySelector('.mizuki-select-trigger'), before = select.value, label = wrapper.querySelector('.mizuki-select-value').textContent;
    const savedBefore = new Map(mounted.storage.values), optionsBefore = structuredClone(mounted.host.settings.getSnapshot().options);
    await React.act(async () => {trigger.click();});
    const menu = node('.mizuki-select-menu:not([hidden])');
    await React.act(async () => {menu.querySelector('[data-value="touch-unlimited"]').click();}); await tick();
    assert.equal(node('#decisionMessage').textContent, owners.translate('en', 'touch.unlimitedWarning'));
    await click('#decisionCancel');
    assert.equal(select.value, before); assert.equal(wrapper.querySelector('.mizuki-select-value').textContent, label);
    assert.deepEqual(mounted.host.settings.getSnapshot().options, optionsBefore); assert.deepEqual(mounted.storage.values, savedBefore);
    assert.equal(env.document.querySelectorAll('.mizuki-select-menu:not([hidden])').length, 0);
    await click('#touchLayoutExit'); await until(() => !hasEditor() && hasOptions('th06'), 'StrictMode editor Exit retains parent');
    assert.equal(env.document.querySelector('#touchMovementMode'), null);
    await click('#libraryBack'); await until(() => hasParent('library'), 'StrictMode repeated Back has no duplicate owner');
    // Main retains the selected settings panel during its closing transition.
    // Only editor owners unmount here; full entry teardown is checked afterEach.
    assert.equal(env.document.querySelectorAll('.mizuki-select').length, retainedSelects, 'no editor wrapper leaks into the retained options panel');
    assert.equal(env.document.querySelectorAll('.mizuki-select-menu:not([hidden])').length, 0);
    for (const live of env.document.querySelectorAll('select.custom-select-native')) assert.equal(live.closest('.mizuki-select').querySelectorAll('.mizuki-select-trigger').length, 1);
  }
});

for (const context of ['library', 'lobby']) test(`synthetic mounted reload: old ${context} options/touch marker respects main document-lifetime policy`, async () => {
  // Main lobby.mts58–65 starts reloaded directory without an options sheet;
  // main route-state preserves a library product's explicit ?game address.
  const pathname = context === 'lobby' ? '/lobby.html' : '/', product = context === 'lobby' ? 'th06mp' : 'th06';
  const search = `?game=${product}&keep=a%20b`, hash = '#retained', address = pathname + search + hash;
  await mountEntry([{pathname, search, hash, state: {unrelated: 7,
    launcherSurfaceEntry: {version: 1, surface: 'options', session: 'previous-document', productId: product, parentKey: 'old-parent', href: address},
    launcherTouchEntry: {version: 1, surface: 'touch', parentKey: 'old-options', href: address},
  }}]);
  await until(() => !mounted.router.state.location.state?.launcherTouchEntry, 'reloaded editor marker is retired');
  assert.equal(url(), address); assert.equal(mounted.router.state.location.state.unrelated, 7);
  assert.ok(!hasEditor()); assert.deepEqual(mounted.nativeCalls, []);
  if (context === 'lobby') {
    assert.ok(hasParent('lobby')); assert.equal(mounted.router.state.location.state.launcherSurfaceEntry, undefined);
    assert.equal(node('#lobbyGameRail .game.nav-preview').dataset.product, product);
  } else assert.ok(hasOptions(product));
});
