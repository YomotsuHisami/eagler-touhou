import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { ThtkRunner } from "../server/thtk-runner.mjs";

const project = resolve(fileURLToPath(new URL("..", import.meta.url)));
const workspace = resolve(project, "..");
const port = 18135;
const origin = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ["scripts/serve.mjs", String(port)], {
  cwd: project,
  windowsHide: true,
  stdio: ["ignore", "pipe", "pipe"]
});
let output = "";
child.stdout.on("data", chunk => { output += chunk.toString("utf8"); });
child.stderr.on("data", chunk => { output += chunk.toString("utf8"); });

async function waitForServer() {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`server exited early: ${output}`);
    try {
      const response = await fetch(`${origin}/api/thcrap/languages`);
      if (response.ok) return;
    } catch {}
    await new Promise(resolveWait => setTimeout(resolveWait, 200));
  }
  throw new Error(`server did not become ready: ${output}`);
}

function decodeTable(bytes) {
  assert.equal(bytes.subarray(0, 4).toString("ascii"), "ETL1");
  const count = bytes.readUInt32LE(4);
  const entries = new Map();
  let offset = 8;
  for (let index = 0; index < count; index++) {
    assert(offset + 8 <= bytes.length);
    const key = bytes.readUInt32LE(offset);
    const line = bytes.readUInt16LE(offset + 4);
    const length = bytes.readUInt16LE(offset + 6);
    offset += 8;
    assert(offset + length <= bytes.length);
    entries.set(`${key}:${line}`, bytes.subarray(offset, offset + length).toString("utf8"));
    offset += length;
  }
  assert.equal(offset, bytes.length);
  return entries;
}

try {
  await waitForServer();
  assert.match(output, /thcrap runtime compiler: ready/);
  const response = await fetch(`${origin}/api/thcrap/th07/lang_zh-hans/manifest.json`);
  assert.equal(response.status, 200);
  const manifest = await response.json();
  assert.equal(manifest.runtimeReady, true);
  assert(manifest.assets.length >= 50);
  assert.equal(manifest.assets.filter(asset => asset.format === "touhou-message/1").length, 8);
  assert.equal(manifest.assets.filter(asset => asset.format === "touhou-ending/1").length, 9);
  assert.equal(manifest.assets.filter(asset => asset.format === "eagler-localization-table/1").length, 3);
  assert(manifest.dependencies.includes("nmlgc/base_tsa"));
  assert(manifest.assets.some(asset => asset.targetPath === "/thcrap/th07/fonts/Touhou_Simhei.ttf"));

  const message = manifest.assets.find(asset => asset.targetPath === "/thcrap/th07/msg1.dat");
  const ending = manifest.assets.find(asset => asset.targetPath === "/thcrap/th07/end00.end");
  const spells = manifest.assets.find(asset => asset.targetPath === "/thcrap/th07/localization/spells.etl");
  const music = manifest.assets.find(asset => asset.targetPath === "/thcrap/th07/localization/musiccmt.etl");
  const themes = manifest.assets.find(asset => asset.targetPath === "/thcrap/th07/localization/themes.etl");
  assert(message && ending && spells && music && themes);
  const messageBytes = Buffer.from(await (await fetch(new URL(message.url, origin))).arrayBuffer());
  const endingBytes = Buffer.from(await (await fetch(new URL(ending.url, origin))).arrayBuffer());
  const spellEntries = decodeTable(Buffer.from(await (await fetch(new URL(spells.url, origin))).arrayBuffer()));
  const musicEntries = decodeTable(Buffer.from(await (await fetch(new URL(music.url, origin))).arrayBuffer()));
  const themeEntries = decodeTable(Buffer.from(await (await fetch(new URL(themes.url, origin))).arrayBuffer()));
  const runner = new ThtkRunner({
    thdat: resolve(workspace, "dependencies", "thtk-bin-12", "thtk-bin-12", "thdat.exe"),
    thmsg: resolve(workspace, "dependencies", "thtk-bin-12", "thtk-bin-12", "thmsg.exe")
  });
  const dumped = await runner.dumpMessage(messageBytes, 7);
  assert.match(dumped.toString("utf8"), /真冷/u);
  assert.match(endingBytes.toString("utf8"), /[一-鿿]/u);
  assert.match(spellEntries.get("0:0"), /[一-鿿]/u);
  assert.match(musicEntries.get("1:1"), /[一-鿿]/u);
  assert.match(themeEntries.get("1:0"), /[一-鿿]/u);

  const th06Response = await fetch(`${origin}/api/thcrap/th06/lang_zh-hans/manifest.json`);
  assert.equal(th06Response.status, 200);
  const th06 = await th06Response.json();
  assert.equal(th06.runtimeReady, true);
  assert(th06.assets.length >= 40);
  assert.equal(th06.assets.filter(asset => asset.format === "touhou-message/1").length, 7);
  assert.equal(th06.assets.filter(asset => asset.format === "touhou-ending/1").length, 6);
  assert.equal(th06.assets.filter(asset => asset.format === "eagler-localization-table/1").length, 4);
  const th06Stage = th06.assets.find(asset => asset.targetPath === "/thcrap/th06/localization/stages.etl");
  const th06Message = th06.assets.find(asset => asset.targetPath === "/thcrap/th06/msg1.dat");
  assert(th06Stage && th06Message);
  const stageEntries = decodeTable(Buffer.from(await (await fetch(new URL(th06Stage.url, origin))).arrayBuffer()));
  assert.match(stageEntries.get("1:0"), /[一-鿿]/u);
  const th06Dump = await runner.dumpMessage(
    Buffer.from(await (await fetch(new URL(th06Message.url, origin))).arrayBuffer()), 6);
  assert.match(th06Dump.toString("utf8"), /[一-鿿]/u);
  console.log(JSON.stringify({
    language: manifest.language,
    th06: { assets: th06.assets.length, messages: 7, endings: 6, localizationTables: 4 },
    th07: { assets: manifest.assets.length, messages: 8, endings: 9, localizationTables: 3 },
    runtimeReady: manifest.runtimeReady,
    messageBytes: messageBytes.length
  }));
} finally {
  child.kill();
  await new Promise(resolveExit => {
    if (child.exitCode !== null) resolveExit();
    else child.once("exit", resolveExit);
  });
}
