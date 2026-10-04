/** Execute the actual ES5 source and Framework-emitted inline gate with
 * deterministic capabilities. These checks do not establish real GPU support. */
import {APP_SHELL_FILES, FRONTEND_PACKAGE_FILES, FRONTEND_UI_ARTIFACT, resolveFrontendPackageSource} from '../lib/frontend-manifest.mjs';
import {readUiArtifact} from '../lib/ui-artifact.mjs';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {runInNewContext} from 'node:vm';
import {parse as parseJavaScript} from 'acorn';
import {parse as parseHtml} from 'parse5';

const root = resolve(import.meta.dirname, '..');
const authoredGate = readFileSync(resolve(root, 'app/browser/compatibility-gate.js'), 'utf8');
const guide = readFileSync(resolve(root, 'public/compatibility.html'), 'utf8');
parseJavaScript(authoredGate, {ecmaVersion: 5, sourceType: 'script'});
assert.doesNotMatch(authoredGate, /Object\.hasOwn|URLSearchParams|\b(?:localStorage|sessionStorage)\b/, 'gate must not use modern APIs or persist a bypass');
assert.ok(FRONTEND_PACKAGE_FILES.includes('compatibility.html') && APP_SHELL_FILES.includes('compatibility.html'), 'compatibility page must ship and be precached');
assert.equal(readFileSync(resolveFrontendPackageSource('compatibility.html'), 'utf8'), guide, 'publication must retain the authored standalone guide');
assert.doesNotMatch(guide, /<link\b|<script\s+type="module"/i, 'guide must not depend on external assets or modules');
assert.match(guide, /location\.href='\.\/\?compat=continue'/, 'the explicit retry stays inside the guide mount');
for (const snippet of ['id="computer"', 'id="phone"', 'id="graphics"', 'supermium.net', '--use-angle=gl', '卓易通', 'Via', 'get.webgl.org/webgl2']) {
  assert.ok(guide.includes(snippet), `missing guide content: ${snippet}`);
}

function emittedGate(artifact) {
  const html = readFileSync(resolve(artifact.root, 'index.html'), 'utf8');
  const nodes = [];
  function visit(node) {if (node.tagName) nodes.push(node); for (const child of node.childNodes || []) visit(child);}
  visit(parseHtml(html, {sourceCodeLocationInfo: true}));
  const attributes = node => Object.fromEntries(node.attrs.map(({name, value}) => [name, value]));
  const scripts = nodes.filter(node => node.tagName === 'script');
  const gates = scripts.filter(node => attributes(node).id === 'browser-compatibility-gate');
  assert.equal(gates.length, 1, 'Framework HTML must contain one early gate');
  const gate = gates[0], attrs = attributes(gate);
  assert.equal(scripts[0], gate, 'gate must be the first script, before modern module boot');
  assert.equal(gate.parentNode.tagName, 'head', 'gate must run in the initial document head');
  assert.ok(!attrs.type && !attrs.src && !('async' in attrs) && !('defer' in attrs), 'gate must be inline classic, synchronously parsed');
  assert.equal(attrs['data-compatibility-url'], `${artifact.mountPath}compatibility.html`, 'guide destination must come from the build mount');
  const code = gate.childNodes.map(node => node.value || '').join('');
  assert.equal(code, authoredGate, 'Framework must inline the single authored source unchanged');
  parseJavaScript(code, {ecmaVersion: 5, sourceType: 'script'});
  for (const node of nodes.filter(node => node.tagName === 'link' && attributes(node).rel === 'stylesheet')) {
    assert.ok(gate.sourceCodeLocation.startOffset < node.sourceCodeLocation.startOffset, 'gate must precede Launcher styles');
  }
  return {code, guideUrl: attrs['data-compatibility-url'], mountPath: artifact.mountPath};
}

