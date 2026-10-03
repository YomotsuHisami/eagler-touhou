/** Real authored Header + directory + native iframe/dialog component regression.
 * This is an offline component test, not full Launcher/Runtime or network netplay.
 * Save slots use an explicit in-memory storage fixture; no real user data is read.
 */
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse, serializeOuter } from 'parse5';
import { build } from 'esbuild';
import puppeteer from 'puppeteer-core';
const project = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const tree = parse(await readFile(resolve(project, 'public/index.html'), 'utf8'));
const attr = (node, name) => node.attrs?.find(a => a.name === name)?.value;
function find(node, predicate) { if (predicate(node)) return node; for (const child of node.childNodes || []) { const result = find(child, predicate); if (result) return result; } }
const outer = id => serializeOuter(find(tree, n => attr(n, 'id') === id));
const sheet = serializeOuter(find(tree, n => attr(n, 'class')?.split(' ').includes('sheet')));
const css = await readFile(process.env.EAGLER_TEST_STYLES || resolve(project, 'public/styles.css'), 'utf8');
const app = await readFile(resolve(project, 'src/launcher/app.mts'), 'utf8');
const menuHandlers = app.slice(app.indexOf('function setMastheadMenuOpen('), app.indexOf('const firstUseNotice = createFirstUseNoticeController('));
const filesHandlers = app.slice(app.indexOf('const scoreFilesDialog = '), app.indexOf('scorePanel = createScorePanel('));
assert.ok(menuHandlers.includes('restoreFocus') && filesHandlers.includes('showModal()'), 'source handler anchors');
function block(tag, payload) { const bytes=Buffer.alloc(8+payload.length);bytes.write(tag);bytes.writeUInt16LE(bytes.length,4);payload.copy(bytes,8);return bytes; }
function encode6(body) { const bytes=Buffer.alloc(20+body.length);bytes.writeUInt32LE(20,8);bytes.writeUInt32LE(bytes.length,16);body.copy(bytes,20);bytes.writeUInt16LE(bytes.subarray(4).reduce((n,v)=>n+v,0)&65535,2);const result=Buffer.from(bytes);let key=0;for(let i=2;i<bytes.length;i++){key=(key+bytes[i-1])&255;key=((key>>5)|(key<<3))&255;result[i]=bytes[i]^key;}return result; }
const high=Buffer.alloc(20);high.writeUInt32LE(1,0);high.writeUInt32LE(98765430,4);high[8]=2;high[9]=1;high.write('FIXTURE',11);
const scoreFixture=encode6(Buffer.concat([block('TH6K',Buffer.from([16,0,0,0])),block('HSCR',high)]));
const code = (await build({ stdin: { resolveDir: project, loader: 'ts', contents: `
import {createScorePanel} from './src/launcher/score-panel.mts';
const $ = (s:string) => document.querySelector(s)!;
const isMultiplayerProduct = () => window.__testProduct.endsWith('mp');
let scorePanel:any;
const mastheadMenu = $('#mastheadMenu'), mastheadMenuToggle = $('#mastheadMenuToggle'), mastheadMenuPanel = $('#mastheadMenuPanel');
${menuHandlers}
${filesHandlers}
$('#globalSettingsContent').append($('#advancedOptions'), $('#mobileOptions'));
window.fixtureState={saves:[],chosen:null,next:0};
window.__scoreFixture=${JSON.stringify([...scoreFixture])};
window.fetch=async()=>({ok:true,json:async()=>({schema:'eagler-touhou/character-art/1',characters:[]})});
scorePanel = createScorePanel($('#scorePanel'), $('#scoreCharacter'), async()=>null, scoreFilesContent,
 async(selection,save)=>{fixtureState.chosen=save?.id??null;});
window.__select = product => { window.__testProduct=product;scorePanel.select({game:'th06',product,root:'/fixture',file:'score.dat'}); };
window.__select('th06');
// Record download bytes without leaving this opaque-origin component page.
window.__downloads=[];
URL.createObjectURL=blob=>{window.__lastBlob=blob;return 'blob:fixture';};URL.revokeObjectURL=()=>{};
HTMLAnchorElement.prototype.click=function(){window.__downloads.push({name:this.download,blob:window.__lastBlob});};
` }, bundle: true, write: false, format: 'iife', platform: 'browser', target: 'es2022', plugins: [{
  name: 'explicit-save-storage-fixture', setup(builder) {
    builder.onResolve({ filter: /^\.\/score-saves\.mjs$/ }, () => ({ path: 'score-slots', namespace: 'fixture' }));
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: `
      export async function listScoreSaves(product){return fixtureState.saves.filter(s=>s.product===product);}
      export async function activeScoreSave(product){const save=fixtureState.saves.find(s=>s.product===product&&s.id===fixtureState.chosen);return save?{save,state:{pending:true}}:null;}
      export async function addScoreSave(product,game,name,bytes){const save={id:String(++fixtureState.next),product,game,name,bytes,updated:Date.now()};fixtureState.saves.push(save);return save;}
      export async function updateActiveScoreSave(){}
    `, loader: 'js' }));
  }
}] })).outputFiles[0].text;
const executablePath = process.env.EAGLER_TEST_CHROMIUM || ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'].find(existsSync);
assert.ok(executablePath, 'Set EAGLER_TEST_CHROMIUM to your Chromium executable');
const browser = await puppeteer.launch({ executablePath, headless: process.env.EAGLER_TEST_HEADFUL !== '1', args: process.getuid?.() === 0 ? ['--no-sandbox', '--disable-dev-shm-usage'] : [] });
const evidence = resolve(project, '.cache/header-files-evidence'); await mkdir(evidence, { recursive: true });
const results = [];
try {
  for (const [width, height] of [[1440, 1000], [820, 720], [390, 844]]) {
    const page = await browser.newPage(); await page.setViewport({ width, height, hasTouch: width < 780 });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    // Assets are local data only; font files remain outside deliverable packages.
    await page.setRequestInterception(true);
    page.on('request', async req => {
      try {
        const path = new URL(req.url()).pathname.slice(1);
        if (!path.startsWith('assets/')) { await req.abort(); return; }
        const local = resolve(project, 'public', path);
        const bytes = await readFile(local);
        await req.respond({ status: 200, headers: { 'Access-Control-Allow-Origin': '*' }, contentType: path.endsWith('.woff2') ? 'font/woff2' : 'image/webp', body: bytes });
      } catch { await req.abort(); }
    });
    await page.setContent(`<html lang="zh-CN"><head><meta charset="utf-8"><base href="https://component-fixture.invalid/"><style>${css}</style></head><body>${sheet}${outer('scoreFilesDialog')}${outer('globalSettingsDialog')}</body></html>`);
    await page.addScriptTag({ content: code });
    await page.evaluate(() => document.fonts.ready);
    // Prevent external navigation while exercising the real menu hit targets.
    await page.evaluate(() => {
      window.__menuClicks = 0;
      document.querySelector('#mastheadMenuPanel').addEventListener('click', e => { e.preventDefault(); window.__menuClicks++; });
      document.querySelectorAll('.tools > .options-scroll > :not(#mpShell)').forEach(el => el.hidden = true);
    });
    for (const mode of ['game-info', 'site-info', 'lobby', 'room']) {
      await page.evaluate(mode => {
        const tools = document.querySelector('.tools'), shell = document.querySelector('#mpShell');
        tools.classList.toggle('mp-mode', mode === 'lobby' || mode === 'room');
        tools.classList.toggle('site-info-active', mode === 'site-info');
        document.querySelector('#siteInfo').hidden = mode !== 'site-info';
        shell.classList.toggle('local-lobby-preview', mode === 'lobby' || mode === 'room');
        shell.hidden = !(mode === 'lobby' || mode === 'room');
        shell.querySelector('.local-lobby-frame')?.remove();
        if (!shell.hidden) {
          const iframe = document.createElement('iframe'); iframe.className = 'local-lobby-frame';
          iframe.title = `Synthetic ${mode} content for host-layer hit testing`;
          iframe.srcdoc = `<body style="margin:0;background:#22221e;color:#eee"><h1>${mode}</h1><button>Frame hit target</button></body>`;
          shell.append(iframe);
        }
        document.querySelector('.main').dataset.testView = mode;
        scrollTo(0,0);
      }, mode);
      await page.click('#mastheadMenuToggle');
      await page.waitForFunction(() => getComputedStyle(document.querySelector('#mastheadMenuPanel')).opacity === '1');
      const hits = await page.evaluate(() => {
        const panel = document.querySelector('#mastheadMenuPanel');
        return [...panel.querySelectorAll('button.masthead-menu-item, a.masthead-menu-item, select')].map(el => {
          const r = el.getBoundingClientRect(), x = r.x+r.width/2, y = r.y+r.height/2;
          const hit = document.elementFromPoint(x, y);
          return { id:el.id || el.textContent.trim(), ok:el === hit || el.contains(hit), hit:hit?.id || hit?.className, x,y };
        });
      });
      assert.ok(hits.every(hit => hit.ok), `${width}/${mode}: Header targets covered: ${JSON.stringify(hits)}`);
      const before = await page.evaluate(() => window.__menuClicks);
      await page.click('#firstUseNoticeOpen');
      assert.equal(await page.evaluate(() => window.__menuClicks), before+1, `${mode}: pointer must reach menu, not card/iframe`);
      await page.screenshot({ path: resolve(evidence, `${mode}-${width}.png`) });
      // Check during entering/leaving card transforms, not only their rest state.
      await page.evaluate(() => { const card=document.querySelector('.tools');window.__layerAnimation=card.animate([{transform:'translateY(-50px)',opacity:0.6},{transform:'translateY(0px)',opacity:1}],{duration:1000,fill:'both'});__layerAnimation.pause();__layerAnimation.currentTime=450; });
      assert.ok(await page.$eval('#firstUseNoticeOpen', el => {const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}), `${mode}: animated card must stay below menu`);
      await page.evaluate(() => window.__layerAnimation.cancel());
      await page.focus('#mastheadMenuToggle'); await page.keyboard.press('Escape');
      assert.equal(await page.$eval('#mastheadMenuToggle', el => el.getAttribute('aria-expanded')), 'false');
      await page.keyboard.press('ArrowDown');
      assert.equal(await page.$eval('#siteNoticeToggle', el => el === document.activeElement), true);
      await page.keyboard.press('Escape');
      assert.equal(await page.$eval('#mastheadMenuToggle', el => el === document.activeElement), true);
      results.push({width,mode,unobscuredMenu:true,pointer:true,transition:true,keyboard:true});
    }
    // Verify the new dialog uses the real save component and a single import UI.
    await page.evaluate(() => {
      const tools=document.querySelector('.tools');tools.classList.remove('mp-mode','site-info-active');
      document.querySelector('#siteInfo').hidden=true;document.querySelector('#mpShell').hidden=true;
    });
    for (const product of ['th06','th06mp']) {
      await page.evaluate(product => {__select(product);document.querySelector('#scoreFilesOpen').click();}, product);
      await page.waitForFunction(()=>document.querySelector('.score-save-list').textContent.includes('尚无存档'));
      assert.equal(await page.$$eval('#scoreFilesContent [data-action="import-save"], #scoreFilesContent [data-action="export-save"]', nodes => nodes.length), 0);
      assert.equal(await page.$$eval('#scoreFilesContent .score-save-library-header button', nodes => nodes.length), 1);
      assert.equal(await page.$eval(product.endsWith('mp') ? '#mpFileOptions' : '#fileOptions', el => el.hidden), false);
      const [chooser] = await Promise.all([page.waitForFileChooser(), page.click('.score-save-library-header button')]);
      await chooser.cancel();
      // Upload through the real input handler; storage is the documented fixture.
      await page.$eval('.score-save-library input[type=file]', (el, product) => {const dt=new DataTransfer();dt.items.add(new File([new Uint8Array(window.__scoreFixture)],product+'.dat'));el.files=dt.files;el.dispatchEvent(new Event('change',{bubbles:true}));}, product);
      await page.waitForFunction(product => [...document.querySelectorAll('.score-save-select strong')].some(el=>el.textContent===product+'.dat'), {}, product);
      await page.evaluate(product => [...document.querySelectorAll('.score-save-row')].find(row=>row.querySelector('strong').textContent===product+'.dat').querySelector('.score-save-select').click(), product);
      await page.waitForFunction(product => [...document.querySelectorAll('.score-save-select')].some(el=>el.querySelector('strong').textContent===product+'.dat' && el.getAttribute('aria-pressed')==='true'), {}, product);
      await page.evaluate(product => [...document.querySelectorAll('.score-save-row')].find(row=>row.querySelector('strong').textContent===product+'.dat').querySelector('.score-save-download').click(), product);
      const saved = await page.evaluate(async () => {const r=__downloads.at(-1);return {name:r.name,bytes:[...new Uint8Array(await r.blob.arrayBuffer())]};});
      assert.deepEqual(saved, {name:product+'.dat',bytes:[...scoreFixture]});
      assert.ok(await page.$eval('#scorePanel', el=>el.textContent.includes('98,765,430')), 'valid chosen score is actually rendered');
      await page.screenshot({path:resolve(evidence,`save-dialog-${product}-${width}.png`)});
      // Native modal must remain above the Header, not within the directory stack.
      assert.ok(await page.$eval('#scoreFilesClose', el => {const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}));
      await page.click('#scoreFilesClose');
      results.push({width,product,oneSaveUI:true,addChooseDownload:true,replayTools:true,modalOnTop:true});
    }
    assert.deepEqual(errors, []); await page.close();
  }
  console.log(JSON.stringify({result:'PASS',scope:'offline actual DOM/CSS/handlers; native iframe host layering; in-memory save storage fixture, not real Runtime/IDBFS',results},null,2));
} finally { await browser.close(); }
