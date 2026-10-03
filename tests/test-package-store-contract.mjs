import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { generationKey } from "../package/package-store.mjs";

assert.throws(() => generationKey("th99", "generation-1"), /game id/,
  "Package Store must share Product Catalog game identity");

const source = await readFile(new URL("../package/package-store.mjs", import.meta.url), "utf8");
assert.match(source, /db\.transaction\(\[PACKAGE_INSTALLATIONS, PACKAGE_GENERATIONS\], "readwrite"\)/,
  "current/pending generation commit must remain one IndexedDB transaction; crash atomicity is a structural contract");
assert.match(source, /currentGeneration: generationId,[\s\S]*pendingGeneration: null/,
  "the same commit transaction must advance current and clear pending");

// Chromium rejects one structured-cloned IndexedDB value above 127 MiB, which a
// retail archive can exceed (TH20's th20.data is 144 MiB). Object bytes must be
// persisted as a Blob above a limit that stays clear of that ceiling.
const arrayBufferLimit = Number(/PACKAGE_OBJECT_ARRAYBUFFER_LIMIT = (\d+) \* 1024 \* 1024/.exec(source)?.[1]);
assert.ok(Number.isFinite(arrayBufferLimit) && arrayBufferLimit > 0 && arrayBufferLimit < 127,
  "the Package Store ArrayBuffer limit must stay below the browser structured-clone ceiling");
assert.match(source, /data\.byteLength > PACKAGE_OBJECT_ARRAYBUFFER_LIMIT[\s\S]{0,240}blob: new Blob\(\[data\]/,
  "an over-limit Package object must be stored as a Blob, never as one ArrayBuffer value");
assert.match(source, /value instanceof Blob[\s\S]{0,200}value\.size > PACKAGE_OBJECT_ARRAYBUFFER_LIMIT\) return \{ blob: value/,
  "an over-limit Blob acquisition must be persisted without first materializing it");
assert.match(source, /value\?\.blob instanceof Blob \|\| value\?\.data instanceof ArrayBuffer/,
  "Package Store records must keep accepting both Blob and ArrayBuffer storage");

console.log("Package Store crash-atomic commit and large-object storage: PASS");
