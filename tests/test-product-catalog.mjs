/** L3/module. Preconditions: static product policy only. Mutations: none.
 * Proves: stable product registry invariants, product-id mapping and language ordering. */
import assert from "node:assert/strict";
import {
  HOST_RUNTIME_FEATURE_IDS,
  PRODUCT_GAMES,
  PRODUCT_FEATURE_IDS,
  PRODUCT_FEATURE_POLICY,
  PRODUCT_IDS,
  DEFAULT_MULTIPLAYER_PRODUCT_ID,
  DEFAULT_PRODUCT_ID,
  createLocalProductManifest,
  gameIdForProduct,
  isMultiplayerProductId,
  languagePriority,
  multiplayerConfigForProduct,
  multiplayerProductIdForGame,
  productFeatureAvailable,
  productEnabledForBuild,
} from "../lib/contracts/product-catalog.mjs";
import { PRODUCT_CONTENT } from "../lib/content-definition.mjs";

assert.deepEqual(PRODUCT_FEATURE_IDS, ["thprac", "languages", "focusHitbox"]);
assert.deepEqual(HOST_RUNTIME_FEATURE_IDS, ["thprac", "focusHitbox"]);
assert.equal(PRODUCT_FEATURE_POLICY.languages.runtimeRelease, true);
assert.equal(PRODUCT_FEATURE_POLICY.languages.hostManifestFeature, false);
assert.match(PRODUCT_FEATURE_POLICY.languages.hostSurface, /languageOptions/);
assert.equal(PRODUCT_FEATURE_POLICY.thprac.hostValueSource, "server-request-and-runtime");
assert.equal(PRODUCT_FEATURE_POLICY.focusHitbox.hostValueSource, "runtime-release");

assert.deepEqual(
  ["lang_ru", "lang_en", "ja", "lang_zh-hant", "lang_zh-hans", "lang_de"]
    .sort((a, b) => languagePriority(a) - languagePriority(b) || a.localeCompare(b, "en")),
  ["ja", "lang_zh-hans", "lang_zh-hant", "lang_en", "lang_de", "lang_ru"],
);

