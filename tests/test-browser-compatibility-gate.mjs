import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";

const root = resolve(import.meta.dirname, "..");
const index = readFileSync(resolve(root, "public/index.html"), "utf8");
const guide = readFileSync(resolve(root, "public/compatibility.html"), "utf8");
const manifest = readFileSync(resolve(root, "lib/frontend-manifest.mjs"), "utf8");
const scripts = [...index.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)];
assert.ok(scripts.length >= 2, "compatibility gate and boot script should both be inline");
const gate = scripts[0][1];
assert.ok(index.indexOf(scripts[0][0]) < index.indexOf('<link rel="stylesheet"'), "gate must run before loading Launcher styles");
assert.doesNotMatch(gate, /\bconst\b|\blet\b|=>|\?\.|Object\.hasOwn|URLSearchParams/, "gate must work in old browsers");
assert.match(manifest, /\["compatibility\.html", true\]/, "compatibility page must ship and be precached");
assert.doesNotMatch(guide, /<link\b|<script\s+type="module"/i, "guide must not depend on external assets or modules");
for (const snippet of ["id=\"computer\"", "id=\"phone\"", "id=\"graphics\"", "supermium.net", "--use-angle=gl", "卓易通", "Via", "get.webgl.org/webgl2"]) {
  assert.ok(guide.includes(snippet), `missing guide content: ${snippet}`);
}

function evaluateGate({ ua, webgl = true, query = "", throws = false }) {
  const redirects = [];
  let probes = 0;
  const location = { search: query, replace: url => redirects.push(url) };
  const document = { createElement: tag => {
    assert.equal(tag, "canvas");
    return { getContext: kind => {
      assert.equal(kind, "webgl2");
      probes++;
      if (throws) throw new Error("GPU process failed");
      return webgl ? { isContextLost: () => false, getExtension: () => null } : null;
    } };
  } };
  runInNewContext(gate, { navigator: { userAgent: ua }, location, document, Number, encodeURIComponent });
  return { redirects, probes };
}

const win7Chrome = "Mozilla/5.0 (Windows NT 6.1; Win64; x64) AppleWebKit/537.36 Chrome/109.0.0.0 Safari/537.36";
const win7NewChrome = version => `Mozilla/5.0 (Windows NT 6.1; Win64; x64) AppleWebKit/537.36 Chrome/${version}.0.0.0 Safari/537.36`;
const win10Chrome = version => `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/${version}.0.0.0 Safari/537.36`;
const androidChrome = version => `Mozilla/5.0 (Linux; Android 11; HUAWEI XYZ) AppleWebKit/537.36 Chrome/${version}.0.0.0 Mobile Safari/537.36`;
const cases = [
  ["old Windows and old Chrome", { ua: win7Chrome }, "windows%2Cchrome", 0],
  ["old Windows and Chromium 125", { ua: win7NewChrome(125) }, "windows%2Cchrome", 0],
  ["old Windows and Chromium 126 passes", { ua: win7NewChrome(126) }, null, 1],
  ["old Windows and modern Supermium passes", { ua: win7NewChrome(132) }, null, 1],
  ["old Windows and modern Chromium without WebGL2", { ua: win7NewChrome(132), webgl: false }, "webgl2", 1],
  ["IE11", { ua: "Mozilla/5.0 (Windows NT 6.3; Trident/7.0; rv:11.0) like Gecko" }, "ie", 0],
  ["old desktop Chromium", { ua: win10Chrome(125) }, "chrome", 0],
  ["old Huawei phone", { ua: androidChrome(92) }, "chrome", 0],
  ["Chrome 126 passes", { ua: win10Chrome(126) }, null, 1],
  ["Chrome 126 has no WebGL2", { ua: win10Chrome(126), webgl: false }, "webgl2", 1],
  ["WebGL2 throws", { ua: win10Chrome(150), throws: true }, "webgl2", 1],
  ["modern Chromium passes", { ua: win10Chrome(150) }, null, 1],
  ["retry skips detector when explicitly requested", { ua: win7Chrome, query: "?compat=continue" }, null, 0],
];
for (const [label, scenario, expected, probes] of cases) {
  const got = evaluateGate(scenario);
  assert.equal(got.probes, probes, `${label}: probe count`);
  if (expected === null) assert.equal(got.redirects.length, 0, label);
  else {
    assert.equal(got.redirects.length, 1, label);
    assert.match(got.redirects[0], new RegExp(`^compatibility\\.html\\?reasons=${expected}&platform=`), label);
    if (label === "old Huawei phone") assert.match(got.redirects[0], /&platform=mobile&huawei=1$/);
  }
}
console.log(`PASS browser compatibility gate (${cases.length} scenarios), self-contained guide and shell manifest`);
