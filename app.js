const manifest = await fetch("games.json", { cache: "no-store" }).then(response => {
  if (!response.ok) throw new Error(`games.json: HTTP ${response.status}`);
  return response.json();
});

const protocol = manifest.protocol;
if (protocol !== "eagler-touhou/1" || typeof manifest.shared?.font !== "string" ||
    !manifest.games?.th06 || !manifest.games?.th07 ||
    !Object.values(manifest.games).every(item => typeof item.runtime === "string" && item.music?.midi)) {
  throw new Error("games.json 的协议或游戏清单无效");
}
const defaultOptions = Object.freeze({
  th06FocusHitbox: false,
  touchEnabled: false,
  unlimitedTouch: false,
  alwaysHitbox: false
});
const state = {
  game: "th06", hasSelection: false, music: "ogg", ready: false, launched: false,
  request: 0, pending: new Map(), source: "", mobileOpen: false,
  options: { ...defaultOptions }
};
const touchControls = { fireEnabled: true, bombSerial: 0 };
const touchHelpSeenKey = "eagler-touch-help-seen-v7";
const preferenceKey = gameId => `eagler-touhou-game-options-v1-${gameId}`;
function restoreGamePreferences(gameId) {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(preferenceKey(gameId)) || "null"); } catch {}
  const options = { ...defaultOptions };
  for (const name of Object.keys(defaultOptions)) {
    if (typeof saved?.options?.[name] === "boolean") options[name] = saved.options[name];
  }
  if (!options.touchEnabled) options.unlimitedTouch = false;
  state.options = options;
  state.music = ["midi", "wav", "ogg"].includes(saved?.music) && manifest.games[gameId].music[saved.music]
    ? saved.music : "ogg";
}
function saveGamePreferences() {
  try {
    localStorage.setItem(preferenceKey(state.game), JSON.stringify({
      music: state.music,
      options: Object.fromEntries(Object.keys(defaultOptions).map(name => [name, state.options[name]]))
    }));
  } catch {}
}
const loaded = {
  th06: localStorage.getItem("et-loaded-th06") === "1",
  th07: localStorage.getItem("et-loaded-th07") === "1"
};
const $ = selector => document.querySelector(selector);
const frame = $("#gameFrame");
const player = $("#player");
const maxImportBytes = 128 * 1024 * 1024;
const maxStoredFileBytes = 64 * 1024 * 1024;
let midiSynth = null;
let gameKeyWindow = null;
let fullscreenChordActive = false;
const playerHistoryKey = "eaglerTouhouPlayer";
const routedGame = new URLSearchParams(location.search).get("game");
const debugHarness = new URLSearchParams(location.search).get("debug");
restoreGamePreferences(state.game);
if (routedGame === "th06" || routedGame === "th07") {
  state.game = routedGame;
  restoreGamePreferences(state.game);
  state.hasSelection = true;
  if (!history.state?.[playerHistoryKey]) {
    const gameUrl = new URL(location.href);
    const homeUrl = new URL(location.href); homeUrl.searchParams.delete("game");
    history.replaceState({ ...(history.state || {}), [playerHistoryKey]: false }, "", homeUrl);
    history.pushState({ [playerHistoryKey]: true, game: routedGame }, "", gameUrl);
  }
}
const setStatus = text => { $("#status").textContent = text; };
const setPlayerStatus = text => { $("#playerStatus").textContent = text; };
let toastTimer = null;
let transferSpeed = 0;
let transferMode = "";
let transferHideTimer = null;
let musicNoticeTimer = null;
let guidePlaybackTimer = null;
let guideShotTimer = null;
function showToast(text, ms = 2500) {
  const toast = $("#toast");
  toast.textContent = text;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), ms);
}
function showStartupError(error, context = "启动失败") {
  if (state.launched) return;
  const detail = error?.stack || error?.message || String(error);
  $("#startupErrorText").textContent = `[${new Date().toLocaleString()}] ${context}\n${detail}`;
  $("#startupError").hidden = false;
}
function clearStartupError() { $("#startupError").hidden = true; $("#startupErrorText").textContent = ""; }
function clock(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "--:--";
  const value = Math.min(Math.ceil(seconds), 99 * 60 + 59);
  return `${Math.floor(value / 60).toString().padStart(2, "0")}:${(value % 60).toString().padStart(2, "0")}`;
}
function showTransfer(message) {
  const panel = $("#transfer");
  clearTimeout(transferHideTimer); panel.hidden = false;
  const loaded = Number(message.loaded) || 0;
  const total = Number(message.total) || 0;
  const instant = Number(message.speed) || 0;
  if (transferMode !== message.mode) { transferMode = message.mode; transferSpeed = 0; }
  transferSpeed = transferSpeed ? transferSpeed * .72 + instant * .28 : instant;
  $("#transferTitle").textContent = message.mode === "ogg" ? "BGM DOWNLOADING..." : "NOW LOADING...";
  $("#transferLabel").textContent = message.mode === "ogg" ? "OGG DATA" : "GAME DATA";
  $("#transferAmount").textContent = total
    ? `${(loaded / 1048576).toFixed(1)} / ${(total / 1048576).toFixed(1)} MiB`
    : `${(loaded / 1048576).toFixed(1)} MiB`;
  $("#transferBar").style.width = total ? `${Math.min(100, loaded / total * 100).toFixed(1)}%` : "0%";
  $("#transferSpeed").textContent = transferSpeed >= 1048576
    ? `${(transferSpeed / 1048576).toFixed(1)} MiB/s`
    : `${Math.round(transferSpeed / 1024)} KiB/s`;
  $("#transferEta").textContent = total && transferSpeed > 1024 ? clock((total - loaded) / transferSpeed) : "--:--";
}
function transferFailure(message) {
  if (state.launched) return;
  const panel = $("#transfer"); panel.hidden = false;
  const warning = $("#transferWarning"); warning.hidden = false;
  warning.textContent = `OGG DOWNLOAD FAILED (${message.failed || 1})\nCURRENT AUDIO: MIDI\n当前正在播放 MIDI，并非 OGG 音质`;
  $("#transferRetry").hidden = false;
}
function transferComplete(message) {
  showTransfer({ ...message, mode: "ogg", speed: 0 });
  $("#transferTitle").textContent = "BGM DOWNLOAD COMPLETE";
  $("#transferWarning").hidden = true; $("#transferRetry").hidden = true;
  transferHideTimer = setTimeout(() => { $("#transfer").hidden = true; }, 2200);
}
function showMidiFallback() {
  const notice = $("#musicNotice");
  clearTimeout(musicNoticeTimer);
  notice.classList.remove("show");
  requestAnimationFrame(() => {
    notice.classList.add("show");
    musicNoticeTimer = setTimeout(() => notice.classList.remove("show"), 2000);
  });
}