assert.deepEqual(PRODUCT_IDS, ["th06", "th07", "th08", "th09", "th10", "th11", "th15", "th20", "th06mp", "th07mp", "th08mp", "th09mp", "th10mp", "th11mp"]);
assert.equal(DEFAULT_PRODUCT_ID, "th06");
assert.ok(PRODUCT_IDS.includes(DEFAULT_PRODUCT_ID));
assert.equal(DEFAULT_MULTIPLAYER_PRODUCT_ID, "th07mp");
assert.equal(isMultiplayerProductId(DEFAULT_MULTIPLAYER_PRODUCT_ID), true);
assert.equal(isMultiplayerProductId("th06mp"), true);
assert.equal(isMultiplayerProductId("th07mp"), true);
assert.equal(isMultiplayerProductId("th08mp"), true);
assert.equal(isMultiplayerProductId("th09mp"), true);
assert.equal(isMultiplayerProductId("th10mp"), true);
assert.equal(isMultiplayerProductId("th11mp"), true);
assert.equal(isMultiplayerProductId("th06"), false);
assert.equal(gameIdForProduct("th06mp"), "th06");
assert.equal(gameIdForProduct("th07"), "th07");
assert.equal(multiplayerProductIdForGame("th06"), "th06mp");
assert.equal(multiplayerProductIdForGame("th07"), "th07mp");
assert.equal(multiplayerProductIdForGame("th08"), "th08mp");
assert.equal(multiplayerProductIdForGame("th09"), "th09mp");
assert.equal(multiplayerProductIdForGame("th10"), "th10mp");
assert.equal(multiplayerProductIdForGame("th11"), "th11mp");
assert.equal(multiplayerConfigForProduct("th06mp"), PRODUCT_GAMES.th06.multiplayer);
assert.equal(multiplayerConfigForProduct("th07"), PRODUCT_GAMES.th07.multiplayer);
assert.equal(multiplayerConfigForProduct("th08"), PRODUCT_GAMES.th08.multiplayer);
assert.equal(productFeatureAvailable("th06", "thprac"), true);
assert.equal(productFeatureAvailable("th06", "thprac", { thprac: false }), false);
assert.equal(productFeatureAvailable("th08", "thprac", { thprac: true }), true);
assert.equal(productFeatureAvailable("th08", "thprac", { thprac: false }), false);
assert.equal(productFeatureAvailable("th06", "focusHitbox", { focusHitbox: false }), false);
assert.equal(productFeatureAvailable("th07", "focusHitbox", { focusHitbox: true }), false);
assert.equal(productFeatureAvailable("th06", "languages", { languages: false }), true);
assert.equal(PRODUCT_GAMES.th08.replay.prefix, "th8");
assert.equal(PRODUCT_GAMES.th09.replay.prefix, "th9");
assert.deepEqual(PRODUCT_GAMES.th09.package.rawDataImport.fileNames, ["th09.dat"]);
assert.equal(PRODUCT_GAMES.th09.features.thprac, false);
assert.equal(PRODUCT_GAMES.th10.replay.prefix, "th10");
assert.equal(PRODUCT_GAMES.th10.display.faithBar, true);
assert.deepEqual(PRODUCT_GAMES.th10.storage.hintFiles, ["hint/hint_user.txt", "hint/hint_auto.txt"]);
for (const [game, product] of Object.entries(PRODUCT_GAMES)) {
  if (game === "th10") continue;
  assert.equal(product.display?.faithBar, undefined);
  assert.equal(product.storage.hintFiles, undefined);
}
assert.deepEqual(PRODUCT_GAMES.th08.package.rawDataImport.fileNames, ["th08.dat"]);
assert.equal(PRODUCT_GAMES.th08.musicCapabilities.midi, true);
assert.equal(PRODUCT_GAMES.th10.musicCapabilities.midi, false);
assert.equal(PRODUCT_GAMES.th08.support.adaptationNotice, "early-test");
assert.equal(PRODUCT_GAMES.th10.support.adaptationNotice, "early-test");
const localManifest = createLocalProductManifest();
assert.notEqual(localManifest.games.th06.music.midi.supported, false);
assert.equal(localManifest.games.th10.music.midi.supported, false,
  "development fallback must not advertise a product capability forbidden by static policy");
assert.equal(PRODUCT_GAMES.th06.multiplayerRuntime, "./runtime/th06/multiplayer/th06.html");
assert.equal(PRODUCT_GAMES.th06.multiplayer.titleKey, "game.title.th06mp");
assert.deepEqual(PRODUCT_GAMES.th06.multiplayer.playerCounts, [2, 3]);
assert.deepEqual(PRODUCT_GAMES.th06.multiplayer.loadouts.map(item => [item.labelKey, item.glyph, item.character, item.shot]), [
  ["multiplayer.loadout.reimuA", "霊", 0, 0],
  ["multiplayer.loadout.reimuB", "霊", 0, 1],
  ["multiplayer.loadout.marisaA", "魔", 1, 0],
  ["multiplayer.loadout.marisaB", "魔", 1, 1],
]);
assert.deepEqual(PRODUCT_GAMES.th06.multiplayer.difficulties, ["Easy", "Normal", "Hard", "Lunatic", "Extra"]);
assert.equal(PRODUCT_GAMES.th06.multiplayer.peerTransportGlobal, "__th06PeerTransport");
assert.equal(PRODUCT_GAMES.th07.multiplayerRuntime, "./runtime/th07/multiplayer/th07.html");
assert.equal(PRODUCT_GAMES.th07.multiplayer.titleKey, "game.title.th07mp");
assert.deepEqual(PRODUCT_GAMES.th07.multiplayer.playerCounts, [2, 3]);
assert.deepEqual(PRODUCT_GAMES.th07.multiplayer.loadouts.slice(-2).map(item => [item.labelKey, item.glyph, item.character, item.shot]), [
  ["multiplayer.loadout.sakuyaA", "咲", 2, 0],
  ["multiplayer.loadout.sakuyaB", "咲", 2, 1],
]);
assert.deepEqual(PRODUCT_GAMES.th07.multiplayer.difficulties, ["Easy", "Normal", "Hard", "Lunatic", "Extra", "Phantasm"]);
assert.equal(PRODUCT_GAMES.th07.multiplayer.peerTransportGlobal, "__th07PeerTransport");
assert.equal(PRODUCT_GAMES.th09.multiplayerRuntime, "./runtime/th09/multiplayer/th09.html");
assert.deepEqual(PRODUCT_GAMES.th09.multiplayer.playerCounts, [2]);
assert.deepEqual(PRODUCT_GAMES.th09.multiplayer.difficulties, ["Easy", "Normal", "Hard", "Lunatic"]);
assert.deepEqual(PRODUCT_GAMES.th09.multiplayer.loadouts.map(item => item.character), Array.from({ length: 16 }, (_, index) => index));
// Room facts shared Launcher orchestration reads instead of branching on the
// title number: the in-game versus entry, and whether a spectator seat exists.
assert.equal(PRODUCT_GAMES.th06.multiplayer.titleRoomEntry, false);
assert.equal(PRODUCT_GAMES.th07.multiplayer.titleRoomEntry, false);
assert.equal(PRODUCT_GAMES.th09.multiplayer.titleRoomEntry, true);
assert.equal(PRODUCT_GAMES.th06.multiplayer.spectator, true);
assert.equal(PRODUCT_GAMES.th07.multiplayer.spectator, true);
assert.equal(PRODUCT_GAMES.th09.multiplayer.spectator, true);
for (const [game, product] of Object.entries(PRODUCT_GAMES)) {
  if (!product.multiplayer) continue;
  assert.equal(typeof product.multiplayer.spectator, "boolean", `${game}: multiplayer room must declare spectator availability`);
  assert.equal(typeof product.multiplayer.titleRoomEntry, "boolean", `${game}: multiplayer room must declare the in-game title entry`);
}

