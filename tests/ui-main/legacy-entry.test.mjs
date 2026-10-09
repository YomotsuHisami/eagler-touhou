/** Pure planning, SSR and memory-Router evidence only; no browser execution. */
import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {boundaryViolations} from '../../scripts/check-ui-boundaries.mjs';
const root = fileURLToPath(new URL('../..', import.meta.url));
await mkdir(join(root, '.cache'), {recursive:true});
const directory = await mkdtemp(join(root, '.cache/ui-legacy-entry-test-'));
after(() => rm(directory, {recursive:true, force:true}));
const bundle = await build({stdin:{contents:`
  export * from './app/components/LegacyEntryAdapter.tsx';
  export {default as LegacyEntryRoute} from './app/routes/legacy-entry.tsx';
  export {createMultiplayerRoomSessionStore} from './src/launcher/multiplayer-room-session.mts';
  export {createElement, Fragment} from 'react';
  export {createMemoryRouter, RouterProvider} from 'react-router';
  export {renderToStaticMarkup} from 'react-dom/server';
`, resolveDir:root, loader:'tsx'}, bundle:true, format:'esm', platform:'node', packages:'external', write:false, jsx:'automatic'});
const modulePath = join(directory, 'legacy-entry.mjs');
await writeFile(modulePath, bundle.outputFiles[0].text);
const {resolveLegacyEntryNavigation, LEGACY_ENTRY_STATE_KEY, LegacyEntryAdapter, LegacyEntryRoute,
  createMultiplayerRoomSessionStore, createElement, Fragment, createMemoryRouter, RouterProvider, renderToStaticMarkup} = await import(pathToFileURL(modulePath).href);
const baseUrl = 'https://launcher.example/';
const plan = (path, options = {}) => resolveLegacyEntryNavigation({url:new URL(path, baseUrl).href, baseUrl, ...options});

test('root query and aliases produce replace targets with preserved context and no launch', () => {
  const previousState = {helpRequestId:'help-1', keep:{id:3}};
  for (const source of ['/?game=th06&panel=help#keys', '/index.html?game=th06&panel=help#keys']) {
    const next = plan(source, {previousState});
    assert.deepEqual(next.target, {pathname:'/play/th06', search:'?panel=help', hash:'#keys'});
    assert.equal(next.intent.autoLaunch, false); assert.equal(next.intent.replace, true);
    assert.equal(next.state[LEGACY_ENTRY_STATE_KEY], next.intent);
    assert.equal(next.state.helpRequestId, 'help-1'); assert.equal(next.state.keep, previousState.keep);
    assert.deepEqual(previousState, {helpRequestId:'help-1', keep:{id:3}}, 'previous Router state is not mutated');
  }
  const english = plan('/en.html?game=th11&keep=a&keep=b#touch');
  assert.equal(english.intent.locale, 'en');
  assert.deepEqual(english.target, {pathname:'/play/th11', search:'?keep=a&keep=b&uiLocale=en', hash:'#touch'});
  assert.deepEqual(plan('/lobby.html?game=th10mp&keep=1').target, {pathname:'/lobby', search:'?game=th10mp&keep=1', hash:''});
});

test('canonical URLs and unchanged root are no-ops; invalid saved state is not spread', () => {
  for (const source of ['/', '/?keep=1#tail', '/play/th06?mpRoom=1234', '/lobby', '/games/th06']) assert.equal(plan(source), null, source);
  assert.equal(plan('/?game=th20').intent.kind, 'library');
  assert.deepEqual(Object.keys(plan('/index.html?game=th06', {previousState:['not-state']}).state), [LEGACY_ENTRY_STATE_KEY]);
  assert.equal(plan('/index.html?game=th06', {previousState:null}).state[LEGACY_ENTRY_STATE_KEY].productId, 'th06');
});

test('main opaque room invitation preserves product, creation settings and directory return intent', () => {
  const token = Buffer.from(JSON.stringify({g:'th08mp',r:'4321',f:true,a:'create',p:3,d:2,v:'private',c:true})).toString('base64url');
  const next = plan(`/?j=${token}&uiLocale=en&keep=1#tail`);
  assert.equal(next.target.pathname, '/play/th08mp');assert.equal(next.intent.room.code, '4321');
  assert.equal(next.intent.room.playerCount, 3);assert.equal(next.intent.room.difficulty, 2);
  assert.equal(next.intent.room.visibility, 'private');assert.equal(next.intent.room.disableCheatMovement, true);
  assert.equal(next.intent.returnToDirectory, true);assert.equal(next.intent.directoryAction, 'create');
  assert.equal(next.intent.autoLaunch, false);assert.equal(next.target.hash, '#tail');
  assert.equal(new URLSearchParams(next.target.search).get('keep'), '1');
  assert.equal(plan('/?j=broken&game=th06').intent.productId, 'th06');
});

