/** Synthetic DOM + real Router/provider policy tests only. Main i18n891–918,
 * dialog-navigation and app5338–5383 are the contract. This is not a rendered
 * Launcher/browser/game/visual acceptance suite; that entry has separate tests. */
import test, {before, after, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir, mkdtemp, rm} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {installMountedDom} from './mounted-dom-environment.mjs';

const project = fileURLToPath(new URL('../../', import.meta.url));
let env, work, React, createRoot, createMemoryRouter, RouterProvider, owner, mounted;
before(async () => {
  env = installMountedDom();
  React = await import('react');
  ({createRoot} = await import('react-dom/client'));
  ({createMemoryRouter, RouterProvider} = await import('react-router'));
  await mkdir(resolve(project, '.cache'), {recursive: true});
  work = await mkdtemp(resolve(project, '.cache/navigation-policy-'));
  const file = resolve(work, 'policy.mjs');
  await build({absWorkingDir: project, stdin: {resolveDir: project, loader: 'ts', contents: `
    export {SurfaceNavigationProvider, useSurfaceNavigation} from './app/navigation/surface-navigation.tsx';
    export {LocaleProvider} from './app/i18n.tsx';
  `}, bundle: true, platform: 'node', format: 'esm', jsx: 'automatic', outfile: file, packages: 'external', logLevel: 'silent',
  plugins: [{name: 'main-authored-siblings', setup(context) {
    context.onResolve({filter: /^\.\.?\/.*\.mjs$/}, args => {
      const source = resolve(dirname(args.importer), args.path), authored = source.slice(0, -4) + '.mts';
      return source.startsWith(resolve(project, 'src') + '/') && existsSync(authored) ? {path: authored} : undefined;
    });
  }}]});
  owner = await import(pathToFileURL(file).href);
});
afterEach(async () => {
  if (mounted) {
    await React.act(async () => {mounted.root.unmount();});
    mounted.router.dispose(); mounted = null;
  }
  env.document.body.replaceChildren();
});
after(async () => {env?.close(); if (work) await rm(work, {recursive: true, force: true});});
async function settle(action = () => {}) {
  await React.act(async () => {action(); await new Promise(resolve => setTimeout(resolve, 5));});
}
function href() {const {pathname, search, hash} = mounted.router.state.location; return pathname + search + hash;}
async function mount(initial = {pathname: '/', search: '?keep=a%20b', hash: '#original', state: {unrelated: 7}}) {
  const controls = {navigation: null, setEditing: null, setDirty: null, setPlayer: null, setTitle: null, discardCount: 0, closeCount: 0, closeResult: true, leaveCount: 0, available: () => true, routeSelections: []};
  function Probe({editing, endEditing}) {
    const navigation = owner.useSurfaceNavigation(); controls.navigation = navigation;
    React.useEffect(() => {if (editing && navigation.surface !== 'touch') endEditing(false);}, [editing, navigation.surface]);
    return null;
  }
  function Harness() {
    const [editing, setEditing] = React.useState(false), [dirty, setDirty] = React.useState(false), [player, setPlayer] = React.useState(false), [title, setTitle] = React.useState(false);
    Object.assign(controls, {setEditing, setDirty, setPlayer, setTitle});
    return React.createElement(owner.LocaleProvider, {locale: 'en'}, React.createElement(owner.SurfaceNavigationProvider, {
      isEditing: editing, dirty, playerOpen: player, titleOverlayOpen: title,
      productAvailable: product => controls.available(product), onRouteSelection: product => controls.routeSelections.push(product),
      onDiscard: () => {controls.discardCount++; setDirty(false); setEditing(false);},
      requestRoomLeave: () => {controls.leaveCount++; const {productId, fromDirectory} = controls.navigation; if (title) {setTitle(false); controls.navigation.leaveTitleRoomRoute('th09');} else controls.navigation.leaveRoomRoute({product: productId, fromDirectory});},
      requestRuntimeClose: async () => {controls.closeCount++; const result = await controls.closeResult; if (result) {setPlayer(false); setTitle(false);} return result;},
    }, React.createElement(Probe, {editing, endEditing: setEditing})));
  }
  const router = createMemoryRouter([{path: '*', element: React.createElement(Harness)}], {initialEntries: [initial]});
  const element = env.document.createElement('div'); env.document.body.append(element);
  const root = createRoot(element); mounted = {root, router, controls};
  await settle(() => root.render(React.createElement(RouterProvider, {router})));
  return controls;
}
const state = () => mounted.router.state.location.state;
const decisionOpen = () => env.document.getElementById('decisionDialog').open;