const roots = new Set();
assert.deepEqual(Object.keys(PRODUCT_CONTENT), Object.keys(PRODUCT_GAMES),
  "every registered product must declare its original-content shape");
for (const [game, product] of Object.entries(PRODUCT_GAMES)) {
  const content = PRODUCT_CONTENT[game];
  if (product.cardPresentation) {
    const card = product.cardPresentation;
    assert.ok(Number.isFinite(card.positionPercent) && card.positionPercent >= 0 && card.positionPercent <= 100,
      `${game}: card artwork position must be a 0-100 percentage`);
    for (const key of ["artBrightness", "artSaturation", "glowBrightness", "glowSaturation"]) {
      assert.ok(Number.isFinite(card[key]) && card[key] >= 0, `${game}: invalid card presentation ${key}`);
    }
  }
  assert.ok(content?.original && Array.isArray(content.original.files) && content.original.files.length > 0,
    `${game}: original-content files must be declared`);
  // Products that stream retail BGM directly (no external OGG set) declare no
  // OGG host-preparation owner. Everything else must declare one explicitly.
  if (content.hostPreparation?.ogg) {
    assert.ok(["verified-converter", "prepared-content"].includes(content.hostPreparation.ogg.kind),
      `${game}: unknown OGG Host preparation kind`);
    if (content.hostPreparation.ogg.kind === "verified-converter") {
      assert.match(content.hostPreparation.ogg.outputDirectory, /^[A-Za-z0-9][A-Za-z0-9._/-]*$/,
        `${game}: verified OGG converter needs a safe output directory`);
    } else {
      assert.ok(content.hostPreparation.preparedContent, `${game}: prepared OGG path needs preparedContent metadata`);
    }
  } else {
    assert.equal(product.musicCapabilities.midi, false,
      `${game}: only a non-MIDI product may omit the external OGG host-preparation owner`);
  }
  // Language-capable products either declare the thcrap host compiler or state
  // that language support is runtime-only (static packs installed by the shell).
  if (content.hostPreparation?.languagePack) {
    assert.equal(content.hostPreparation.languagePack.kind, "thcrap-runtime-compiler",
      `${game}: unknown language preparation kind`);
    assert.ok(["archive", "archives"].includes(content.hostPreparation.languagePack.inputMode));
    assert.match(content.hostPreparation.languagePack.developmentEnv, /^EAGLER_[A-Z0-9_]+$/);
    assert.ok(Array.isArray(content.hostPreparation.languagePack.developmentFiles) &&
      content.hostPreparation.languagePack.developmentFiles.length > 0);
  }
  if (content.hostPreparation?.preparedContent) {
    const prepared = content.hostPreparation.preparedContent;
    assert.match(prepared.directory, /^[A-Za-z0-9][A-Za-z0-9._/-]*$/);
    assert.ok(Array.isArray(prepared.markerFiles) && prepared.markerFiles.length > 0);
    assert.match(prepared.script, /^scripts\/[A-Za-z0-9][A-Za-z0-9._/-]*$/);
  }
  if (content.hostPreparation?.dataAssets?.kind === "legacy-preload-with-focus-hitbox") {
    const focus = content.hostPreparation.dataAssets.focusHitbox;
    assert.ok(PRODUCT_GAMES[focus.sourceGame], `${game}: focus-hitbox preparation source game must be registered`);
    assert.match(focus.output, /^[A-Za-z0-9][A-Za-z0-9._-]*$/);
  }
  const dataPreparation = content.hostPreparation?.dataAssets;
  if (product.dataProvider === "retail-memory") {
    assert.ok(["original-file", "prepared-content"].includes(dataPreparation?.kind),
      `${game}: retail-memory DATA preparation must be declared`);
    if (dataPreparation.kind === "original-file") {
      assert.ok(content.original.files.includes(dataPreparation.source),
        `${game}: original DATA source must be part of the declared original content`);
    } else {
      assert.ok(content.hostPreparation.preparedContent,
        `${game}: prepared DATA path needs preparedContent metadata`);
    }
  }
  for (const name of [...content.original.files, ...(content.original.oggSourceFiles || [])]) {
    assert.equal(typeof name, "string");
    assert.ok(name && !name.startsWith("/") && !name.includes("..") && !name.includes("\\"),
      `${game}: original-content path must be safe and relative: ${name}`);
  }
  if (content.original.preparedAlternative) {
    assert.match(content.original.preparedAlternative.directory, /^[A-Za-z0-9][A-Za-z0-9._/-]*$/);
    assert.ok(content.original.preparedAlternative.markerFiles.length > 0);
  }
  assert.equal(roots.has(product.storage.saveRoot), false, `${game}: unique save owner`);
  roots.add(product.storage.saveRoot);
  assert.ok(product.storage.saveRoot.startsWith("/"));
  assert.ok(!product.storage.scoreFile.includes("/"));
  assert.equal(typeof product.features.languages, "boolean");
  assert.equal(typeof product.features.focusHitbox, "boolean");
  assert.equal(typeof product.package.dataFileId, "string");
  assert.match(product.package.dataFileId, /^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
  assert.match(product.package.dataTarget, /^\/[A-Za-z0-9][A-Za-z0-9._/-]*$/);
  assert.equal(typeof product.musicCapabilities.midi, "boolean");
  assert.deepEqual(Object.keys(product.musicCapabilities), ["midi"], `${game}: only optional music capabilities belong in product policy`);
  assert.match(product.support.sourceRepository, /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);
  if (product.support.adaptationNotice != null) assert.equal(product.support.adaptationNotice, "early-test");
  if (product.package.rawDataImport) {
    assert.ok(product.package.rawDataImport.fileNames.length > 0);
    assert.equal(new Set(product.package.rawDataImport.fileNames.map(name => name.toLowerCase())).size,
      product.package.rawDataImport.fileNames.length);
    for (const name of product.package.rawDataImport.fileNames) {
      assert.match(name, /^[A-Za-z0-9][A-Za-z0-9._-]*$/);
      assert.ok(!name.includes("/") && !name.includes("\\"));
    }
  }
  for (const [mode, directory] of Object.entries(product.package.musicSourceDirectories || {})) {
    assert.ok(["wav", "ogg"].includes(mode));
    assert.equal(typeof directory, "string");
    assert.ok(directory === "." || /^[A-Za-z0-9_.-]+$/.test(directory));
  }
  assert.match(product.replay?.prefix || "", /^th\d+$/);
  if (product.multiplayerRuntime) {
    assert.ok(product.multiplayer);
    assert.match(product.multiplayer.titleKey, /^game\.title\.[A-Za-z0-9_-]+$/,
      `${game}: multiplayer product needs an explicit localized title key`);
    assert.ok(Array.isArray(product.multiplayer.playerCounts) && product.multiplayer.playerCounts.length > 0,
      `${game}: multiplayer product needs at least one supported player count`);
    assert.equal(new Set(product.multiplayer.playerCounts).size, product.multiplayer.playerCounts.length,
      `${game}: multiplayer player-count declarations must be unique`);
    assert.ok(product.multiplayer.playerCounts.every(count => count === 2 || count === 3),
      `${game}: current shared Multiplayer platform supports only declared 2P/3P subsets`);
    assert.ok(product.multiplayer.difficulties.length > 0 && product.multiplayer.difficulties.every(label => typeof label === "string" && label.length > 0));
    assert.equal(new Set(product.multiplayer.difficulties).size, product.multiplayer.difficulties.length,
      `${game}: multiplayer difficulty labels must be unique`);
    assert.ok(product.multiplayer.loadouts.length > 0, `${game}: multiplayer product needs at least one loadout`);
    const loadoutPairs = new Set();
    const loadoutLabels = new Set();
    for (const loadout of product.multiplayer.loadouts) {
      assert.match(loadout.labelKey, /^multiplayer\.loadout\.[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/);
      assert.equal(typeof loadout.glyph, "string");
      assert.ok(loadout.glyph.length > 0);
      assert.ok(Number.isInteger(loadout.character) && loadout.character >= 0);
      assert.ok(Number.isInteger(loadout.shot) && loadout.shot >= 0);
      assert.equal(loadoutLabels.has(loadout.labelKey), false, `${game}: duplicate Multiplayer loadout label ${loadout.labelKey}`);
      loadoutLabels.add(loadout.labelKey);
      const pair = `${loadout.character}:${loadout.shot}`;
      assert.equal(loadoutPairs.has(pair), false, `${game}: duplicate Multiplayer loadout pair ${pair}`);
      loadoutPairs.add(pair);
    }
    assert.match(product.multiplayer.peerTransportGlobal, /^__[A-Za-z0-9]+$/);
  } else {
    assert.equal(product.multiplayer, undefined);
  }
  if (product.runtimeFileLayout === "directory") {
    assert.ok(Array.isArray(product.runtimeAssets) && product.runtimeAssets.length > 0);
    assert.ok(Array.isArray(product.requiredShared));
    assert.ok(product.runtimeAssets.includes(`${game}.html`));
    assert.ok(product.runtimeAssets.includes("directory-keyboard.mjs"),
      `${game}: directory Runtime must publish the shared browser keyboard owner`);
    assert.equal(new Set(product.runtimeAssets).size, product.runtimeAssets.length);
  }
  assert.equal(typeof PRODUCT_CONTENT[game].hostPreparation?.artwork?.kind, "string",
    `${game}: host artwork preparation must be declared as a format recipe`);
}
console.log("Product catalog policy: PASS");

for (const id of PRODUCT_IDS) {
  const visible = id !== "th20";
  assert.equal(productEnabledForBuild(id), visible);
  assert.equal(productEnabledForBuild(id, false), visible);
  assert.equal(productEnabledForBuild(id, true), true, "Test builds include TH15 and TH20");
}
assert.equal(productEnabledForBuild("th99", true), false);

assert.deepEqual(Object.fromEntries(Object.entries(PRODUCT_GAMES).map(([id, product]) => [id, product.support.highRefreshRate])), {th06: true, th07: true, th08: true, th09: false, th10: true, th11: false, th15: true, th20: false}, "high-refresh UI must follow the catalog capability");
assert.equal(PRODUCT_GAMES.th15.features.languages,true);
assert.equal(PRODUCT_GAMES.th15.features.thprac,true);
assert.ok(PRODUCT_GAMES.th15.requiredShared.includes('/unifont.otf'));