function emitGuideShotPair() {
  const help = $("#touchHelp");
  const panel = $(".focus-demo");
  const body = panel.querySelector(".guide-demo-body");
  if (help.hidden || body.hidden || !panel.classList.contains("is-playing") ||
      panel.classList.contains("is-finished") || document.hidden ||
      matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const stage = $(".focus-stage");
  const layer = $(".shot-stream");
  const playerRect = $(".demo-player").getBoundingClientRect();
  const stageRect = stage.getBoundingClientRect();
  if (!stageRect.width || !stageRect.height) return;

  const focused = Number.parseFloat(getComputedStyle($(".finger-focus")).opacity) > .45;
  const centerX = playerRect.left - stageRect.left + playerRect.width / 2;
  const startY = playerRect.top - stageRect.top + 3;
  const columnGap = focused ? 3 : 9;
  for (const side of [-1, 1]) {
    const shot = document.createElement("i");
    shot.className = "demo-shot";
    shot.style.left = `${centerX + side * columnGap}px`;
    shot.style.top = `${startY}px`;
    layer.append(shot);
    const animation = shot.animate([
      { transform: "translate(-50%,-50%) rotate(45deg)", opacity: 0 },
      { offset: .08, transform: "translate(-50%,-50%) rotate(105deg)", opacity: 1 },
      { transform: `translate(-50%,-${startY + 18}px) rotate(765deg)`, opacity: 1 }
    ], { duration: 760, easing: "linear" });
    animation.onfinish = () => shot.remove();
  }
}

function startGuideShots() {
  clearInterval(guideShotTimer);
  emitGuideShotPair();
  guideShotTimer = setInterval(emitGuideShotPair, 140);
}

function stopGuideShots() {
  clearInterval(guideShotTimer);
  guideShotTimer = null;
}

const guideDurations = { focus: 7000, menu: 12000, dialogue: 4000 };

function collapseTouchGuides() {
  clearTimeout(guidePlaybackTimer);
  guidePlaybackTimer = null;
  stopGuideShots();
  $(".shot-stream").replaceChildren();
  document.querySelectorAll("[data-guide-tab]").forEach(tab => tab.setAttribute("aria-expanded", "false"));
  document.querySelectorAll("[data-guide-panel]").forEach(panel => {
    panel.querySelector(".guide-demo-body").hidden = true;
    panel.classList.remove("is-playing", "is-finished");
  });
}

function playTouchGuide(name) {
  collapseTouchGuides();
  const tab = document.querySelector(`[data-guide-tab="${name}"]`);
  const panel = document.querySelector(`[data-guide-panel="${name}"]`);
  if (!tab || !panel) return;
  tab.setAttribute("aria-expanded", "true");
  panel.querySelector(".guide-demo-body").hidden = false;
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
    panel.classList.add("is-finished");
    return;
  }
  void panel.offsetWidth;
  panel.classList.add("is-playing");
  if (name === "focus") startGuideShots();
  guidePlaybackTimer = setTimeout(() => {
    panel.classList.add("is-finished");
    if (name === "focus") {
      stopGuideShots();
      $(".shot-stream").replaceChildren();
    }
    guidePlaybackTimer = null;
  }, guideDurations[name]);
}

