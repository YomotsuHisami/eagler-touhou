import assert from "node:assert/strict";
import { PACKAGE_DESCRIPTOR_SCHEMA, PLAYER_PROTOCOL_V1 } from "../package-descriptor.mjs";
import {
  attachGenerationFile,
  beginPendingInstallation,
  commitInstallation,
  componentFileIds,
  planPackageGeneration,
} from "../package-generation.mjs";

const descriptor = (revision, dataRevision, oggRevision = "ogg-1") => ({
  schema: PACKAGE_DESCRIPTOR_SCHEMA,
  game: "th08",
  revision,
  runtime: { type: "html", entry: "runtime", playerProtocol: PLAYER_PROTOCOL_V1 },
  files: {
    runtime: { source: "runtime.html", target: "/runtime/runtime.html", revision: "runtime-1" },
    data: { source: "game.bin", target: "/game.bin", revision: dataRevision },
    ogg: { source: "ogg/weird-name.ogg", target: "/bgm/weird-name.ogg", revision: oggRevision },
    lang: { source: "lang/zh.zip", target: "/__eagler/language/lang_zh-hans.zip", revision: "lang-1" },
  },
  base: { files: ["runtime", "data"] },
  components: {
    ogg: { type: "ogg", files: ["ogg"] },
    language: { type: "language", entries: [{ id: "lang_zh-hans", title: "中文（简体）", file: "lang" }] },
  },
});

const currentDescriptor = descriptor("package-1", "data-1");
const current = {
  id: "gen-old",
  game: "th08",
  descriptor: currentDescriptor,
  files: {
    runtime: { objectId: "obj-runtime-old", revision: "runtime-1" },
    data: { objectId: "obj-data-old", revision: "data-1" },
    ogg: { objectId: "obj-ogg-old", revision: "ogg-1" },
  },
};

const nextDescriptor = descriptor("package-2", "data-2");
const desired = [...nextDescriptor.base.files, ...componentFileIds(nextDescriptor, "ogg")];
const plan = planPackageGeneration({ current, descriptor: nextDescriptor, desiredFileIds: desired, generationId: "gen-new" });

assert.deepEqual(plan.needs, ["data"], "only content whose file revision changed should need new bytes");
assert.equal(plan.generation.files.runtime.objectId, "obj-runtime-old", "unchanged runtime bytes must be reused, not copied");
assert.equal(plan.generation.files.ogg.objectId, "obj-ogg-old", "installed unchanged OGG must be reused");

const forcedRuntime = planPackageGeneration({
  current,
  descriptor: nextDescriptor,
  desiredFileIds: desired,
  forceFileIds: ["runtime"],
  generationId: "gen-force-runtime",
});
assert.deepEqual(forcedRuntime.needs, ["runtime", "data"],
  "explicit storage migrations must be able to reacquire unchanged Runtime bytes without changing their declared content revision");

const pendingWithData = attachGenerationFile(plan.generation, "data", "obj-data-new-random-id");
assert.equal(pendingWithData.files.data.objectId, "obj-data-new-random-id",
  "physical object identity must be independent from the declared file revision");

const missingAllowed = planPackageGeneration({ current: null, descriptor: nextDescriptor, generationId: "gen-import" });
assert.deepEqual(missingAllowed.needs.sort(), ["data", "runtime"], "a fresh import may report absent bytes to its acquisition layer");
const importedRuntimeOnly = attachGenerationFile(missingAllowed.generation, "runtime", "obj-imported-runtime");
assert.doesNotThrow(() => commitInstallation(null, importedRuntimeOnly, { source: "local" }),
  "committing a descriptor is not an integrity gate; absent declared files may remain absent");

const installation = { game: "th08", source: "remote", currentGeneration: "gen-old", pendingGeneration: null };
const pendingState = beginPendingInstallation(installation, pendingWithData);
assert.equal(pendingState.currentGeneration, "gen-old", "starting pending must leave current playable");
assert.equal(pendingState.pendingGeneration, "gen-new");
const committed = commitInstallation(pendingState, pendingWithData, { source: "remote" });
assert.equal(committed.currentGeneration, "gen-new");
assert.equal(committed.pendingGeneration, null);

assert.deepEqual(componentFileIds(nextDescriptor, "language", ["lang_zh-hans"]), ["lang"]);
assert.deepEqual(componentFileIds(nextDescriptor, "language", []), []);

console.log("Package generation contract: PASS");
