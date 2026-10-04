/** Test the actual React notice owner and pure authored guide model. Dialog
 * animation/focus belong to tests/ui-main/dialog-motion.spec.ts. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {importUiModule} from './support/import-ui-module.mjs';

const {createNoticesService, parsePackagedContent} = await importUiModule('app/services/notices.client.ts');
const {multiplayerGuideGroups, multiplayerGuideGameId} = await importUiModule('app/services/multiplayer-guide-content.ts');
const {MULTIPLAYER_GUIDE_FILE, MULTIPLAYER_GUIDE_GAMES, MULTIPLAYER_GUIDE_COMMON_HEADING, DEFAULT_MULTIPLAYER_GUIDE_GAME} =
  await importUiModule('src/launcher/multiplayer-guide.mts');
const baseUrl = 'https://launcher.example/mount/';
const guideHtml = '<h2>通用规则</h2><h3>Boss 生命值缩放</h3><p>共同规则</p><h2>TH07 妖妖梦</h2><h3>本作特有规则</h3><h4>森罗结界</h4><p>特有规则</p>';
function deferred() {let resolve;const promise = new Promise(yes => {resolve = yes;});return {promise, resolve};}
function setup(t, fetchImpl = async () => new Response(guideHtml)) {
  const calls = [], service = createNoticesService({baseUrl, fetchImpl: (url, options) => {calls.push({url, options});return fetchImpl(url, options);}});
  t.after(() => service.dispose());return {service, calls, state: () => service.getSnapshot()};
}

test('guide opens before loading completes, uses its fixed packaged source and closes immediately', async t => {
  const pending = deferred(), h = setup(t, () => pending.promise);
  assert.equal(MULTIPLAYER_GUIDE_FILE, 'content/MULTIPLAYER.html');
  const showing = h.service.showMultiplayer('th08');
  assert.equal(h.state().multiplayerOpen, true);assert.equal(h.state().contents.multiplayer.status, 'loading');
  assert.equal(h.calls[0].url, new URL(MULTIPLAYER_GUIDE_FILE, baseUrl).href);assert.equal(h.calls[0].options.cache, 'no-store');
  pending.resolve(new Response(guideHtml));assert.equal(await showing, true);
  assert.equal(h.state().contents.multiplayer.html, guideHtml);assert.ok(h.state().contents.multiplayer.nodes.length);
  h.service.closeMultiplayer();assert.equal(h.state().multiplayerOpen, false);
  await h.service.showMultiplayer('th06');assert.equal(h.calls.length, 1, 'reopening reuses the parsed guide');
  assert.equal(h.state().multiplayerGameId, 'th06');
});

test('concurrent opens and close/reopen share content loading but keep the latest requested game', async t => {
  const pending = deferred(), h = setup(t, () => pending.promise);
  const first = h.service.showMultiplayer('th06'), second = h.service.showMultiplayer('th08');
  h.service.closeMultiplayer();const third = h.service.showMultiplayer('th10');
  assert.equal(h.calls.length, 1);assert.equal(h.state().multiplayerGameId, 'th10');
  pending.resolve(new Response(guideHtml));
  assert.equal(await first, false);assert.equal(await second, false);assert.equal(await third, true);
  assert.equal(h.state().multiplayerOpen, true);assert.equal(h.state().multiplayerGameId, 'th10');
  assert.ok(h.state().multiplayerRequest > 1);
});

test('a closed or disposed guide cannot reopen from late content', async t => {
  for (const action of ['closeMultiplayer', 'dispose']) {
    const pending = deferred(), h = setup(t, () => pending.promise);
    const showing = h.service.showMultiplayer('th07');h.service.closeMultiplayer();
    if (action === 'dispose') h.service.dispose();
    pending.resolve(new Response(guideHtml));assert.equal(await showing, false);
    assert.equal(h.state().multiplayerOpen, false);
    if (action === 'dispose') assert.equal(h.calls[0].options.signal.aborted, true);
  }
});

test('network and HTTP read errors remain visible and can be retried without reopening after dismissal', async t => {
  for (const failure of ['offline', 'http']) {
    let attempts = 0;
    const h = setup(t, async () => {
      if (++attempts === 1) {
        if (failure === 'offline') throw Error('offline');
        return new Response('Unavailable', {status: 503});
      }
      return new Response(guideHtml);
    });
    assert.equal(await h.service.showMultiplayer('th08'), true);assert.equal(h.state().multiplayerOpen, true);
    assert.equal(h.state().contents.multiplayer.status, 'error');
    assert.equal(h.state().contents.multiplayer.error, failure === 'offline' ? 'offline' : 'HTTP 503');
    h.service.closeMultiplayer();await h.service.loadContent('multiplayer');
    assert.equal(h.state().contents.multiplayer.status, 'available');assert.equal(h.state().multiplayerOpen, false);
    assert.equal(attempts, 2);await h.service.showMultiplayer('th10');assert.equal(attempts, 2);
  }
});

test('empty packaged guides stay manually viewable and are cached', async t => {
  const h = setup(t, async () => new Response('\uFEFF\n'));
  assert.equal(await h.service.showMultiplayer(), true);assert.equal(h.state().contents.multiplayer.status, 'empty');
  assert.deepEqual(h.state().contents.multiplayer.nodes, []);assert.equal(h.state().multiplayerGameId, null);
  h.service.closeMultiplayer();await h.service.showMultiplayer();assert.equal(h.calls.length, 1);
});

test('guide model preserves game metadata, heading normalization and authored hierarchy', async () => {
  assert.deepEqual(MULTIPLAYER_GUIDE_GAMES, [
    {id: 'th06', short: 'TH06', title: '红魔乡'}, {id: 'th07', short: 'TH07', title: '妖妖梦'},
    {id: 'th08', short: 'TH08', title: '永夜抄'}, {id: 'th10', short: 'TH10', title: '风神录'},
  ]);
  assert.equal(DEFAULT_MULTIPLAYER_GUIDE_GAME, 'th07');assert.equal(MULTIPLAYER_GUIDE_COMMON_HEADING, '通用规则');
  for (const game of MULTIPLAYER_GUIDE_GAMES) assert.equal(multiplayerGuideGameId(game.id), game.id);
  for (const invalid of [null, undefined, '', 'th09', 'TH07']) assert.equal(multiplayerGuideGameId(invalid), 'th07');
  const nodes = await parsePackagedContent('<h1>Guide</h1><p>Intro</p>' + guideHtml.replace('TH07 妖妖梦', ' TH07\n 妖妖梦 '), baseUrl);
  const groups = multiplayerGuideGroups(nodes);
  assert.ok(groups);assert.equal(groups.intro.length, 1);assert.equal(groups.intro[0].tag, 'p');
  assert.deepEqual(groups.common.map(node => node.tag), ['h3', 'p']);
  assert.deepEqual(groups.games.find(game => game.id === 'th07').nodes.map(node => node.tag), ['h4', 'p'], 'remove only the redundant game-specific heading');
  assert.deepEqual(groups.games.find(game => game.id === 'th06').nodes, []);
  assert.ok(Object.isFrozen(groups));assert.ok(Object.isFrozen(groups.games));assert.ok(Object.isFrozen(groups.common));
  assert.equal(multiplayerGuideGroups(await parsePackagedContent('<p>Alternate authored guide</p>', baseUrl)), null);
});

test('the repository-generated guide parses and groups all supported games without copied markup', async () => {
  const html = await readFile(new URL('../public/content/MULTIPLAYER.html', import.meta.url), 'utf8');
  const groups = multiplayerGuideGroups(await parsePackagedContent(html, baseUrl));
  assert.ok(groups);assert.ok(groups.common.length);assert.ok(groups.intro.length);
  assert.deepEqual(groups.games.map(game => game.id), MULTIPLAYER_GUIDE_GAMES.map(game => game.id));
  assert.ok(groups.games.find(game => game.id === 'th07').nodes.length);
  assert.match(JSON.stringify(groups.common), /Boss/);
});
