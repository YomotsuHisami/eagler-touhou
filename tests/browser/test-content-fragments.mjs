// Real-browser boundary: fetched instruction fragments retain Markdown content
// while executable markup, unsafe URLs and DOM-clobbering attributes are dropped.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import {originalComponentFixture} from '../support/original-component-fixture.mjs';

const componentFixture = await originalComponentFixture('content-fragments');

const project = fileURLToPath(new URL('../../', import.meta.url));
const server = createServer(async (request, response) => {
  if (request.url === '/') { response.writeHead(200, { 'Content-Type': 'text/html' }); response.end('<!doctype html><title>Content security</title>'); return; }
  const name = /^\/modules\/([a-z-]+\.mjs)$/.exec(request.url || '')?.[1];
  if (!name) { response.writeHead(404); response.end(); return; }
  if (componentFixture && ['first-use-notice.mjs', 'multiplayer-guide.mjs'].includes(name)) {
    response.writeHead(200, { 'Content-Type': 'text/javascript' }); response.end(componentFixture.module); return;
  }
  try { response.writeHead(200, { 'Content-Type': 'text/javascript' }); response.end(await readFile(resolve(project, '.cache/build/browser/assets/launcher', name))); }
  catch { response.writeHead(404); response.end(); }
});
await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen));
let browser;
try {
  browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true, args: ['--no-first-run'] });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  const result = await page.evaluate(async () => {
    const { createFirstUseNoticeController } = await import('/modules/first-use-notice.mjs');
    const { createMultiplayerGuideController } = await import('/modules/multiplayer-guide.mjs');
    document.body.innerHTML = '<dialog id="firstUseNoticeDialog"><div id="firstUseNoticeText"></div></dialog>' +
      '<dialog id="mpGuideDialog"><button id="mpGuideClose">Close</button><div id="mpGuideContent"></div></dialog>';
    window.__contentXss = 0;
    const payload = '<div class="first-use-notice-list evil" id="runtime" name="Module" style="display:none" onclick="window.__contentXss++">' +
      '<section class="first-use-notice-item"><h2>Readable heading</h2><p><strong>Readable text</strong></p>' +
      '<blockquote class="markdown-blockquote">Quotation</blockquote><ol start="3"><li>Third</li></ol>' +
      '<script>window.__contentXss++</script><iframe srcdoc="<script>parent.__contentXss++</script>"></iframe>' +
      '<img src="/missing-image" onerror="window.__contentXss++"><img src="javascript:window.__contentXss++">' +
      '<a href="java&#x09;script:window.__contentXss++">Unsafe</a><a href="data:text/html,unsafe">Data</a>' +
      '<a href="/safe" target="_blank" rel="opener" onclick="window.__contentXss++">Safe</a>' +
      '<svg><a><animate attributeName="href" values="javascript:window.__contentXss++" /></a></svg>' +
      '<math><mtext><table><mglyph><style><!--</style><img title="--><img src=x onerror=window.__contentXss++>">' +
      '</table></mtext></math><form id="mpGuideDialog"><input name="open"></form></section></div>';
    const fetchImpl = async () => new Response(payload);
    const notice = createFirstUseNoticeController({ fetchImpl, storage: null });
    await notice.showManual(); notice.close();
    const guide = createMultiplayerGuideController({ fetchImpl }); await guide.show();
    // Events would fire synchronously here if any inline handlers survived.
    for (const element of document.querySelectorAll('#firstUseNoticeText *, #mpGuideContent *')) {
      element.dispatchEvent(new Event('error')); element.dispatchEvent(new MouseEvent('click'));
    }
    const inspect = target => ({
      heading: target.querySelector('h2')?.textContent,
      strong: target.querySelector('strong')?.textContent,
      quote: target.querySelector('blockquote')?.className,
      start: target.querySelector('ol')?.getAttribute('start'),
      scripts: target.querySelectorAll('script,iframe,svg,math,style,form,input,object,embed,template').length,
      dangerous: [...target.querySelectorAll('*')].flatMap(el => [...el.attributes]).filter(a => /^(on|id$|name$|style$|srcdoc$)/i.test(a.name)).length,
      unsafeLinks: [...target.querySelectorAll('a')].slice(0, 2).map(el => el.hasAttribute('href')),
      safeHref: target.querySelector('a[href]')?.getAttribute('href'),
      safeRel: target.querySelector('a[href]')?.getAttribute('rel'),
      images: [...target.querySelectorAll('img')].map(el => el.getAttribute('src')),
    });
    return { xss: window.__contentXss, notice: inspect(document.getElementById('firstUseNoticeText')),
      guide: inspect(document.getElementById('mpGuideContent')), dialogs: document.querySelectorAll('dialog').length, origin: location.origin };
  });
  assert.equal(result.xss, 0); assert.equal(result.dialogs, 2);
  for (const content of [result.notice, result.guide]) {
    assert.equal(content.heading, 'Readable heading'); assert.equal(content.strong, 'Readable text');
    assert.equal(content.quote, 'markdown-blockquote'); assert.equal(content.start, '3');
    assert.equal(content.scripts, 0); assert.equal(content.dangerous, 0);
    assert.deepEqual(content.unsafeLinks, [false, false]);
    assert.equal(content.safeHref, `${result.origin}/safe`); assert.equal(content.safeRel, 'noopener noreferrer');
    assert.ok(content.images.every(src => src.startsWith(result.origin)));
  }
  console.log('PASS real-browser content rendering, event-handler/URL/foreign-namespace filtering and DOM-clobbering protection');
} finally { await browser?.close(); await new Promise(resolveClose => server.close(resolveClose)); }