test('room lookup uses catalog policy and normalized session-store precedence', () => {
  const records = new Map(), storage = {getItem:key=>records.get(key)??null, setItem:(key,value)=>records.set(key,value), removeItem:key=>records.delete(key)};
  const sessions = createMultiplayerRoomSessionStore({storage});
  sessions.save('th08mp', {room:{code:'1234', playerCount:3, difficulty:2, created:false, visibility:'public', disableCheatMovement:false}, seat:1, ready:true, spectatorRequested:false, roomSettingsOpen:true});
  const reads = [];
  const next = plan('/index.html?game=th08mp&mpRoom=12-34&fromLobby=1&lobbyAction=create&lobbyPlayers=2&lobbyDifficulty=4&lobbyVisibility=private', {readRoom:input=>{reads.push(input);return sessions.load(input);}});
  assert.equal(reads.length, 1); assert.equal(reads[0].product, 'th08mp'); assert.equal(reads[0].roomCode, '1234');
  assert.deepEqual(reads[0].playerCounts, [2,3]); assert.equal(reads[0].difficulties.length, 5);
  assert.equal(next.intent.kind, 'room'); assert.equal(next.intent.room.playerCount, 3); assert.equal(next.intent.room.difficulty, 2);
  assert.equal(next.intent.room.visibility, 'public'); assert.equal(next.intent.room.seat, 1); assert.equal(next.intent.room.ready, true);
  assert.equal(next.state[LEGACY_ENTRY_STATE_KEY].returnToDirectory, true);
  assert.equal(new URLSearchParams(next.target.search).get('lobbyAction'), 'create', 'only actual room acceptance clears creation hints');
});

test('non-room aliases never read storage; unavailable room storage does not block URL intent', () => {
  let reads = 0;
  const readRoom = () => {reads++; throw new Error('session storage unavailable');};
  for (const source of ['/index.html?game=th06', '/en.html', '/lobby.html?game=th08mp']) assert.ok(plan(source, {readRoom}));
  assert.equal(reads, 0);
  const room = plan('/?game=th09mp&mpRoom=1234', {readRoom});
  assert.equal(reads, 1); assert.equal(room.intent.room.playerCount, 2); assert.equal(room.intent.room.seat, null);
});

test('nested mount strips only the public Router basename, without double-prefix navigation', () => {
  const options = {baseUrl:'https://launcher.example/mount/', routerBasePath:'/mount/'};
  const next = plan('/mount/en.html?game=th11&keep=1#settings', options);
  assert.deepEqual(next.target, {pathname:'/play/th11', search:'?keep=1&uiLocale=en', hash:'#settings'});
  assert.equal(next.intent.to, '/mount/play/th11?keep=1&uiLocale=en#settings');
  assert.equal(plan('/mount/lobby.html?game=th09mp', options).target.pathname, '/lobby');
  assert.equal(plan('/outside/index.html?game=th06', options), null);
  assert.throws(()=>plan('/mount/index.html?game=th06', {...options, routerBasePath:'/different/'}), /outside the Router basename/);
});

test('applying the plan through public memory-Router navigate replaces rather than adds history', async () => {
  const router = createMemoryRouter([{path:'*', element:createElement('p', null, 'route')}], {initialEntries:['/previous', '/index.html?game=th06&keep=1#tail'], initialIndex:1});
  try {
    const next = plan('/index.html?game=th06&keep=1#tail');
    await router.navigate(next.target, {replace:true, state:next.state});
    assert.equal(router.state.location.pathname, '/play/th06'); assert.equal(router.state.location.hash, '#tail');
    assert.equal(router.state.location.state[LEGACY_ENTRY_STATE_KEY].productId, 'th06');
    await router.navigate(-1); assert.equal(router.state.location.pathname, '/previous');
  } finally {router.dispose();}
});

test('SSR creates no browser/storage reads, room join, navigation effect or Runtime', () => {
  const content = createElement(Fragment, null, createElement(LegacyEntryAdapter), createElement(LegacyEntryRoute));
  const router = createMemoryRouter([{path:'*', element:content}], {initialEntries:['/en.html?game=th09mp&mpRoom=1234']});
  const names = ['window', 'document', 'localStorage', 'sessionStorage'];
  const originals = new Map(names.map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)]));
  for (const name of names) Object.defineProperty(globalThis,name,{configurable:true,get(){throw new Error(`SSR must not read ${name}`);}});
  try {
    const html = renderToStaticMarkup(createElement(RouterProvider, {router}));
    assert.match(html, /正在打开原有链接/); assert.match(html, /游戏不会自动启动/);
    assert.equal(router.state.location.pathname, '/en.html');
  } finally {
    for (const name of names) {const descriptor = originals.get(name);if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name];}
    router.dispose();
  }
});

test('adapter and alias obey source ownership boundaries without hidden production side effects', async () => {
  const component = await readFile(join(root,'app/components/LegacyEntryAdapter.tsx'),'utf8');
  const route = await readFile(join(root,'app/routes/legacy-entry.tsx'),'utf8');
  assert.deepEqual(boundaryViolations('app/components/LegacyEntryAdapter.tsx',component),[]);
  assert.deepEqual(boundaryViolations('app/routes/legacy-entry.tsx',route),[]);
  assert.doesNotMatch(component,/\b(?:history|indexedDB|caches)\s*\.\s*[A-Za-z_$]|\.launch\s*\(|\.prepare\s*\(|\.register\s*\(|\.setItem\s*\(|new WebSocket/);
  assert.match(component,/navigation\.state !== 'idle'/);
  assert.match(component,/current\.href !== window\.location\.href/);
  assert.match(component,/attempted\.current\?\.source === source/);
  assert.doesNotMatch(route,/useNavigate|useEffect|<LegacyEntryAdapter/);
});
