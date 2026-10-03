import { readFile } from "node:fs/promises";
import { webcrypto } from "node:crypto";
import vm from "node:vm";
import assert from "node:assert/strict";
import { PRODUCT_GAMES } from "../lib/contracts/product-catalog.mjs";
import { RUNTIME_CONFIGURE_LEGACY_MUSIC_MODES } from "../lib/contracts/runtime-protocol.mjs";
import { workspacePath } from "../lib/workspace-layout.mjs";

const cases = [
  { game: "th06", shell: process.env.EAGLER_TEST_TH06_SHELL || workspacePath("th06", "resources", "shell.html"), packs: {
    wav: [{ url: "http://test.local/music.wav", path: "/bgm/th06_01.wav" }],
    ogg: [{ url: "http://test.local/music.ogg", path: "/bgm/th06_01.ogg" }]
  } },
  { game: "th07", shell: process.env.EAGLER_TEST_TH07_SHELL || workspacePath("th07", "resources", "shell.html"), packs: {
    wav: [{ url: "http://test.local/thbgm.dat", path: "/thbgm.dat" }],
    ogg: [{ url: "http://test.local/music.ogg", path: "/bgm-ogg/th07_01.ogg" }]
  } }
];

const preloadGames = Object.entries(PRODUCT_GAMES)
  .filter(([, product]) => product.dataProvider === "emscripten-preload")
  .map(([game]) => game)
  .sort();
assert.deepEqual(cases.map(test => test.game).sort(), preloadGames,
  "preload shell execution cases must be updated when a formal emscripten-preload adapter is registered");

