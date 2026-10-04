import assert from "node:assert/strict";
import { PRODUCT_GAMES } from "../lib/contracts/product-catalog.mjs";
import { PRODUCT_CONTENT } from "../lib/content-definition.mjs";
import { ADAPTER_CONTRACT_REPORT_SCHEMA, createAdapterContractReport } from "../lib/adapter-contract-report.mjs";

for (const game of Object.keys(PRODUCT_GAMES)) {
  const report = createAdapterContractReport(game);
  assert.equal(report.schema, ADAPTER_CONTRACT_REPORT_SCHEMA);
  assert.equal(report.game, game);
  for (const capability of ["authoritative-gameplay-fidelity", "touch-controls", "restart-action", "always-hitbox", "replay-file-management", "replay-determinism-verification"]) {
    assert.ok(report.obligations.required.includes(capability), `${game}: missing required report capability ${capability}`);
  }
  assert.equal(report.obligations.requiredDefinitions.length, report.obligations.required.length);
  for (const definition of report.obligations.requiredDefinitions) {
    assert.equal(typeof definition.summary, "string");
    assert.ok(definition.summary.length > 0);
    assert.ok(Array.isArray(definition.verification) && definition.verification.length > 0,
      `${game}: required capability report lost verification ownership for ${definition.id}`);
  }
  assert.ok(report.obligations.requiredBehaviorDefinitions.input.some(item => item.id === "keyboard-logical-input"));
  assert.ok(report.obligations.requiredBehaviorDefinitions.storage.some(item => item.id === "runtime-restart-durability"));
  assert.ok(report.obligations.requiredBehaviorDefinitions.music.some(item => item.id === "audible-ogg-normal-mode"));
  assert.ok(report.obligations.requiredBehaviorDefinitions.package.some(item => item.id === "offline-installed-launch"));
  assert.ok(report.obligations.presentationProfile.includes("display-cadence-presentation"));
  assert.ok(report.obligations.replayProfile.includes("original-replay-import"));
  assert.ok(report.obligations.replayVerificationProfile.includes("quick-all-title-demos"));
  assert.ok(report.obligations.replayVerificationProfile.includes("daily-long-replay-corpus"));
  assert.ok(report.obligations.requiredBehaviorDefinitions.replayVerification.some(item => item.id === "candidate-cannot-bless"));
  assert.ok(report.obligations.inputProfile.includes("controller-logical-input"));
  assert.ok(report.obligations.storageProfile.includes("runtime-restart-durability"));
  assert.ok(report.obligations.musicProfile.includes("audible-ogg-normal-mode"));
  assert.ok(report.obligations.packageProfile.includes("offline-installed-launch"));
  assert.ok(report.obligations.inherited.includes("touch-layout-editor"));
  assert.equal(report.protocol.gameOptions.alwaysHitbox.class, "required");
  assert.equal(report.protocol.gameOptions.magnifierEnabled.class, "inherited");
  assert.equal(report.protocol.gameOptions.focusHitboxEnabled.class, "optional");
  assert.equal(report.protocol.gameOptions.multiplayerLocalPlayerVisibility.class, "profile-required");
  assert.equal(report.protocol.configureOptions.alwaysHitbox.requirement, "required");
  assert.equal(report.protocol.configureOptions.alwaysHitbox.activeForProduct, true);
  assert.equal(report.protocol.configureOptions.focusHitboxEnabled.requirement, "optional");
  for (const key of ["netplayAdonisMode", "netplayInputDelayAuto", "netplayPredictionReserve"]) {
    assert.equal(report.protocol.configureOptions[key].requirement, "profile-required");
    assert.equal(report.protocol.configureOptions[key].activeForProduct,
      PRODUCT_GAMES[game].multiplayer?.inputTiming?.measuredStartup === true,
      `${game}: measured timing obligations must follow the product declaration`);
  }
  assert.equal(
    report.obligations.optionalProductCapabilityDefinitions.find(item => item.id === "multiplayer")?.class,
    "optional",
  );
  assert.ok(
    report.obligations.optionalProductCapabilityDefinitions.find(item => item.id === "multiplayer")?.verification?.includes("browser:tests/test-multiplayer-replay-launcher-browser.py"),
    "adapter report must expose optional capability verification ownership",
  );
  assert.equal(report.product.music.mounts.ogg, PRODUCT_GAMES[game].package.musicMounts.ogg);
  assert.equal(report.product.activeFormatPreparation.artwork, PRODUCT_CONTENT[game].hostPreparation.artwork.kind);
  assert.equal(report.product.activeFormatPreparation.ogg, PRODUCT_CONTENT[game].hostPreparation.ogg?.kind ?? null);
  assert.ok(report.protocol.legacyConfigureAliases.includes("touchBombZoneEnabled"));
  assert.deepEqual(report.protocol.legacyMusicModes, ["wav"]);
  assert.equal(report.protocol.commands["touch-controls"].requirement, "required");
  assert.equal(report.protocol.events["first-frame"].requirement, "required");
  assert.equal(report.nonObligations.compatibilityAdapters.includes("legacy-package-reader"), true);
  if (PRODUCT_GAMES[game].package.musicMounts?.ogg) {
    assert.ok(report.product.hostPreparation?.ogg, `${game}: adapter report must expose Host content preparation ownership`);
  }
}

