import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  REQUIRED_ADAPTER_CAPABILITIES,
  REQUIRED_INPUT_BEHAVIORS,
  REQUIRED_TOUCH_BEHAVIORS,
  REQUIRED_PRESENTATION_BEHAVIORS,
  REQUIRED_REPLAY_BEHAVIORS,
  REQUIRED_REPLAY_VERIFICATION_BEHAVIORS,
  REQUIRED_STORAGE_BEHAVIORS,
  REQUIRED_MUSIC_BEHAVIORS,
  REQUIRED_PACKAGE_BEHAVIORS,
  REQUIRED_MULTIPLAYER_BEHAVIORS,
  REQUIRED_THPRAC_BEHAVIORS,
  REQUIRED_LANGUAGE_BEHAVIORS,
  REQUIRED_MIDI_BEHAVIORS,
  GAME_OPTION_CLASSIFICATION,
  INHERITED_LAUNCHER_CAPABILITIES,
  PROFILE_REQUIRED_CAPABILITIES,
  OPTIONAL_PRODUCT_CAPABILITIES,
  IMPLEMENTATION_DETAILS,
  FORMAT_ADAPTERS,
  COMPATIBILITY_ADAPTERS,
  ADAPTER_CAPABILITIES,
  adapterCapability,
} from "../lib/contracts/adapter-capabilities.mjs";
import {
  HOST_RUNTIME_FEATURE_IDS,
  PRODUCT_FEATURE_IDS,
  PRODUCT_GAMES,
} from "../lib/contracts/product-catalog.mjs";
import { DEFAULT_GAME_OPTIONS } from "../.cache/build/browser/assets/launcher/game-preferences.mjs";
import { RUNTIME_CONFIGURE_OPTION_BEHAVIOR } from "../lib/contracts/runtime-protocol.mjs";
import { REPOSITORY_NODE_TESTS, WORKSPACE_NODE_TESTS } from "./test-plan.mjs";

assert.ok(REQUIRED_ADAPTER_CAPABILITIES.some(item => item.id === "touch-controls"));
assert.ok(REQUIRED_ADAPTER_CAPABILITIES.some(item => item.id === "always-hitbox"));
assert.ok(REQUIRED_ADAPTER_CAPABILITIES.some(item => item.id === "gamepad-input"));
assert.equal(adapterCapability("always-hitbox")?.class, "required");
assert.equal(adapterCapability("magnifier")?.class, "inherited");
assert.equal(adapterCapability("multiplayer-local-player-visibility")?.class, "profile-required");
assert.equal(adapterCapability("multiplayer-local-player-visibility")?.when, "multiplayer");
assert.equal(adapterCapability("midi-music")?.class, "optional");
assert.equal(adapterCapability("eagx-replay-sidecar")?.class, "implementation-detail");
assert.equal(adapterCapability("continuous-motion-replay-sidecar")?.class, "implementation-detail");
assert.equal(adapterCapability("wav-host-music-path")?.class, "implementation-detail");
assert.equal(adapterCapability("legacy-wav-music-preference")?.class, "compatibility");
assert.equal(adapterCapability("retail-data-decoder")?.class, "format-adapter");
assert.equal(adapterCapability("legacy-package-reader")?.class, "compatibility");

assert.deepEqual(REQUIRED_TOUCH_BEHAVIORS.map(item => item.id), [
  "direct-rate-limited-movement",
  "direct-unlimited-movement",
  "joystick-digital-movement",
  "joystick-free-movement",
  "focus-hold",
  "focus-toggle",
  "focus-two-finger",
  "fire-bomb-pause",
  "deathbomb-preservation",
  "unlimited-cheat-processing-rate",
  "double-tap-bomb",
  "menu-dialogue-navigation",
  "touch-confirm-edge",
  "sensitivity-100-300",
  "mixed-input-isolation",
  "lifecycle-cancel",
  "layout-editor",
  "restart-button",
  "magnifier",
]);
assert.equal(new Set(REQUIRED_TOUCH_BEHAVIORS.map(item => item.id)).size, REQUIRED_TOUCH_BEHAVIORS.length);
for (const item of REQUIRED_TOUCH_BEHAVIORS) assert.ok(["launcher-runtime", "launcher"].includes(item.owner));
assert.deepEqual(REQUIRED_PRESENTATION_BEHAVIORS.map(item => item.id), [
  "fixed-authority",
  "display-cadence-presentation",
  "draw-only-extra-frames",
  "continuous-fields-only",
  "discontinuity-snap",
  "pause-modal-policy",
  "first-frame-after-present",
  "optional-60hz-presentation-limit",
]);
assert.equal(new Set(REQUIRED_PRESENTATION_BEHAVIORS.map(item => item.id)).size, REQUIRED_PRESENTATION_BEHAVIORS.length);
assert.deepEqual(REQUIRED_REPLAY_BEHAVIORS.map(item => item.id), [
  "original-replay-import",
  "original-replay-export-when-representable",
  "deterministic-effective-input",
  "extended-format-only-when-needed",
  "file-management",
  "playback-live-input-isolation",
  "presentation-independence",
]);
assert.equal(new Set(REQUIRED_REPLAY_BEHAVIORS.map(item => item.id)).size, REQUIRED_REPLAY_BEHAVIORS.length);
assert.deepEqual(REQUIRED_REPLAY_VERIFICATION_BEHAVIORS.map(item => item.id), [
  "quick-all-title-demos",
  "daily-long-replay-corpus",
  "immutable-content-addressed-golden",
  "candidate-cannot-bless",
  "explicit-oracle-maintenance",
  "strict-fixed-tick-comparison",
  "diagnostic-build-isolation",
  "title-owned-adapter",
]);
assert.equal(new Set(REQUIRED_REPLAY_VERIFICATION_BEHAVIORS.map(item => item.id)).size, REQUIRED_REPLAY_VERIFICATION_BEHAVIORS.length);

