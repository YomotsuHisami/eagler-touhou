import { readFile, readdir, stat } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const requiredFrontendFiles = ["index.html", "about.html", "about.css", "styles.css", "touch-guide.css", "app.js", "games.json"];
const requiredGameExtensions = [".html", ".js", ".wasm", ".data"];

async function walk(directory, files = []) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) await walk(path, files);
    else files.push(path);
  }
  return files;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export async function verifyDistribution(distributionRoot) {
  const root = resolve(distributionRoot);
  const frontend = resolve(root, "eagler-touhou");
  for (const file of requiredFrontendFiles) {
    assert((await stat(resolve(frontend, file))).isFile(), `missing frontend file: ${file}`);
  }

  const manifest = JSON.parse(await readFile(resolve(frontend, "games.json"), "utf8"));
  assert(manifest.protocol === "eagler-touhou/1", "unexpected host protocol");
  for (const key of ["vanillaFont", "unicodeFont"]) {
    assert(typeof manifest.shared?.[key] === "string" && manifest.shared[key].includes("?v="), `versioned shared ${key} missing`);
    assert((await stat(resolve(frontend, manifest.shared[key].split("?")[0]))).isFile(), `shared ${key} file missing`);
  }
  for (const game of ["th06", "th07"]) {
    const entry = manifest.games?.[game];
    assert(typeof entry?.runtime === "string" && entry.runtime.includes(`/games/${game}/${game}.html`),
      `invalid ${game} runtime manifest entry`);
    assert(entry.runtime.includes("&v="), `unversioned ${game} runtime`);
    assert(entry.music?.midi && Array.isArray(entry.music.midi.files) && entry.music.midi.files.length === 0,
      `invalid ${game} MIDI resource entry`);
    for (const mode of ["wav", "ogg"]) {
      const pack = entry.music?.[mode];
      assert(pack && typeof pack.base === "string" && Array.isArray(pack.files) && pack.files.length > 0,
        `invalid ${game} ${mode.toUpperCase()} resource entry`);
      assert(pack.base === `../games/${game}/music/${mode}/`,
        `unexpected ${game} ${mode.toUpperCase()} resource base`);
      assert(typeof pack.version === "string" && pack.version.length >= 8,
        `missing ${game} ${mode.toUpperCase()} content version`);
      for (const file of pack.files) {
        const info = await stat(resolve(frontend, pack.base, file));
        assert(info.isFile() && info.size > 0,
          `missing or empty music resource: ${game}/${mode}/${file}`);
      }
    }
    for (const extension of requiredGameExtensions) {
      const path = resolve(root, "games", game, `${game}${extension}`);
      const info = await stat(path);
      assert(info.isFile() && info.size > 0, `missing or empty game artifact: ${game}${extension}`);
    }
    const wasm = await readFile(resolve(root, "games", game, `${game}.wasm`));
    assert(wasm.length >= 8 && wasm.subarray(0, 4).equals(Buffer.from([0x00, 0x61, 0x73, 0x6d])),
      `invalid WebAssembly header: ${game}.wasm`);
    const shell = await readFile(resolve(root, "games", game, `${game}.html`), "utf8");
    assert(shell.includes("eagler-touhou/1") && shell.includes(JSON.stringify(game)) &&
      shell.includes("configure") && shell.includes("touhouMusicMode"),
      `host protocol missing from ${game}.html`);
  }

  const dangerous = (await walk(root)).filter((path) => [".exe", ".com", ".scr", ".msi"].includes(extname(path).toLowerCase()));
  assert(dangerous.length === 0, `unexpected executable files: ${dangerous.join(", ")}`);
  return { files: (await walk(root)).length, games: 2, protocol: manifest.protocol };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const target = process.argv[2] || resolve(fileURLToPath(new URL("../..", import.meta.url)), "dist", "eagler-touhou-unified-test");
  console.log(JSON.stringify(await verifyDistribution(target)));
}