const th08 = createAdapterContractReport("th08");
assert.equal(th08.product.adapterProfile.runtimeLayout, "directory");
assert.equal(th08.obligations.optionalProductCapabilities["raw-data-import"], true);
assert.equal(th08.product.music.midiOptional, true);
assert.equal(th08.protocol.configureOptions.focusHitboxEnabled.activeForProduct, false);
assert.equal(th08.protocol.configureOptions.thpracEnabled.activeForProduct, true);
assert.equal(th08.protocol.configureOptions.netplayMode.activeForProduct, true);
assert.equal(th08.obligations.optionalProfiles.multiplayer.active, true);
assert.equal(th08.obligations.optionalProfiles.thprac.active, true);
assert.equal(th08.obligations.optionalProfiles.languages.active, true);
assert.equal(th08.obligations.optionalProfiles.midi.active, true);
assert.ok(th08.obligations.optionalProfiles.midi.behaviors.includes("audible-midi-transport"));

const th10 = createAdapterContractReport("th10");
assert.equal(th10.product.music.midiOptional, false);
assert.equal(th10.product.multiplayerRuntime, PRODUCT_GAMES.th10.multiplayerRuntime);
assert.deepEqual(th10.product.multiplayer, PRODUCT_GAMES.th10.multiplayer);
assert.equal(th10.obligations.optionalProductCapabilities["raw-data-import"], false);
assert.deepEqual(th10.obligations.activeProfileRequired, ["multiplayer-local-player-visibility",
  "multiplayer-spectator-input-isolation", "thprac-touch-bridge", "language-runtime-application"]);
assert.equal(th10.protocol.configureOptions.focusHitboxEnabled.activeForProduct, false);
assert.equal(th10.protocol.configureOptions.debugHarness.activeForProduct, false);
assert.equal(th10.obligations.optionalProfiles.languages.active, true);
assert.equal(th10.obligations.optionalProfiles.midi.active, false);

// TH20 is a single-player early-test adapter: directory Runtime, retail-memory
// DATA, no multiplayer, no thprac, no host card artwork yet.
const th20 = createAdapterContractReport("th20");
assert.equal(th20.product.adapterProfile.runtimeLayout, "directory");
assert.equal(th20.product.adapterProfile.dataProvider, "retail-memory");
assert.equal(th20.product.cardArtwork ?? null, PRODUCT_GAMES.th20.cardArtwork ?? null);
assert.equal(th20.product.multiplayerRuntime, null);
assert.equal(th20.product.multiplayer, null);
assert.equal(th20.obligations.optionalProductCapabilities["raw-data-import"], true);
assert.deepEqual(th20.obligations.activeProfileRequired, ["language-runtime-application"]);
assert.equal(th20.obligations.optionalProfiles.multiplayer.active, false);
assert.equal(th20.obligations.optionalProfiles.thprac.active, false);
assert.equal(th20.obligations.optionalProfiles.languages.active, true);
assert.equal(th20.obligations.optionalProfiles.midi.active, false);
assert.equal(th20.protocol.configureOptions.thpracEnabled.activeForProduct, false);
assert.equal(th20.protocol.configureOptions.netplayMode.activeForProduct, false);

const th09 = createAdapterContractReport("th09");
assert.equal(th09.product.adapterProfile.runtimeLayout, "directory");
assert.equal(th09.product.adapterProfile.dataProvider, "retail-memory");
assert.equal(th09.obligations.optionalProductCapabilities["raw-data-import"], true);
assert.equal(th09.obligations.optionalProfiles.thprac.active, false);
assert.equal(th09.obligations.optionalProfiles.midi.active, false);

const th06 = createAdapterContractReport("th06");
assert.equal(th06.product.cardArtwork, PRODUCT_GAMES.th06.cardArtwork);
assert.equal(th06.product.multiplayerRuntime, PRODUCT_GAMES.th06.multiplayerRuntime);
assert.deepEqual(th06.product.multiplayer.playerCounts, [2, 3]);
assert.deepEqual(th06.product.multiplayer.difficulties, ["Easy", "Normal", "Hard", "Lunatic", "Extra"]);
assert.equal(th06.product.multiplayer.loadouts.length, 4);
assert.equal(th06.protocol.configureOptions.focusHitboxEnabled.activeForProduct, true);
assert.equal(th06.protocol.configureOptions.thpracEnabled.activeForProduct, true);
assert.equal(th06.protocol.configureOptions.netplayMode.activeForProduct, true);
assert.equal(th06.protocol.configureOptions.multiplayerLocalPlayerVisibility.activeForProduct, true);
assert.equal(th06.obligations.optionalProfiles.multiplayer.active, true);
assert.ok(th06.obligations.optionalProfiles.multiplayer.behaviorDefinitions.some(item => item.id === "declared-room-bounds"));
assert.equal(th06.obligations.optionalProfiles.thprac.active, true);
assert.equal(th06.obligations.optionalProfiles.languages.active, true);
assert.equal(th06.obligations.optionalProfiles.midi.active, true);
assert.ok(th06.obligations.optionalProfiles.multiplayer.behaviors.includes("multiplayer-replay"));

const th07 = createAdapterContractReport("th07");
assert.deepEqual(th07.product.cardPresentation, PRODUCT_GAMES.th07.cardPresentation);

assert.throws(() => createAdapterContractReport("th99"), /unknown game/);
console.log(JSON.stringify({ adapterContractReport: "PASS", games: Object.keys(PRODUCT_GAMES) }));
