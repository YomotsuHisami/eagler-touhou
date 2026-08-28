import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../package-installer.mjs", import.meta.url), "utf8");
assert.match(source, /installPackageFromZip[\s\S]*installPackageFromAcquisition/,
  "ZIP acquisition must enter the same Package installer as remote acquisition");
assert.match(source, /installPackageFromRemote[\s\S]*installPackageFromAcquisition/,
  "remote acquisition must enter the same Package installer as ZIP acquisition");
assert.match(source, /installPackageFromRemote[\s\S]*signal = null[\s\S]*fetchImpl\(url, \{ cache: "no-store", signal \}\)/,
  "remote Package acquisition must pass the caller AbortSignal into each blocking fetch");
assert.match(source, /signal\?\.aborted[\s\S]*abortedDownloadError/,
  "remote Package acquisition must preserve user cancellation as AbortError instead of wrapping it as a generic network failure");
assert.match(source, /else \{[\s\S]*desired Package file is unavailable/,
  "every file selected from the new Descriptor must be acquired before the pending generation can commit");
assert.doesNotMatch(source, /requiredFileIds|required Package file is unavailable/,
  "updates must not keep a weaker optional-file boundary that can commit partially missing desired content");
assert.match(source, /reuseCurrent: false/,
  "ZIP import must use the bytes the user supplied instead of silently reusing current objects by revision");
assert.match(source, /Package file size mismatch/,
  "acquired Package bytes must be checked against the Descriptor before a pending generation can commit");
assert.match(source, /sliced\.arrayBuffer\(\)/,
  "ZIP entries must be materialized to independent ArrayBuffer bytes before Package Store persistence");
assert.match(source, /response\.arrayBuffer\(\)/,
  "remote Package acquisition must use the same ArrayBuffer persistence boundary as local ZIP imports");
assert.match(source, /Package file size mismatch/,
  "acquired file bytes must match the Descriptor before a pending generation can commit");
assert.doesNotMatch(source, /runtimeStorage|runtimeCarrier|runtimeArrayBufferFileIds|forceRuntime/i,
  "the content installer must not retain executable Runtime carrier/storage migrations");
const successBranch = source.slice(source.indexOf("const installation = await commitPendingPackageGeneration"), source.indexOf("} catch (error)"));
assert.doesNotMatch(successBranch, /garbageCollectPackageStore/,
  "successful current switch must defer GC until a Runtime-safe boundary");
assert.match(source, /catch \(error\)[\s\S]*cancelPendingPackageGeneration[\s\S]*garbageCollectPackageStore/,
  "failed pending installs should be cancelled and garbage-collected immediately");
assert.doesNotMatch(source, /sha-?256|subtle\.digest/i,
  "browser Package installation must not re-hash local files");
console.log("Package installer contract: PASS");