function evaluateGate({code, guideUrl}, {ua, webgl = true, query = '', throws = false, lost = false, release = true, getContext = true, legacyContext = false, documentPath = '/play/th06/resources'}) {
  const redirects = [];
  let probes = 0, releases = 0, extensions = 0;
  const location = {search: query, href: `https://launcher.test${documentPath}${query}`, replace: url => redirects.push(new URL(url, location.href))};
  const document = {
    // No currentScript support is needed, including on IE.
    getElementById: id => {
      assert.equal(id, 'browser-compatibility-gate');
      return {getAttribute: name => {assert.equal(name, 'data-compatibility-url'); return guideUrl;}};
    },
    createElement: tag => {
      assert.equal(tag, 'canvas');
      return {getContext: getContext ? kind => {
        assert.equal(kind, 'webgl2'); probes++;
        if (throws) throw new Error('GPU process failed');
        if (!webgl) return null;
        if (legacyContext) return {};
        return {isContextLost: () => lost, getExtension: name => {
          assert.equal(name, 'WEBGL_lose_context'); extensions++;
          return release ? {loseContext: () => {releases++;}} : null;
        }};
      } : undefined};
    },
  };
  runInNewContext(code, {navigator: {userAgent: ua}, location, document, Number, encodeURIComponent});
  return {redirects, probes, releases, extensions};
}
const windows = (version, nt = '10.0', token = 'Chrome') => `Mozilla/5.0 (Windows NT ${nt}; Win64; x64) AppleWebKit/537.36 ${token}/${version}.0.0.0 Safari/537.36`;
const win7Chrome = windows(109, '6.1');
const cases = [
  ['old Windows and old Chrome', {ua: win7Chrome}, 'windows,chrome', 0],
  ['old Windows and Chromium 125', {ua: windows(125, '6.1')}, 'windows,chrome', 0],
  ['old Windows and Chromium 126 passes', {ua: windows(126, '6.1')}, null, 1, 1],
  ['old Windows and modern Supermium passes', {ua: windows(132, '6.1')}, null, 1, 1],
  ['old Windows without Chromium', {ua: 'Mozilla/5.0 (Windows NT 6.1; rv:115.0) Gecko/20100101 Firefox/115.0'}, 'windows', 0],
  ['old Windows and modern Chromium without WebGL2', {ua: windows(132, '6.1'), webgl: false}, 'webgl2', 1],
  ['IE11', {ua: 'Mozilla/5.0 (Windows NT 6.3; Trident/7.0; rv:11.0) like Gecko'}, 'ie', 0],
  ['IE8 on old Windows', {ua: 'Mozilla/4.0 (compatible; MSIE 8.0; Windows NT 5.1)'}, 'windows,ie', 0],
  ['old desktop Chromium', {ua: windows(125)}, 'chrome', 0],
  ['old Chromium-token desktop', {ua: windows(125, '10.0', 'Chromium')}, 'chrome', 0],
  ['old Huawei phone', {ua: 'Mozilla/5.0 (Linux; Android 11; HUAWEI XYZ) AppleWebKit/537.36 Chrome/92.0.0.0 Mobile Safari/537.36'}, 'chrome', 0],
  ['Chrome 126 passes', {ua: windows(126)}, null, 1, 1],
  ['Chrome 126 has no WebGL2', {ua: windows(126), webgl: false}, 'webgl2', 1],
  ['WebGL2 throws', {ua: windows(150), throws: true}, 'webgl2', 1],
  ['lost WebGL2 context is rejected and released', {ua: windows(150), lost: true}, 'webgl2', 1, 1],
  ['missing canvas context API', {ua: windows(150), getContext: false}, 'webgl2', 0],
  ['optional release extension is not required', {ua: windows(150), release: false}, null, 1],
  ['optional context helpers are not required', {ua: windows(150), legacyContext: true}, null, 1],
  ['modern Chromium passes', {ua: windows(150)}, null, 1, 1],
  ['modern Firefox passes with WebGL2', {ua: 'Mozilla/5.0 (X11; Linux x86_64; rv:144.0) Gecko/20100101 Firefox/144.0'}, null, 1, 1],
  ['iOS CriOS is not Chromium', {ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) CriOS/92.0.0.0 Mobile/15E148 Safari/604.1'}, null, 1, 1],
  ['retry skips detector only when explicitly requested', {ua: win7Chrome, query: '?compat=continue'}, null, 0],
  ['retry works among other parameters', {ua: win7Chrome, query: '?uiLocale=en&compat=continue&game=th06'}, null, 0],
  ['retry value must match exactly', {ua: win7Chrome, query: '?compat=continue-later'}, 'windows,chrome', 0],
  ['retry key must match exactly', {ua: win7Chrome, query: '?notcompat=continue'}, 'windows,chrome', 0],
  ['retry is not accepted from another parameter value', {ua: win7Chrome, query: '?value=compat=continue'}, 'windows,chrome', 0],
];
const candidates = [
  {code: authoredGate, guideUrl: '/compatibility.html', mountPath: '/'},
  {code: authoredGate, guideUrl: '/nested-launcher/compatibility.html', mountPath: '/nested-launcher/'},
  emittedGate(FRONTEND_UI_ARTIFACT),
];
for (const argument of process.argv.slice(2)) {
  assert.ok(argument.startsWith('--artifact='), `unknown argument: ${argument}`);
  candidates.push(emittedGate(await readUiArtifact(resolve(argument.slice('--artifact='.length)))));
}
for (const candidate of candidates) for (const [label, scenario, expected, probes, releases = 0] of cases) {
  const got = evaluateGate(candidate, {...scenario, documentPath: `${candidate.mountPath}play/th06/resources`});
  assert.equal(got.probes, probes, `${label}: probe count`);
  assert.equal(got.releases, releases, `${label}: ephemeral probe context must be released`);
  if (expected === null) assert.equal(got.redirects.length, 0, label);
  else {
    assert.equal(got.redirects.length, 1, label);
    const url = got.redirects[0];
    assert.equal(url.origin, 'https://launcher.test', label);
    assert.equal(url.pathname, candidate.guideUrl, `${label}: route-independent guide URL`);
    assert.equal(url.searchParams.get('reasons'), expected, label);
    assert.equal(url.searchParams.get('platform'), label === 'old Huawei phone' ? 'mobile' : 'desktop', label);
    assert.equal(url.searchParams.get('huawei'), label === 'old Huawei phone' ? '1' : null, label);
  }
}
console.log(`PASS browser compatibility gate (${cases.length} scenarios × ${candidates.length} source/artifact variants), ES5 ordering, context release, standalone guide and shell manifest`);