for (const context of ['library', 'lobby']) test(`policy: locale replacement preserves dirty touch and informational parent in ${context}`, async () => {
  const initial = {pathname: context === 'lobby' ? '/lobby.html' : '/', search: '?game=th06mp&keep=a%20b', hash: '#original', state: {unrelated: 7}};
  const controls = await mount(initial);
  if (context === 'lobby') await settle(() => controls.navigation.openOptions('th07mp'));
  const optionsAddress = href();
  await settle(() => controls.navigation.openTouchLayout());
  // Actual entry begins its model only after the editor surface is mounted.
  await settle(() => {controls.setEditing(true); controls.setDirty(true);});
  assert.equal(controls.navigation.surface, 'touch');
  const touchParent = state().launcherTouchEntry.parentKey;
  await settle(() => controls.navigation.openInfoDialog('appleRefreshDialog'));
  await settle(() => controls.navigation.openInfoDialog('donationDialog'));
  assert.equal(decisionOpen(), false, 'informational descendants never discard underlying draft');
  const infoParent = state().launcherInformationDialogs.parentKey;
  await settle(() => controls.navigation.setLocaleAddress('en'));
  assert.equal(href(), `${context === 'lobby' ? '/lobby.html' : '/en.html'}?game=th06mp&keep=a%20b#original`);
  assert.equal(mounted.router.state.historyAction, 'REPLACE');
  assert.equal(controls.navigation.surface, 'touch');
  assert.equal(controls.discardCount, 0); assert.equal(decisionOpen(), false);
  assert.equal(state().unrelated, 7);
  assert.equal(state().launcherTouchEntry.parentKey, touchParent);
  assert.equal(state().launcherTouchEntry.href, href());
  assert.equal(state().launcherInformationDialogs.parentKey, infoParent);
  assert.equal(state().launcherInformationDialogs.href, href());
  assert.equal(controls.navigation.infoDialogOpen('appleRefreshDialog'), true);
  assert.equal(controls.navigation.infoDialogOpen('donationDialog'), true);
  await settle(() => controls.navigation.closeSurface());
  assert.equal(controls.navigation.infoDialogOpen('donationDialog'), false);
  assert.equal(controls.navigation.infoDialogOpen('appleRefreshDialog'), true);
  assert.equal(href(), optionsAddress, 'older parent address remains unchanged as in main');
  assert.equal(controls.navigation.surface, 'touch'); assert.equal(controls.discardCount, 0);
  await settle(() => controls.navigation.closeSurface());
  assert.equal(controls.navigation.infoDialogOpen('appleRefreshDialog'), false);
  assert.equal(controls.navigation.surface, 'touch'); assert.equal(decisionOpen(), false);
  await settle(() => controls.navigation.closeSurface());
  assert.equal(decisionOpen(), true, 'actual editor exit still requires discard after locale/info navigation');
});

test('policy: locale replaces directory form URL without adding a history layer or losing its mode', async () => {
  const controls = await mount({pathname: '/lobby.html', search: '?game=th06mp&keep=a%20b', hash: '#original', state: {unrelated: 7}});
  const directory = href();
  await settle(() => controls.navigation.openDirectoryForm('join'));
  const parent = state().launcherDirectoryForm.parentKey;
  await settle(() => controls.navigation.setLocaleAddress('en'));
  assert.equal(href(), directory); assert.equal(controls.navigation.directoryFormMode, 'join');
  assert.equal(state().launcherDirectoryForm.parentKey, parent);
  assert.equal(state().unrelated, 7);
  await settle(() => controls.navigation.closeSurface());
  assert.equal(controls.navigation.directoryFormMode, null); assert.equal(href(), directory);
});

test('policy: locale replacement does not sync or close direct-query running player', async () => {
  const controls = await mount({pathname: '/', search: '?game=th06&keep=a%20b', hash: '#original', state: {unrelated: 7}});
  await settle(() => controls.setPlayer(true));
  await settle(() => controls.navigation.setLocaleAddress('en'));
  assert.equal(href(), '/en.html?game=th06&keep=a%20b#original');
  assert.equal(controls.navigation.playerOpen, true); assert.equal(controls.closeCount, 0);
  assert.equal(decisionOpen(), false); assert.equal(state().unrelated, 7);
  await settle(() => controls.navigation.setLocaleAddress('zh-CN'));
  assert.equal(href(), '/?game=th06&keep=a%20b#original'); assert.equal(controls.closeCount, 0);
});

test('policy: ordinary owned player Exit silently waits save, reuses product entry, then reaches home', async () => {
  const controls = await mount(); const home = href();
  await settle(() => controls.navigation.openOptions('th06'));
  const optionsKey = mounted.router.state.location.key;
  await settle(() => {controls.navigation.openPlayer('th06'); controls.setPlayer(true);});
  assert.equal(mounted.router.state.location.key, optionsKey, 'Start inserts no second player history entry');
  let finish; controls.closeResult = new Promise(resolve => {finish = resolve;});
  await settle(() => {controls.navigation.closeSurface(); controls.navigation.closeSurface();});
  assert.equal(controls.closeCount, 1); assert.equal(controls.navigation.playerOpen, true);
  assert.equal(mounted.router.state.location.key, optionsKey); assert.equal(decisionOpen(), false);
  await settle(() => finish(true));
  assert.equal(controls.navigation.playerOpen, false); assert.equal(controls.navigation.surface, 'library'); assert.equal(href(), home);
});

test('policy: Stay retains player and allows a later close retry', async () => {
  const controls = await mount(); await settle(() => controls.navigation.openOptions('th06'));
  await settle(() => controls.setPlayer(true)); controls.closeResult = false;
  const before = href(); await settle(() => controls.navigation.closeSurface());
  assert.equal(controls.navigation.playerOpen, true); assert.equal(href(), before); assert.equal(controls.closeCount, 1);
  controls.closeResult = true; await settle(() => controls.navigation.closeSurface());
  assert.equal(controls.closeCount, 2); assert.equal(controls.navigation.surface, 'library');
});

const inviteEntry = (invite, state = {unrelated: 7}) => ({pathname: '/', search: `?j=${Buffer.from(JSON.stringify(invite)).toString('base64url')}&keep=a%20b`, hash: '#original', state});

