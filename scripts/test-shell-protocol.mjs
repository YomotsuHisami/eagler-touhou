import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import vm from "node:vm";

const workspace = resolve(new URL("../..", import.meta.url).pathname.replace(/^\/(?:([A-Za-z]:))/, "$1"));
const cases = [
  { game: "th06", shell: "th06-eagler/resources/shell.html", packs: {
    wav: [{ url: "http://test.local/music.wav", path: "/bgm/th06_01.wav" }],
    ogg: [{ url: "http://test.local/music.ogg", path: "/bgm/th06_01.ogg" }]
  } },
  { game: "th07", shell: "th07-eagler/resources/shell.html", packs: {
    wav: [{ url: "http://test.local/thbgm.dat", path: "/thbgm.dat" }],
    ogg: [{ url: "http://test.local/music.ogg", path: "/bgm-ogg/th07_01.ogg" }]
  } }
];

for (const test of cases) {
  const html = await readFile(resolve(workspace, test.shell), "utf8");
  const source = html.match(/<script>\s*([\s\S]*?)<\/script>/)?.[1];
  if (!source) throw new Error(`${test.game}: inline shell script missing`);
  const listeners = new Map();
  const documentListeners = new Map();
  const files = new Map();
  const replies = [];
  const canvas = { addEventListener() {}, focus() {},
    getBoundingClientRect() { return { left: 100, top: 50, width: 400, height: 300 }; } };
  const status = { textContent: "" };
  const parent = { postMessage(message) { replies.push(message); } };
  let delayBackground = false;
  let releaseBackground;
  const backgroundGate = new Promise(resolve => { releaseBackground = resolve; });
  const context = {
    console, URL, URLSearchParams, Uint8Array, performance,
    location: { search: "?hosted=1", origin: "http://test.local", href: "http://test.local/game.html?hosted=1" },
    parent,
    document: {
      getElementById(id) { return id === "canvas" ? canvas : status; },
      addEventListener(type, listener) { documentListeners.set(type, listener); }
    },
    fetch: async url => {
      if (delayBackground && String(url).includes("background")) await backgroundGate;
      return { ok: true, status: 200, headers: { get() { return null; } },
        arrayBuffer: async () => new Uint8Array([String(url).length & 255]).buffer };
    },
    FS: {
      mkdirTree() {}, unlink(path) { files.delete(path); },
      writeFile(path, bytes) { files.set(path, [...bytes]); },
      syncfs(_populate, done) { done(); }, mount() {}, mkdir() {}, readdir() { return [".", ".."]; }
    },
    IDBFS: {}, addRunDependency() {}, removeRunDependency() {},
    addEventListener(type, listener) { listeners.set(type, listener); }
  };
  context.window = context;
  vm.runInNewContext(source, context, { filename: test.shell });
  if (typeof context.EaglerTouhouGameExited !== "function") throw new Error(`${test.game}: exit bridge missing`);
  context.EaglerTouhouGameExited(1);
  if (!replies.some(reply => reply.event === "exit" && reply.status === "success")) {
    throw new Error(`${test.game}: successful game exit was not forwarded`);
  }
  const message = listeners.get("message");
  if (!message) throw new Error(`${test.game}: message listener missing`);
  const auxDown = [];
  const auxMotion = [];
  const auxUp = [];
  context.Module._TouhouAuxTouchDown = (id, x, y) => auxDown.push({ id, x, y });
  context.Module._TouhouAuxTouchMotion = (id, x, y) => auxMotion.push({ id, x, y });
  context.Module._TouhouAuxTouchUp = (id, x, y) => auxUp.push({ id, x, y });
  const sharedResources = [{ url: "http://test.local/msgothic.ttc", path: "/msgothic.ttc" }];
  const runtimeResources = [{ url: "http://test.local/translation.bin", path: `/thcrap/${test.game}/translation.bin`, size: 1 }];
  const thpracSession = { schema: "eagler-touhou/thprac-session/1", game: test.game, params: { mode: 1, stage: 0, section: 1 } };
  for (const mode of ["wav", "ogg"]) {
    const resources = test.packs[mode];
    await message({ origin: context.location.origin, source: parent, data: {
      protocol: "eagler-touhou/1", game: test.game, command: "configure", request: mode, music: mode, resources, sharedResources, runtimeResources,
      options: { thpracEnabled: true, touchEnabled: true, unlimitedTouch: true, touchBombZoneEnabled: false, alwaysHitbox: true, th06FocusHitbox: true, thpracSession }
    } });
    if (context.Module.touhouMusicMode !== mode || !resources.every(resource => files.has(resource.path))) {
      throw new Error(`${test.game}: ${mode.toUpperCase()} resources were not installed`);
    }
    if (!context.Module.eaglerOptions.thpracEnabled ||
        !context.Module.eaglerOptions.touchEnabled || !context.Module.eaglerOptions.unlimitedTouch ||
        context.Module.eaglerOptions.touchBombZoneEnabled !== false ||
        !context.Module.eaglerOptions.alwaysHitbox ||
        context.Module.eaglerOptions.th06FocusHitbox !== (test.game === "th06") ||
        context.Module.eaglerOptions.thpracSession !== thpracSession || !files.has(runtimeResources[0].path)) {
      throw new Error(`${test.game}: eagler-touhou options were not installed`);
    }
  }
  const pointerDown = documentListeners.get("pointerdown");
  const pointerMove = documentListeners.get("pointermove");
  const pointerUp = documentListeners.get("pointerup");
  const outside = { pointerType: "touch", pointerId: 2, target: {}, clientX: 0, clientY: 200, preventDefault() {} };
  pointerDown(outside);
  pointerMove({ ...outside, clientX: 50 });
  pointerUp({ ...outside, clientX: 50 });
  if (auxDown[0]?.id !== -1 || auxDown[0]?.x !== -0.25 || auxDown[0]?.y !== 0.5 ||
      auxMotion[0]?.id !== -1 || auxMotion[0]?.x !== -0.125 || auxMotion[0]?.y !== 0.5 ||
      auxUp[0]?.id !== -1 || auxUp[0]?.x !== -0.125 || auxUp[0]?.y !== 0.5) {
    throw new Error(`${test.game}: letterbox down/move/up was not forwarded as a full touch`);
  }
  const mount = test.game === "th06" ? "/bgm" : "/bgm-ogg";
  const suffix = test.game === "th06" ? "th06" : "th07";
  const progressive = [1, 2, 3].map(index => ({
    url: `http://test.local/${index === 3 ? "background" : `priority-${index}`}.ogg`,
    path: `${mount}/${suffix}_0${index}.ogg`, size: 1
  }));
  delayBackground = true;
  const configureProgressive = message({ origin: context.location.origin, source: parent, data: {
    protocol: "eagler-touhou/1", game: test.game, command: "configure", request: "progressive",
    music: "ogg", resources: progressive, sharedResources
  } });
  const completedBeforeBackground = await Promise.race([
    configureProgressive.then(() => true), new Promise(resolve => setTimeout(() => resolve(false), 100))
  ]);
  if (!completedBeforeBackground || !files.has(progressive[0].path) || !files.has(progressive[1].path) ||
      files.has(progressive[2].path)) {
    throw new Error(`${test.game}: OGG launch did not wait for exactly the first two tracks`);
  }
  releaseBackground(); await configureProgressive; await new Promise(resolve => setTimeout(resolve, 0));
  if (!files.has(progressive[2].path)) throw new Error(`${test.game}: background OGG did not finish`);
  delayBackground = false;
  await message({ origin: context.location.origin, source: parent, data: {
    protocol: "eagler-touhou/1", game: test.game, command: "configure", request: "midi", music: "midi", resources: [], sharedResources
  } });
  if (context.Module.touhouMusicMode !== "midi" || files.size !== 1 || !files.has("/msgothic.ttc") ||
      replies.filter(reply => reply.request).some(reply => !reply.ok)) {
    throw new Error(`${test.game}: MIDI reconfiguration failed`);
  }
}

console.log(JSON.stringify({ shells: cases.length, configure: ["midi", "wav", "ogg"], letterbox: "full-touch", protocol: "eagler-touhou/1" }));
