import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PRODUCT_CONTENT } from "../lib/content-definition.mjs";
import { createDevelopmentHostManifestFromContent } from "../lib/development-host-manifest.mjs";
import { DEVELOPMENT_CONTENT } from "../lib/development-content.mjs";
import { HOST_MANIFEST_SCHEMA, validateHostManifest } from "../lib/contracts/host-manifest.mjs";
import { PRODUCT_GAMES } from "../lib/contracts/product-catalog.mjs";

const root = await mkdtemp(join(resolve(import.meta.dirname, "../.."), "eagler-development-manifest-"));
const fixtureData = Buffer.from([1, 2, 3, 4]);
const fixtureScript = game => `loadPackage({files:[{filename:"/${game}-fixture.dat",start:0,end:4}],remote_package_size:4});`;
const preloadGames = Object.entries(PRODUCT_GAMES)
  .filter(([, product]) => product.dataProvider === "emscripten-preload")
  .map(([game]) => game);
for (const game of preloadGames) {
  await writeFile(join(root, `${game}.data`), fixtureData);
  await writeFile(join(root, `${game}.js`), fixtureScript(game));
}
const fixtureContent = {
  shared: DEVELOPMENT_CONTENT.shared,
  games: Object.fromEntries(Object.entries(DEVELOPMENT_CONTENT.games).map(([game, declaration]) => [game, {
    runtime: declaration.runtime,
    ...(declaration.multiplayerRuntime ? { multiplayerRuntime: declaration.multiplayerRuntime } : {}),
    data: PRODUCT_GAMES[game].dataProvider === "retail-memory" ? { identity: { bytes:4, sha256:"a".repeat(64), layout:declaration.data.identity?.layout || declaration.data.layout } } : {
      source: `${game}.data`,
      runtimeScript: `${game}.js`,
    },
  }])),
};
const createManifest = options => createDevelopmentHostManifestFromContent(fixtureContent, { sourceRoot: root, ...options });
const manifest = await createManifest();
assert.equal(manifest.schema, HOST_MANIFEST_SCHEMA);
assert.equal(manifest.profile, "web-development");
assert.equal(manifest.shared.testBuild, true);
assert.equal(manifest.shared.resourceMode, "hosted");
assert.deepEqual(Object.keys(manifest.games), Object.keys(PRODUCT_GAMES));
assert.doesNotThrow(() => validateHostManifest(manifest));
assert.equal(manifest.shared.netplayRelay, undefined);
const th09Only = await createManifest({ games: ["th09"] });
assert.deepEqual(Object.keys(th09Only.games), ["th09"]);
assert.doesNotThrow(() => validateHostManifest(th09Only));

const relayManifest = await createManifest({ netplayRelay: "ws://127.0.0.1:18142/" });
assert.equal(relayManifest.shared.netplayRelay, "ws://127.0.0.1:18142/");
await assert.rejects(
  createManifest({ netplayRelay: "https://example.invalid/" }),
  /netplayRelay/,
);
for (const [game, entry] of Object.entries(manifest.games)) {
  assert.match(entry.runtime, /^\.\.\//, `${game}: development Runtime must remain an explicit workspace-relative input`);
  assert.equal(entry.runtime, DEVELOPMENT_CONTENT.games[game].runtime,
    `${game}: development Host Manifest must preserve the declared Runtime owner`);
  if (PRODUCT_GAMES[game].multiplayerRuntime) {
    assert.equal(entry.multiplayerRuntime, DEVELOPMENT_CONTENT.games[game].multiplayerRuntime,
      `${game}: development Host Manifest must preserve the declared multiplayer Runtime owner`);
  }
  assert.match(entry.gameData.version, /^sha256-[a-f0-9]{64}$/i);
  assert.match(entry.gameData.layout, /^sha256-[a-f0-9]{64}$/i);
}
// Prepared content outside the Launcher tree must still produce HTTP URLs,
// rather than Windows drive schemes or Unix filesystem-root URLs.
const project = fileURLToPath(new URL("..", import.meta.url));
for (const game of ["th10", "th11", "th20"]) {
  const contentRoot = join(root, game);
  const musicDirectory = game === "th11" ? "music" : "bgm-ogg";
  await mkdir(join(contentRoot, musicDirectory), { recursive: true });
  await writeFile(join(contentRoot, `${game}.data`), fixtureData);
  for (const name of PRODUCT_CONTENT[game].music.ogg.files) {
    await writeFile(join(contentRoot, musicDirectory, name), fixtureData);
  }
  const prepared = JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e",
    `import { createDevelopmentHostManifest } from './lib/development-host-manifest.mjs';
     console.log(JSON.stringify(await createDevelopmentHostManifest({ games: ['${game}'] })));`,
  ], { cwd: project, encoding: "utf8", env: { ...process.env, [`EAGLER_${game.toUpperCase()}_CONTENT_DIR`]: contentRoot } }));
  const entry = prepared.games[game];
  assert.equal(resolve(project, entry.gameData.source), join(contentRoot, `${game}.data`));
  assert.match(entry.gameData.source, /^\.\.\//);
  assert.match(entry.music.ogg.base, /^\.\.\//);
  const url = new URL(entry.music.ogg.files[0], new URL(entry.music.ogg.base, "http://127.0.0.1:8130/"));
  assert.equal(url.origin, "http://127.0.0.1:8130");
  assert.equal(entry.gameData.bytes, fixtureData.length);
}
await rm(root, { recursive: true, force: true });
console.log(JSON.stringify({ developmentHostManifest: "PASS", games: Object.keys(manifest.games) }));