test('policy: canonical direct room restores context once, reload keeps room without launching', async () => {
  const controls = await mount(inviteEntry({g: 'th06mp', r: '4079'}));
  assert.equal(controls.navigation.surface, 'room'); assert.equal(controls.navigation.roomCode, '4079');
  assert.equal(controls.navigation.playerOpen, false); assert.equal(controls.closeCount, 0);
  await settle(() => {controls.navigation.restoreRoomRoute({product: 'th06mp', code: '4079', fromDirectory: false}); controls.navigation.restoreRoomRoute({product: 'th06mp', code: '4079', fromDirectory: false});});
  assert.equal(state().eaglerTouhouMpRoom, '4079'); assert.equal(state().unrelated, 7);
  const roomKey = mounted.router.state.location.key;
  await settle(() => controls.navigation.restoreRoomRoute({product: 'th06mp', code: '4079', fromDirectory: false}));
  assert.equal(mounted.router.state.location.key, roomKey, 'managed reload/restore does not seed another entry');
  await settle(() => mounted.router.navigate(-1));
  await settle();
  assert.equal(controls.leaveCount, 1); assert.equal(controls.navigation.surface, 'options');
  assert.equal(controls.navigation.productId, 'th06mp');
  await settle(() => controls.navigation.closeSurface());
  assert.equal(controls.navigation.surface, 'library', 'Back departure computes options from the popped home, not a stale room');
});

for (const method of ['button', 'browser']) test(`policy: MP player ${method} close returns room first, subsequent Back leaves membership`, async () => {
  const controls = await mount();
  await settle(() => controls.navigation.openOptions('th06mp'));
  await settle(() => controls.navigation.enterRoomRoute({product: 'th06mp', code: '4079'}));
  const roomKey = mounted.router.state.location.key;
  await settle(() => {controls.navigation.openPlayer('th06mp'); controls.setPlayer(true);});
  assert.equal(mounted.router.state.location.key, roomKey, 'room launch does not create options');
  await settle(() => controls.navigation.openInfoDialog('lobbyNetworkDialog'));
  await settle(() => controls.navigation.closeSurface());
  assert.equal(controls.closeCount, 0, 'informational Back has priority over the live player');
  let finish; controls.closeResult = new Promise(resolve => {finish = resolve;});
  await settle(() => method === 'button' ? controls.navigation.closeSurface() : mounted.router.navigate(-1));
  assert.equal(controls.closeCount, 1); assert.equal(controls.navigation.playerOpen, true);
  assert.equal(controls.navigation.surface, 'room'); assert.equal(decisionOpen(), false);
  await settle(() => finish(true));
  assert.equal(controls.navigation.playerOpen, false); assert.equal(controls.navigation.surface, 'room');
  if (method === 'browser') assert.equal(mounted.router.state.location.key, roomKey);
  else assert.equal(mounted.router.state.historyAction, 'REPLACE', 'manual Exit applies original returnToRoom normalization');
  assert.equal(controls.leaveCount, 0);
  await settle(() => mounted.router.navigate(-1)); await settle();
  assert.equal(controls.leaveCount, 1); assert.equal(controls.navigation.surface, 'options');
  await settle(() => controls.navigation.closeSurface());
  assert.equal(controls.navigation.surface, 'library');
});

test('policy: directory create token settles one-shot intent, preserves return origin and leaves to directory', async () => {
  const controls = await mount(inviteEntry({g: 'th06mp', r: '4079', f: true, a: 'create', p: 3, d: 2, v: 'private', c: true}));
  assert.equal(controls.navigation.surface, 'room'); assert.equal(controls.navigation.fromDirectory, true);
  await settle(() => controls.navigation.restoreRoomRoute({product: 'th06mp', code: '4079', fromDirectory: true}));
  await settle(() => controls.navigation.settleRoomInvite());
  const token = new URLSearchParams(mounted.router.state.location.search).get('j');
  assert.deepEqual(JSON.parse(Buffer.from(token, 'base64url').toString()), {g: 'th06mp', r: '4079', f: true});
  assert.equal(controls.navigation.playerOpen, false); assert.equal(state().unrelated, 7);
  await settle(() => controls.navigation.closeSurface());
  assert.equal(controls.leaveCount, 1); assert.equal(href(), '/lobby.html?game=th06mp');
  assert.equal(controls.navigation.surface, 'library'); assert.equal(controls.navigation.context, 'lobby');
});

test('policy: legacy room URL remains a room and managed reload keeps its entry', async () => {
  const controls = await mount({pathname: '/en.html', search: '?game=th07mp&mpRoom=4079&fromLobby=1&lobbyAction=join', hash: '#legacy', state: {eaglerTouhouMpRoom: '4079'}});
  const key = mounted.router.state.location.key;
  assert.equal(controls.navigation.surface, 'room'); assert.equal(controls.navigation.fromDirectory, true);
  await settle(() => controls.navigation.restoreRoomRoute({product: 'th07mp', code: '4079', fromDirectory: true}));
  assert.equal(mounted.router.state.location.key, key);
  await settle(() => controls.navigation.settleRoomInvite());
  assert.equal(href(), '/en.html?game=th07mp&mpRoom=4079&fromLobby=1#legacy');
});

for (const method of ['button', 'browser']) test(`policy: original directory-origin manual Exit versus browser Back distinction (${method})`, async () => {
  const controls = await mount({pathname: '/lobby.html', search: '?game=th06mp', hash: '', state: null});
  const invite = inviteEntry({g: 'th06mp', r: '4079', f: true});
  await settle(() => mounted.router.navigate(invite));
  await settle(() => controls.navigation.restoreRoomRoute({product: 'th06mp', code: '4079', fromDirectory: true}));
  await settle(() => controls.setPlayer(true));
  await settle(() => method === 'button' ? controls.navigation.closeSurface() : mounted.router.navigate(-1));
  assert.equal(controls.navigation.surface, 'room'); assert.equal(controls.navigation.playerOpen, false);
  assert.equal(controls.navigation.fromDirectory, method === 'browser',
    'main manual returnToRoom re-encodes {g,r}; browser Back uses history.forward and retains f');
  await settle(() => controls.navigation.closeSurface());
  assert.equal(controls.leaveCount, 1);
  assert.equal(controls.navigation.context, method === 'browser' ? 'lobby' : 'library');
  assert.equal(controls.navigation.surface, method === 'browser' ? 'library' : 'options');
});

