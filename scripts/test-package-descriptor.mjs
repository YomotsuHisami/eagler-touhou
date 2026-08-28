import assert from "node:assert/strict";
import {
  PACKAGE_DESCRIPTOR_SCHEMA,
  PLAYER_PROTOCOL_V1,
  canonicalPackagePayload,
  resolvePackageRuntime,
  resolvePackageSource,
  validatePackageDescriptor,
} from "../package-descriptor.mjs";

const descriptor = {
  schema: PACKAGE_DESCRIPTOR_SCHEMA,
  game: "th08",
  revision: "package-a1",
  runtime: {
    type: "html",
    entry: "runtime-html",
    playerProtocol: PLAYER_PROTOCOL_V1,
    bootstrap: ["runtime-html", "runtime-js", "game-data"],
  },
  files: {
    "runtime-html": { source: "runtime/th08.html", target: "/runtime/th08.html", revision: "html-a", bytes: 100 },
    "runtime-js": { source: "runtime/th08.js", target: "/runtime/th08.js", revision: "js-a", bytes: 200 },
    "game-data": { source: "data/custom-name.bin", target: "/data/custom-name.bin", revision: "data-a", bytes: 300 },
    "ogg-stage1": { source: "ogg/nonstandard-stage-one.ogg", target: "/music/nonstandard-stage-one.ogg", revision: "ogg-a", bytes: 400 },
    "lang-zh": { source: "language/zh.zip", target: "/__eagler/language/lang_zh-hans.zip", revision: "lang-a", bytes: 500 },
  },
  base: { files: ["runtime-html", "runtime-js", "game-data"] },
  components: {
    ogg: { type: "ogg", files: ["ogg-stage1"] },
    language: { type: "language", entries: [{ id: "lang_zh-hans", title: "中文（简体）", file: "lang-zh" }] },
  },
};

assert.equal(validatePackageDescriptor(structuredClone(descriptor)).game, "th08",
  "package schema must naturally accept future Touhou ids instead of a th06/th07 allowlist");
assert.equal(resolvePackageSource("https://example.invalid/releases/th08/package.json", "ogg/nonstandard-stage-one.ogg"),
  "https://example.invalid/releases/th08/ogg/nonstandard-stage-one.ogg");

const changedRevisionOnly = structuredClone(descriptor);
changedRevisionOnly.revision = "package-b2";
assert.equal(canonicalPackagePayload(descriptor), canonicalPackagePayload(changedRevisionOnly),
  "package revision must not hash itself");

const changedTarget = structuredClone(descriptor);
changedTarget.files["ogg-stage1"].target = "/another-mount/nonstandard-stage-one.ogg";
assert.notEqual(canonicalPackagePayload(descriptor), canonicalPackagePayload(changedTarget),
  "runtime target changes must participate in package identity");

const missingBytes = structuredClone(descriptor);
delete missingBytes.files["game-data"].bytes;
assert.doesNotThrow(() => validatePackageDescriptor(missingBytes),
  "byte length is metadata, not a required completeness/authenticity gate");

const unknownRef = structuredClone(descriptor);
unknownRef.base.files.push("not-declared");
assert.throws(() => validatePackageDescriptor(unknownRef), /unknown file/);

const traversal = structuredClone(descriptor);
traversal.files["game-data"].source = "../outside.bin";
assert.throws(() => validatePackageDescriptor(traversal), /unsafe source/);

const unknownBootstrap = structuredClone(descriptor);
unknownBootstrap.runtime.bootstrap.push("not-declared");
assert.throws(() => validatePackageDescriptor(unknownBootstrap), /runtime bootstrap: unknown file/);

const th07Variants = structuredClone(descriptor);
th07Variants.game = "th07";
delete th07Variants.runtime;
th07Variants.defaultRuntime = "normal";
th07Variants.files["multi-html"] = { source: "runtime/multiplayer/th07.html", target: "/runtime/multiplayer/th07.html", revision: "mh" };
th07Variants.files["multi-js"] = { source: "runtime/multiplayer/th07.js", target: "/runtime/multiplayer/th07.js", revision: "mj" };
th07Variants.runtimes = {
  normal: {
    type: "html", entry: "runtime-html", playerProtocol: PLAYER_PROTOCOL_V1,
    bootstrap: ["runtime-html", "runtime-js", "game-data"],
  },
  multiplayer: {
    type: "html", entry: "multi-html", playerProtocol: PLAYER_PROTOCOL_V1,
    bootstrap: ["multi-html", "multi-js", "game-data"],
  },
};
th07Variants.base.files.push("multi-html", "multi-js");
assert.equal(validatePackageDescriptor(th07Variants).defaultRuntime, "normal");
assert.equal(resolvePackageRuntime(th07Variants).variant, "normal");
assert.equal(resolvePackageRuntime(th07Variants, "multiplayer").runtime.entry, "multi-html");
assert.throws(() => resolvePackageRuntime(th07Variants, "spectator"), /unknown package runtime variant/);

const missingVariantBootstrap = structuredClone(th07Variants);
missingVariantBootstrap.base.files = missingVariantBootstrap.base.files.filter(id => id !== "multi-js");
assert.throws(() => validatePackageDescriptor(missingVariantBootstrap), /bootstrap file is not in base/,
  "one generation must install every runtime variant bootstrap while sharing common data");

console.log("Package descriptor contract: PASS");
