// L3/module + entry safety. Preconditions: temporary local paths only.
// Mutation: invoke the release owner with invalid input and an existing
// destination. Proves formal-release planning and output ownership. It does
// NOT build a host, validate Runtime semantics, or publish anything.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { FORMAL_RELEASE_GAMES, formalReleaseSourceOwners, normalizeFormalReleaseInput } from "../lib/release-plan.mjs";

const workspace = resolve("workspace-fixture");
const inputDirectory = resolve("release-input-fixture");
const normalizationOptions = { inputDirectory, workspace, windir: resolve("windows-fixture") };
const validInput = {
  schema: "eagler-touhou/release-input/1",
  prepare: {
    RuntimeRelease: "runtime-release",
    FeatureConfig: "features.json",
    GameDirectories: {
      th06: "original/th06",
      th07: "original/th07",
      th08: "original/th08",
      th09: "original/th09",
      th10: "original/th10",
      th11: "original/th11",
      th20: "original/th20",
    },
    LanguagePackDirectories: {
      th06: "languages/th06",
      th07: "languages/th07",
    },
    Music: ["midi"],
  },
};
const plan = normalizeFormalReleaseInput(validInput, normalizationOptions);
assert.deepEqual(plan.games, FORMAL_RELEASE_GAMES);
assert.equal(plan.prepare.Profile, "web-release-hosted");
assert.deepEqual(plan.prepare.Games, FORMAL_RELEASE_GAMES);
assert.equal(plan.prepare.RuntimeRelease, resolve(inputDirectory, "runtime-release"));
for (const game of FORMAL_RELEASE_GAMES) {
  assert.equal(plan.prepare.GameDirectories[game], resolve(inputDirectory, "original", game));
}
assert.equal(plan.prepare.LanguagePackDirectories.th06, resolve(inputDirectory, "languages", "th06"));
assert.equal(plan.prepare.LanguagePackDirectories.th07, resolve(inputDirectory, "languages", "th07"));
assert.deepEqual(formalReleaseSourceOwners(), ["launcher"]);

const exampleInput = JSON.parse(await readFile(new URL("../tools/maintainer/release-input.example.json", import.meta.url), "utf8"));
const examplePlan = normalizeFormalReleaseInput(exampleInput, normalizationOptions);
assert.deepEqual(examplePlan.games, FORMAL_RELEASE_GAMES);
assert.deepEqual(examplePlan.prepare.Music, ["midi", "ogg"]);
assert.equal(examplePlan.prepare.RuntimeRelease, resolve(inputDirectory, "runtime-release"));
for (const game of FORMAL_RELEASE_GAMES) assert.ok(examplePlan.prepare.GameDirectories[game]);

const legacyInput = {
  ...validInput,
  prepare: {
    RuntimeRelease: "runtime-release",
    FeatureConfig: "features.json",
    Th06Directory: "original/th06",
    Th07Directory: "original/th07",
    Th08Directory: "original/th08",
    Th09Directory: "original/th09",
    Th10Directory: "original/th10",
    Th11Directory: "original/th11",
    Th20Directory: "original/th20",
    Th06LanguagePacks: "languages/th06",
    Th07LanguagePacks: "languages/th07",
    Music: ["midi"],
  },
};
const legacyPlan = normalizeFormalReleaseInput(legacyInput, normalizationOptions);
assert.deepEqual(legacyPlan.prepare.GameDirectories, plan.prepare.GameDirectories);
assert.deepEqual(legacyPlan.prepare.LanguagePackDirectories, plan.prepare.LanguagePackDirectories);
assert.equal("Th06Directory" in legacyPlan.prepare, false);
assert.equal("Th06LanguagePacks" in legacyPlan.prepare, false);

assert.throws(() => normalizeFormalReleaseInput({ ...validInput, prepare: { ...validInput.prepare, RuntimeRelease: "" } }, {
  ...normalizationOptions,
}), /requires prepare\.RuntimeRelease/);
assert.throws(() => normalizeFormalReleaseInput({ ...validInput, games: ["th07"] }, {
  ...normalizationOptions,
}), /must contain every non-test product/);
assert.throws(() => normalizeFormalReleaseInput({ ...validInput, prepare: { ...validInput.prepare, Th08Build: "build" } }, {
  ...normalizationOptions,
}), /belongs to maintainer Runtime compilation/);
assert.throws(() => normalizeFormalReleaseInput({
  ...validInput,
  prepare: { ...validInput.prepare, GameDirectories: { ...validInput.prepare.GameDirectories, th99: "original/th99" } },
}, normalizationOptions), /unknown game/);

const root = await mkdtemp(join(tmpdir(), "eagler-release-entry-"));
try {
const input = join(root, "input.json");
const output = join(root, "candidate");
await writeFile(input, JSON.stringify({ schema: "eagler-touhou/release-input/1", prepare: {} }));
const runRelease = () => spawnSync(process.execPath, [
  "scripts/release.mjs",
  `--input=${input}`,
  `--output=${output}`,
], { encoding: "utf8" });
let result = runRelease();
assert.notEqual(result.status, 0);
assert.deepEqual(await readdir(root), ["input.json"]);

await mkdir(output);
const marker = join(output, "owner.txt");
await writeFile(marker, "existing owner");
result = runRelease();
assert.notEqual(result.status, 0);
assert.equal(await readFile(marker, "utf8"), "existing owner");
} finally {
  await rm(root, { recursive: true, force: true });
}
console.log("Release entry output ownership: PASS");