for (const [name, profile, requiredIds] of [
  ["input", REQUIRED_INPUT_BEHAVIORS, ["keyboard-logical-input", "controller-logical-input", "loss-cleanup"]],
  ["storage", REQUIRED_STORAGE_BEHAVIORS, ["declared-save-root", "strict-user-file-allowlist", "runtime-restart-durability", "package-user-data-separation"]],
  ["music", REQUIRED_MUSIC_BEHAVIORS, ["audible-ogg-normal-mode", "explicit-no-music-mode", "foreground-audio-recovery", "presentation-audio-independence"]],
  ["package", REQUIRED_PACKAGE_BEHAVIORS, ["canonical-package-store", "atomic-current-generation", "offline-installed-launch"]],
]) {
  assert.ok(profile.length > 0, `${name}: required behavior profile must not be empty`);
  assert.equal(new Set(profile.map(item => item.id)).size, profile.length, `${name}: duplicate required behavior id`);
  for (const id of requiredIds) assert.ok(profile.some(item => item.id === id), `${name}: missing required behavior ${id}`);
}

for (const [name, profile, requiredIds] of [
  ["multiplayer", REQUIRED_MULTIPLAYER_BEHAVIORS, ["dedicated-runtime-variant", "spectator-admission-and-isolation", "multiplayer-replay", "peer-transport-and-relay-fallback"]],
  ["thprac", REQUIRED_THPRAC_BEHAVIORS, ["runtime-attestation", "replay-prac-metadata", "touch-function-bridge"]],
  ["languages", REQUIRED_LANGUAGE_BEHAVIORS, ["built-in-japanese-baseline", "validated-pack-publication", "safe-launch-fallback"]],
  ["midi", REQUIRED_MIDI_BEHAVIORS, ["selector-only-when-declared", "audible-midi-transport", "music-lifecycle"]],
]) {
  assert.ok(profile.length > 0, `${name}: optional profile behavior list must not be empty`);
  assert.equal(new Set(profile.map(item => item.id)).size, profile.length, `${name}: duplicate profile behavior id`);
  for (const id of requiredIds) assert.ok(profile.some(item => item.id === id), `${name}: missing required behavior ${id}`);
}
assert.deepEqual(
  Object.keys(GAME_OPTION_CLASSIFICATION).sort(),
  Object.keys(DEFAULT_GAME_OPTIONS).sort(),
  "every persisted GameOptions field must have an explicit capability classification",
);
for (const [option, classification] of Object.entries(GAME_OPTION_CLASSIFICATION)) {
  assert.ok(["required", "inherited", "profile-required", "optional"].includes(classification.class), `${option}: invalid option capability class`);
  if (classification.class === "required") assert.ok(REQUIRED_ADAPTER_CAPABILITIES.some(item => item.id === classification.capability));
  if (classification.class === "inherited" && classification.capability !== "touch-controls") assert.ok(INHERITED_LAUNCHER_CAPABILITIES.some(item => item.id === classification.capability));
  if (classification.class === "profile-required") assert.ok(PROFILE_REQUIRED_CAPABILITIES.some(item => item.id === classification.capability));
  if (classification.class === "optional") assert.ok(OPTIONAL_PRODUCT_CAPABILITIES.some(item => item.id === classification.capability));
}