test('policy: room secondary panel switches in place, consumes one layer, and retired Forward does not reopen', async () => {
  const controls = await mount(inviteEntry({g: 'th06mp', r: '4079'}));
  await settle(() => controls.navigation.restoreRoomRoute({product: 'th06mp', code: '4079', fromDirectory: false}));
  const room = href();
  await settle(() => {controls.navigation.openRoomPanel('network', 'peer123'); controls.navigation.openRoomPanel('network', 'peer123');});
  assert.equal(controls.navigation.roomPanel, 'network'); assert.equal(controls.navigation.roomNetworkPeer, 'peer123');
  const parent = state().launcherRoomPanel.parentKey;
  await settle(() => controls.navigation.openRoomPanel('spectators'));
  assert.equal(mounted.router.state.historyAction, 'REPLACE'); assert.equal(state().launcherRoomPanel.parentKey, parent);
  await settle(() => controls.navigation.closeSurface());
  assert.equal(controls.navigation.roomPanel, null); assert.equal(controls.navigation.surface, 'room'); assert.equal(controls.leaveCount, 0);
  await settle(() => mounted.router.navigate(1));
  assert.equal(controls.navigation.roomPanel, null); assert.equal(state().launcherRoomPanel, undefined);
  assert.equal(href(), room); assert.equal(controls.leaveCount, 0);
});

test('policy: room drawer → dirty touch → cancel/discard → drawer → room keeps original top-layer priority', async () => {
  const controls = await mount(inviteEntry({g: 'th06mp', r: '4079'}));
  await settle(() => controls.navigation.restoreRoomRoute({product: 'th06mp', code: '4079', fromDirectory: false}));
  await settle(() => controls.navigation.openRoomSettings());
  assert.equal(controls.navigation.roomSettingsOpen, true);
  await settle(() => controls.navigation.openTouchLayout());
  await settle(() => {controls.setEditing(true); controls.setDirty(true);});
  assert.equal(controls.navigation.surface, 'touch');
  await settle(() => controls.navigation.setLocaleAddress('en'));
  assert.equal(controls.navigation.roomSettingsOpen, true); assert.equal(controls.navigation.surface, 'touch');
  await settle(() => controls.navigation.openInfoDialog('appleRefreshDialog'));
  await settle(() => controls.navigation.closeSurface());
  assert.equal(decisionOpen(), false); assert.equal(controls.navigation.surface, 'touch');
  await settle(() => controls.navigation.closeSurface());
  assert.equal(decisionOpen(), true);
  await settle(() => env.document.getElementById('decisionDialog').dispatchEvent(new env.window.Event('cancel', {cancelable: true})));
  await settle(); assert.equal(controls.discardCount, 0); assert.equal(controls.navigation.surface, 'touch');
  // End the fixture draft by the production explicit-discard decision button.
  await settle(() => controls.navigation.closeSurface());
  await settle(() => env.document.getElementById('decisionConfirm').click());
  await new Promise(resolve => setTimeout(resolve, 240)); await settle();
  assert.equal(controls.discardCount, 1); assert.equal(controls.navigation.surface, 'room'); assert.equal(controls.navigation.roomSettingsOpen, true);
  await settle(() => controls.navigation.closeSurface());
  assert.equal(controls.navigation.roomSettingsOpen, false); assert.equal(controls.navigation.surface, 'room'); assert.equal(controls.leaveCount, 0);
});

test('policy: TH09 title-room enter and leave retain the existing normal Runtime and replace only room address', async () => {
  const controls = await mount();
  await settle(() => controls.navigation.openOptions('th09'));
  await settle(() => controls.setPlayer(true));
  await settle(() => controls.navigation.enterRoomRoute({product: 'th09mp', code: '4079'}));
  assert.equal(controls.navigation.surface, 'room'); assert.equal(controls.navigation.playerOpen, true); assert.equal(controls.closeCount, 0);
  await settle(() => controls.navigation.leaveTitleRoomRoute('th09'));
  assert.equal(controls.navigation.surface, 'options'); assert.equal(controls.navigation.productId, 'th09');
  assert.equal(controls.navigation.playerOpen, true); assert.equal(controls.closeCount, 0);
  assert.equal(mounted.router.state.historyAction, 'REPLACE');
  const params = new URLSearchParams(mounted.router.state.location.search);
  assert.equal(params.get('j'), null); assert.equal(params.get('mpRoom'), null); assert.equal(params.get('keep'), 'a b');
  assert.equal(mounted.router.state.location.hash, '#original'); assert.equal(state().unrelated, 7);
});

test('policy: original selected-room override retains raw invite while settings/player use selected MP', async () => {
  const controls = await mount(inviteEntry({g: 'th06mp', r: '4079'})); const raw = href();
  // Host selection is the approved original build gate; this exercises its
  // bounded port without inventing a hidden title in the current registry.
  await settle(() => controls.navigation.restoreRoomRoute({product: 'th07mp', code: '4079', fromDirectory: false}));
  assert.equal(href(), raw); assert.equal(controls.navigation.productId, 'th07mp');
  await settle(() => controls.navigation.openRoomSettings());
  assert.equal(controls.navigation.productId, 'th07mp'); assert.equal(controls.navigation.roomSettingsOpen, true);
  await settle(() => controls.navigation.closeSurface());
  await settle(() => {controls.navigation.openPlayer('th07mp'); controls.setPlayer(true);});
  assert.equal(controls.navigation.surface, 'room'); assert.equal(controls.closeCount, 0);
  await settle(() => controls.navigation.closeSurface());
  const token = new URLSearchParams(mounted.router.state.location.search).get('j');
  assert.equal(JSON.parse(Buffer.from(token, 'base64url').toString()).g, 'th07mp', 'main manual return serializes actual selected product');
});

