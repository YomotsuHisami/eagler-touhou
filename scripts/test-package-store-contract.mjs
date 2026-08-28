import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  PACKAGE_STORE_DB,
  openPackageStore,
  packageMimeType,
} from "../package-store.mjs";

assert.equal(PACKAGE_STORE_DB, "eagler-touhou-package-store-v1");

assert.equal(packageMimeType("games/th08/th08.wasm"), "application/wasm");
assert.equal(packageMimeType("music/track.ogg"), "audio/ogg");

const source = await readFile(new URL("../package-store.mjs", import.meta.url), "utf8");
assert.match(source, /db\.transaction\(\[PACKAGE_INSTALLATIONS, PACKAGE_GENERATIONS\], "readwrite"\)/,
  "current/pending generation commit must remain one IndexedDB transaction");
assert.match(source, /currentGeneration: generationId,[\s\S]*pendingGeneration: null/,
  "commit must atomically advance current and clear pending");
assert.doesNotMatch(source, /sha-?256|subtle\.digest/i,
  "Package Store must not re-hash installed objects");
assert.match(source, /putPackageObject\(value[\s\S]*randomObjectId\(\)/,
  "new physical objects must use independent ids rather than descriptor revisions");
assert.match(source, /readPackageObjectBySource[\s\S]*return null/,
  "missing declared objects must remain a non-fatal lookup miss");
assert.doesNotMatch(source, /CacheStorage|caches\.|EM_PRELOAD_CACHE/,
  "Package Store must remain the only persistent owner for installed game bytes");
assert.match(source, /putPackageObject\(value[\s\S]*value instanceof ArrayBuffer[\s\S]*ArrayBuffer\.isView\(value\)[\s\S]*value instanceof Blob[\s\S]*value\.arrayBuffer\(\)[\s\S]*writePackageObjectRecord\(id, \{ data, type: normalizedType, bytes: data\.byteLength \}/,
  "Package Store must canonicalize every new binary object to ArrayBuffer before IndexedDB persistence");
assert.doesNotMatch(source, /writePackageObjectRecord\([^\n]*\{\s*blob\b/,
  "new Package Store writes must never persist disk-backed Blob/File objects directly");
assert.match(source, /normalizeStoredPackageObject[\s\S]*\.\.\.value[\s\S]*new Blob\(\[value\.data\]/,
  "ArrayBuffer-backed Package objects must retain direct bytes while exposing an in-memory Blob for legacy callers");
assert.match(source, /readPackageObjects[\s\S]*db\.transaction\(\[PACKAGE_OBJECTS\], "readonly"\)[\s\S]*Promise\.all\(ids\.map/,
  "bootstrap Package objects must support one-transaction bulk reads for WebKit startup");
assert.match(source, /attachPendingPackageObject[\s\S]*object\?\.data instanceof ArrayBuffer[\s\S]*storageMode: "arraybuffer"/,
  "ArrayBuffer Runtime objects must preserve their storage mode on generation refs");
assert.match(source, /Package Store open timed out/,
  "Package Store open must have a bounded watchdog instead of trusting IndexedDB callbacks forever");
assert.doesNotMatch(source, /Safari|WebKit|webkit|userAgent/i,
  "Package Store compatibility must be capability-driven rather than browser-UA driven");

const neverSettles = { open() { return {}; } };
await assert.rejects(
  openPackageStore(neverSettles, { timeoutMs: 5 }),
  /Package Store open timed out/,
  "Package Store open watchdog must reject a WebKit-style permanently pending request",
);

console.log("Package Store contract: PASS");
