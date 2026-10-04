/** Pure parser and the current React notice service; no legacy fake DOM. */
import assert from "node:assert/strict";
import {test} from "node:test";
import {importUiModule} from "./support/import-ui-module.mjs";
const {createNoticesService} = await importUiModule("app/services/notices.client.ts");
const {
  SITE_NOTICE_DISMISSED_KEY,
  SITE_NOTICE_DURATION_MS,
  SITE_NOTICE_STORAGE_KEY,
  parseSiteNoticeText,
  siteNoticeBrandAsset,
} = await importUiModule("src/launcher/site-notice.mts");

const baseUrl = "https://test.example/eagler-touhou/";
assert.equal(SITE_NOTICE_DURATION_MS, 15_000);
assert.equal(siteNoticeBrandAsset("https://cloud.touhou.best/", baseUrl), "assets/notice-touhou-cloud.png",
  "the permission-cleared 车万云 provider mark must remain available offline");
assert.equal(siteNoticeBrandAsset("https://space.bilibili.com/1", baseUrl), "assets/notice-bilibili.svg");
assert.equal(siteNoticeBrandAsset("https://github.com/example/repo", baseUrl), "assets/notice-github.svg");
assert.equal(siteNoticeBrandAsset("https://qm.qq.com/q/example", baseUrl), "assets/notice-qq.svg");
assert.equal(siteNoticeBrandAsset("faq.html", baseUrl), "assets/th06.ico");
assert.equal(siteNoticeBrandAsset("https://example.org/", baseUrl), "");

const parsed = parseSiteNoticeText(
  "反馈请看 [FAQ](faq.html) 或 [GitHub](https://github.com/example/repo)\n不要执行 [bad](javascript:alert(1))",
  baseUrl,
);
assert.equal(parsed.length, 2);
assert.deepEqual(parsed[0].filter(segment => segment.type === "link").map(segment => ({
  label: segment.label,
  href: segment.href,
  external: segment.external,
  asset: segment.asset,
})), [
  { label: "FAQ", href: "faq.html", external: false, asset: "assets/th06.ico" },
  { label: "GitHub", href: "https://github.com/example/repo", external: true, asset: "assets/notice-github.svg" },
]);
assert.equal(parsed[1].map(segment => segment.type === "text" ? segment.text : segment.label).join(""),
  "不要执行 [bad](javascript:alert(1))", "non-http links must remain inert text");
assert.deepEqual(parseSiteNoticeText("[车万云](https://cloud.touhou.best/)", baseUrl)[0], [{
  type: "link",
  label: "车万云",
  href: "https://cloud.touhou.best/",
  resolvedHref: "https://cloud.touhou.best/",
  external: true,
  asset: "assets/notice-touhou-cloud.png",
}]);

function storageFrom(values = new Map()) {
  return {values, writes: [], getItem: key => values.get(key) ?? null,
    setItem(key, value) {this.writes.push([key, value]);values.set(key, String(value));}};
}
function deferred() {let resolve;const promise = new Promise(yes => {resolve = yes;});return {promise, resolve};}
function setup(t, {storage = storageFrom(), fetchImpl, body = '欢迎 [FAQ](faq.html)', status = 200} = {}) {
  const calls = [], tasks = new Map();
  const clock = {set(callback, delay) {const key = {};tasks.set(key, {callback, delay});return key;}, clear(key) {tasks.delete(key);}};
  const service = createNoticesService({baseUrl, storage, timers: clock,
    fetchImpl: (url, options) => {calls.push({url, options});return fetchImpl ? fetchImpl(url, options) : Promise.resolve(new Response(body, {status}));},
  });
  t.after(() => service.dispose());return {service, storage, calls, tasks, state: () => service.getSnapshot()};
}
function fire(h) {for (const [key, task] of [...h.tasks]) {h.tasks.delete(key);task.callback();}}

test('site notice loads its fixed source, parses nested links, and starts one fifteen-second timer', async t => {
  const h = setup(t, {body: '\uFEFF欢迎 [FAQ](faq.html)\r\n'});
  assert.equal(SITE_NOTICE_STORAGE_KEY, 'eagler-touhou-site-notice-enabled-v1');
  assert.equal(SITE_NOTICE_DISMISSED_KEY, 'eagler-touhou-site-notice-dismissed-v1');
  assert.equal(await h.service.loadSite(), true);assert.equal(h.state().site.open, true);
  assert.equal(h.calls[0].url, new URL('NOTICE.txt', baseUrl).href);assert.equal(h.calls[0].options.cache, 'no-store');
  assert.equal(h.state().site.lines.length, 1);
  assert.equal(h.state().site.lines[0].find(segment => segment.type === 'link').resolvedHref, new URL('faq.html', baseUrl).href);
  assert.deepEqual([...h.tasks.values()].map(task => task.delay), [SITE_NOTICE_DURATION_MS]);
  assert.equal(h.state().site.canOptOut, false);
  fire(h);assert.equal(h.state().site.open, false);assert.equal(h.state().site.dismissed, false);
  assert.deepEqual(h.storage.writes, []);assert.equal(h.tasks.size, 0);
});

test('explicit dismissal persists immediately, with opt-out offered on the next presentation', async t => {
  const h = setup(t);await h.service.loadSite();h.service.closeSite({dismiss: true});
  assert.equal(h.state().site.open, false);assert.equal(h.tasks.size, 0);
  assert.equal(h.state().site.dismissed, true);assert.equal(h.state().site.canOptOut, false);
  assert.deepEqual(h.storage.writes, [[SITE_NOTICE_DISMISSED_KEY, '1']]);
  await h.service.loadSite();assert.equal(h.state().site.canOptOut, true);
  const returning = setup(t, {storage: h.storage});await returning.service.loadSite();
  assert.equal(returning.state().site.canOptOut, true, 'dismissal survives a new document');
});