test('policy: original non-MP room token resolves default MP context without rewriting token', async () => {
  const controls = await mount(inviteEntry({g: 'th20', r: '4079'})); const raw = href();
  assert.equal(controls.navigation.surface, 'room'); assert.equal(controls.navigation.productId, 'th07mp');
  await settle(() => controls.navigation.restoreRoomRoute({product: 'th07mp', code: '4079', fromDirectory: false}));
  assert.equal(href(), raw); assert.equal(controls.navigation.productId, 'th07mp');
});

for (const stalePlayerFlag of [false, true]) test(`policy: completed runtime close applies one SP/MP consequence without syncing again (stale flag ${stalePlayerFlag})`, async () => {
  const controls = await mount(); const home = href();
  await settle(() => controls.navigation.openOptions('th06'));
  await settle(() => controls.setPlayer(stalePlayerFlag));
  await settle(() => {controls.navigation.completeRuntimeClose(); controls.navigation.completeRuntimeClose();});
  assert.equal(href(), home); assert.equal(controls.navigation.surface, 'library'); assert.equal(controls.closeCount, 0);
  await settle(() => controls.setPlayer(false));
  await settle(() => controls.navigation.openOptions('th06mp'));
  await settle(() => controls.navigation.enterRoomRoute({product: 'th06mp', code: '4079'}));
  await settle(() => controls.setPlayer(stalePlayerFlag));
  await settle(() => {controls.navigation.completeRuntimeClose(); controls.navigation.completeRuntimeClose();});
  assert.equal(controls.navigation.surface, 'room'); assert.equal(controls.navigation.roomCode, '4079');
  assert.equal(controls.closeCount, 0); assert.equal(controls.leaveCount, 0); assert.equal(mounted.router.state.historyAction, 'REPLACE');
});


test('source-derived native SP completion consumes info entry while retaining home selection under parent info', async () => {
  const controls = await mount(); await settle(() => controls.navigation.openOptions('th06'));
  const options = href(); await settle(() => controls.setPlayer(true));
  await settle(() => controls.navigation.openInfoDialog('replayDialog'));
  await settle(() => controls.navigation.openInfoDialog('donationDialog'));
  await settle(() => {controls.setPlayer(false); controls.navigation.completeRuntimeClose();});
  assert.equal(controls.closeCount, 0); assert.equal(controls.navigation.surface, 'library'); assert.equal(href(), options);
  assert.equal(controls.navigation.infoDialogOpen('donationDialog'), false); assert.equal(controls.navigation.infoDialogOpen('replayDialog'), true);
  await settle(() => controls.navigation.closeSurface());
  assert.equal(controls.navigation.surface, 'library'); assert.equal(href(), options);
  assert.equal(controls.navigation.infoDialogOpen('replayDialog'), false);
  await settle(() => mounted.router.navigate(1));
  assert.equal(controls.navigation.surface, 'library'); assert.equal(controls.navigation.infoDialogOpen('replayDialog'), true);
});

test('source-derived native MP completion keeps existing info open and rebases it over original normalized room URL', async () => {
  const controls = await mount(inviteEntry({g: 'th06mp', r: '4079', f: true}));
  await settle(() => controls.navigation.restoreRoomRoute({product: 'th06mp', code: '4079', fromDirectory: true}));
  await settle(() => controls.navigation.openInfoDialog('replayDialog'));
  await settle(() => controls.navigation.completeRuntimeClose());
  assert.equal(controls.navigation.infoDialogOpen('replayDialog'), true);
  assert.equal(controls.navigation.surface, 'room'); assert.equal(controls.navigation.fromDirectory, false);
  assert.equal(controls.closeCount, 0); assert.equal(controls.leaveCount, 0);
});

for (const action of ['browser', 'manual', 'native']) test(`source-derived TH09 title-room ${action} return keeps its distinct helper sequence`, async () => {
  const controls = await mount(); await settle(() => controls.navigation.openOptions('th09'));
  await settle(() => {controls.setPlayer(true); controls.setTitle(true);});
  await settle(() => controls.navigation.enterRoomRoute({product: 'th09mp', code: '4079'}));
  if (action === 'browser') {await settle(() => mounted.router.navigate(-1)); await settle();}
  else if (action === 'manual') await settle(() => controls.navigation.closeSurface());
  else await settle(() => {controls.setPlayer(false); controls.setTitle(false); controls.navigation.completeRuntimeClose({titleOverlayWasOpen: true});});
  assert.equal(controls.navigation.surface, 'options'); assert.equal(controls.navigation.productId, 'th09');
  assert.equal(controls.navigation.playerOpen, action === 'browser');
  assert.equal(controls.closeCount, action === 'manual' ? 1 : 0);
  assert.equal(controls.leaveCount, action === 'browser' ? 1 : 0);
});


