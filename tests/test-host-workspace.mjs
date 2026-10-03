import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PRODUCT_CONTENT } from "../lib/content-definition.mjs";
import { HOST_WORKSPACE_GAMES, inspectHostWorkspace, hostWorkspacePaths } from "../lib/host-workspace.mjs";
import { writeSyntheticRuntimeRelease } from "../tests/support/runtime-release-fixture.mjs";

const root = await mkdtemp(join(tmpdir(), "eagler-host-workspace-"));
try {
const layout = hostWorkspacePaths(root);
assert.equal(layout.config, join(root, "eagler-touhou.config.json"));
assert.equal(layout.runtimeRelease, join(root, "runtime-release"));
assert.equal(layout.games.th06, join(root, "games", "th06"));
assert.equal(layout.site, join(root, "dist", "site"));
assert.equal(layout.importSite, join(root, "dist", "import-site"));
assert.equal(layout.importPackages, join(root, "dist", "import"));
await writeSyntheticRuntimeRelease(layout.runtimeRelease);
for (const game of HOST_WORKSPACE_GAMES) await mkdir(layout.games[game], { recursive: true });
const put = async path => { await mkdir(join(path, ".."), { recursive: true }); await writeFile(path, Buffer.from([1])); };
for (const game of HOST_WORKSPACE_GAMES) {
  for (const name of PRODUCT_CONTENT[game].original.files) await put(join(layout.games[game], name));
}

const midiOnly = await inspectHostWorkspace(root, { music: "midi" });
assert.deepEqual(midiOnly.music, ["midi"]);
await assert.rejects(() => inspectHostWorkspace(root), /TH06 OGG source bgm[\\/]th06_01\.wav not found/);

for (const game of ["th06", "th07", "th08"]) {
  for (const name of PRODUCT_CONTENT[game].original.oggSourceFiles) await put(join(layout.games[game], name));
}
await assert.rejects(() => inspectHostWorkspace(root), /TH09 OGG source thbgm\.dat not found/);
const th09Alternative = PRODUCT_CONTENT.th09.original.preparedAlternative;
for (const marker of th09Alternative.markerFiles) await put(join(layout.games.th09, th09Alternative.directory, marker));
await assert.rejects(() => inspectHostWorkspace(root), /TH10 OGG source thbgm\.dat not found/);
const alternative = PRODUCT_CONTENT.th10.original.preparedAlternative;
for (const marker of alternative.markerFiles) await put(join(layout.games.th10, alternative.directory, marker));
// TH11 ships the prepared /music OGG set; either the retail thbgm.dat or the
// prepared content markers satisfy the self-host workspace declaration.
const th11Alternative = PRODUCT_CONTENT.th11.original.preparedAlternative;
for (const marker of th11Alternative.markerFiles) await put(join(layout.games.th11, th11Alternative.directory, marker));
// TH20 streams retail thbgm.dat directly; the self-host workspace still requires
// the declared BGM source input.
for (const name of PRODUCT_CONTENT.th20.original.oggSourceFiles) await put(join(layout.games.th20, name));
const full = await inspectHostWorkspace(root);
assert.deepEqual(full.music, ["midi", "ogg"]);
assert.equal(full.runtimeReleaseSchema, "eagler-touhou/runtime-release/2");
assert.equal(full.games.th08, layout.games.th08);
assert.equal(full.games.th10, layout.games.th10);
assert.equal(full.hostConfig.present, false);
assert.equal(full.warnings.length, 2);
await writeFile(layout.config, JSON.stringify({
  schema: "eagler-touhou/host-config/1",
  netplay: { relay: "wss://relay.example.com/eagler-netplay/" },
  externalImportSource: { url: "https://downloads.example.com/packages", hint: "test" },
}));
const configured = await inspectHostWorkspace(root);
assert.equal(configured.hostConfig.present, true);
assert.equal(configured.hostConfig.netplay.relay, "wss://relay.example.com/eagler-netplay/");
assert.equal(configured.warnings.length, 1, "configured WS/external source leaves only the unverified TURN warning");
console.log(JSON.stringify({ hostWorkspace: "PASS", games: Object.keys(full.games), music: full.music }));
} finally {
  await rm(root, { recursive: true, force: true });
}
