import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PRODUCT_GAMES } from "../lib/contracts/product-catalog.mjs";
import { assertProductEntriesRegistered, normalizeProductSelection, selectProductEntries } from "../lib/product-selection.mjs";

assert.deepEqual(normalizeProductSelection(), Object.keys(PRODUCT_GAMES));
assert.deepEqual(normalizeProductSelection(["th07"]), ["th07"]);
assert.deepEqual(normalizeProductSelection("th08,th06"), ["th06", "th08"]);
for (const value of [[], ["th99"], ["th06", "th06"], "th99"]) {
  assert.throws(() => normalizeProductSelection(value), /non-empty unique subset/);
}
assert.deepEqual(selectProductEntries({ th06: 6, th07: 7, th08: 8 }, ["th07"]), { th07: 7 });
const registeredEntries = { th06: {}, th08: {} };
assert.equal(assertProductEntriesRegistered(registeredEntries), registeredEntries);
assert.throws(() => assertProductEntriesRegistered({ th06: {}, th99: {} }, "content catalog games"),
  /content catalog games do not match registered adapters: th99/);
const publicInstallVerifier = readFileSync(resolve(import.meta.dirname, "..", "tools", "maintainer", "verify-public-first-install.mjs"), "utf8");
assert.match(publicInstallVerifier, /DEFAULT_PRODUCT_ID/,
  "public first-install verifier default must follow Product Catalog policy");
assert.match(publicInstallVerifier, /isGameId\(game\)/,
  "public first-install verifier must validate requested games through Product Catalog");
assert.doesNotMatch(publicInstallVerifier, /th\(\?:06\|07\|08\|10\)/,
  "public first-install verifier must not carry a second hard-coded game registry");
console.log(JSON.stringify({ defaultGames: Object.keys(PRODUCT_GAMES), subset: true }));