// Main1499–1533/1564: Host selection is in-memory state, not a new address.
for (const context of ['library', 'lobby']) test(`source-derived Host fallback retains selected options and raw URL in ${context}`, async () => {
  const controls = await mount({pathname: context === 'lobby' ? '/lobby.html' : '/', search: '?game=th07&keep=a%20b', hash: '#original', state: {unrelated: 7}});
  if (context === 'lobby') await settle(() => controls.navigation.openOptions('th07mp'));
  const before = mounted.router.state.location;
  controls.routeSelections.length = 0;
  controls.available = product => product === 'th06';
  await settle(() => controls.navigation.applyHostSelection({productId: 'th06', hasSelection: true}));
  assert.equal(mounted.router.state.location, before, 'Host fallback never navigates or rewrites state');
  assert.equal(controls.navigation.productId, 'th06');
  assert.equal(controls.navigation.surface, 'options');
  assert.equal(controls.navigation.filterProductId, context === 'lobby' ? 'th07' : null);
  assert.deepEqual(controls.routeSelections, [], 'Host preference handling must not call route-reset port');
  controls.available = () => true;
  await settle(() => controls.navigation.openInfoDialog('donationDialog'));
  await settle(() => controls.navigation.closeInfoDialog());
  assert.equal(controls.navigation.productId, 'th06', 'informational Back keeps selected fallback even after route becomes available');
  let selected;
  await settle(() => {selected = controls.navigation.syncSelectionFromRoute();});
  assert.equal(selected, context === 'lobby' ? 'th07mp' : 'th07');
  assert.equal(controls.navigation.productId, selected);
  assert.deepEqual(controls.routeSelections, [selected]);
});

test('source-derived Host fallback preserves dirty touch across child open, informational Back and editor Exit', async () => {
  const controls = await mount({pathname: '/', search: '?game=th07', hash: '', state: {}});
  controls.available = product => product === 'th06';
  await settle(() => controls.navigation.applyHostSelection({productId: 'th06', hasSelection: true}));
  await settle(() => controls.navigation.openTouchLayout());
  await settle(() => {controls.setEditing(true); controls.setDirty(true);});
  assert.equal(controls.navigation.productId, 'th06');
  await settle(() => controls.navigation.openInfoDialog('appleRefreshDialog'));
  assert.equal(decisionOpen(), false);
  await settle(() => controls.navigation.closeInfoDialog());
  assert.equal(controls.navigation.surface, 'touch');
  assert.equal(controls.navigation.productId, 'th06');
  assert.equal(controls.discardCount, 0);
  await settle(() => controls.setDirty(false));
  await settle(() => controls.navigation.closeSurface());
  assert.equal(controls.navigation.surface, 'options');
  assert.equal(controls.navigation.productId, 'th06');
});

test('source-derived Host application retains live Runtime and same-entry informational transitions', async () => {
  const controls = await mount({pathname: '/', search: '?game=th07', hash: '', state: {}});
  await settle(() => controls.setPlayer(true));
  controls.available = product => product === 'th06';
  const before = mounted.router.state.location;
  await settle(() => controls.navigation.applyHostSelection({productId: 'th06', hasSelection: true}));
  assert.equal(mounted.router.state.location, before);
  assert.equal(controls.navigation.playerOpen, true);
  assert.equal(controls.closeCount, 0);
  await settle(() => controls.navigation.openInfoDialog('replayDialog'));
  await settle(() => controls.navigation.closeInfoDialog());
  assert.equal(controls.closeCount, 0);
  assert.equal(controls.navigation.productId, 'th06');
});

test('source-derived general POP re-evaluates available raw route after retained Host fallback', async () => {
  const controls = await mount();
  await settle(() => controls.navigation.openOptions('th07'));
  controls.available = product => product === 'th06';
  await settle(() => controls.navigation.applyHostSelection({productId: 'th06', hasSelection: true}));
  await settle(() => mounted.router.navigate(-1));
  assert.equal(controls.navigation.surface, 'library');
  controls.available = () => true;
  await settle(() => mounted.router.navigate(1));
  assert.equal(controls.navigation.productId, 'th07');
  assert.equal(controls.navigation.surface, 'options');
  assert.deepEqual(controls.routeSelections, ['th07', 'th07']);
});

test('source-derived unavailable MP keeps room but clears selection; missing-base SP fallback hides room without deleting membership', async () => {
  const controls = await mount({pathname: '/', search: '?game=th07mp&mpRoom=4079', hash: '', state: {}});
  const before = mounted.router.state.location;
  await settle(() => controls.navigation.applyHostSelection({productId: 'th07mp', hasSelection: false}));
  assert.equal(controls.navigation.surface, 'room');
  assert.equal(controls.navigation.hasSelection, false);
  await settle(() => controls.navigation.applyHostSelection({productId: 'th06', hasSelection: true}));
  assert.equal(controls.navigation.surface, 'options');
  assert.equal(controls.navigation.roomCode, '4079');
  assert.equal(controls.leaveCount, 0);
  assert.equal(mounted.router.state.location, before);
});


test('source-derived library same-product reopen retains preferences while a fresh lobby carrier rereads them', async () => {
  const controls = await mount();
  await settle(() => controls.navigation.openOptions('th07'));
  assert.deepEqual(controls.routeSelections, ['th07']);
  await settle(() => controls.navigation.closeSurface());
  assert.equal(controls.navigation.productId, 'th07', 'closing selection does not replace main business product');
  assert.equal(controls.navigation.hasSelection, false);
  await settle(() => controls.navigation.openOptions('th07'));
  assert.deepEqual(controls.routeSelections, ['th07'], 'same library product must not reread preferences');
  await settle(() => controls.navigation.openDirectory('th07mp'));
  controls.routeSelections.length = 0;
  await settle(() => controls.navigation.openOptions('th07mp'));
  await settle(() => controls.navigation.closeSurface());
  await settle(() => controls.navigation.openOptions('th07mp'));
  assert.deepEqual(controls.routeSelections, ['th07mp', 'th07mp'], 'each original lobby iframe lifetime rereads preferences');
});