const ids = ADAPTER_CAPABILITIES.map(item => item.id);
assert.equal(new Set(ids).size, ids.length, "adapter capability ids must be globally unique");

const maintainerAssembler = readFileSync(resolve(import.meta.dirname, "..", "tools", "maintainer", "assemble-site.ps1"), "utf8");
assert.match(maintainerAssembler, /scripts\\list-product-games\.mjs/,
  "maintainer site assembly default game set must come from Product Catalog");
assert.doesNotMatch(maintainerAssembler, /\[string\[\]\]\s+\$Games\s*=\s*@\([^)]*th0\d/i,
  "maintainer site assembly must not carry a second hard-coded default game registry");
const titleSpecificMaintainerParameters = [...maintainerAssembler.matchAll(/\[string\]\s+\$(Th\d+(?:Directory|LanguagePacks|Build))/g)]
  .map(match => match[1])
  .sort();
assert.deepEqual(titleSpecificMaintainerParameters, [
  "Th06Directory",
  "Th06LanguagePacks",
  "Th07Directory",
  "Th07LanguagePacks",
  "Th08Build",
  "Th08Directory",
  "Th10Build",
  "Th10Directory",
].sort(),
"title-specific assemble-site parameters are a frozen compatibility surface; new games must use generic maps/Runtime Release instead");

const workspaceRuntimeBuilder = readFileSync(resolve(import.meta.dirname, "..", "tools", "maintainer", "build-workspace-runtimes.ps1"), "utf8");
const titleSpecificRuntimeAssetParameters = [...workspaceRuntimeBuilder.matchAll(/\[string\]\s+\$(Th\d+AssetDirectory)/g)]
  .map(match => match[1])
  .sort();
assert.deepEqual(titleSpecificRuntimeAssetParameters, ["Th06AssetDirectory", "Th07AssetDirectory"],
  "title-specific workspace Runtime asset parameters are frozen compatibility aliases; new games must use GameAssetDirectories");

const repositoryGates = new Set(REPOSITORY_NODE_TESTS);
const workspaceGates = new Set(WORKSPACE_NODE_TESTS);
for (const item of REQUIRED_ADAPTER_CAPABILITIES) {
  assert.equal(item.declaration, undefined, `${item.id}: required capability must not become a product opt-out`);
  assert.ok(Array.isArray(item.verification) && item.verification.length > 0, `${item.id}: required capability needs named verification ownership`);
  for (const gate of item.verification) {
    const separator = gate.indexOf(":");
    assert.ok(separator > 0, `${item.id}: malformed verification gate ${gate}`);
    const scope = gate.slice(0, separator), name = gate.slice(separator + 1);
    assert.ok(["repository", "workspace", "runtime", "browser"].includes(scope), `${item.id}: unknown verification scope ${scope}`);
    if (scope === "repository") assert.ok(repositoryGates.has(name), `${item.id}: repository gate is not scheduled: ${name}`);
    if (scope === "workspace") assert.ok(workspaceGates.has(name), `${item.id}: workspace gate is not scheduled: ${name}`);
  }
}
for (const item of OPTIONAL_PRODUCT_CAPABILITIES) {
  assert.equal(typeof item.declaration, "string");
  assert.match(item.declaration, /^[A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z][A-Za-z0-9]*)*$/,
    `${item.id}: optional capability declaration must be a directly inspectable product-catalog path`);
  assert.ok(Array.isArray(item.verification) && item.verification.length > 0,
    `${item.id}: optional capability needs named verification ownership`);
  for (const gate of item.verification) {
    const separator = gate.indexOf(":");
    assert.ok(separator > 0, `${item.id}: malformed verification gate ${gate}`);
    const scope = gate.slice(0, separator), name = gate.slice(separator + 1);
    assert.ok(["repository", "workspace", "runtime", "browser"].includes(scope), `${item.id}: unknown verification scope ${scope}`);
    if (scope === "repository") assert.ok(repositoryGates.has(name), `${item.id}: repository gate is not scheduled: ${name}`);
    if (scope === "workspace") assert.ok(workspaceGates.has(name), `${item.id}: workspace gate is not scheduled: ${name}`);
  }
}
assert.deepEqual(
  OPTIONAL_PRODUCT_CAPABILITIES
    .map(item => item.declaration)
    .filter(declaration => declaration.startsWith("features."))
    .map(declaration => declaration.slice("features.".length))
    .sort(),
  [...PRODUCT_FEATURE_IDS].sort(),
  "every product feature boolean must have exactly one optional-capability classification",
);
assert.ok(HOST_RUNTIME_FEATURE_IDS.every(id => PRODUCT_FEATURE_IDS.includes(id)),
  "Host Runtime feature attestations must be a subset of product feature ids");