test('opt-out persists the existing enabled key, closes the notice, and prevents later fetches', async t => {
  const h = setup(t);let notifications = 0;const unsubscribe = h.service.subscribe(() => notifications++);
  await h.service.loadSite();const beforeOptOut = notifications;h.service.setSiteEnabled(false);
  assert.equal(h.state().site.enabled, false);assert.equal(h.state().site.open, false);assert.equal(h.tasks.size, 0);
  assert.ok(notifications > beforeOptOut, 'the actual React subscription observes the updated preference');
  assert.equal(h.storage.values.get(SITE_NOTICE_STORAGE_KEY), '0');
  assert.equal(await h.service.loadSite(), false);assert.equal(h.calls.length, 1);
  const returning = setup(t, {storage: h.storage});assert.equal(await returning.service.loadSite(), false);
  assert.equal(returning.calls.length, 0);unsubscribe();
});

test('reenabling the site notice fetches once, presents it and restores the saved preference', async t => {
  const h = setup(t, {storage: storageFrom(new Map([[SITE_NOTICE_STORAGE_KEY, '0']]))});
  assert.equal(await h.service.loadSite(), false);h.service.setSiteEnabled(true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.calls.length, 1);assert.equal(h.state().site.open, true);
  assert.equal(h.storage.values.get(SITE_NOTICE_STORAGE_KEY), '1');assert.equal(h.tasks.size, 1);
});

test('empty, HTTP and network failures do not display a notice or leave a timer and can retry', async t => {
  for (const failure of ['empty', 'http', 'offline']) {
    let attempts = 0;
    const h = setup(t, {fetchImpl: async () => {
      if (++attempts === 1) {
        if (failure === 'offline') throw Error('offline');
        return new Response(failure === 'empty' ? '\uFEFF\n' : 'Unavailable', {status: failure === 'http' ? 503 : 200});
      }
      return new Response('Ready');
    }});
    assert.equal(await h.service.loadSite(), false);assert.equal(h.state().site.open, false);
    assert.equal(h.tasks.size, 0);assert.deepEqual(h.storage.writes, []);
    assert.equal(await h.service.loadSite(), true);assert.equal(attempts, 2);
  }
});

test('closing, opting out or disposing cancels pending requests and prevents stale presentation', async t => {
  for (const action of ['close', 'opt-out', 'dispose']) {
    const pending = deferred(), h = setup(t, {fetchImpl: () => pending.promise});
    const loading = h.service.loadSite();
    if (action === 'close') h.service.closeSite({dismiss: true});
    else if (action === 'opt-out') h.service.setSiteEnabled(false);
    else h.service.dispose();
    assert.equal(h.calls[0].options.signal.aborted, true);
    pending.resolve(new Response('Too late'));assert.equal(await loading, false);
    assert.equal(h.state().site.open, false);assert.equal(h.tasks.size, 0);
  }
});

test('a newer load wins and replaces the previous expiry timer without stale content', async t => {
  const first = deferred(), second = deferred();let requests = 0;
  const h = setup(t, {fetchImpl: () => ++requests === 1 ? first.promise : requests === 2 ? second.promise : Promise.resolve(new Response('Refreshed'))});
  const old = h.service.loadSite(), latest = h.service.loadSite();
  assert.equal(h.calls[0].options.signal.aborted, true);
  second.resolve(new Response('Latest'));assert.equal(await latest, true);
  first.resolve(new Response('Stale'));assert.equal(await old, false);
  assert.equal(h.state().site.lines[0][0].text, 'Latest');assert.equal(h.tasks.size, 1);
  const oldTimer = [...h.tasks.keys()][0];await h.service.loadSite();
  assert.equal(h.tasks.has(oldTimer), false);assert.equal(h.tasks.size, 1);
  assert.equal(h.state().site.lines[0][0].text, 'Refreshed');
});

test('scroll hiding has per-owner baselines and never records dismissal or opt-out', async t => {
  const h = setup(t);await h.service.loadSite();const root = {}, nested = {};
  h.service.observeScroll(root, 0);h.service.observeScroll(root, 20);assert.equal(h.state().site.scrollHidden, true);
  h.service.observeScroll(root, 18);assert.equal(h.state().site.scrollHidden, true, 'small deltas are ignored');
  h.service.observeScroll(root, 10);assert.equal(h.state().site.scrollHidden, false);
  h.service.observeScroll(nested, 100);assert.equal(h.state().site.scrollHidden, false, 'new scroll containers start their own baseline');
  h.service.observeScroll(nested, 130);assert.equal(h.state().site.scrollHidden, true);
  h.service.closeSite();assert.equal(h.state().site.scrollHidden, false);assert.equal(h.state().site.dismissed, false);
  assert.deepEqual(h.storage.writes, []);
});

test('storage failures remain nonblocking and disposal clears expiry and subscription delivery', async t => {
  const h = setup(t, {storage: {getItem() {throw Error('denied');}, setItem() {throw Error('denied');}}});
  let notifications = 0;h.service.subscribe(() => notifications++);
  await h.service.loadSite();h.service.closeSite({dismiss: true});await h.service.loadSite();
  assert.equal(h.state().site.canOptOut, true);assert.equal(h.tasks.size, 1);
  h.service.dispose();const before = notifications;assert.equal(h.tasks.size, 0);
  h.service.setSiteEnabled(false);h.service.closeSite();assert.equal(await h.service.loadSite(), false);
  assert.equal(notifications, before);
});
