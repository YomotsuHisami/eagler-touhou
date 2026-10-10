import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {JSDOM} from 'jsdom';
import {act, createRef, StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {SiteNotice, type SiteNoticeHandle} from '@source/app/components/notices/SiteNotice.tsx';
import {LocaleProvider, translate} from '@source/app/i18n.tsx';
import {createSiteNoticeState} from '@source/app/components/notices/site-notice-state.ts';
import {createSitePreferencesModel, bindSitePreferencesToDocument, LESS_MOTION_STORAGE_KEY,
  SITE_NOTICE_STORAGE_KEY, SITE_NOTICE_DISMISSED_KEY} from '@source/app/models/site-preferences.ts';
import {createSiteNoticeController} from '@source/src/launcher/site-notice.mts';

const pinnedMain = 'edee9633e5e3ee79cd2e1aa334f84f6caf755090';
function storage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {data, getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {data.set(key, value);}};
}
function clock() {
  let serial = 0;
  const timers = new Map<number, {callback: () => void; delay: number}>();
  return {timers,
    setTimeoutImpl(callback: () => void, delay: number) {
      const id = ++serial; timers.set(id, {callback, delay}); return id;
    },
    clearTimeoutImpl(id: number) {timers.delete(id);},
    fire(delay: number) {
      for (const [id, item] of timers) if (item.delay === delay) {
        timers.delete(id); item.callback(); return;
      }
      throw new Error(`Missing ${delay}ms timer`);
    },
  };
}
function installDom(dom: JSDOM) {
  Object.assign(globalThis, {window: dom.window, document: dom.window.document,
    Node: dom.window.Node, HTMLElement: dom.window.HTMLElement, location: dom.window.location,
    IS_REACT_ACT_ENVIRONMENT: true});
}
function tree(node: any): any {
  if (node.nodeType === 3) return node.textContent.trim() ? node.textContent : null;
  if (node.nodeType !== 1) return null;
  return {tag: node.tagName,
    attrs: Object.fromEntries([...node.attributes].map(attr => [attr.name, attr.value])
      .sort(([left], [right]) => left.localeCompare(right))),
    children: [...node.childNodes].map(tree).filter(Boolean)};
}
export async function runChecks(repo: string) {
  const cases: {name: string; status: 'passed'}[] = [];
  async function check(name: string, run: () => void | Promise<void>) {
    await run(); cases.push({name, status: 'passed'}); console.log(`PASS ${name}`);
  }
  const originalSource = readFileSync(join(repo, 'src/launcher/site-notice.mts'), 'utf8');
  const originalHtml = execFileSync('git', ['show', `${pinnedMain}:public/index.html`], {cwd: repo, encoding: 'utf8'});
  await check('unchanged source matches pinned main and parser subset is byte-identical', () => {
    const pinned = execFileSync('git', ['show', `${pinnedMain}:src/launcher/site-notice.mts`], {cwd: repo, encoding: 'utf8'});
    assert.equal(originalSource, pinned);
    const subset = readFileSync(join(repo, 'app/components/notices/site-notice-source.ts'), 'utf8');
    assert.equal(subset.slice(subset.indexOf('export const SITE_NOTICE_DURATION_MS')),
      pinned.slice(0, pinned.indexOf('function renderSiteNoticeText(')));
  });
  const saved = storage(), prefs = createSitePreferencesModel({storage: saved});
  await check('ordinary-build defaults and construction without storage writes', () => {
    assert.deepEqual(prefs.getSnapshot(), {lessMotion: false, noticeEnabled: true, noticeDismissed: false});
    assert.equal(saved.data.size, 0);
  });
  // Diagnostics preference/default assertions now exercise the actual
  // sole owner in runtime-diagnostics.test.mjs, rather than a second model.
  await check('motion persistence and exact-value cross-document parsing', () => {
    prefs.toggleMotion(); assert.equal(saved.data.get(LESS_MOTION_STORAGE_KEY), '1');
    prefs.syncStorageEvent({key: LESS_MOTION_STORAGE_KEY, newValue: 'true'});
    assert.equal(prefs.getSnapshot().lessMotion, false);
  });
  await check('denied localStorage is non-fatal for all preferences', () => {
    const denied = createSitePreferencesModel({storage: {
      getItem() {throw new Error('blocked');}, setItem() {throw new Error('blocked');},
    }});
    denied.toggleNotice(); denied.dismissNotice(); denied.toggleMotion();
    assert.equal(denied.getSnapshot().noticeEnabled, false);
    assert.equal(denied.getSnapshot().noticeDismissed, true);
  });
  const timer = clock(); let fetches = 0;
  const state = createSiteNoticeState(prefs, {...timer, baseUrl: 'https://test.example/',
    matchMediaImpl: () => ({matches: false}), fetchImpl: async (url, init) => {
      fetches++; assert.equal(url, 'NOTICE.txt'); assert.deepEqual(init, {cache: 'no-store'});
      return new Response('\uFEFF[FAQ](faq.html) [GitHub](https://github.com/test)\n<script>alert(1)</script> [bad](javascript:alert(1))');
    }});
  state.connect();
  await check('real NOTICE.txt fetch, BOM trim, parser and 15-second lifespan', async () => {
    assert.equal(await state.load(), true); assert.equal(state.getSnapshot().durationMs, 15_000);
    assert.equal(state.getSnapshot().lines.length, 2);
    assert.equal(state.getSnapshot().lines[1][0].type, 'text');
    assert.equal(state.getSnapshot().optOutVisible, false);
  });
  await check('close persists dismissal and uses original 220ms animation', () => {
    state.dismiss(); assert.equal(saved.data.get(SITE_NOTICE_DISMISSED_KEY), '1');
    assert.equal(state.getSnapshot().closing, true); assert.equal(state.getSnapshot().hidden, false);
    timer.fire(220); assert.equal(state.getSnapshot().hidden, true);
  });
  await check('reopening a dismissed notice exposes permanent opt-out', async () => {
    await state.load(); assert.equal(state.getSnapshot().optOutVisible, true);
  });
  const scroll = {};
  await check('scroll hiding preserves running lifespan and upward scroll restores', () => {
    state.rememberScroll(scroll, 0); state.scroll(scroll, 30);
    assert.equal(state.getSnapshot().scrollHidden, true);
    assert.ok([...timer.timers.values()].some(item => item.delay === 15_000));
    state.scroll(scroll, 24); assert.equal(state.getSnapshot().scrollHidden, false);
  });
  await check('closing a scroll-hidden notice is immediate', () => {
    state.scroll(scroll, 40); state.close(); assert.equal(state.getSnapshot().hidden, true);
  });
  await check('automatic expiration completes original animated dismissal', async () => {
    await state.load(); timer.fire(15_000); assert.equal(state.getSnapshot().closing, true);
    timer.fire(220); assert.equal(state.getSnapshot().hidden, true);
  });
  await check('permanent opt-out persists and prevents additional fetches', async () => {
    state.optOut(); assert.equal(saved.data.get(SITE_NOTICE_STORAGE_KEY), '0');
    const before = fetches; assert.equal(await state.load(), false); assert.equal(fetches, before);
  });
  await check('reenabling immediately fetches and owner teardown clears timers', async () => {
    const before = fetches; prefs.toggleNotice(); await Promise.resolve(); await Promise.resolve();
    assert.equal(fetches, before + 1); state.destroy(); assert.equal(timer.timers.size, 0);
  });
  for (const operation of ['newer', 'close', 'disable', 'destroy']) {
    await check(`pending request invalidation: ${operation}`, async () => {
      const preference = createSitePreferencesModel({storage: storage()}), time = clock();
      const pending: ((response: Response) => void)[] = [];
      const owner = createSiteNoticeState(preference, {...time,
        fetchImpl: () => new Promise(resolve => pending.push(resolve)), baseUrl: 'https://test.example/'});
      owner.connect(); const first = owner.load(); let newer: Promise<boolean> | undefined;
      if (operation === 'newer') newer = owner.load();
      if (operation === 'close') owner.close();
      if (operation === 'disable') preference.toggleNotice();
      if (operation === 'destroy') owner.destroy();
      pending[0](new Response('obsolete')); assert.equal(await first, false);
      if (newer) {
        pending[1](new Response('current')); assert.equal(await newer, true);
        assert.equal(owner.getSnapshot().lines[0][0].text, 'current');
      } else assert.equal(owner.getSnapshot().hidden, true);
      owner.destroy(); assert.equal(time.timers.size, 0);
    });
  }
  for (const failure of ['empty', 'http', 'offline']) {
    await check(`notice fetch failure stays hidden: ${failure}`, async () => {
      const owner = createSiteNoticeState(prefs, {...clock(), fetchImpl: async () => {
        if (failure === 'offline') throw new Error('offline');
        return new Response(failure === 'empty' ? '' : 'bad', {status: failure === 'http' ? 500 : 200});
      }});
      owner.connect(); assert.equal(await owner.load(), false);
      assert.equal(owner.getSnapshot().hidden, true); owner.destroy();
    });
  }
  const markup = originalHtml.slice(originalHtml.indexOf('  <div class="site-notice"'), originalHtml.indexOf('  <div class="sheet">'));
  const original = new JSDOM(markup + '<button id="siteNoticeToggle"></button>', {url: 'https://test.example/'});
  const dom = new JSDOM('<div id="mount"></div>', {url: 'https://test.example/'});
  // jsdom lacks HTMLImageElement.decoding property reflection. Browsers reflect
  // it; this bounded platform shim lets legacy property writes compare fairly.
  for (const window of [original.window, dom.window]) Object.defineProperty(window.HTMLImageElement.prototype, 'decoding', {
    get() {return this.getAttribute('decoding') ?? 'auto';},
    set(value) {this.setAttribute('decoding', value);}, configurable: true,
  });
  installDom(dom);
  const notice = readFileSync(join(repo, 'NOTICE.txt'), 'utf8'), legacyTimer = clock();
  const legacy = createSiteNoticeController({documentObj: original.window.document, windowObj: original.window,
    storage: storage(), fetchImpl: async () => new Response(notice), ...legacyTimer, matchMediaImpl: () => ({matches: false})});
  await legacy.load();
  const browserPrefs = createSitePreferencesModel({storage: storage()});
  const detach = bindSitePreferencesToDocument(browserPrefs), componentTimer = clock();
  const environment = {...componentTimer, fetchImpl: async () => new Response(notice), baseUrl: 'https://test.example/', matchMediaImpl: () => ({matches: false})};
  const ref = createRef<SiteNoticeHandle>(), root = createRoot(document.getElementById('mount')!);
  await check('StrictMode mounted output matches pinned main DOM, copy, icons, style and aria', async () => {
    await act(async () => root.render(<StrictMode><LocaleProvider locale="zh-CN"><SiteNotice preferences={browserPrefs}
      autoLoad edgeGestures={false} environment={environment} ref={ref}/></LocaleProvider></StrictMode>));
    assert.deepEqual(tree(document.getElementById('siteNotice')), tree(original.window.document.getElementById('siteNotice')));
  });
  await check('mounted close click and imperative reopen preserve dismissal semantics', async () => {
    await act(async () => document.getElementById('siteNoticeClose')!.dispatchEvent(new dom.window.MouseEvent('click', {bubbles: true})));
    assert.equal(browserPrefs.getSnapshot().noticeDismissed, true);
    await act(async () => componentTimer.fire(220)); assert.equal(document.getElementById('siteNotice')!.hidden, true);
    await act(async () => {await ref.current!.load();}); assert.equal(document.getElementById('siteNoticeOptOut')!.hidden, false);
  });
  await check('mounted motion changes and storage events synchronize body class', async () => {
    await act(async () => browserPrefs.toggleMotion()); assert.equal(document.body.classList.contains('less-motion'), true);
    await act(async () => window.dispatchEvent(new dom.window.StorageEvent('storage', {key: LESS_MOTION_STORAGE_KEY, newValue: '0'})));
    assert.equal(document.body.classList.contains('less-motion'), false);
  });
  await check('live English locale copy changes without a history write', async () => {
    const history = window.history.length;
    await act(async () => root.render(<StrictMode><LocaleProvider locale="en"><SiteNotice preferences={browserPrefs}
      edgeGestures={false} environment={environment} ref={ref}/></LocaleProvider></StrictMode>));
    assert.equal(document.getElementById('siteNotice')!.getAttribute('aria-label'), translate('en', 'notice.aria'));
    assert.equal(window.history.length, history);
  });
  await check('mounted cleanup clears timers and original-controller resources', async () => {
    await act(async () => root.unmount()); assert.equal(componentTimer.timers.size, 0);
    detach(); legacy.destroy();
  });
  dom.window.close(); original.window.close();

  const gestureDom = new JSDOM('<div id="mount"></div>', {url: 'https://test.example/'}); installDom(gestureDom);
  let requests = 0, hint = ''; const gestureClock = clock();
  const gestureEnvironment = {...gestureClock, baseUrl: 'https://test.example/', matchMediaImpl: () => ({matches: true}), fetchImpl: async () => {
    requests++; return new Response('[bad](javascript:alert(1)) <img src=x onerror=alert(1)> [GitHub](https://github.com/test)');
  }};
  const gesturePrefs = createSitePreferencesModel({storage: null}), handle = createRef<SiteNoticeHandle>();
  const gestureRoot = createRoot(document.getElementById('mount')!);
  const render = (edgeGestures = true) => gestureRoot.render(<LocaleProvider locale="en"><SiteNotice
    preferences={gesturePrefs} edgeGestures={edgeGestures} environment={gestureEnvironment}
    onOptOut={text => {hint = text;}} ref={handle}/></LocaleProvider>);
  function pointer(target: EventTarget, type: string, x: number, y = 20) {
    const event = new gestureDom.window.MouseEvent(type, {bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0});
    Object.defineProperties(event, {pointerId: {value: 1}, isPrimary: {value: true}});
    target.dispatchEvent(event); return event;
  }
  async function swipe(target: EventTarget, from: number, to: number) {
    await act(async () => {pointer(target, 'pointerdown', from); pointer(target, 'pointermove', to); pointer(target, 'pointerup', to);});
  }
  await check('startup gate does not fetch automatically', async () => {
    await act(async () => render()); assert.equal(requests, 0);
  });
  await check('real pointer events reopen notice from left viewport edge', async () => {
    await swipe(document.body, 5, 80); assert.equal(requests, 1); assert.equal(handle.current!.isOpen(), true);
  });
  await check('hostile fetched content remains inert text in mounted DOM', () => {
    assert.equal(document.querySelectorAll('#siteNoticeContent script, #siteNoticeContent [onerror]').length, 0);
    assert.equal(document.querySelectorAll('#siteNoticeContent a').length, 1);
    assert.match(document.getElementById('siteNoticeContent')!.textContent!, /javascript:alert/);
  });
  const bar = document.getElementById('siteNotice')!;
  await check('original edge-drawer setup can hide the native banner then reveal it again', async () => {
    bar.hidden = true; assert.equal(handle.current!.isOpen(), false);
    const before = requests; await swipe(document.body, 5, 80);
    assert.equal(requests, before + 1); assert.equal(bar.hidden, false);
    assert.equal(handle.current!.isOpen(), true);
    assert.equal(gesturePrefs.getSnapshot().noticeDismissed, false);
  });
  await check('reduced-motion gesture collapse is immediate and does not mark dismissal', async () => {
    await swipe(bar, 180, 80); assert.equal(bar.hidden, true);
    assert.equal(gesturePrefs.getSnapshot().noticeDismissed, false);
    await swipe(document.body, 5, 80); assert.equal(bar.hidden, false);
  });
  await check('close and reopen expose opt-out in the mounted gesture surface', async () => {
    await act(async () => document.getElementById('siteNoticeClose')!.dispatchEvent(new gestureDom.window.MouseEvent('click', {bubbles: true})));
    await act(async () => {await handle.current!.load();});
    assert.equal(document.getElementById('siteNoticeOptOut')!.hidden, false);
  });
  await check('opt-out click sends exact localized restore hint and disables banner', async () => {
    await act(async () => document.getElementById('siteNoticeOptOut')!.dispatchEvent(new gestureDom.window.MouseEvent('click', {bubbles: true})));
    assert.equal(hint, translate('en', 'notice.restoreHint'));
    assert.equal(gesturePrefs.getSnapshot().noticeEnabled, false); assert.equal(bar.hidden, true);
  });
  await check('disabled notice rejects edge-swipe reopen', async () => {
    const before = requests; await swipe(document.body, 5, 80); assert.equal(requests, before);
  });
  await check('reenabling opens banner and lobby mode disables edge gestures', async () => {
    await act(async () => gesturePrefs.toggleNotice()); assert.equal(handle.current!.isOpen(), true);
    await act(async () => handle.current!.close()); await act(async () => render(false));
    const before = requests; await swipe(document.body, 5, 80); assert.equal(requests, before);
  });
  await check('unmount removes gesture listeners and all outstanding timers', async () => {
    const before = requests; await act(async () => gestureRoot.unmount());
    assert.equal(gestureClock.timers.size, 0); await swipe(document.body, 5, 80); assert.equal(requests, before);
  });
  gestureDom.window.close();
  return {status: 'passed', checkedAt: new Date().toISOString(), repo, pinnedMain,
    sourceSha256: createHash('sha256').update(originalSource).digest('hex'),
    kind: 'Node + jsdom mounted regression; no browser or visual screenshot verification', cases};
}