for (const item of INHERITED_LAUNCHER_CAPABILITIES) {
  assert.equal(item.owner, "launcher");
  assert.equal(item.declaration, undefined, `${item.id}: inherited Launcher capability must not become a product toggle`);
}
const optionalIds = new Set(OPTIONAL_PRODUCT_CAPABILITIES.map(item => item.id));
for (const item of PROFILE_REQUIRED_CAPABILITIES) {
  assert.equal(item.owner, "launcher-runtime");
  assert.ok(item.when && optionalIds.has(item.when), `${item.id}: profile-required parent must be an optional capability`);
  assert.equal(item.declaration, undefined, `${item.id}: profile obligation is inherited from its parent profile`);
}
for (const item of IMPLEMENTATION_DETAILS) {
  assert.ok(["runtime", "maintainer"].includes(item.owner));
  assert.equal(item.declaration, undefined, `${item.id}: Runtime implementation detail must not become a product flag`);
}
for (const item of FORMAT_ADAPTERS) assert.equal(item.owner, "format");
for (const item of COMPATIBILITY_ADAPTERS) assert.equal(item.owner, "legacy");
for (const [option, behavior] of Object.entries(RUNTIME_CONFIGURE_OPTION_BEHAVIOR)) {
  assert.ok(adapterCapability(behavior.capability),
    `${option}: Runtime configure option references unknown capability ${behavior.capability}`);
  if (behavior.requirement === "required") {
    assert.equal(adapterCapability(behavior.capability)?.class, "required",
      `${option}: required Runtime option must resolve to an all-game required capability`);
  }
  if (behavior.requirement === "optional") {
    assert.equal(adapterCapability(behavior.capability)?.class, "optional",
      `${option}: optional Runtime option must resolve to an optional product capability`);
  }
  if (behavior.requirement === "profile-required") {
    assert.ok(["optional", "profile-required"].includes(adapterCapability(behavior.capability)?.class),
      `${option}: profile-required Runtime option must resolve to its optional/profile capability`);
  }
}

// These product declarations are retained for existing UI/manifest ownership,
// but current formal adapters are not allowed to use them to opt out of the
// required product surface.
for (const [game, product] of Object.entries(PRODUCT_GAMES)) {
  assert.match(product.replay?.prefix || "", /^th\d+$/, `${game}: Replay management is required`);
  assert.deepEqual(Object.keys(product.musicCapabilities), ["midi"], `${game}: required OGG/no-music support must not become per-product opt-outs`);
}

// Shared orchestration must consume product facts from the catalog instead of
// acquiring another hidden "if this is THxx" contract. Product-specific data
// tables/format adapters are intentionally outside this source guard.
for (const relative of [
  "app/services/game-launch.client.ts",
  "app/services/preferences.client.ts",
  "app/services/resources.client.ts",
  "app/services/multiplayer-room.client.ts",
  "src/launcher/network-diagnostics.mts",
  "src/launcher/multiplayer-relay-url.mts",
  "scripts/package-server.mjs",
  "scripts/serve.mjs",
  "server/netplay-relay.mjs",
  "host/lib/site-builder.mjs",
  "lib/frontend-manifest.mjs",
  "lib/workspace-layout.mjs",
  "lib/runtime-release.mjs",
  "lib/development-host-manifest.mjs",
  "lib/publication-host-seed.mjs",
]) {
  const source = readFileSync(resolve(import.meta.dirname, "..", relative), "utf8");
  const literals = [...source.matchAll(/(["'`])th\d+(?:mp)?\1/g)].map(match => match[0]);
  assert.deepEqual(literals, [], `${relative}: shared orchestration must not hard-code product ids; declare the difference in product-catalog instead`);
}

// The modern settings behavior/SSR suite iterates the catalog with actual Host
// feature gates (tests/ui-main/preferences.test.mjs). Old static class-name
// assertions would only test a deleted renderer, not optional capabilities.

console.log(JSON.stringify({
  adapterCapabilities: "PASS",
  required: REQUIRED_ADAPTER_CAPABILITIES.length,
  inherited: INHERITED_LAUNCHER_CAPABILITIES.length,
  profileRequired: PROFILE_REQUIRED_CAPABILITIES.length,
  optional: OPTIONAL_PRODUCT_CAPABILITIES.length,
  implementationDetails: IMPLEMENTATION_DETAILS.length,
  formatAdapters: FORMAT_ADAPTERS.length,
  compatibility: COMPATIBILITY_ADAPTERS.length,
}));
