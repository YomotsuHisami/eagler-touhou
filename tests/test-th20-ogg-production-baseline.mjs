/** L3/module. Verifies the TH20 production OGG baseline declaration and the
 * byte-level stream-serial normalization used by the release adapter. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { assertOggProductionBaseline, pinOggSerial } from "../lib/ogg-production-baseline.mjs";
import { TH20_MUSIC_FILES, TH20_MUSIC_LAYOUT } from "../lib/th20-content-layout.mjs";

const root = resolve(import.meta.dirname, "..");
const baseline = JSON.parse(await readFile(resolve(root, "host/ogg-baselines/th20.json"), "utf8"));
assert.equal(baseline.schema, "eagler-touhou/ogg-server-baseline/1");
assert.equal(baseline.game, "th20");
assert.equal(baseline.quality, 5);
assert.equal(TH20_MUSIC_LAYOUT.length, 19);
assert.deepEqual(Object.keys(baseline.files), [...TH20_MUSIC_FILES]);
for (const identity of Object.values(baseline.files)) {
  assert.ok(identity.bytes > 0);
  assert.match(identity.sha256, /^[a-f0-9]{64}$/);
  assert.match(identity.serial, /^0x[a-f0-9]{8}$/);
}

const fixture = Buffer.alloc(28);
fixture.write("OggS", 0, "ascii");
fixture[4] = 0;
fixture[26] = 1;
fixture[27] = 0;
const pinned = pinOggSerial(fixture, 0x12345678);
assert.equal(pinned.readUInt32LE(14), 0x12345678);
assert.notEqual(pinned.readUInt32LE(22), 0);
const expected = { bytes: pinned.length, sha256: createHash("sha256").update(pinned).digest("hex") };
assert.deepEqual(assertOggProductionBaseline(pinned, expected), expected);
assert.throws(() => assertOggProductionBaseline(pinned, { ...expected, sha256: "0".repeat(64) }), /does not match/);

console.log(JSON.stringify({ th20OggProductionBaseline: "PASS", tracks: Object.keys(baseline.files).length }));
