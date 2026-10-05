// Module regression: a structurally valid old hosted site must not suppress
// preparation of newly enabled default language packs. No game data is used.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PRODUCT_GAMES } from "../lib/contracts/product-catalog.mjs";
import { reusableHostedBase } from "../host/lib/site-builder.mjs";

const cache = resolve(import.meta.dirname, "../.cache");
await mkdir(cache, { recursive: true });
const root = await mkdtemp(resolve(cache, "hosted-base-language-test-"));
const site = resolve(root, "site");
await mkdir(site);
await mkdir(resolve(root, "scripts"));
// All other cache checks pass; the verifier stub keeps this test independent
// of retail files and browser Runtime artifacts.
await writeFile(resolve(root, "scripts/verify-server-build.mjs"), "process.exit(0);\n");
const games = Object.keys(PRODUCT_GAMES);
await writeFile(resolve(site, "deployment.json"), JSON.stringify({
  format: "eagler-touhou-deployment/1", profile: "web-validation-self-host",
  resourceMode: "hosted", games, music: ["ogg"],
  generatedAt: new Date(Date.now() + 60000).toISOString(),
}));
const layout = { site, music: ["ogg"], runtimeRelease: resolve(root, "runtime"),
  shared: resolve(root, "shared"), config: resolve(root, "config.json"),
  games: Object.fromEntries(games.map(game => [game, resolve(root, game)])) };
const manifest = { games: Object.fromEntries(games.map(game => [game, {
  languageOptions: ["ja", "lang_zh-hans", "lang_en"].map(id => ({
    id, pack: id === "ja" ? null : { url: `games/${game}/language/${id}.zip` },
  })),
}])) };
const save = () => writeFile(resolve(site, "host-manifest.json"), JSON.stringify(manifest));
await save();
assert.equal(await reusableHostedBase(root, layout), true);
const full = manifest.games.th09.languageOptions;
manifest.games.th09.languageOptions = full.slice(0, 1);
await save();
assert.equal(await reusableHostedBase(root, layout), false, "Japanese-only TH09 cache must rebuild");
manifest.games.th09.languageOptions = full.map(option => ({ ...option, pack: null }));
await save();
assert.equal(await reusableHostedBase(root, layout), false, "labels without packs must rebuild");
manifest.games.th09.languageOptions = full;
await save();
assert.equal(await reusableHostedBase(root, layout), true);
console.log(JSON.stringify({ hostedLanguageCache: "validated", th09MissingPacks: "rebuild" }));
