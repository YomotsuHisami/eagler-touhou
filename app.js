const manifest = await fetch("games.json", { cache: "no-store" }).then(response => {
  if (!response.ok) throw new Error(`games.json: HTTP ${response.status}`);
  return response.json();
});

const protocol = manifest.protocol;
if (protocol !== "eagler-touhou/1" || typeof manifest.shared?.vanillaFont !== "string" ||
    typeof manifest.shared?.unicodeFont !== "string" ||
    !manifest.games?.th06 || !manifest.games?.th07 ||
    !Object.values(manifest.games).every(item => typeof item.runtime === "string" && item.music?.midi)) {
  throw new Error("games.json 的协议或游戏清单无效");
}

let changelogLoaded = false;
async function loadChangelog() {
  if (changelogLoaded) return true;
  const target = $("#changelogText");
  try {
    const response = await fetch(`CHANGELOG.txt?v=${encodeURIComponent(changelogVersion)}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    target.textContent = await response.text();
    changelogLoaded = true;
    return true;
  } catch (error) {
    target.textContent = `CHANGELOG.txt 读取失败：${error.message}\n\n请刷新页面后重试。`;
    return false;
  }
}

async function showChangelog(automatic = false) {
  const dialog = $("#changelogDialog");
  if (dialog.open) return;
  const loaded = await loadChangelog();
  dialog.showModal();
  if (automatic && loaded) {
    try { localStorage.setItem(changelogSeenKey, "1"); } catch {}
  }
}

function closeChangelog() {
  const dialog = $("#changelogDialog");
  if (dialog.open) dialog.close();
}
const defaultOptions = Object.freeze({
  thpracEnabled: false,
  th06FocusHitbox: false,
  limitPresentationTo60: false,
  touchEnabled: false,
  touchFocusMode: "two-finger",
  unlimitedTouch: false,
  alwaysHitbox: false
});
const state = {
  game: "th06", hasSelection: false, music: "ogg", ready: false, launched: false,
  request: 0, pending: new Map(), source: "", experimentalOpen: false, mobileOpen: false,
  options: { ...defaultOptions }, language: "ja"
};
const touchControls = { fireEnabled: true, focusEnabled: false, bombSerial: 0, escapeSerial: 0 };
const touchFocusModes = new Set(["two-finger", "hold-button", "toggle-button"]);
const touchHelpSeenKey = "eagler-touch-help-seen-v8";
const mobileDevice = navigator.userAgentData?.mobile === true || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) ||
  (navigator.maxTouchPoints > 1 && /Macintosh/i.test(navigator.userAgent));
const changelogVersion = "20260817-3";
const changelogSeenKey = `eagler-touhou-changelog-seen-${changelogVersion}`;
const preferenceKey = gameId => `eagler-touhou-game-options-v1-${gameId}`;
const languagePreferenceKey = gameId => `eagler-touhou-language-v1-${gameId}`;
const gameFeatures = gameId => manifest.games[gameId].features || {};
const languageDisplayNames = Object.freeze({
  ja: "日本語",
  "lang_zh-hans": "中文（简体）",
  "lang_zh-hant": "中文（繁體）",
  lang_en: "English",
  lang_ru: "Русский"
});
const languagePriority = id => id === "ja" ? 0
  : id === "lang_zh-hans" ? 10
  : id === "lang_zh-hant" ? 11
  : id === "lang_en" ? 20
  : 100;
const normalizeLanguageCatalog = entries => entries
  .map(entry => ({ ...entry, title: languageDisplayNames[entry.id] || entry.title || entry.id }))
  .sort((a, b) => languagePriority(a.id) - languagePriority(b.id) || String(a.id).localeCompare(String(b.id), "en"));
const languageCatalog = gameId => normalizeLanguageCatalog(Array.isArray(manifest.games[gameId].languageOptions)
  ? manifest.games[gameId].languageOptions
  : (Array.isArray(manifest.games[gameId].languages)
    ? [{ id: "ja", title: "日本語", pack: null }, ...manifest.games[gameId].languages]
    : [{ id: "ja", title: "日本語", pack: null }]));
const thpracLocaleForLanguage = id => id === "lang_zh-hans" ? "zh-CN" : id === "ja" ? "ja-JP" : "en-US";
const languageEntry = () => languageCatalog(state.game).find(item => item.id === state.language) || languageCatalog(state.game)[0];
const languageCacheName = "eagler-touhou-language-packs-v1";
function restoreGamePreferences(gameId) {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(preferenceKey(gameId)) || "null"); } catch {}
  const options = { ...defaultOptions };
  for (const name of Object.keys(defaultOptions)) {
    if (typeof saved?.options?.[name] === typeof defaultOptions[name]) options[name] = saved.options[name];
  }
  if (!touchFocusModes.has(options.touchFocusMode)) options.touchFocusMode = "two-finger";
  if (!gameFeatures(gameId).thprac) options.thpracEnabled = false;
  if (mobileDevice) options.limitPresentationTo60 = true;
  if (!options.touchEnabled) options.unlimitedTouch = false;
  state.options = options;
  state.music = ["midi", "wav", "ogg"].includes(saved?.music) && manifest.games[gameId].music[saved.music]
    ? saved.music : "ogg";
  const available = languageCatalog(gameId);
  let savedLanguage = null;
  try { savedLanguage = localStorage.getItem(languagePreferenceKey(gameId)); } catch {}
  state.language = available.some(item => item.id === savedLanguage) ? savedLanguage : "ja";
}
function saveGamePreferences() {
  try {
    localStorage.setItem(preferenceKey(state.game), JSON.stringify({
      music: state.music,
      options: Object.fromEntries(Object.keys(defaultOptions).map(name => [name, state.options[name]]))
    }));
  } catch {}
  try { localStorage.setItem(languagePreferenceKey(state.game), state.language); } catch {}
}
const loaded = {
  th06: localStorage.getItem("et-loaded-th06") === "1",
  th07: localStorage.getItem("et-loaded-th07") === "1"
};
const $ = selector => document.querySelector(selector);
const frame = $("#gameFrame");
const player = $("#player");
function renderSiteNoticeText(target, text) {
  target.replaceChildren();
  const urlPattern = /https?:\/\/[^\s<>"']+/gi;
  let cursor = 0;
  for (const match of text.matchAll(urlPattern)) {
    const index = match.index ?? 0;
    if (index > cursor) target.append(document.createTextNode(text.slice(cursor, index)));
    let url = match[0];
    let suffix = "";
    const trailing = url.match(/[),.;!?，。；！？）》】]+$/u);
    if (trailing) {
      suffix = trailing[0];
      url = url.slice(0, -suffix.length);
    }
    const link = document.createElement("a");
    link.href = url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = "网页链接";
    link.title = url;
    target.append(link);
    if (suffix) target.append(document.createTextNode(suffix));
    cursor = index + match[0].length;
  }
  if (cursor < text.length) target.append(document.createTextNode(text.slice(cursor)));
}

async function loadSiteNotice() {
  const bar = $("#siteNotice");
  const target = $("#siteNoticeContent");
  try {
    const response = await fetch("NOTICE.txt", { cache: "no-store" });
    if (!response.ok) return;
    const text = (await response.text()).replace(/^\uFEFF/, "").trim();
    if (!text) return;
    renderSiteNoticeText(target, text);
    bar.hidden = false;
  } catch {}
}

function closeSiteNotice() {
  const bar = $("#siteNotice");
  bar.hidden = true;
}
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
let transferKind = "";
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
function hideTransfer() {
  clearTimeout(transferHideTimer);
  transferHideTimer = null;
  $("#transfer").hidden = true;
  $("#transferWarning").hidden = true;
  $("#transferRetry").hidden = true;
  transferKind = "";
  transferMode = "";
  transferSpeed = 0;
}
function showTransfer(message) {
  const panel = $("#transfer");
  clearTimeout(transferHideTimer); panel.hidden = false;
  transferKind = message.kind || (message.mode === "ogg" ? "music" : "game");
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
  transferKind = "music";
  const warning = $("#transferWarning"); warning.hidden = false;
  warning.textContent = `OGG DOWNLOAD FAILED (${message.failed || 1})\nCURRENT AUDIO: MIDI\n当前正在播放 MIDI，并非 OGG 音质`;
  $("#transferRetry").hidden = false;
}
function transferComplete(message) {
  showTransfer({ ...message, mode: "ogg", speed: 0 });
  $("#transferTitle").textContent = "BGM DOWNLOAD COMPLETE";
  $("#transferWarning").hidden = true; $("#transferRetry").hidden = true;
  transferHideTimer = setTimeout(hideTransfer, 2200);
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
function selectedLanguagePack() {
  const entry = languageEntry();
  if (!entry.pack) return null;
  const pack = entry.pack;
  if (typeof pack.url !== "string" || typeof pack.sha256 !== "string" || !Number.isInteger(pack.bytes) ||
      typeof pack.runtimeVersion !== "string" || pack.runtimeVersion.length < 16) throw new Error("语言包清单无效");
  return {
    ...pack,
    language: entry.id,
    url: new URL(pack.url, location.href).href
  };
}
async function launchConfiguredRuntime() {
  clearStartupError(); prepareMidi(); await ensureRuntime(true);
  const runtimePack = await prepareLanguagePack();
  setPlayerStatus(runtimePack ? `准备 ${entryTitle(languageEntry())} 语言包…` : `准备 ${state.music.toUpperCase()} 音乐资源…`);
  await send("configure", {
    music: state.music, resources: selectedMusicResources(), runtimeResources: [],
    runtimePack: runtimePack ? { ...runtimePack, manifest: runtimePack.manifest, files: runtimePack.files } : null,
    sharedResources: sharedResources(),
    options: { ...state.options, debugHarness, thpracLocale: thpracLocaleForLanguage(state.language),
      touchBombZoneEnabled: false,
      th06FocusHitbox: state.game === "th06" && state.options.th06FocusHitbox }
  }, 30 * 60 * 1000);
  await send("launch"); state.launched = true; clearStartupError();
  await syncTouchControls(); setPlayerStatus("运行中"); frame.focus();
}
function entryTitle(entry) { return typeof entry?.title === "string" && entry.title ? entry.title : entry?.id || "语言"; }
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
  const languageEntries = languageCatalog(state.game);
  const languageSelect = $("#languageSelect");
  const languageOption = $("#languageOption");
  languageOption.hidden = languageEntries.length <= 1;
  languageSelect.replaceChildren(...languageEntries.map(entry => {
    const option = document.createElement("option"); option.value = entry.id; option.textContent = entryTitle(entry); return option;
  }));
  languageSelect.value = state.language;
  const selectedPack = languageEntry().pack;
  $("#languagePackSize").textContent = selectedPack ? formatBytes(Number(selectedPack.bytes) || 0) : "内置";
  const thpracAvailable = !!gameFeatures(state.game).thprac;
  $("#thpracOption").hidden = !thpracAvailable;
  if (!thpracAvailable) state.options.thpracEnabled = false;
  const experimentalAvailable = languageEntries.length > 1 || thpracAvailable;
  $("#experimentalOptions").hidden = !experimentalAvailable;
  $("#experimentalOptions").classList.toggle("open", state.experimentalOpen);
  $("#experimentalOptionsToggle").setAttribute("aria-expanded", String(state.experimentalOpen));
  $("#th06HitboxOption").hidden = state.game !== "th06";
  $("#mobileOptions").classList.toggle("open", state.mobileOpen);
  $("#mobileOptionsToggle").setAttribute("aria-expanded", String(state.mobileOpen));
  const switches = { thpracToggle: state.options.thpracEnabled, frameLimitToggle: state.options.limitPresentationTo60, th06HitboxToggle: state.options.th06FocusHitbox, touchToggle: state.options.touchEnabled, unlimitedTouchToggle: state.options.unlimitedTouch, alwaysHitboxToggle: state.options.alwaysHitbox };
  for (const [id, enabled] of Object.entries(switches)) {
    $("#" + id).setAttribute("aria-checked", String(enabled));
    $("#" + id).classList.toggle("on", enabled);
  }
  const frameLimitToggle = $("#frameLimitToggle");
  frameLimitToggle.disabled = mobileDevice;
  frameLimitToggle.title = mobileDevice ? "由于调度问题，移动端设备强制锁定 60 帧" : "";
  const frameLimitHint = $("#frameLimitHint");
  frameLimitHint.textContent = mobileDevice ? "由于调度问题，移动端设备强制锁定 60 帧" : "如果帧数在游玩时经常严重波动，那么必须启用该选项，否则会造成严重的输入延迟。";
  frameLimitHint.classList.toggle("option-warning", !mobileDevice);
  $("#unlimitedTouchToggle").disabled = !state.options.touchEnabled;
  const touchFocusMode = $("#touchFocusMode");
  touchFocusMode.value = state.options.touchFocusMode;
  touchFocusMode.disabled = !state.options.touchEnabled;
  player.classList.toggle("touch-enabled", state.options.touchEnabled);
  const focusButton = $("#touchFocus");
  const focusButtonMode = state.options.touchFocusMode !== "two-finger";
  focusButton.hidden = !state.options.touchEnabled || !focusButtonMode;
  focusButton.classList.toggle("is-on", touchControls.focusEnabled);
  focusButton.setAttribute("aria-pressed", String(touchControls.focusEnabled));
  focusButton.querySelector("strong").textContent = "低速";
  focusButton.querySelector("small").textContent = state.options.touchFocusMode === "hold-button"
    ? (touchControls.focusEnabled ? "按住中" : "按住低速")
    : (touchControls.focusEnabled ? "已开启" : "点按切换");
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
  if (name === "thpracEnabled" && !gameFeatures(state.game).thprac) return;
  if (mobileDevice && name === "limitPresentationTo60") {
    if (!state.options.limitPresentationTo60) state.options.limitPresentationTo60 = true;
    render();
    return;
  }
  if (state.options[name] === value) return;
  state.options[name] = value;
  if (name === "touchEnabled" && !value) {
    state.options.unlimitedTouch = false;
    touchControls.focusEnabled = false;
  }
  if (name === "touchFocusMode") touchControls.focusEnabled = false;
  saveGamePreferences();
  resetRuntime();
  render();
}

function confirmInputWarnings() {
  const pureTouch = navigator.maxTouchPoints > 0 && !matchMedia("(any-pointer: fine)").matches;
  if (!state.options.touchEnabled && (pureTouch || mobileDevice)) {
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
  touchControls.focusEnabled = false;
  touchControls.bombSerial = 0;
  touchControls.escapeSerial = 0;
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
  document.body.classList.add("player-active");
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
  document.body.classList.remove("player-active");
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
    // Emscripten reports the final GAME DATA progress event, but the hosted
    // shell has no separate completion event for that preload. The runtime's
    // ready notification is the authoritative boundary: hide only the base
    // transfer here so an OGG transfer can still be displayed afterwards.
    if (transferKind === "game") hideTransfer();
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
  const vanillaFont = manifest.shared?.vanillaFont;
  const unicodeFont = manifest.shared?.unicodeFont;
  if (typeof vanillaFont !== "string" || !vanillaFont || typeof unicodeFont !== "string" || !unicodeFont) {
    throw new Error("共享字体资源清单无效");
  }
  const resources = [];
  if (state.language === "ja") {
    resources.push({ url: new URL(vanillaFont, location.href).href, path: "/msgothic.ttc" });
  }
  if (state.language !== "ja" || state.options.thpracEnabled) {
    resources.push({ url: new URL(unicodeFont, location.href).href, path: "/unifont.otf" });
  }
  return resources;
}

async function sha256Hex(bytes) {
  const subtle = globalThis.crypto?.subtle;
  if (typeof subtle?.digest === "function") {
    return Array.from(new Uint8Array(await subtle.digest("SHA-256", bytes)), byte => byte.toString(16).padStart(2, "0")).join("");
  }
  const input = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const k = new Uint32Array([
    0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
    0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
    0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
    0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
    0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
    0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
    0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2
  ]);
  const h = new Uint32Array([0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]);
  const total = Math.ceil((input.length + 9) / 64) * 64;
  const padded = new Uint8Array(total);
  padded.set(input);
  padded[input.length] = 0x80;
  const dv = new DataView(padded.buffer);
  const bitLength = input.length * 8;
  dv.setUint32(total - 8, Math.floor(bitLength / 0x100000000), false);
  dv.setUint32(total - 4, bitLength >>> 0, false);
  const w = new Uint32Array(64);
  const ror = (x, n) => (x >>> n) | (x << (32 - n));
  for (let offset = 0; offset < total; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(offset + i * 4, false);
    for (let i = 16; i < 64; i++) {
      const x = w[i - 15], y = w[i - 2];
      const s0 = ror(x, 7) ^ ror(x, 18) ^ (x >>> 3);
      const s1 = ror(y, 17) ^ ror(y, 19) ^ (y >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let a=h[0],b=h[1],c=h[2],d=h[3],e=h[4],f=h[5],g=h[6],hh=h[7];
    for (let i = 0; i < 64; i++) {
      const s1 = ror(e, 6) ^ ror(e, 11) ^ ror(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + s1 + ch + k[i] + w[i]) >>> 0;
      const s0 = ror(a, 2) ^ ror(a, 13) ^ ror(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (s0 + maj) >>> 0;
      hh=g; g=f; f=e; e=(d+t1)>>>0; d=c; c=b; b=a; a=(t1+t2)>>>0;
    }
    h[0]=(h[0]+a)>>>0; h[1]=(h[1]+b)>>>0; h[2]=(h[2]+c)>>>0; h[3]=(h[3]+d)>>>0;
    h[4]=(h[4]+e)>>>0; h[5]=(h[5]+f)>>>0; h[6]=(h[6]+g)>>>0; h[7]=(h[7]+hh)>>>0;
  }
  return Array.from(h, value => value.toString(16).padStart(8, "0")).join("");
}

function languageCacheKey(pack) {
  return new Request(`${location.origin}/__eagler-language/${state.game}/${pack.language}/${pack.sha256}`);
}

function parseStaticPackManifest(bytes, pack) {
  let value;
  try { value = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new Error("语言包清单损坏"); }
  const prefix = `/thcrap/${state.game}/`;
  if (value?.schema !== "eagler-touhou/thcrap-static-pack/1" || value.game !== state.game ||
      value.language !== pack.language || value.runtimeVersion !== pack.runtimeVersion ||
      !Array.isArray(value.files) || value.files.length > 256) throw new Error("语言包清单不兼容");
  for (const file of value.files) {
    if (typeof file?.path !== "string" || !file.path.startsWith(prefix) || file.path.includes("\\") || file.path.includes("..") ||
        !Number.isInteger(file.bytes) || file.bytes < 0 || typeof file.sha256 !== "string") throw new Error("语言包文件清单无效");
  }
  return value;
}

async function prepareLanguagePack() {
  const pack = selectedLanguagePack();
  if (!pack) return null;
  const prefix = `/thcrap/${state.game}/`;
  if (!globalThis.fflate?.unzipSync) throw new Error("ZIP 组件没有加载");
  let cache = null;
  try { cache = await globalThis.caches?.open(languageCacheName); } catch {}
  const cacheKey = languageCacheKey(pack);
  let fromCache = true;
  let response = cache ? await cache.match(cacheKey) : null;
  if (!response) {
    fromCache = false;
    response = await fetch(pack.url, { cache: "force-cache" });
    if (!response.ok) throw new Error(`${new URL(pack.url).pathname}: HTTP ${response.status}`);
  }
  let archive = new Uint8Array(await response.arrayBuffer());
  if (archive.length !== pack.bytes) {
    if (!fromCache) throw new Error("语言包大小错误");
    if (cache) try { await cache.delete(cacheKey); } catch {}
    response = await fetch(pack.url, { cache: "no-store" });
    if (!response.ok) throw new Error(`${new URL(pack.url).pathname}: HTTP ${response.status}`);
    archive = new Uint8Array(await response.arrayBuffer());
    if (archive.length !== pack.bytes) throw new Error("语言包大小错误");
  }
  if (cache) try { await cache.put(cacheKey, new Response(archive)); } catch {}
  const entries = globalThis.fflate.unzipSync(archive);
  const manifestBytes = entries["manifest.json"];
  if (!(manifestBytes instanceof Uint8Array)) throw new Error("语言包缺少清单");
  const packManifest = parseStaticPackManifest(manifestBytes, pack);
  const expected = new Map(packManifest.files.map(file => [file.path, file]));
  const names = Object.keys(entries).filter(name => name !== "manifest.json");
  if (names.length !== expected.size) throw new Error("语言包文件数量不一致");
  const files = [];
  for (const name of names) {
    if (!name.startsWith(`${prefix.slice(1)}`) || name.includes("\\") || name.includes("..")) throw new Error("语言包路径无效");
    const path = `/${name}`;
    const declaration = expected.get(path);
    const bytes = entries[name];
    if (!declaration || bytes.length !== declaration.bytes) {
      throw new Error(`${path}: 语言包文件大小错误`);
    }
    files.push({ path, bytes });
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  return { ...pack, manifest: packManifest, files };
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
$("#languageSelect").addEventListener("change", event => {
  const available = languageCatalog(state.game);
  const value = event.target.value;
  if (!available.some(entry => entry.id === value) || state.language === value) return;
  state.language = value;
  saveGamePreferences();
  resetRuntime();
  render();
  setStatus(`已选择${entryTitle(languageEntry())}`);
});
document.querySelectorAll("[data-music]").forEach(button => button.addEventListener("click", () => { if (!button.disabled && state.music !== button.dataset.music) { state.music = button.dataset.music; saveGamePreferences(); resetRuntime(); render(); } }));
document.querySelectorAll("[data-action]").forEach(button => button.addEventListener("click", () => runAction(button.dataset.action)));
$("#experimentalOptionsToggle").addEventListener("click", () => { state.experimentalOpen = !state.experimentalOpen; render(); });
$("#mobileOptionsToggle").addEventListener("click", () => { state.mobileOpen = !state.mobileOpen; render(); });
$("#thpracToggle").addEventListener("click", () => setOption("thpracEnabled", !state.options.thpracEnabled));
$("#frameLimitToggle").addEventListener("click", () => setOption("limitPresentationTo60", !state.options.limitPresentationTo60));
$("#changelogOpen").addEventListener("click", () => { void showChangelog(false); });
$("#changelogClose").addEventListener("click", closeChangelog);
$("#changelogConfirm").addEventListener("click", closeChangelog);
$("#siteNoticeClose").addEventListener("click", closeSiteNotice);
$("#th06HitboxToggle").addEventListener("click", () => setOption("th06FocusHitbox", !state.options.th06FocusHitbox));
$("#touchToggle").addEventListener("click", () => setOption("touchEnabled", !state.options.touchEnabled));
$("#touchFocusMode").addEventListener("change", event => {
  const value = event.target.value;
  if (touchFocusModes.has(value)) setOption("touchFocusMode", value);
});
$("#unlimitedTouchToggle").addEventListener("click", () => { if (state.options.touchEnabled) setOption("unlimitedTouch", !state.options.unlimitedTouch); });
$("#alwaysHitboxToggle").addEventListener("click", () => setOption("alwaysHitbox", !state.options.alwaysHitbox));
$("#startupErrorClose").addEventListener("click", clearStartupError);
async function toggleTouchFire() {
  touchControls.fireEnabled = !touchControls.fireEnabled;
  render();
  frame.focus({ preventScroll: true });
  try { await syncTouchControls(); } catch (error) { setPlayerStatus(error.message); }
}

async function setTouchFocus(value) {
  if (!state.launched || state.options.touchFocusMode === "two-finger") return;
  touchControls.focusEnabled = !!value;
  render();
  frame.focus({ preventScroll: true });
  try { await syncTouchControls(); } catch (error) { setPlayerStatus(error.message); }
}

const touchFocusButton = $("#touchFocus");
touchFocusButton.addEventListener("pointerdown", event => {
  if (!state.launched || state.options.touchFocusMode === "two-finger") return;
  event.preventDefault();
  try { touchFocusButton.setPointerCapture(event.pointerId); } catch {}
  if (state.options.touchFocusMode === "hold-button") void setTouchFocus(true);
  else void setTouchFocus(!touchControls.focusEnabled);
});
const releaseHeldTouchFocus = event => {
  if (state.options.touchFocusMode !== "hold-button") return;
  event?.preventDefault?.();
  void setTouchFocus(false);
};
touchFocusButton.addEventListener("pointerup", releaseHeldTouchFocus);
touchFocusButton.addEventListener("pointercancel", releaseHeldTouchFocus);
touchFocusButton.addEventListener("lostpointercapture", releaseHeldTouchFocus);
touchFocusButton.addEventListener("click", event => {
  if (event.detail !== 0 || !state.launched || state.options.touchFocusMode !== "toggle-button") return;
  void setTouchFocus(!touchControls.focusEnabled);
});

async function triggerTouchBomb() {
  touchControls.bombSerial++;
  frame.focus({ preventScroll: true });
  try { await syncTouchControls(); } catch (error) { setPlayerStatus(error.message); }
}

async function triggerTouchEscape() {
  touchControls.escapeSerial++;
  frame.focus({ preventScroll: true });
  try { await syncTouchControls(); } catch (error) { setPlayerStatus(error.message); }
}

for (const [button, activate] of [[$("#touchFire"), toggleTouchFire], [$("#touchBomb"), triggerTouchBomb], [$("#touchEscape"), triggerTouchEscape]]) {
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
  document.body.classList.add("player-active");
  player.classList.add("open", "touch-preview");
  player.setAttribute("aria-hidden", "false");
  $("#touchHelp").hidden = touchPreview !== "touch";
  player.classList.toggle("help-visible", touchPreview === "touch");
}

render(); setStatus("选择游戏和音乐后即可启动");
void loadSiteNotice();
let changelogSeen = false;
try { changelogSeen = localStorage.getItem(changelogSeenKey) === "1"; } catch {}
if (!changelogSeen && !debugHarness && !touchPreview) void showChangelog(true);