test('source-derived Host fallback leaves unselected home closed and unavailable route sync does nothing', async () => {
  const controls = await mount({pathname: '/', search: '?game=th07', hash: '', state: {}});
  controls.available = product => product === 'th06';
  await settle(() => controls.navigation.applyHostSelection({productId: 'th06', hasSelection: false}));
  const before = mounted.router.state.location;
  let selected;
  await settle(() => {selected = controls.navigation.syncSelectionFromRoute();});
  assert.equal(selected, null);
  assert.equal(controls.navigation.surface, 'library');
  assert.equal(controls.navigation.productId, 'th06');
  assert.equal(mounted.router.state.location, before);
  assert.deepEqual(controls.routeSelections, []);
});

test('source-derived late Host changes selection inside an already-open dirty editor without ending its draft', async () => {
  const controls = await mount({pathname: '/', search: '?game=th07', hash: '', state: {}});
  await settle(() => controls.navigation.openTouchLayout());
  await settle(() => {controls.setEditing(true); controls.setDirty(true);});
  const before = mounted.router.state.location;
  controls.available = product => product === 'th06';
  await settle(() => controls.navigation.applyHostSelection({productId: 'th06', hasSelection: true}));
  assert.equal(controls.navigation.surface, 'touch');
  assert.equal(controls.navigation.productId, 'th06');
  assert.equal(controls.discardCount, 0);
  assert.equal(decisionOpen(), false);
  assert.equal(mounted.router.state.location, before);
});


test('source-derived fallback Options button closes in place while browser Back consumes its existing entry', async () => {
  const controls = await mount();
  await settle(() => controls.navigation.openOptions('th07'));
  controls.available = product => product === 'th06';
  await settle(() => controls.navigation.applyHostSelection({productId: 'th06', hasSelection: true}));
  await settle(() => controls.navigation.closeSurface());
  assert.equal(mounted.router.state.historyAction, 'REPLACE');
  assert.equal(controls.navigation.surface, 'library');
  assert.equal(controls.navigation.productId, 'th06');
  assert.equal(href(), '/?keep=a+b#original', 'unchanged main home helper serializes its query on explicit close');
});


for (const fromDirectory of [false, true]) test(`source-derived room leave returns selected Host fallback product to ${fromDirectory ? 'directory' : 'options'}`, async () => {
  const controls = await mount({pathname: '/', search: `?game=th07mp&mpRoom=4079${fromDirectory ? '&fromLobby=1' : ''}&keep=a%20b`, hash: '#original', state: {}});
  controls.available = product => product === 'th06';
  await settle(() => controls.navigation.applyHostSelection({productId: 'th06', hasSelection: true}));
  let destination;
  await settle(() => {destination = controls.navigation.leaveRoomRoute({product: 'th07mp', fromDirectory});});
  assert.equal(destination, fromDirectory ? 'directory' : 'options');
  assert.equal(new URL(href(), 'https://example.invalid').searchParams.get('game'), 'th06');
  assert.equal(controls.navigation.surface, fromDirectory ? 'library' : 'options');
  assert.equal(controls.navigation.context, fromDirectory ? 'lobby' : 'library');
  assert.equal(controls.navigation.roomCode, null);
  assert.equal(mounted.router.state.historyAction, fromDirectory ? 'REPLACE' : 'PUSH',
    'unchanged main Options helper pushes when raw game differs from selected fallback');
});


for (const exit of ['button', 'browser']) test(`original hidden home-editor action retains product and consumes one child by ${exit}`, async () => {
  const controls = await mount();
  await settle(() => controls.navigation.openOptions('th07'));
  await settle(() => controls.navigation.closeSurface());
  const home = mounted.router.state.location;
  assert.equal(controls.navigation.productId, 'th07');
  assert.equal(controls.navigation.hasSelection, false);
  await settle(() => {controls.navigation.openTouchLayout(); controls.navigation.openTouchLayout();});
  await settle(() => controls.setEditing(true));
  assert.equal(controls.navigation.surface, 'touch');
  assert.equal(controls.navigation.productId, 'th07');
  assert.equal(controls.navigation.hasSelection, false, 'hidden action must not invent an Options parent');
  assert.equal(href(), home.pathname + home.search + home.hash);
  assert.equal(state().launcherTouchEntry.parentKey, home.key);
  await settle(() => controls.navigation.openTouchLayout());
  if (exit === 'button') await settle(() => controls.navigation.closeSurface());
  else await settle(() => mounted.router.navigate(-1));
  assert.equal(mounted.router.state.location.key, home.key, 'duplicate open cannot insert another child');
  assert.equal(controls.navigation.surface, 'library');
  assert.equal(controls.navigation.productId, 'th07');
  await settle(() => mounted.router.navigate(1));
  assert.equal(controls.navigation.surface, 'library', 'retired Forward never recreates editor');
  assert.equal(state()?.launcherTouchEntry, undefined);
  await settle(() => mounted.router.navigate(-1));
  assert.equal(controls.navigation.surface, 'library');
  assert.equal(controls.navigation.hasSelection, false);
});

