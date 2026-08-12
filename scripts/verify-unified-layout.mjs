import { readFile, stat } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const project = resolve(fileURLToPath(new URL("..", import.meta.url)));
const workspace = resolve(project, "..");
const manifest = JSON.parse(await readFile(resolve(project, "games.json"), "utf8"));
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const toPath = value => resolve(workspace, decodeURIComponent(new URL(value, "https://eagler.local/eagler-touhou/").pathname.slice(1)));
const results = {};

assert(manifest.protocol === "eagler-touhou/1", "unexpected protocol");
for (const [game, entry] of Object.entries(manifest.games || {})) {
  assert(typeof entry.runtime === "string", `${game}: missing unified runtime`);
  const runtimeHtml = toPath(entry.runtime);
  const basename = runtimeHtml.slice(0, -extname(runtimeHtml).length);
  for (const extension of [".html", ".js", ".wasm", ".data"]) {
    const info = await stat(`${basename}${extension}`);
    assert(info.isFile() && info.size > 0, `${game}: missing ${extension} runtime artifact`);
  }
  const wasm = await readFile(`${basename}.wasm`);
  assert(wasm.subarray(0, 4).equals(Buffer.from([0, 0x61, 0x73, 0x6d])), `${game}: invalid wasm`);
  const shell = await readFile(`${basename}.html`, "utf8");
  assert(shell.includes("configure") && shell.includes("touhouMusicMode"), `${game}: runtime music protocol missing`);

  const compileCommands = await readFile(resolve(dirname(runtimeHtml), "compile_commands.json"), "utf8");
  assert(!compileCommands.includes("TH_BGM_MIDI") && !compileCommands.includes("TH_BGM_OGG"),
    `${game}: compile-time music fork remains`);

  const musicBytes = {};
  for (const name of ["midi", "wav", "ogg"]) {
    const pack = entry.music?.[name];
    assert(pack && Array.isArray(pack.files), `${game}: missing ${name} resource pack`);
    let bytes = 0;
    for (const file of pack.files) {
      assert(typeof file === "string" && !file.includes("/") && !file.includes("\\"), `${game}: unsafe resource name`);
      const info = await stat(toPath(new URL(file, new URL(pack.base || "./", "https://eagler.local/eagler-touhou/")).href));
      assert(info.isFile() && info.size > 0, `${game}: empty ${name} resource ${file}`);
      bytes += info.size;
    }
    musicBytes[name] = bytes;
  }
  results[game] = { wasmBytes: wasm.length, baseDataBytes: (await stat(`${basename}.data`)).size, musicBytes };
}

console.log(JSON.stringify({ protocol: manifest.protocol, unified: true, games: results }, null, 2));
