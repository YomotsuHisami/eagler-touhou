import { readFile } from "node:fs/promises";
import { webcrypto } from "node:crypto";
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
    console, URL, URLSearchParams, Uint8Array, TextDecoder, performance, crypto: webcrypto,
    navigator: { userAgent: "Desktop Test Browser", maxTouchPoints: 0, userAgentData: { mobile: false } },
    location: { search: "?hosted=1", origin: "http://test.local", href: "http://test.local/game.html?hosted=1" },
    parent,
    document: {
      visibilityState: "visible",
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
  let auxCancelAll = 0;
  context.Module._TouhouAuxTouchDown = (id, x, y) => auxDown.push({ id, x, y });
  context.Module._TouhouAuxTouchMotion = (id, x, y) => auxMotion.push({ id, x, y });
  context.Module._TouhouAuxTouchUp = (id, x, y) => auxUp.push({ id, x, y });
  context.Module._TouhouAuxTouchCancelAll = () => { auxCancelAll++; };
  const sharedResources = [
    { url: "http://test.local/msgothic.ttc", path: "/msgothic.ttc" },
    { url: "http://test.local/unifont.otf", path: "/unifont.otf" },
  ];
  const runtimeResources = [{ url: "http://test.local/translation.bin", path: `/thcrap/${test.game}/translation.bin`, size: 1 }];
  const thpracSession = { schema: "eagler-touhou/thprac-session/1", game: test.game, params: { mode: 1, stage: 0, section: 1 } };
  for (const mode of ["wav", "ogg"]) {
    const resources = test.packs[mode];
    await message({ origin: context.location.origin, source: parent, data: {
      protocol: "eagler-touhou/1", game: test.game, command: "configure", request: mode, music: mode, resources, sharedResources, runtimeResources,
      options: { thpracEnabled: true, limitPresentationTo60: true, touchEnabled: true, unlimitedTouch: true, touchBombZoneEnabled: false, alwaysHitbox: true, th06FocusHitbox: true, thpracSession }
    } });
    if (context.Module.touhouMusicMode !== mode || !resources.every(resource => files.has(resource.path))) {
      throw new Error(`${test.game}: ${mode.toUpperCase()} resources were not installed`);
    }
    if (!context.Module.eaglerOptions.thpracEnabled ||
        !context.Module.eaglerOptions.limitPresentationTo60 ||
        !context.Module.eaglerOptions.touchEnabled || !context.Module.eaglerOptions.unlimitedTouch ||
        context.Module.eaglerOptions.touchBombZoneEnabled !== false ||
        !context.Module.eaglerOptions.alwaysHitbox ||
        context.Module.eaglerOptions.th06FocusHitbox !== (test.game === "th06") ||
        context.Module.eaglerOptions.thpracSession !== thpracSession || !files.has(runtimeResources[0].path)) {
      throw new Error(`${test.game}: eagler-touhou options were not installed`);
    }
  }
  {
    const packBytes = new Uint8Array([1, 2, 3]);
    const invalidPackBytes = new Uint8Array([1, 2]);
    const digest = Array.from(new Uint8Array(await webcrypto.subtle.digest("SHA-256", packBytes)), byte => byte.toString(16).padStart(2, "0")).join("");
    const packManifest = {
      schema: "eagler-touhou/thcrap-static-pack/1", game: test.game, language: "lang_en",
      runtimeVersion: "0123456789abcdef", files: [{ path: `/thcrap/${test.game}/test.bin`, bytes: 3, sha256: digest }]
    };
    await message({ origin: context.location.origin, source: parent, data: {
      protocol: "eagler-touhou/1", game: test.game, command: "configure", request: "static-pack",
      music: "midi", resources: [], sharedResources,
      runtimePack: { url: "http://test.local/lang_en.zip", language: "lang_en", runtimeVersion: "0123456789abcdef",
        bytes: 4, sha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef", manifest: packManifest, files: [{ path: `/thcrap/${test.game}/test.bin`, bytes: invalidPackBytes }] },
      options: { thpracEnabled: false, touchEnabled: true, unlimitedTouch: true, touchBombZoneEnabled: true, alwaysHitbox: true, th06FocusHitbox: test.game === "th06" }
    } });
    // The static-pack message is deliberately sent with a file-size mismatch;
    // the shell must reject it before writing any runtime file.
    if (files.has(`/thcrap/${test.game}/test.bin`) || !replies.some(reply => reply.request === "static-pack" && !reply.ok)) {
      throw new Error(`${test.game}: invalid static language pack was accepted`);
    }
    await message({ origin: context.location.origin, source: parent, data: {
      protocol: "eagler-touhou/1", game: test.game, command: "configure", request: "static-pack-valid",
      music: "midi", resources: [], sharedResources,
      runtimePack: { url: "http://test.local/lang_en.zip", language: "lang_en", runtimeVersion: "0123456789abcdef",
        bytes: 3, sha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef", manifest: packManifest,
        files: [{ path: `/thcrap/${test.game}/test.bin`, bytes: packBytes }] },
      options: { thpracEnabled: false, touchEnabled: true, unlimitedTouch: true, touchBombZoneEnabled: true, alwaysHitbox: true, th06FocusHitbox: test.game === "th06" }
    } });
    if (!files.has(`/thcrap/${test.game}/test.bin`) || !replies.some(reply => reply.request === "static-pack-valid" && reply.ok)) {
      throw new Error(`${test.game}: valid static language pack was not installed`);
    }
  }
  await message({ origin: context.location.origin, source: parent, data: {
    protocol: "eagler-touhou/1", game: test.game, command: "touch-controls", request: "touch-controls",
    fireEnabled: false, bombSerial: 3, escapeSerial: 4
  } });
  if (context.Module.eaglerControls.fireEnabled !== false || context.Module.eaglerControls.bombSerial !== 3 ||
      context.Module.eaglerControls.escapeSerial !== 4) {
    throw new Error(`${test.game}: hosted touch controls were not installed`);
  }
  const pointerDown = documentListeners.get("pointerdown");
  const pointerMove = documentListeners.get("pointermove");
  const pointerUp = documentListeners.get("pointerup");
  const pointerCancel = documentListeners.get("pointercancel");
  const lostPointerCapture = documentListeners.get("lostpointercapture");
  const visibilityChange = documentListeners.get("visibilitychange");
  const outside = { pointerType: "touch", pointerId: 2, target: {}, clientX: 0, clientY: 200, preventDefault() {} };
  pointerDown(outside);
  pointerMove({ ...outside, clientX: 50 });
  pointerUp({ ...outside, clientX: 50 });
  if (auxDown[0]?.id !== -1 || auxDown[0]?.x !== -0.25 || auxDown[0]?.y !== 0.5 ||
      auxMotion[0]?.id !== -1 || auxMotion[0]?.x !== -0.125 || auxMotion[0]?.y !== 0.5 ||
      auxUp[0]?.id !== -1 || auxUp[0]?.x !== -0.125 || auxUp[0]?.y !== 0.5) {
    throw new Error(`${test.game}: letterbox down/move/up was not forwarded as a full touch`);
  }

  // Canvas touches are normally handled by SDL itself. The shell only tracks
  // pointerId+1 (SDL Emscripten's exact finger-ID mapping) so a document-level
  // release can safely clear a stuck C++ role if canvas pointerup is lost.
  const native = { pointerType: "touch", pointerId: 7, target: canvas, clientX: 300, clientY: 200, preventDefault() {} };
  pointerDown(native);
  pointerMove({ ...native, clientX: 320 });
  pointerUp({ ...native, clientX: 320 });
  if (auxDown.length !== 1 || auxMotion.length !== 1 ||
      auxUp[1]?.id !== 8 || auxUp[1]?.x !== 0.55 || auxUp[1]?.y !== 0.5) {
    throw new Error(`${test.game}: native canvas touch release safety-net did not use SDL pointerId+1 mapping`);
  }

  // A lost pointer capture must be equivalent to finger release even when the
  // browser does not deliver a normal pointerup to the canvas.
  const lost = { pointerType: "touch", pointerId: 9, target: canvas, clientX: 260, clientY: 170, preventDefault() {} };
  pointerDown(lost);
  lostPointerCapture({ ...lost, clientX: Number.NaN, clientY: Number.NaN });
  if (auxUp[2]?.id !== 10 || auxUp[2]?.x !== 0.4 || auxUp[2]?.y !== 0.4) {
    throw new Error(`${test.game}: lostpointercapture did not release native canvas touch`);
  }

  // Browser lifecycle cancellation is the final fail-safe for OS gesture,
  // tab/background and WebView transitions. It clears both native and
  // letterbox tracking and asks C++ to reset all touch roles.
  pointerDown({ ...native, pointerId: 11 });
  pointerDown({ ...outside, pointerId: 12 });
  context.document.visibilityState = "hidden";
  visibilityChange();
  context.document.visibilityState = "visible";
  if (auxCancelAll !== 1) {
    throw new Error(`${test.game}: visibilitychange did not cancel all touch roles`);
  }
  // Release events after the lifecycle reset must be harmless/no-op at the
  // shell tracking layer instead of reintroducing stale state.
  const releasesBefore = auxUp.length;
  pointerCancel({ ...native, pointerId: 11 });
  pointerUp({ ...outside, pointerId: 12 });
  if (auxUp.length !== releasesBefore) {
    throw new Error(`${test.game}: release after lifecycle reset was not idempotent`);
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
    if (context.Module.touhouMusicMode !== "midi" || files.size !== 2 ||
        !files.has("/msgothic.ttc") || !files.has("/unifont.otf") ||
      replies.filter(reply => reply.request && reply.request !== "static-pack").some(reply => !reply.ok)) {
    throw new Error(`${test.game}: MIDI reconfiguration failed`);
  }
}

console.log(JSON.stringify({ shells: cases.length, configure: ["midi", "wav", "ogg"], letterbox: "full-touch", touchReleaseSafety: "canvas+lostcapture+visibility", protocol: "eagler-touhou/1" }));