for (const test of cases) {
  const runtimeEpoch = 23;
  const html = await readFile(test.shell, "utf8");
  const source = html.match(/<script>\s*([\s\S]*?)<\/script>/)?.[1];
  if (!source) throw new Error(`${test.game}: inline shell script missing`);
  const listeners = new Map();
  const documentListeners = new Map();
  const files = new Map();
  const replies = [];
  const rootStyles = new Map();
  const nativeFetches = [];
  const localDataVersion = "sha256-0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  const localOggVersion = "sha256-abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";
  const localOggName = `${test.game}_01.ogg`;
  const localDataBytes = new Uint8Array([0x45, 0x41, 0x47, 0x4c]);
  const localOggBytes = new Uint8Array([0x4f, 0x67, 0x67, 0x53]);
  const canvas = { addEventListener() {}, focus() {},
    getBoundingClientRect() { return { left: 100, top: 50, width: 400, height: 300 }; } };
  const status = { textContent: "" };
  const parent = { postMessage(message) { replies.push(message); } };
  let delayBackground = false;
  let releaseBackground;
  const backgroundGate = new Promise(resolve => { releaseBackground = resolve; });
  const context = {
    console, URL, URLSearchParams, Uint8Array, TextDecoder, Request, Response, AbortController, setTimeout, clearTimeout, performance, crypto: webcrypto,
    innerWidth: 640, innerHeight: 480,
    navigator: { userAgent: "Desktop Test Browser", maxTouchPoints: 0, userAgentData: { mobile: false } },
    location: { search: `?hosted=1&runtimeEpoch=${runtimeEpoch}&asset=${encodeURIComponent(localDataVersion)}&oggAsset=${encodeURIComponent(localOggVersion)}`, origin: "http://test.local",
      href: `http://test.local/game.html?hosted=1&runtimeEpoch=${runtimeEpoch}&asset=${encodeURIComponent(localDataVersion)}&oggAsset=${encodeURIComponent(localOggVersion)}` },
    parent,
    caches: {
      async match(url) {
        const target = String(url);
        const expectedData = `http://test.local/.eagler-local/game-data/${test.game}/${encodeURIComponent(localDataVersion)}/${test.game}.data`;
        const expectedOgg = `http://test.local/.eagler-local/ogg/${test.game}/${encodeURIComponent(localOggVersion)}/${localOggName}`;
        if (target === expectedData) return new Response(localDataBytes, { status: 200, headers: { "X-Eagler-Asset-Source": "local-import" } });
        if (target === expectedOgg) return new Response(localOggBytes, { status: 200, headers: { "X-Eagler-Asset-Source": "local-import" } });
        return undefined;
      }
    },
    document: {
      visibilityState: "visible",
      documentElement: {
        clientWidth: 1542,
        clientHeight: 852,
        style: { setProperty(name, value) { rootStyles.set(name, value); } }
      },
      getElementById(id) { return id === "canvas" ? canvas : status; },
      addEventListener(type, listener) { documentListeners.set(type, listener); }
    },
    fetch: async url => {
      nativeFetches.push(String(url));
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
  {
    const before = nativeFetches.length;
    const localResponse = await context.fetch(`http://test.local/${test.game}.data?v=runtime-code-version`);
    if (nativeFetches.length !== before ||
        !Buffer.from(await localResponse.arrayBuffer()).equals(Buffer.from(localDataBytes))) {
      throw new Error(`${test.game}: exact-version locally imported game data did not bypass native fetch`);
    }
    const localOggResponse = await context.fetch(`http://test.local/assets/${localOggName}?v=network-version`);
    if (nativeFetches.length !== before ||
        !Buffer.from(await localOggResponse.arrayBuffer()).equals(Buffer.from(localOggBytes))) {
      throw new Error(`${test.game}: exact-version locally imported OGG did not bypass native fetch`);
    }
    await context.fetch("http://test.local/unrelated.bin");
    if (nativeFetches.length !== before + 1 || !nativeFetches.at(-1)?.endsWith("/unrelated.bin")) {
      throw new Error(`${test.game}: local asset fetch bridge intercepted an unrelated resource`);
    }
  }
  if (rootStyles.get("--touhou-canvas-width") !== "1136px" ||
      rootStyles.get("--touhou-canvas-height") !== "852px") {
    throw new Error(`${test.game}: wide/short ordinary-window canvas did not contain to 1136x852`);
  }
  context.document.documentElement.clientWidth = 600;
  context.document.documentElement.clientHeight = 900;
  listeners.get("resize")?.();
  if (rootStyles.get("--touhou-canvas-width") !== "600px" ||
      rootStyles.get("--touhou-canvas-height") !== "450px") {
    throw new Error(`${test.game}: narrow/tall ordinary-window canvas did not contain to 600x450`);
  }
  if (typeof context.EaglerTouhouGameExited !== "function") throw new Error(`${test.game}: exit bridge missing`);
  await context.EaglerTouhouGameExited(1);
  if (!replies.some(reply => reply.event === "exit" && reply.status === "success")) {
    throw new Error(`${test.game}: successful game exit was not forwarded`);
  }
  if (typeof context.EaglerTouhouFirstFrame !== "function") throw new Error(`${test.game}: first-frame bridge missing`);
  context.EaglerTouhouFirstFrame();
  if (!replies.some(reply => reply.event === "first-frame")) {
    throw new Error(`${test.game}: first rendered frame was not forwarded`);
  }
  if (!replies.some(reply => reply.event === "runtime-info" && typeof reply.renderer === "string")) {
    throw new Error(`${test.game}: renderer diagnostics were not forwarded with the first frame`);
  }
  context.EaglerTouhouFrameHealth(119.4, 23.5);
  if (!replies.some(reply => reply.event === "frame-health" && reply.fps === 119.4 && reply.maxGapMs === 23.5)) {
    throw new Error(`${test.game}: presentation health was not forwarded`);
  }
  context.EaglerTouhouAudioHealth(57.0, 31.0, true);
  if (!replies.some(reply => reply.event === "audio-health" && reply.queuedMs === 57.0 &&
      reply.minQueuedMs === 31.0 && reply.robust === true && reply.backend === "script" && reply.underruns === 0)) {
    throw new Error(`${test.game}: audio queue health was not forwarded`);
  }
  const rawMessage = listeners.get("message");
  if (!rawMessage) throw new Error(`${test.game}: message listener missing`);
  const message = event => rawMessage({ ...event, data: { epoch: runtimeEpoch, ...event.data } });
  const beforeStaleEpoch = replies.length;
  await rawMessage({ origin: context.location.origin, source: parent, data: {
    protocol: "eagler-touhou/1", game: test.game, epoch: runtimeEpoch - 1,
    command: "keyboard-clear", request: "stale-epoch"
  } });
  assert.equal(replies.length, beforeStaleEpoch, `${test.game}: stale navigation epoch command must be ignored`);
  const auxDown = [];
  const auxMotion = [];
  const auxUp = [];
  let auxCancelAll = 0;
  const thpracMouse = [];
  const audioActive = [];
  context.Module._TouhouAuxTouchDown = (id, x, y) => auxDown.push({ id, x, y });
  context.Module._TouhouAuxTouchMotion = (id, x, y) => auxMotion.push({ id, x, y });
  context.Module._TouhouAuxTouchUp = (id, x, y) => auxUp.push({ id, x, y });
  context.Module._TouhouAuxTouchCancelAll = () => { auxCancelAll++; };
  context.Module._TouhouThpracMouseEvent = (type, x, y) => thpracMouse.push({ type, x, y });
  context.Module._TouhouWebSetAudioActive = active => audioActive.push(active);
  const sharedResources = [
    { url: "http://test.local/msgothic.ttc", path: "/msgothic.ttc" },
    { url: "http://test.local/unifont.otf", path: "/unifont.otf" },
  ];
  const runtimeResources = [{ url: "http://test.local/translation.bin", path: `/thcrap/${test.game}/translation.bin`, size: 1 }];
  for (const mode of [...RUNTIME_CONFIGURE_LEGACY_MUSIC_MODES, "ogg"]) {
    const resources = test.packs[mode];
    await message({ origin: context.location.origin, source: parent, data: {
      protocol: "eagler-touhou/1", game: test.game, command: "configure", request: mode, music: mode, resources, sharedResources, runtimeResources,
      options: { thpracEnabled: true, limitPresentationTo60: true, touchEnabled: true, touchMovementMode: "touch-unlimited", doubleTapBombEnabled: true, alwaysHitbox: true, multiplayerLocalPlayerVisibility: true, focusHitboxEnabled: true, oggDecodeMode: mode === "ogg" ? "full" : "stream" }
    } });
    if (context.Module.touhouMusicMode !== mode || !resources.every(resource => files.has(resource.path))) {
      throw new Error(`${test.game}: ${mode.toUpperCase()} resources were not installed`);
    }
    if (!context.Module.eaglerOptions.thpracEnabled ||
        !context.Module.eaglerOptions.limitPresentationTo60 ||
        !context.Module.eaglerOptions.touchEnabled || context.Module.eaglerOptions.touchMovementMode !== "touch-unlimited" || !context.Module.eaglerOptions.unlimitedTouch ||
        !context.Module.eaglerOptions.doubleTapBombEnabled ||
        context.Module.eaglerOptions.touchBombZoneEnabled !== false ||
        !context.Module.eaglerOptions.alwaysHitbox ||
        !context.Module.eaglerOptions.enhanceLocalPlayerVisibility ||
        context.Module.eaglerOptions.focusHitboxEnabled !== (test.game === "th06") ||
        context.Module.eaglerOptions.netplayMode !== null || context.Module.eaglerOptions.netplayLoadouts !== null ||
        context.Module.eaglerOptions.oggDecodeMode !== (mode === "ogg" ? "full" : "stream") || !files.has(runtimeResources[0].path)) {
      throw new Error(`${test.game}: eagler-touhou options were not installed`);
    }
  }
  const legacyThpracSession = { schema: "eagler-touhou/thprac-session/1", game: test.game, params: { mode: 1, stage: 0, section: 1 } };
  await message({ origin: context.location.origin, source: parent, data: {
    protocol: "eagler-touhou/1", game: test.game, command: "configure", request: "legacy-thprac-session", music: "none", resources: [], sharedResources,
    options: { thpracSession: legacyThpracSession }
  } });
  if (context.Module.eaglerOptions.thpracSession !== legacyThpracSession) {
    throw new Error(`${test.game}: legacy thpracSession read compatibility was lost`);
  }
  await message({ origin: context.location.origin, source: parent, data: {
    protocol: "eagler-touhou/1", game: test.game, command: "configure", request: "legacy-focus-hitbox", music: "none", resources: [], sharedResources,
    options: { th06FocusHitbox: true }
  } });
  if (context.Module.eaglerOptions.focusHitboxEnabled !== (test.game === "th06")) {
    throw new Error(`${test.game}: legacy TH06-named focus-hitbox alias escaped its compatibility boundary`);
  }
  {
    const keyMessage = (request, down, code, key, keyCode) => message({
      origin: context.location.origin, source: parent, data: {
        protocol: "eagler-touhou/1", game: test.game, command: "keyboard", request,
        down, code, key, keyCode, location: 0
      }
    });
    await keyMessage("thprac-backspace-down", true, "Backspace", "Backspace", 8);
    if (context.Module.eaglerControls.thpracKeyboardBits !== 1) throw new Error(`${test.game}: Backspace did not enter thprac browser bitset`);
    await keyMessage("thprac-backspace-up", false, "Backspace", "Backspace", 8);
    if (context.Module.eaglerControls.thpracKeyboardBits !== 0) throw new Error(`${test.game}: Backspace did not leave thprac browser bitset`);
    await keyMessage("thprac-f7-down", true, "F7", "F7", 118);
    if (context.Module.eaglerControls.thpracKeyboardBits !== (1 << 7)) throw new Error(`${test.game}: F7 did not enter thprac browser bitset`);
    await keyMessage("thprac-f7-up", false, "F7", "F7", 118);
    if (context.Module.eaglerControls.thpracKeyboardBits !== 0) throw new Error(`${test.game}: F7 did not leave thprac browser bitset`);
    const beforeCancel = auxCancelAll;
    await message({ origin: context.location.origin, source: parent, data: {
      protocol: "eagler-touhou/1", game: test.game, command: "touch-cancel", request: "touch-cancel"
    } });
    if (auxCancelAll !== beforeCancel + 1 || !replies.some(reply => reply.request === "touch-cancel" && reply.ok)) {
      throw new Error(`${test.game}: touch-cancel did not clear gameplay touch ownership`);
    }
    for (const [type, expected] of [["move", 0], ["down", 1], ["up", 2]]) {
      await message({ origin: context.location.origin, source: parent, data: {
        protocol: "eagler-touhou/1", game: test.game, command: "thprac-mouse",
        type, x: 123.5, y: 234.5
      } });
      if (thpracMouse.at(-1)?.type !== expected || Math.abs(thpracMouse.at(-1)?.x - 37.6) > 1e-6 ||
          Math.abs(thpracMouse.at(-1)?.y - 295.2) > 1e-6) {
        throw new Error(`${test.game}: thprac mouse ${type} did not reach the native SDL/ImGui bridge in 640x480 game coordinates`);
      }
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
      options: { thpracEnabled: false, touchEnabled: true, unlimitedTouch: true, touchBombZoneEnabled: true, alwaysHitbox: true, focusHitboxEnabled: test.game === "th06" }
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
      options: { thpracEnabled: false, touchEnabled: true, unlimitedTouch: true, touchBombZoneEnabled: true, alwaysHitbox: true, focusHitboxEnabled: test.game === "th06" }
    } });
    if (!files.has(`/thcrap/${test.game}/test.bin`) || !replies.some(reply => reply.request === "static-pack-valid" && reply.ok)) {
      throw new Error(`${test.game}: valid static language pack was not installed`);
    }
  }
  await message({ origin: context.location.origin, source: parent, data: {
    protocol: "eagler-touhou/1", game: test.game, command: "touch-controls", request: "touch-controls",
    fireEnabled: false, focusEnabled: false, bombSerial: 3, escapeSerial: 4, joystickX: 23456, joystickY: -12345,
    touchSensitivity: 237
  } });
  if (context.Module.eaglerControls.fireEnabled !== false || context.Module.eaglerControls.bombSerial !== 3 ||
      context.Module.eaglerControls.escapeSerial !== 4 || context.Module.eaglerControls.joystickX !== 23456 || context.Module.eaglerControls.joystickY !== -12345 ||
      context.Module.eaglerOptions.touchSensitivity !== 237) {
    throw new Error(`${test.game}: hosted touch controls were not installed`);
  }
  const repliesBeforeLiveTouch = replies.length;
  await message({ origin: context.location.origin, source: parent, data: {
    protocol: "eagler-touhou/1", game: test.game, command: "touch-controls",
    fireEnabled: true, focusEnabled: true, bombSerial: 5, escapeSerial: 6, joystickX: -12000, joystickY: 16000,
    touchSensitivity: 155
  } });
  if (context.Module.eaglerControls.fireEnabled !== true || context.Module.eaglerControls.focusEnabled !== true ||
      context.Module.eaglerControls.bombSerial !== 5 || context.Module.eaglerControls.escapeSerial !== 6 ||
      context.Module.eaglerControls.joystickX !== -12000 || context.Module.eaglerControls.joystickY !== 16000 ||
      context.Module.eaglerOptions.touchSensitivity !== 155) {
    throw new Error(`${test.game}: request-less live touch controls were not installed`);
  }
  if (replies.length !== repliesBeforeLiveTouch) {
    throw new Error(`${test.game}: request-less live touch controls unexpectedly generated an ACK`);
  }
  await message({ origin: context.location.origin, source: parent, data: {
    protocol: "eagler-touhou/1", game: test.game, command: "keyboard",
    down: true, code: "KeyZ", key: "z", keyCode: 90, location: 0
  } });
  if (context.Module.eaglerControls.keyboardBits !== 1) {
    throw new Error(`${test.game}: hosted KeyZ fallback was not asserted`);
  }
  await message({ origin: context.location.origin, source: parent, data: {
    protocol: "eagler-touhou/1", game: test.game, command: "keyboard",
    down: false, code: "Unidentified", key: "z", keyCode: 90, location: 0
  } });
  if (context.Module.eaglerControls.keyboardBits !== 0) {
    throw new Error(`${test.game}: hosted KeyZ fallback was not released`);
  }
  await message({ origin: context.location.origin, source: parent, data: {
    protocol: "eagler-touhou/1", game: test.game, command: "keyboard",
    down: true, code: "ArrowUp", key: "ArrowUp", keyCode: 38, location: 0
  } });
  if (context.Module.eaglerControls.keyboardBits !== (1 << 4)) {
    throw new Error(`${test.game}: hosted ArrowUp fallback was not asserted`);
  }
  await message({ origin: context.location.origin, source: parent, data: {
    protocol: "eagler-touhou/1", game: test.game, command: "keyboard",
    down: false, code: "Unidentified", key: "Unidentified", keyCode: 38, location: 0
  } });
  if (context.Module.eaglerControls.keyboardBits !== 0) {
    throw new Error(`${test.game}: legacy DOM keyCode ArrowUp fallback was not released`);
  }
  const restartBit = 1 << (test.game === "th06" ? 13 : 14);
  await message({ origin: context.location.origin, source: parent, data: {
    protocol: "eagler-touhou/1", game: test.game, command: "keyboard",
    down: true, code: "KeyR", key: "r", keyCode: 82, location: 0
  } });
  if (context.Module.eaglerControls.keyboardBits !== restartBit) {
    throw new Error(`${test.game}: hosted KeyR restart was not asserted`);
  }
  await message({ origin: context.location.origin, source: parent, data: {
    protocol: "eagler-touhou/1", game: test.game, command: "keyboard",
    down: false, code: "KeyR", key: "r", keyCode: 82, location: 0
  } });
  if (context.Module.eaglerControls.keyboardBits !== 0) {
    throw new Error(`${test.game}: hosted KeyR restart was not released`);
  }
  await message({ origin: context.location.origin, source: parent, data: {
    protocol: "eagler-touhou/1", game: test.game, command: "keyboard",
    down: false, code: "Escape", key: "Escape", keyCode: 27, location: 0
  } });
  if (context.Module.eaglerControls.keyboardBits !== 0 ||
      context.Module.eaglerControls.keyboardPulseBits !== (1 << 3)) {
    throw new Error(`${test.game}: keyup-only Escape did not produce a one-shot browser pulse`);
  }
  await message({ origin: context.location.origin, source: parent, data: {
    protocol: "eagler-touhou/1", game: test.game, command: "keyboard",
    down: true, code: "Unidentified", key: "Unidentified", keyCode: 38, location: 0
  } });
  if (context.Module.eaglerControls.keyboardBits !== (1 << 4)) {
    throw new Error(`${test.game}: legacy DOM keyCode ArrowUp fallback was not asserted`);
  }
  await message({ origin: context.location.origin, source: parent, data: {
    protocol: "eagler-touhou/1", game: test.game, command: "keyboard-clear"
  } });
  if (context.Module.eaglerControls.keyboardBits !== 0 || context.Module.eaglerControls.keyboardPulseBits !== 0) {
    throw new Error(`${test.game}: hosted keyboard-clear left a stuck key`);
  }
  if (process.env[`EAGLER_TEST_${test.game.toUpperCase()}_SHELL`] || context.Module.eaglerResetBrowserKeyboard) {
    assert.equal(typeof context.Module.eaglerResetBrowserKeyboard, "function", `${test.game}: full owner reset hook`);
    await message({ origin: context.location.origin, source: parent, data: {
      protocol: "eagler-touhou/1", game: test.game, command: "keyboard",
      down: true, code: "ShiftLeft", key: "Shift", keyCode: 16, location: 1
    } });
    context.Module.eaglerResetBrowserKeyboard();
    await message({ origin: context.location.origin, source: parent, data: {
      protocol: "eagler-touhou/1", game: test.game, command: "keyboard",
      down: true, code: "KeyZ", key: "z", keyCode: 90, location: 0
    } });
    assert.equal(context.Module.eaglerControls.keyboardBits, 1, `${test.game}: reset Map must not republish Focus`);
    context.Module.eaglerResetBrowserKeyboard();
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
  const cancelsBeforeLifecycle = auxCancelAll;
  pointerDown({ ...native, pointerId: 11 });
  pointerDown({ ...outside, pointerId: 12 });
  context.document.visibilityState = "hidden";
  visibilityChange();
  context.document.visibilityState = "visible";
  visibilityChange();
  if (auxCancelAll !== cancelsBeforeLifecycle + 1) {
    throw new Error(`${test.game}: visibilitychange did not cancel all touch roles`);
  }
  if (audioActive.at(-2) !== 0 || audioActive.at(-1) !== 1) {
    throw new Error(`${test.game}: visibilitychange did not suspend/resume native audio ownership`);
  }
  listeners.get("pagehide")?.();
  listeners.get("pageshow")?.();
  if (audioActive.at(-2) !== 0 || audioActive.at(-1) !== 1) {
    throw new Error(`${test.game}: pagehide/pageshow did not preserve Safari audio lifecycle`);
  }
  // Release events after the lifecycle reset must be harmless/no-op at the
  // shell tracking layer instead of reintroducing stale state.
  const releasesBefore = auxUp.length;
  pointerCancel({ ...native, pointerId: 11 });
  pointerUp({ ...outside, pointerId: 12 });
  if (auxUp.length !== releasesBefore) {
    throw new Error(`${test.game}: release after lifecycle reset was not idempotent`);
  }
  const auxDownBeforeBridge = auxDown.length;
  const auxMotionBeforeBridge = auxMotion.length;
  const auxUpBeforeBridge = auxUp.length;
  for (const [type, x, y] of [["down", 0.5, 0.5], ["move", 0.625, 0.375], ["up", 0.625, 0.375]]) {
    await message({ origin: context.location.origin, source: parent, data: {
      protocol: "eagler-touhou/1", game: test.game, command: "direct-touch", type, id: -1000001, x, y
    } });
  }
  const bridgedDown = auxDown[auxDownBeforeBridge];
  const bridgedMove = auxMotion[auxMotionBeforeBridge];
  const bridgedUp = auxUp[auxUpBeforeBridge];
  if (bridgedDown?.id !== -1000001 || Math.abs(bridgedDown.x - 0.55) > 1e-6 || Math.abs(bridgedDown.y - (190 / 300)) > 1e-6 ||
      bridgedMove?.id !== -1000001 || Math.abs(bridgedMove.x - 0.75) > 1e-6 || Math.abs(bridgedMove.y - (130 / 300)) > 1e-6 ||
      bridgedUp?.id !== -1000001 || Math.abs(bridgedUp.x - 0.75) > 1e-6 || Math.abs(bridgedUp.y - (130 / 300)) > 1e-6) {
    throw new Error(`${test.game}: hosted direct-touch bridge did not map host viewport coordinates into Runtime canvas coordinates`);
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
  await message({ origin: context.location.origin, source: parent, data: {
    protocol: "eagler-touhou/1", game: test.game, command: "configure", request: "none", music: "none", resources: [], sharedResources,
    options: { oggDecodeMode: "stream" }
  } });
  if (context.Module.touhouMusicMode !== "none") throw new Error(`${test.game}: no-BGM mode was not installed`);
  {
    const netplayLoadouts = test.game === "th06"
      ? [{ character: 0, shot: 0 }, { character: 1, shot: 1 }, { character: 0, shot: 1 }]
      : [{ character: 0, shot: 0 }, { character: 1, shot: 1 }, { character: 2, shot: 0 }];
    await message({ origin: context.location.origin, source: parent, data: {
      protocol: "eagler-touhou/1", game: test.game, command: "configure", request: "lan-options",
      music: "none", resources: [], sharedResources,
      options: {
        netplayMode: "lan", netplayUrl: "ws://127.0.0.1:18142/?room=contract&player=1",
        netplayPlayer: 1, netplayPlayerCount: 3, netplaySeed: 19005,
        netplayDifficulty: 4, netplayLoadouts,
      },
    } });
    if (context.Module.eaglerOptions.netplayMode !== "lan" ||
        context.Module.eaglerOptions.netplayUrl !== "ws://127.0.0.1:18142/?room=contract&player=1" ||
        context.Module.eaglerOptions.netplayPlayer !== 1 || context.Module.eaglerOptions.netplayPlayerCount !== 3 ||
        context.Module.eaglerOptions.netplaySeed !== 19005 ||
        context.Module.eaglerOptions.netplayDifficulty !== 4 ||
        JSON.stringify(context.Module.eaglerOptions.netplayLoadouts) !== JSON.stringify(netplayLoadouts)) {
      throw new Error(`${test.game}: production LAN options were not installed`);
    }
  }
}

console.log(JSON.stringify({ shells: cases.length, configure: ["midi", "ogg-stream", "ogg-full", "none"], legacyConfigureMusic: RUNTIME_CONFIGURE_LEGACY_MUSIC_MODES, letterbox: "full-touch", touchReleaseSafety: "canvas+lostcapture+visibility", protocol: "eagler-touhou/1" }));
