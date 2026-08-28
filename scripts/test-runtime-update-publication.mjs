import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./package-runtime-update.mjs", import.meta.url), "utf8");

assert.match(source, /const descriptor = JSON\.parse\(JSON\.stringify\(baseline\)\)/,
  "runtime update publication must preserve the complete baseline Package contract");
assert.match(source, /const runtimeVariant = args\.variant \|\| "multiplayer"/,
  "runtime update publication must support selecting normal or multiplayer Runtime while retaining multiplayer as the compatibility default");
assert.match(source, /runtime\.bootstrap\.filter[\s\S]*source\.startsWith\(runtimeSourceDirectory\)[\s\S]*html\|js\|wasm/,
  "runtime update publication must copy only the selected Runtime HTML/JS/WASM bootstrap files");
assert.match(source, /const dataPath = required\("data"\)[\s\S]*shared DATA does not match the baseline Package Descriptor/,
  "runtime update publication must use but never publish the exact shared DATA when calculating Runtime identity");
assert.match(source, /runtimeVersionHash[\s\S]*\["html", "js", "wasm"\][\s\S]*runtimeVersionHash\.update\(dataBytes\)/,
  "sparse publication must calculate the same HTML/JS/WASM/DATA Runtime version as the full server packager");
assert.match(source, /source\.replace\(pattern, `\$1\$2th07\.js\?v=\$\{runtimeVersion\}\$2`\)/,
  "sparse publication must version the Runtime script reference exactly like the full server packager");
assert.doesNotMatch(source, /cp\([^\n]*th07\.data|cp\([^\n]*ogg|cp\([^\n]*msgothic|cp\([^\n]*unifont/i,
  "runtime update publication must not become a DATA/OGG/font origin");
assert.match(source, /canonicalPackagePayload\(descriptor\)/,
  "runtime update publication must recalculate the full Package revision after replacing Runtime file revisions");
assert.match(source, /descriptor: `\.\.\/\$\{descriptorName\}`/,
  "Release Catalog must resolve the sparse TH07 Package Descriptor from the Launcher path");
assert.match(source, /deployment\.resourceMode !== "import-partial"[\s\S]*deployment\.runtimeUpdates = \[\{/,
  "overlaying a deployment must declare the sparse Runtime update only in import-partial mode");
assert.match(source, /deployment\.files = inventory\.sort/,
  "runtime update overlay must regenerate the authoritative deployment inventory");

console.log("Runtime update publication contract: PASS");