test('original hidden home-editor action preserves dirty Cancel, then Discard returns home', async () => {
  const controls = await mount();
  await settle(() => controls.navigation.openOptions('th07'));
  await settle(() => controls.navigation.closeSurface());
  const home = mounted.router.state.location;
  await settle(() => controls.navigation.openTouchLayout());
  await settle(() => {controls.setEditing(true); controls.setDirty(true);});
  await settle(() => mounted.router.navigate(-1));
  assert.equal(decisionOpen(), true);
  await settle(() => env.document.getElementById('decisionCancel').click());
  assert.equal(controls.navigation.surface, 'touch');
  assert.equal(controls.discardCount, 0);
  assert.equal(controls.navigation.hasSelection, false);
  await settle(() => controls.navigation.closeSurface());
  await settle(() => env.document.getElementById('decisionConfirm').click());
  assert.equal(controls.discardCount, 1);
  assert.equal(mounted.router.state.location.key, home.key);
  assert.equal(controls.navigation.surface, 'library');
  assert.equal(controls.navigation.productId, 'th07');
});

test('open preparation Player is not a launched guard for original hidden home-editor action', async () => {
  const controls = await mount();
  await settle(() => controls.setPlayer(true));
  await settle(() => controls.navigation.openTouchLayout());
  assert.equal(controls.navigation.surface, 'touch');
  assert.equal(controls.navigation.hasSelection, false);
  assert.equal(controls.closeCount, 0, 'real launched rejection belongs to Settings intent, not playerOpen');
});

for (const kind of ['panel', 'settings']) test(`main same-room retired ${kind} Forward closes MP player once and retains popped entry`, async () => {
  const controls = await mount(inviteEntry({g: 'th06mp', r: '4079', f: true}));
  await settle(() => controls.navigation.restoreRoomRoute({product: 'th06mp', code: '4079', fromDirectory: true}));
  const parentKey = mounted.router.state.location.key;
  await settle(() => kind === 'panel' ? controls.navigation.openRoomPanel('network') : controls.navigation.openRoomSettings());
  await settle(() => controls.navigation.closeSurface());
  assert.equal(mounted.router.state.location.key, parentKey);
  await settle(() => controls.setPlayer(true));
  let finish; controls.closeResult = new Promise(resolve => {finish = resolve;});
  await settle(() => mounted.router.navigate(1));
  assert.equal(controls.closeCount, 1); assert.equal(controls.navigation.playerOpen, true);
  assert.equal(mounted.router.state.location.key, parentKey, 'save completes before committing the POP');
  await settle(() => finish(true)); await settle();
  assert.equal(controls.closeCount, 1); assert.equal(controls.navigation.playerOpen, false);
  assert.equal(controls.navigation.surface, 'room'); assert.equal(controls.leaveCount, 0);
  assert.equal(controls.navigation.roomPanel, null); assert.equal(controls.navigation.roomSettingsOpen, false);
  assert.equal(controls.navigation.fromDirectory, false, 'main5293–5304 normalizes the retained same-room destination');
  assert.notEqual(mounted.router.state.location.key, parentKey);
  await settle(() => mounted.router.navigate(-1));
  assert.equal(mounted.router.state.location.key, parentKey, 'the retired destination was consumed, not reset to its parent');
  assert.equal(controls.leaveCount, 0);
});

for (const kind of ['panel', 'settings']) test(`main live room ${kind} dismissal precedes MP runtime close`, async () => {
  const controls = await mount(inviteEntry({g: 'th06mp', r: '4079'}));
  await settle(() => controls.navigation.restoreRoomRoute({product: 'th06mp', code: '4079', fromDirectory: false}));
  await settle(() => controls.setPlayer(true));
  await settle(() => kind === 'panel' ? controls.navigation.openRoomPanel('network') : controls.navigation.openRoomSettings());
  await settle(() => controls.navigation.closeSurface());
  assert.equal(controls.closeCount, 0); assert.equal(controls.navigation.playerOpen, true);
  assert.equal(controls.navigation.roomPanel, null); assert.equal(controls.navigation.roomSettingsOpen, false);
  assert.equal(controls.leaveCount, 0);
});

test('main retired room Forward Stay retains runtime and permits one later retry', async () => {
  const controls = await mount(inviteEntry({g: 'th06mp', r: '4079'}));
  await settle(() => controls.navigation.restoreRoomRoute({product: 'th06mp', code: '4079', fromDirectory: false}));
  await settle(() => controls.navigation.openRoomPanel('network'));
  await settle(() => controls.navigation.closeSurface());
  const parentKey = mounted.router.state.location.key;
  await settle(() => controls.setPlayer(true)); controls.closeResult = false;
  await settle(() => mounted.router.navigate(1));
  assert.equal(controls.closeCount, 1); assert.equal(controls.navigation.playerOpen, true);
  assert.equal(mounted.router.state.location.key, parentKey); assert.equal(controls.leaveCount, 0);
  controls.closeResult = true;
  await settle(() => mounted.router.navigate(1)); await settle();
  assert.equal(controls.closeCount, 2); assert.equal(controls.navigation.playerOpen, false);
  assert.equal(controls.navigation.surface, 'room'); assert.equal(controls.leaveCount, 0);
});

test('main retired room Forward leaves title overlay without closing retained normal Runtime', async () => {
  const controls = await mount(inviteEntry({g: 'th09mp', r: '4079'}));
  await settle(() => controls.navigation.restoreRoomRoute({product: 'th09mp', code: '4079', fromDirectory: false}));
  await settle(() => controls.navigation.openRoomPanel('network'));
  await settle(() => controls.navigation.closeSurface());
  await settle(() => {controls.setPlayer(true); controls.setTitle(true);});
  await settle(() => mounted.router.navigate(1)); await settle();
  assert.equal(controls.leaveCount, 1); assert.equal(controls.closeCount, 0);
  assert.equal(controls.navigation.playerOpen, true); assert.equal(controls.navigation.productId, 'th09');
  assert.equal(controls.navigation.surface, 'options'); assert.equal(controls.navigation.roomPanel, null);
});
