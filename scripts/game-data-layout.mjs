import { createHash } from "node:crypto";

export function extractGameDataLayout(runtimeScript, game) {
  if (typeof runtimeScript !== "string" || !/^(?:th06|th07)$/.test(game)) throw new Error("invalid runtime layout input");
  const marker = runtimeScript.match(/loadPackage\(\{files:(\[[\s\S]*?\]),remote_package_size:(\d+)/);
  if (!marker) throw new Error(`${game}: Emscripten loadPackage metadata missing`);
  const files = [];
  const pattern = /\{filename:"((?:[^"\\]|\\.)*)",start:(\d+),end:(\d+)\}/g;
  for (const match of marker[1].matchAll(pattern)) {
    const filename = JSON.parse(`"${match[1]}"`);
    const start = Number(match[2]);
    const end = Number(match[3]);
    if (!filename.startsWith("/") || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end <= start) {
      throw new Error(`${game}: invalid Emscripten data-file layout entry`);
    }
    files.push([filename, start, end]);
  }
  if (!files.length || files[0][1] !== 0 || files.at(-1)[2] !== Number(marker[2])) {
    throw new Error(`${game}: incomplete Emscripten data-file layout`);
  }
  for (let index = 1; index < files.length; index++) {
    if (files[index - 1][2] !== files[index][1]) throw new Error(`${game}: non-contiguous Emscripten data-file layout`);
  }
  const sha256 = createHash("sha256").update(JSON.stringify(files)).digest("hex");
  return { layout: `sha256-${sha256}`, bytes: Number(marker[2]), files };
}