function game() { return manifest.games[state.game]; }
function runtimeUrl() { return game().runtime; }
function musicPackage() { return game().music[state.music]; }
async function launchConfiguredRuntime() {
  clearStartupError(); prepareMidi(); await ensureRuntime(true);
  setPlayerStatus(`准备 ${state.music.toUpperCase()} 音乐资源…`);
  await send("configure", {
    music: state.music, resources: selectedMusicResources(), runtimeResources: [],
    sharedResources: sharedResources(),
    options: { ...state.options, debugHarness,
      touchBombZoneEnabled: false,
      th06FocusHitbox: state.game === "th06" && state.options.th06FocusHitbox }
  }, 30 * 60 * 1000);
  await send("launch"); state.launched = true; clearStartupError();
  await syncTouchControls(); setPlayerStatus("运行中"); frame.focus();
}
function chooseDefaultMusic() {
  const packages = game().music;
  if (packages[state.music]) return;
  state.music = ["ogg", "wav", "midi"].find(name => packages[name]) || "midi";
  saveGamePreferences();
}
function render() {
  chooseDefaultMusic();
  $("#main").classList.toggle("has-selection", state.hasSelection);
  const tools = $(".tools");
  tools.classList.toggle("mobile-open", state.mobileOpen);
  tools.setAttribute("aria-hidden", String(!state.hasSelection));
  tools.inert = !state.hasSelection;
  document.querySelectorAll(".game").forEach(card => {
    const selected = state.hasSelection && card.dataset.game === state.game;
    card.classList.toggle("selected", selected);
    card.setAttribute("aria-pressed", String(selected));
  });
  $("#gameId").textContent = state.game.toUpperCase();
  $("#gameTitle").textContent = game().title;
  $("#launchText").textContent = `打开 ${game().title}`;
  $("#th06HitboxOption").hidden = state.game !== "th06";
  $("#mobileOptions").classList.toggle("open", state.mobileOpen);
  $("#mobileOptionsToggle").setAttribute("aria-expanded", String(state.mobileOpen));
  const switches = { th06HitboxToggle: state.options.th06FocusHitbox, touchToggle: state.options.touchEnabled, unlimitedTouchToggle: state.options.unlimitedTouch, alwaysHitboxToggle: state.options.alwaysHitbox };
  for (const [id, enabled] of Object.entries(switches)) {
    $("#" + id).setAttribute("aria-checked", String(enabled));
    $("#" + id).classList.toggle("on", enabled);
  }
  $("#unlimitedTouchToggle").disabled = !state.options.touchEnabled;
  player.classList.toggle("touch-enabled", state.options.touchEnabled);
  const fireButton = $("#touchFire");
  fireButton.classList.toggle("is-on", touchControls.fireEnabled);
  fireButton.setAttribute("aria-pressed", String(touchControls.fireEnabled));
  fireButton.querySelector("strong").textContent = "开火";
  fireButton.querySelector("small").textContent = touchControls.fireEnabled ? "已开启" : "已关闭";
  document.querySelectorAll("[data-music]").forEach(button => {
    const name = button.dataset.music;
    if (name === state.music) button.hidden = false;
    button.disabled = !game().music[name];
    button.classList.toggle("sel", name === state.music);
    button.title = game().music[name] ? "" : "此游戏尚无该音乐资源包";
  });
  document.querySelectorAll("[data-action]").forEach(button => {
    const gameLoaded = loaded[state.game];
    button.disabled = !gameLoaded;
    button.title = gameLoaded ? "" : "先在浏览器中打开一次游戏，才能使用此功能";
  });
}

function setOption(name, value) {
  if (state.options[name] === value) return;
  state.options[name] = value;
  if (name === "touchEnabled" && !value) state.options.unlimitedTouch = false;
  saveGamePreferences();
  resetRuntime();
  render();
}

function confirmInputWarnings() {
  const pureTouch = navigator.maxTouchPoints > 0 && !matchMedia("(any-pointer: fine)").matches;
  const mobile = navigator.userAgentData?.mobile === true || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
  if (!state.options.touchEnabled && (pureTouch || mobile)) {
    return confirm("当前未启用手机适配。\n\n你必须连接实体键盘才能游玩。\n\n仍要继续启动吗？");
  }
  if (state.options.touchEnabled) {
    const accepted = confirm("触控并非原游戏设计。\n\n本局实际使用触控操作后：\n· 成绩通常不会被社区规则认可（游戏内成绩仍正常记录）\n· 结算中的处理落率固定为 100%\n· 无法记录 Replay\n\n确认使用触控启动吗？");
    if (!accepted) return false;
  }
  if (state.options.unlimitedTouch) {
    return confirm("无限制触控属于一种「作弊」。\n\n它会显著降低游戏难度，并破坏原有的移动速度限制及相关设计。\n\n确认仍要启用吗？");
  }
  return true;
}

function resetRuntime() {
  clearTimeout(musicNoticeTimer); $("#musicNotice").classList.remove("show");
  for (const pending of state.pending.values()) pending.reject(new Error("游戏运行时已切换"));
  state.pending.clear(); state.ready = false; state.launched = false; state.source = "";
  touchControls.bombSerial = 0;
  midiSynth?.reset();
  frame.removeAttribute("src");
}

function prepareMidi() {
  if (state.music !== "midi" && state.music !== "ogg") return;
  if (!window.WebAudioTinySynth) throw new Error("MIDI 合成器没有加载");
  if (!midiSynth) midiSynth = new window.WebAudioTinySynth({ quality: 1, useReverb: 1, voices: 64 });
  const context = midiSynth.getAudioContext();
  if (context.state === "suspended") context.resume();
}

