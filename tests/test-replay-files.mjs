import assert from "node:assert/strict";
import {
  allocateReplayName,
  createReplayArchiveExtractionGuard,
  createReplayMutationQueue,
  isReplayFilePath,
  isReplayImportFileName,
  isReplayTargetAvailable,
  isSafeReplayArchivePath,
  isValidReplayName,
  planReplayArchiveImport,
  ReplayArchiveScanError,
  replayImportAccept,
  selectReplayExportPaths,
} from "../.cache/build/browser/assets/launcher/replay-files.mjs";

assert.equal(replayImportAccept, ".zip,.rpy,.rpyx");
assert.equal(isReplayFilePath("replay/th6_01.rpy"), true);
assert.equal(isReplayFilePath("replay/th7_ud00af.rpyx"), true);
assert.equal(isReplayFilePath("replay/th6_01.rpy.thprac.json"), false);
assert.equal(isReplayFilePath("other/th6_01.rpy"), false);

assert.deepEqual(selectReplayExportPaths([
  "replay/orphan.rpy.thprac.json",
  "replay/th6_01.rpy.thprac.json",
  "replay/th6_01.rpy",
  "replay/th6_02.rpyx",
  "replay/notes.txt",
]), [
  "replay/th6_01.rpy",
  "replay/th6_02.rpyx",
], "Replay export must include only actual replay files");

for (const safe of ["replay/th6_01.rpy", "nested/th6_01.rpy", "notes.txt"]) {
  assert.equal(isSafeReplayArchivePath(safe), true, safe);
}
for (const unsafe of ["", "/absolute.rpy", "../escape.rpy", "a/../b.rpy", "a\\b.rpy", "a//b.rpy"]) {
  assert.equal(isSafeReplayArchivePath(unsafe), false, unsafe);
}

assert.equal(isValidReplayName("th6", "th6_01.rpy"), true);
assert.equal(isValidReplayName("th6", "TH6_ud00AF.RPYX"), true);
assert.equal(isValidReplayName("th6", "th6_ud10000.rpy"), false);
assert.equal(isValidReplayName("th6", "other_01.rpy"), false);
assert.equal(isReplayImportFileName("run.RPYX"), true);
assert.equal(isReplayImportFileName("backup.zip"), true);
assert.equal(isReplayImportFileName("score.dat"), false);

const occupied = [
  "replay/th6_01.rpy",
  "replay/th6_ud0000.rpy.thprac.json",
];
assert.equal(isReplayTargetAvailable(occupied, "replay/th6_ud0000.rpy"), true,
  "unsupported sidecar-like files must not reserve replay identities");
assert.equal(allocateReplayName("th6", occupied, "my replay.rpy"), "th6_ud0000.rpy");
assert.equal(allocateReplayName("th6", occupied, "my replay.rpyx"), "th6_ud0000.rpyx",
  "collision renaming must preserve ReplayX identity");
assert.equal(allocateReplayName("th6", occupied, "th6_02.rpyx"), "th6_02.rpyx");

const planned = planReplayArchiveImport("th6", [
  "backup/th6_01.rpy",
  "backup/th6_01.rpy.thprac.json",
  "backup/pretty name.rpyx",
  "backup/readme.txt",
], ["replay/th6_01.rpy"]);
assert.equal(planned.ok, true);
assert.deepEqual(planned.entries, [
  { sourcePath: "backup/pretty name.rpyx", targetPath: "replay/th6_ud0000.rpyx", kind: "replay" },
  { sourcePath: "backup/th6_01.rpy", targetPath: "replay/th6_ud0000.rpy", kind: "replay" },
]);
assert.deepEqual(planReplayArchiveImport("th6", ["../bad.rpy"], []), { ok: false, reason: "unsafe-path" });
assert.deepEqual(planReplayArchiveImport("th6", ["a/th6_01.rpy", "A/TH6_01.RPY"], []),
  { ok: false, reason: "duplicate-path" });

const guard = createReplayArchiveExtractionGuard({ maxFileBytes: 64, maxExpandedBytes: 96 });
assert.equal(guard.filter({ name: "docs/readme.txt", originalSize: 4000 }), false,
  "non-Replay files must not be decompressed into memory");
assert.equal(guard.filter({ name: "backup/th6_01.rpy", originalSize: 48 }), true);
assert.equal(guard.filter({ name: "backup/th6_02.rpyx", originalSize: 48 }), true);
assert.deepEqual(guard.paths, ["docs/readme.txt", "backup/th6_01.rpy", "backup/th6_02.rpyx"]);
assert.throws(
  () => guard.filter({ name: "backup/th6_03.rpy", originalSize: 1 }),
  error => error instanceof ReplayArchiveScanError && error.reason === "archive-too-large",
  "expanded Replay bytes must be bounded before decompression",
);
const oversized = createReplayArchiveExtractionGuard({ maxFileBytes: 64, maxExpandedBytes: 128 });
assert.throws(
  () => oversized.filter({ name: "backup/th6_01.rpy", originalSize: 65 }),
  error => error instanceof ReplayArchiveScanError && error.reason === "file-too-large",
);
const duplicate = createReplayArchiveExtractionGuard({ maxFileBytes: 64, maxExpandedBytes: 128 });
duplicate.filter({ name: "backup/th6_01.rpy", originalSize: 1 });
assert.throws(
  () => duplicate.filter({ name: "BACKUP/TH6_01.RPY", originalSize: 1 }),
  error => error instanceof ReplayArchiveScanError && error.reason === "duplicate-path",
);

const queue = createReplayMutationQueue();
const order = [];
let releaseFirst;
let markFirstStarted;
const firstStarted = new Promise(resolve => { markFirstStarted = resolve; });
const first = queue.run(async () => {
  order.push("first-start");
  markFirstStarted();
  await new Promise(resolve => { releaseFirst = resolve; });
  order.push("first-end");
  return 1;
});
const second = queue.run(async () => {
  order.push("second");
  return 2;
});
await firstStarted;
assert.deepEqual(order, ["first-start"], "Replay mutations must serialize instead of interleaving stale snapshots");
releaseFirst();
assert.deepEqual(await Promise.all([first, second]), [1, 2]);
await queue.idle();
assert.deepEqual(order, ["first-start", "first-end", "second"]);

const afterFailure = createReplayMutationQueue();
await assert.rejects(afterFailure.run(async () => { throw new Error("expected"); }), /expected/);
assert.equal(await afterFailure.run(async () => 3), 3, "a failed Replay mutation must not poison the queue");

console.log(JSON.stringify({
  replayFiles: "PASS",
  imports: ["rpy", "rpyx", "zip"],
  replayMetadata: "embedded-prac-only",
  collision: "case-insensitive",
}));
