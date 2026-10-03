/** Reproducible publication/format tests. Synthetic programs/data only; this is
 * not gameplay or real browser acceptance. Exercises the actual generators. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cp, lstat, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { writeRuntimeGeneration, publishRuntimeManifest, readRuntimeManifest, verifyRuntimePublication,
  runtimeGenerationId, assertPortableRuntimeSources } from "../lib/runtime-generations.mjs";
import { RUNTIME_MANIFEST_FILE, RUNTIME_PREPARE, canonicalRuntimePayload, parseRuntimeGenerationPath,
  validateRuntimeManifest, validateRuntimePrepareRequest } from "../lib/contracts/runtime-generations.mjs";
import { PRODUCT_GAMES } from "../lib/contracts/product-catalog.mjs";
import { createPublicationHostSeed } from "../lib/publication-host-seed.mjs";
import { writeSyntheticRuntimeRelease } from "./support/runtime-release-fixture.mjs";
import { verifyRuntimeRelease, LEGACY_RUNTIME_RELEASE_SCHEMA } from "../lib/runtime-release.mjs";
import { deployStaticSite } from "../lib/static-deployment.mjs";

const project = resolve(fileURLToPath(new URL("..", import.meta.url)));
const temp = await mkdtemp(join(tmpdir(), "eagler-generations-"));
const run = promisify(execFile);
const command = (...args) => run(process.execPath, args, { cwd: project, maxBuffer: 8 * 1024 * 1024 });
const json = async path => JSON.parse(await readFile(path, "utf8"));
try {
  const source = resolve(temp, "source"), site = resolve(temp, "unit-site");
  await mkdir(source, { recursive: true });
  await writeFile(resolve(source, "game.html"), '<script type="module" src="./shell.mjs"></script>');
  await writeFile(resolve(source, "shell.mjs"), 'import "./glue.mjs"; new Worker(new URL("./worker.mjs", import.meta.url), {type:"module"});');
  await writeFile(resolve(source, "worker.mjs"), 'import "./glue.mjs";');
  await writeFile(resolve(source, "glue.mjs"), 'fetch(new URL("./game.wasm", import.meta.url));');
  await writeFile(resolve(source, "game.wasm"), new Uint8Array([0,97,115,109,1,0,0,0]));
  const names = await readdir(source);
  const a = await writeRuntimeGeneration({site, source, root:"runtime/th08/", entry:"game.html", names});
  assert.equal(runtimeGenerationId(a.entry, [...a.files].reverse()), a.generation, "filesystem enumeration order is not identity");
  assert.equal((await writeRuntimeGeneration({site, source, root:"runtime/th08/", entry:"game.html", names})).generation, a.generation);
  await publishRuntimeManifest(site, [{root:"runtime/th08/",current:a}]);
  assert.equal(parseRuntimeGenerationPath(`runtime/th08/${a.generation}/game.wasm`).generation, a.generation);
  for(const bad of ["runtime/th08/../x", "runtime/th08//x", "/runtime/th08/x"]) assert.equal(parseRuntimeGenerationPath(bad), null);
  assert.throws(()=>canonicalRuntimePayload(a.entry,[...a.files,a.files[0]]), /identity/);
  assert.throws(()=>validateRuntimePrepareRequest({type:RUNTIME_PREPARE,entry:"runtime/th08/game.html",exclude:["bad"]}), /exclusions/);
  assert.throws(()=>validateRuntimePrepareRequest({type:RUNTIME_PREPARE,entry:"../private.html"}), /entry/);
  assert.throws(()=>assertPortableRuntimeSources(new Map([["shell.mjs",Buffer.from('import "../mutable/glue.mjs";')]])), /escapes/);
  assert.throws(()=>assertPortableRuntimeSources(new Map([["shell.mjs",Buffer.from('new Worker("missing.mjs");')]])), /not declared/);
  await writeFile(resolve(source,"shell.mjs"), 'import "./glue.mjs"; // next generation');
  const b = await writeRuntimeGeneration({site, source, root:"runtime/th08/", entry:"game.html", names});
  await publishRuntimeManifest(site,[{root:"runtime/th08/",current:b}]);
  assert.deepEqual((await readRuntimeManifest(site)).groups[0].previous.map(x=>x.generation),[a.generation]);
  const pointer = await readFile(resolve(site,RUNTIME_MANIFEST_FILE));
  await writeFile(resolve(site,"runtime/th08",b.generation,"game.wasm"),"corrupt");
  await assert.rejects(writeRuntimeGeneration({site, source, root:"runtime/th08/", entry:"game.html", names}), /mismatch/);
  await assert.rejects(publishRuntimeManifest(site,[{root:"runtime/th08/",current:b}]), /mismatch/);
  assert.deepEqual(await readFile(resolve(site,RUNTIME_MANIFEST_FILE)),pointer,"a failed candidate must not change the live pointer");

  const release = resolve(temp,"release"), output = resolve(temp,"output");
  const runtimeRelease = await writeSyntheticRuntimeRelease(release);
  await verifyRuntimeRelease(release);
  // Legacy Runtime Release reader is bounded compatibility, not a legacy writer.
  const legacy = resolve(temp,"legacy-release");
  const old = structuredClone(runtimeRelease); old.schema = LEGACY_RUNTIME_RELEASE_SCHEMA;
  for(const [game,entry] of Object.entries(old.games)) for(const field of ["runtime","multiplayerRuntime"]) if(entry[field]) {
    const program=entry[field], target=`runtime/${game}/${field === "multiplayerRuntime" ? "multiplayer" : ""}`.replace(/\/$/,"");
    for(const name of Object.keys(program.files)) {await mkdir(dirname(resolve(legacy,target,name)),{recursive:true});await cp(resolve(release,program.root,name),resolve(legacy,target,name));}
    program.root=target;delete program.generation;
  }
  await writeFile(resolve(legacy,"runtime-release.json"),JSON.stringify(old));
  await verifyRuntimeRelease(legacy);
  const seed = createPublicationHostSeed("web-validation-generations");
  seed.schema="eagler-touhou/host-manifest/1";
  seed.shared={resourceMode:"hosted",vanillaFont:"shared/msgothic.ttc?v=f",unicodeFont:"shared/unifont.otf?v=g"};
  for(const [game,product] of Object.entries(PRODUCT_GAMES))Object.assign(seed.games[game],{
    runtime:`runtime/${game}/${game}.html?hosted=1&v=old`,
    ...(product.multiplayerRuntime?{multiplayerRuntime:`runtime/${game}/multiplayer/${game}.html?hosted=1&v=old`}:{}),
    gameData:{path:product.package.dataTarget.slice(1),bytes:4,sha256:"a".repeat(64),version:`sha256-${"a".repeat(64)}`,layout:runtimeRelease.games[game].dataLayout},
    features:{thprac:false,focusHitbox:false}, music:{midi:{files:[],...(product.musicCapabilities.midi?{}:{supported:false})}},
  });
  const features={schema:"eagler-touhou/server-features/1",resourceMode:"import",games:Object.fromEntries(Object.entries(PRODUCT_GAMES).map(([game,product])=>[game,{
    ...(product.features.languages?{languages:["ja"]}:{}),...(product.features.thprac?{thprac:false}:{})}]))};
  await writeFile(resolve(temp,"seed.json"),JSON.stringify(seed));
  await writeFile(resolve(temp,"features.json"),JSON.stringify(features));
  await command("scripts/package-server.mjs",`--output=${output}`,`--runtime-release=${release}`,`--host-manifest=${resolve(temp,"seed.json")}`,
    `--feature-config=${resolve(temp,"features.json")}`,"--profile=web-validation-generations","--games=th06,th07,th08,th10","--music=midi");
  await command("scripts/verify-server-build.mjs",output);
  const host = await json(resolve(output,"host-manifest.json"));
  const catalog = await verifyRuntimePublication(output,host);
  assert.deepEqual(catalog.groups.map(group => group.root).sort(),
    ["th06", "th07", "th08", "th10"].flatMap(game => [
      `runtime/${game}/`, ...(PRODUCT_GAMES[game].multiplayerRuntime ? [`runtime/${game}/multiplayer/`] : []),
    ]).sort(), "each selected game and declared multiplayer variant needs an independent Runtime generation");
  for(const [game,entry] of Object.entries(host.games))for(const field of ["runtime","multiplayerRuntime"])if(entry[field]) {
    assert.equal(parseRuntimeGenerationPath(entry[field].split("?")[0]).generation,runtimeRelease.games[game][field].generation);
  }
  const generations=catalog.groups.map(group=>group.current.generation);
  await command("scripts/refresh-deployment-app-shell.mjs",output,"--frontend");
  assert.deepEqual((await readRuntimeManifest(output)).groups.map(group=>group.current.generation),generations,"Launcher-only refresh does not rebuild game generations");
  const deployment=await json(resolve(output,"deployment.json"));
  assert.ok(deployment.appShell.entries.every(path=>!path.startsWith("runtime/") && path!==RUNTIME_MANIFEST_FILE));
  await command("scripts/verify-server-build.mjs",output);
  const store=resolve(temp,"releases"),current=resolve(temp,"current");
  const first=await deployStaticSite({source:output,releases:store,current});
  assert.equal((await lstat(current)).isSymbolicLink(),true);
  const second=await deployStaticSite({source:output,releases:store,current});
  assert.equal(second.previous,first.release);
  await command("scripts/verify-server-build.mjs",current);
  assert.deepEqual((await readRuntimeManifest(current)).groups.map(group=>group.current.generation),generations);
  await writeFile(resolve(output,"runtime-manifest.json"),"broken");
  await assert.rejects(deployStaticSite({source:output,releases:store,current}),/mismatch/);
  await command("scripts/verify-server-build.mjs",current);
  console.log("Immutable Runtime protocol, generator, legacy read, declared-variant Host, refresh and atomic deployment: PASS");
} finally { await rm(temp,{recursive:true,force:true}); }