function suspendHostedMidi() {
  const context = midiSynth?.getAudioContext?.();
  if (context?.state === "running") context.suspend().catch(() => {});
}

function resumeHostedMidi() {
  if (!state.launched || !player.classList.contains("open") || document.hidden ||
      !document.hasFocus() || document.activeElement !== frame) return;
  const context = midiSynth?.getAudioContext?.();
  if (context?.state === "suspended") context.resume().catch(() => {});
}

frame.addEventListener("blur", suspendHostedMidi);
frame.addEventListener("focus", resumeHostedMidi);
window.addEventListener("blur", suspendHostedMidi);
window.addEventListener("focus", resumeHostedMidi);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) suspendHostedMidi(); else resumeHostedMidi();
});

frame.addEventListener("load", () => {
  if (!frame.contentWindow) return;
  if (gameKeyWindow) {
    gameKeyWindow.removeEventListener("keydown", handleGameFullscreenKey, true);
    gameKeyWindow.removeEventListener("keyup", handleGameFullscreenKey, true);
  }
  gameKeyWindow = frame.contentWindow;
  gameKeyWindow.addEventListener("keydown", handleGameFullscreenKey, true);
  gameKeyWindow.addEventListener("keyup", handleGameFullscreenKey, true);
  frame.contentWindow.addEventListener("touhou-midi", event => {
    if ((state.music === "midi" || state.music === "ogg") && midiSynth && Array.isArray(event.detail?.bytes)) midiSynth.send(event.detail.bytes);
  });
  frame.contentWindow.addEventListener("touhou-midi-close", () => midiSynth?.reset());
});

async function lockEscapeForGame() {
  if (document.fullscreenElement !== player || !navigator.keyboard?.lock) return;
  try {
    await navigator.keyboard.lock(["Escape"]);
  } catch {
    // Keyboard Lock is a progressive enhancement. Unsupported browsers retain
    // their normal Escape-to-exit-fullscreen behavior.
  }
}

async function togglePlayerFullscreen() {
  try {
    if (document.fullscreenElement === player) {
      await document.exitFullscreen();
      return;
    }
    if (document.fullscreenElement) await document.exitFullscreen();
    await player.requestFullscreen({ navigationUI: "hide", keyboardLock: "browser" });
    await lockEscapeForGame();
    frame.focus();
  } catch (error) {
    setPlayerStatus(`无法切换全屏：${error.message}`);
  }
}

function handleGameFullscreenKey(event) {
  if (event.type === "keydown" && event.code === "Enter" && event.altKey && !event.ctrlKey && !event.metaKey) {
    event.preventDefault();
    event.stopImmediatePropagation();
    if (!event.repeat && !fullscreenChordActive) {
      fullscreenChordActive = true;
      togglePlayerFullscreen();
    }
    return;
  }
  if (event.type === "keyup" && event.code === "Enter" && fullscreenChordActive) {
    event.preventDefault();
    event.stopImmediatePropagation();
    fullscreenChordActive = false;
  }
}

document.addEventListener("fullscreenchange", () => {
  const fullscreenButton = $("#fullscreenToggle");
  const isFullscreen = document.fullscreenElement === player;
  fullscreenButton.setAttribute("aria-label", isFullscreen ? "退出全屏" : "进入全屏");
  fullscreenButton.title = isFullscreen ? "退出全屏（Alt+Enter）" : "进入全屏（Alt+Enter）";
  if (document.fullscreenElement === player) {
    lockEscapeForGame();
    frame.focus();
  } else {
    fullscreenChordActive = false;
    navigator.keyboard?.unlock?.();
  }
});

function openPlayerView() {
  if (!player.classList.contains("open")) {
    const previous = history.state && typeof history.state === "object" ? history.state : {};
    if (!previous[playerHistoryKey]) {
      const url = new URL(location.href); url.searchParams.set("game", state.game);
      history.pushState({ ...previous, [playerHistoryKey]: true, game: state.game }, "", url);
    }
  }
  player.classList.add("open");
  player.setAttribute("aria-hidden", "false");
  if (state.options.touchEnabled && localStorage.getItem(touchHelpSeenKey) !== "1") {
    localStorage.setItem(touchHelpSeenKey, "1");
    $("#touchHelp").hidden = false;
    player.classList.add("help-visible");
  }
}

function closeTouchHelp() {
  collapseTouchGuides();
  $("#touchHelp").hidden = true;
  player.classList.remove("help-visible");
  frame.focus();
}

async function syncTouchControls() {
  if (!state.launched) return;
  await send("touch-controls", { ...touchControls });
}

async function closePlayerView(fromHistory = false) {
  if (document.fullscreenElement === player) await document.exitFullscreen().catch(() => {});
  if (state.ready) await send("sync", {}, 3000).catch(() => {});
  $("#touchHelp").hidden = true;
  collapseTouchGuides();
  player.classList.remove("help-visible");
  player.classList.remove("open");
  player.setAttribute("aria-hidden", "true");
  resetRuntime();
  if (!fromHistory && history.state?.[playerHistoryKey]) {
    history.back();
  } else if (!fromHistory) {
    const url = new URL(location.href); url.searchParams.delete("game");
    history.replaceState({ ...(history.state || {}), [playerHistoryKey]: false }, "", url);
  }
}

window.addEventListener("popstate", () => {
  if (player.classList.contains("open")) closePlayerView(true);
});

function send(command, payload = {}, timeout = 15000) {
  if (!state.ready || !frame.contentWindow) return Promise.reject(new Error("游戏运行时尚未就绪"));
  const request = `${Date.now().toString(36)}-${++state.request}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { state.pending.delete(request); reject(new Error(`${command} 操作超时`)); }, timeout);
    state.pending.set(request, { resolve, reject, timer });
    frame.contentWindow.postMessage({ protocol, game: state.game, command, request, ...payload }, location.origin);
  });
}

window.addEventListener("message", event => {
  if (event.origin !== location.origin || event.source !== frame.contentWindow) return;
  const message = event.data || {};
  if (message.protocol !== protocol || message.game !== state.game) return;
  if (message.event === "ready") {
    state.ready = true;
    loaded[state.game] = true;
    try { localStorage.setItem(`et-loaded-${state.game}`, "1"); } catch {}
    setPlayerStatus("已就绪"); setStatus(`${state.game.toUpperCase()} ${state.music.toUpperCase()} 已就绪`);
    render();
    frame.dispatchEvent(new CustomEvent("runtime-ready")); return;
  }
  if (message.event === "exit") {
    setPlayerStatus(message.status === "success" ? "游戏已退出" : "游戏异常退出");
    closePlayerView(); return;
  }
  if (message.event === "transfer") { showTransfer(message); return; }
  if (message.event === "music-error" || message.event === "music-incomplete") { if (!state.launched) transferFailure(message); return; }
  if (message.event === "music-complete") { transferComplete(message); return; }
  if (message.event === "midi-fallback") { showMidiFallback(message); return; }
  const pending = state.pending.get(message.request);
  if (!pending) return;
  clearTimeout(pending.timer); state.pending.delete(message.request);
  if (message.ok) pending.resolve(message); else pending.reject(new Error(message.error || "游戏运行时操作失败"));
});

async function ensureRuntime(show = true) {
  const source = new URL(runtimeUrl(), location.href).href;
  if (show) openPlayerView();
  if (state.ready && state.source === source) return;
  resetRuntime(); state.source = source; setPlayerStatus("载入游戏数据…");
  frame.src = source;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { frame.removeEventListener("runtime-ready", done); reject(new Error("游戏加载超时")); }, 120000);
    const done = () => { clearTimeout(timer); resolve(); };
    frame.addEventListener("runtime-ready", done, { once: true });
  });
}

function selectedMusicResources() {
  const pack = musicPackage();
  if (!pack || !Array.isArray(pack.files)) throw new Error("音乐资源清单无效");
  const mount = typeof pack.mount === "string" ? pack.mount.replace(/\/$/, "") : "";
  return pack.files.map((name, index) => {
    if (typeof name !== "string" || !name || name.includes("/") || name.includes("\\")) throw new Error("音乐资源文件名无效");
    const url = new URL(name, new URL(pack.base || "./", location.href));
    if (typeof pack.version === "string" && pack.version) url.searchParams.set("v", pack.version);
    return { url: url.href, path: `${mount}/${name}`, size: Number(pack.sizes?.[index]) || 0 };
  });
}

function sharedResources() {
  const font = manifest.shared?.font;
  if (typeof font !== "string" || !font) throw new Error("共享字体资源清单无效");
  return [{ url: new URL(font, location.href).href, path: "/msgothic.ttc" }];
}

const isReplay = path => /(^|\/)replay\//i.test(path) || /\.rpy$/i.test(path);
const isSafeRelativePath = value => typeof value === "string" && value.length > 0 && value.length <= 240 &&
  !value.includes("\\") && !value.startsWith("/") && !value.split("/").some(part => !part || part === "." || part === "..");
function download(name, value, type = "application/json") {
  const url = URL.createObjectURL(new Blob([value], { type })); const link = document.createElement("a");
  link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const replayPrefix = () => state.game === "th06" ? "th6" : "th7";
const validReplayName = name => new RegExp(`^${replayPrefix()}_(?:\\d{2}|ud[0-9a-f]{4})\\.rpy$`, "i").test(name);
const formatBytes = bytes => bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KiB` : `${(bytes / 1024 / 1024).toFixed(2)} MiB`;
async function replayListing() {
  await ensureRuntime(false);
  await send("sync");
  const listing = await send("list");
  return listing.files.filter(file => isReplay(file.path)).sort((a, b) => a.path.localeCompare(b.path));
}
function nextReplayName(existing) {
  const lower = new Set(existing.map(path => path.toLowerCase()));
  for (let index = 0; index <= 0xffff; index++) {
    const name = `${replayPrefix()}_ud${index.toString(16).padStart(4, "0")}.rpy`;
    if (!lower.has(`replay/${name}`)) return name;
  }
  throw new Error("用户录像槽已用尽");
}

async function exportFiles(kind) {
  const label = kind === "save" ? "存档" : "录像";
  const wasReady = state.ready;
  showToast(`正在准备导出${label}…`, 60000);
  try {
    await ensureRuntime(false); setPlayerStatus(`正在导出${label}…`); await send("sync");
    if (kind === "save") {
      const result = await send("read", { path: "score.dat" });
      download("score.dat", new Uint8Array(result.bytes), "application/octet-stream");
    } else {
      if (!globalThis.fflate?.zipSync) throw new Error("ZIP 组件没有加载");
      const listing = await replayListing();
      if (!listing.length) throw new Error("没有可导出的录像");
      const entries = {};
      for (const file of listing) {
        const result = await send("read", { path: file.path });
        entries[file.path] = new Uint8Array(result.bytes);
      }
      download(`${state.game}-replay-${new Date().toISOString().slice(0,10)}.zip`,
        fflate.zipSync(entries, { level: 1 }), "application/zip");
    }
    if (!wasReady) resetRuntime();
    showToast(`已开始下载原版${label}`);
    setPlayerStatus(`已导出原版${label}`);
  } catch (error) {
    if (!wasReady) resetRuntime();
    showToast(`导出${label}失败：${error.message}`, 4000);
    throw error;
  }
}
async function importFile(kind, file) {
  if (!file.size) throw new Error("不能导入空文件");
  if (file.size > maxImportBytes) throw new Error("导入文件超过 128 MiB 限制");
  if (kind === "save" && state.launched) resetRuntime();
  await ensureRuntime(false); setPlayerStatus("正在导入…"); let files;
  const lowerName = file.name.toLowerCase();
  if (kind === "save" && lowerName.endsWith(".dat")) {
    files = [{ path: "score.dat", bytes: new Uint8Array(await file.arrayBuffer()) }];
  } else if (kind === "replay" && lowerName.endsWith(".rpy")) {
    const sanitized = file.name.replace(/[^\w.()-]/g, "_");
    const listing = await send("list");
    const existing = listing.files.map(item => item.path);
    let replayName = validReplayName(sanitized) ? sanitized : "";
    if (!replayName || existing.some(path => path.toLowerCase() === `replay/${replayName}`.toLowerCase()))
      replayName = nextReplayName(existing);
    files = [{ path: `replay/${replayName}`, bytes: new Uint8Array(await file.arrayBuffer()) }];
  } else if (kind === "replay" && lowerName.endsWith(".zip")) {
    if (!globalThis.fflate?.unzipSync) throw new Error("ZIP 组件没有加载");
    const archive = fflate.unzipSync(new Uint8Array(await file.arrayBuffer()));
    const listing = await send("list");
    const existing = listing.files.map(item => item.path);
    files = [];
    for (const [archivePath, bytes] of Object.entries(archive)) {
      if (archivePath.endsWith("/")) continue;
      if (!isSafeRelativePath(archivePath)) throw new Error("ZIP 包含不安全路径");
      const originalName = archivePath.split("/").pop();
      if (!originalName?.toLowerCase().endsWith(".rpy")) continue;
      const occupied = [...existing, ...files.map(item => item.path)];
      const originalTarget = `replay/${originalName}`;
      const name = validReplayName(originalName) &&
          !occupied.some(path => path.toLowerCase() === originalTarget.toLowerCase())
        ? originalName : nextReplayName(occupied);
      files.push({ path: `replay/${name}`, bytes });
    }
  } else {
    throw new Error(kind === "save" ? "请选择原版 .dat 存档" : "请选择原版 .rpy 录像或录像 ZIP");
  }
  if (!files.length) throw new Error("文件包中没有可导入的文件");
  const uniquePaths = new Set(files.map(item => item.path.toLowerCase()));
  if (uniquePaths.size !== files.length) throw new Error("文件包中存在重复路径");
  if (files.some(item => item.bytes.length > maxStoredFileBytes)) throw new Error("单个文件超过 64 MiB 限制");
  for (const item of files) await send("write", { path: item.path, bytes: Array.from(item.bytes) });
  if (kind === "save") {
    const expected = files[0].bytes;
    resetRuntime();
    await ensureRuntime(false);
    const persisted = new Uint8Array((await send("read", { path: "score.dat" })).bytes);
    if (persisted.length !== expected.length || persisted.some((byte, index) => byte !== expected[index])) {
      throw new Error("存档写入后未能从浏览器持久存储完整读回");
    }
  }
  resetRuntime();
  if ($("#replayDialog").open) $("#replayDialog").close();
  $("#player").classList.remove("open");
  $("#player").setAttribute("aria-hidden", "true");
  showToast(`已导入 ${files.length} 个文件；点击「打开」重新启动后生效`, 4000);
  setStatus(`已导入 ${files.length} 个文件；点击「打开」重新启动后生效`);
}

async function refreshReplayManager() {
  const files = await replayListing();
  const list = $("#replayList");
  list.replaceChildren();
  $("#replaySummary").textContent = `${files.length} FILES`;
  if (!files.length) {
    const empty = document.createElement("div"); empty.className = "replay-empty"; empty.textContent = "NO REPLAY FILES"; list.append(empty); return;
  }
  for (const file of files) {
    const row = document.createElement("div"); row.className = "replay-row";
    const name = file.path.split("/").pop();
    const label = document.createElement("span"); label.className = "replay-name"; label.textContent = name; label.title = name;
    const size = document.createElement("span"); size.className = "replay-size"; size.textContent = formatBytes(file.size);
    const get = document.createElement("button"); get.type = "button"; get.textContent = "下载";
    get.onclick = () => send("read", { path: file.path })
      .then(result => download(name, new Uint8Array(result.bytes), "application/octet-stream"))
      .catch(error => showToast(`录像下载失败：${error.message}`, 4000));
    const more = document.createElement("button"); more.type = "button"; more.textContent = "改名/删除";
    more.onclick = async () => { try {
      const renamed = prompt("输入新的原版录像文件名；留空将删除", name);
      if (renamed === null) return;
      if (!renamed.trim()) {
        if (!confirm(`确定删除 ${name}？`)) return;
        await send("remove", { path: file.path }); await refreshReplayManager(); return;
      }
      if (!validReplayName(renamed.trim())) throw new Error(`文件名必须符合 ${replayPrefix()}_01.rpy 或 ${replayPrefix()}_ud0000.rpy`);
      const target = `replay/${renamed.trim()}`;
      if (target.toLowerCase() === file.path.toLowerCase()) return;
      const result = await send("read", { path: file.path });
      await send("write", { path: target, bytes: result.bytes });
      await send("remove", { path: file.path });
      await refreshReplayManager();
    } catch (error) { showToast(`录像操作失败：${error.message}`, 4000); } };
    row.append(label, size, get, more); list.append(row);
  }
}

async function manageReplays() {
  await refreshReplayManager();
  $("#replayDialog").showModal();
}

const replayWindow = document.querySelector("#replayDialog .replay-window");
let replayDragDepth = 0;
replayWindow.addEventListener("dragenter", event => {
  if (!event.dataTransfer?.types.includes("Files")) return;
  event.preventDefault(); replayDragDepth++; replayWindow.classList.add("dragging");
});
replayWindow.addEventListener("dragover", event => {
  if (!event.dataTransfer?.types.includes("Files")) return;
  event.preventDefault(); event.dataTransfer.dropEffect = "copy";
});
replayWindow.addEventListener("dragleave", () => {
  replayDragDepth = Math.max(0, replayDragDepth - 1);
  if (!replayDragDepth) replayWindow.classList.remove("dragging");
});
replayWindow.addEventListener("drop", async event => {
  event.preventDefault(); replayDragDepth = 0; replayWindow.classList.remove("dragging");
  try {
    const files = [...(event.dataTransfer?.files || [])];
    if (files.length !== 1) throw new Error("请一次拖入一个 .rpy 或 .zip 文件");
    if (!/\.(rpy|zip)$/i.test(files[0].name)) throw new Error("只接受原版 .rpy 或录像 ZIP");
    await importFile("replay", files[0]);
  } catch (error) {
    setStatus(`错误：${error.message}`); showToast(`录像导入失败：${error.message}`, 4000);
  }
});

function pickFile(accept) {
  const input = $("#fileInput"); input.accept = accept; input.multiple = false; input.value = "";
  return new Promise(resolve => {
    let settled = false;
    const finish = file => {
      if (settled) return;
      settled = true;
      input.onchange = null;
      input.oncancel = null;
      resolve(file);
    };
    input.onchange = () => finish(input.files?.[0]);
    input.oncancel = () => finish();
    input.click();
  });
}

async function runAction(action) {
  try {
    if (action === "manage-replay") await manageReplays();
    else if (action.startsWith("export-")) await exportFiles(action.slice(7));
    else {
      const kind = action.slice(7);
      if (kind === "save" && !confirm("导入会覆盖当前游戏已有的存档，是否继续？")) return;
      const file = await pickFile(kind === "replay" ? ".zip,.rpy" : ".dat");
      if (file) await importFile(kind, file);
    }
  } catch (error) { setPlayerStatus(error.message); setStatus(`错误：${error.message}`); showToast(`错误：${error.message}`, 4000); }
}

$("#musicMore").addEventListener("click", () => {
  document.querySelectorAll("#musicOptions [data-music]").forEach(button => { button.hidden = false; });
  $("#musicMore").remove();
});
function bringSelectedCardForward(card) {
  const main = $("#main");
  const cards = [...main.querySelectorAll(".game")];
  if (cards[0] === card) return;
  const previous = new Map(cards.map(item => [item, item.getBoundingClientRect()]));
  main.insertBefore(card, cards[0]);
  if (matchMedia("(prefers-reduced-motion: reduce), (max-width: 780px), (hover: none), (pointer: coarse)").matches) return;
  for (const item of cards) {
    const before = previous.get(item);
    const after = item.getBoundingClientRect();
    const delta = before.left - after.left;
    if (Math.abs(delta) > 1) item.animate([{ translate: `${delta}px 0` }, { translate: "0 0" }], { duration: 650, easing: "cubic-bezier(.22,.8,.22,1)" });
  }
}

document.querySelectorAll(".game").forEach(card => {
  card.addEventListener("click", () => {
    const mobileLite = matchMedia("(max-width: 780px), (hover: none), (pointer: coarse)").matches;
    const main = $("#main");
    const changed = state.game !== card.dataset.game;
    if (changed) { state.game = card.dataset.game; restoreGamePreferences(state.game); resetRuntime(); }
    if (!mobileLite) {
      bringSelectedCardForward(card);
    }
    state.hasSelection = true;
    render();
    setStatus(changed ? `已切换至 ${game().title}` : `已选择 ${game().title}`);
    if (mobileLite && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
      main.classList.remove("mobile-selection-enter");
      requestAnimationFrame(() => {
        main.classList.add("mobile-selection-enter");
        setTimeout(() => main.classList.remove("mobile-selection-enter"), 180);
      });
    }
  });
  if (matchMedia("(pointer: fine)").matches) {
    card.addEventListener("pointermove", event => {
      if (state.hasSelection && !card.classList.contains("selected")) return;
      const rect = card.getBoundingClientRect();
      const x = Math.max(0, Math.min(rect.width, event.clientX - rect.left));
      const y = Math.max(0, Math.min(rect.height, event.clientY - rect.top));
      card.style.setProperty("--mx", `${x}px`);
      card.style.setProperty("--my", `${y}px`);
      card.style.setProperty("--ry", `${((x / rect.width) - .5) * 7}deg`);
      card.style.setProperty("--rx", `${(.5 - (y / rect.height)) * 5}deg`);
    });
    card.addEventListener("pointerleave", () => {
      card.style.setProperty("--rx", "0deg");
      card.style.setProperty("--ry", "0deg");
    });
  }
});
document.querySelectorAll("[data-music]").forEach(button => button.addEventListener("click", () => { if (!button.disabled && state.music !== button.dataset.music) { state.music = button.dataset.music; saveGamePreferences(); resetRuntime(); render(); } }));
document.querySelectorAll("[data-action]").forEach(button => button.addEventListener("click", () => runAction(button.dataset.action)));
$("#mobileOptionsToggle").addEventListener("click", () => { state.mobileOpen = !state.mobileOpen; render(); });
$("#th06HitboxToggle").addEventListener("click", () => setOption("th06FocusHitbox", !state.options.th06FocusHitbox));
$("#touchToggle").addEventListener("click", () => setOption("touchEnabled", !state.options.touchEnabled));
$("#unlimitedTouchToggle").addEventListener("click", () => { if (state.options.touchEnabled) setOption("unlimitedTouch", !state.options.unlimitedTouch); });
$("#alwaysHitboxToggle").addEventListener("click", () => setOption("alwaysHitbox", !state.options.alwaysHitbox));
$("#startupErrorClose").addEventListener("click", clearStartupError);
async function toggleTouchFire() {
  touchControls.fireEnabled = !touchControls.fireEnabled;
  render();
  frame.focus({ preventScroll: true });
  try { await syncTouchControls(); } catch (error) { setPlayerStatus(error.message); }
}

async function triggerTouchBomb() {
  touchControls.bombSerial++;
  frame.focus({ preventScroll: true });
  try { await syncTouchControls(); } catch (error) { setPlayerStatus(error.message); }
}

for (const [button, activate] of [[$("#touchFire"), toggleTouchFire], [$("#touchBomb"), triggerTouchBomb]]) {
  // Pointer-down is handled directly so the browser never transfers focus
  // from the running iframe to this outer control. A detail-0 click preserves
  // keyboard and assistive-technology activation without firing twice.
  button.addEventListener("pointerdown", event => {
    if (!state.launched) return;
    event.preventDefault();
    activate();
  });
  button.addEventListener("click", event => {
    if (event.detail !== 0 || !state.launched) return;
    activate();
  });
}
document.querySelectorAll("[data-guide-tab]").forEach(tab => tab.addEventListener("click", () => {
  if (tab.getAttribute("aria-expanded") === "true") collapseTouchGuides();
  else playTouchGuide(tab.dataset.guideTab);
}));
document.querySelectorAll(".guide-replay").forEach(button => button.addEventListener("click", () => playTouchGuide(button.closest("[data-guide-panel]").dataset.guidePanel)));
$("#touchHelpOpen").addEventListener("click", () => { collapseTouchGuides(); $("#touchHelp").hidden = false; player.classList.add("help-visible"); });
$("#touchHelpClose").addEventListener("click", closeTouchHelp);
$("#touchHelp").addEventListener("click", event => { if (event.target === $("#touchHelp")) closeTouchHelp(); });
$("#launch").addEventListener("click", async () => { try { if (!state.launched && !confirmInputWarnings()) return; if (!state.launched) await launchConfiguredRuntime(null); else frame.focus(); } catch (error) { setPlayerStatus(error.message); showStartupError(error, `${state.game.toUpperCase()} / ${state.music.toUpperCase()}`); showToast(error.message, 5000); } });
$("#fullscreenToggle").addEventListener("click", togglePlayerFullscreen);
$("#transferRetry").addEventListener("click", async () => {
  $("#transferRetry").hidden = true;
  $("#transferWarning").textContent = "RETRYING OGG DOWNLOAD...";
  try { await send("retry-music", {}, 30 * 60 * 1000); }
  catch (error) { transferFailure({ failed: 1 }); setPlayerStatus(error.message); }
});

const touchPreview = new URLSearchParams(location.search).get("preview");
if (touchPreview === "touch" || touchPreview === "touch-hud") {
  state.options.touchEnabled = true;
  player.classList.add("open", "touch-preview");
  player.setAttribute("aria-hidden", "false");
  $("#touchHelp").hidden = touchPreview !== "touch";
  player.classList.toggle("help-visible", touchPreview === "touch");
}

render(); setStatus("选择游戏和音乐后即可启动");
