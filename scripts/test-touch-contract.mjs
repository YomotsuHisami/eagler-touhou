import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..", "..");
const read = rel => fs.readFileSync(path.join(root, rel), "utf8");
const requireText = (source, needle, label) => {
  if (!source.includes(needle)) throw new Error(`missing ${label}: ${needle}`);
};

for (const game of ["th06", "th07"]) {
  const touch = read(`${game}-eagler/src/Touch.cpp`);
  const touchHeader = read(`${game}-eagler/src/Touch.hpp`);
  const main = read(`${game}-eagler/src/main.cpp`);
  const controller = read(`${game}-eagler/src/Controller.cpp`);
  const playerSource = read(`${game}-eagler/src/Player.cpp`);
  const gui = read(`${game}-eagler/src/Gui.cpp`);
  const eaglerOptions = read(`${game}-eagler/src/EaglerOptions.hpp`);
  const practiceRuntime = read(`${game}-eagler/src/PracticeRuntime.cpp`);
  const thpracImGui = read(`${game}-eagler/src/ThpracImGui.cpp`);
  const shell = read(`${game}-eagler/resources/shell.html`);
  const sdl = read(`${game}-eagler/vendored/SDL/src/video/emscripten/SDL_emscriptenevents.c`);

  requireText(touch, "void ReleaseGameplayFingerState(SDL_FingerID id)", `${game} id-keyed release helper`);
  requireText(shell, 'touchFocusMode: "hold-button"', `${game} shell default focus method is hold-button`);
  requireText(shell, 'touchSensitivity: 100', `${game} shell default touch sensitivity is 100 percent`);
  requireText(eaglerOptions, "touchFocusMode || 'hold-button'", `${game} C++ focus-mode fallback is hold-button`);
  requireText(eaglerOptions, "inline f32 TouchSensitivity()", `${game} touch sensitivity bridge`);
  requireText(eaglerOptions, "if (!Number.isFinite(value)) return 1.0;", `${game} touch sensitivity 100-percent fallback`);
  requireText(touch, "bool ReleaseMenuGestureFinger(SDL_FingerID id)", `${game} menu gesture release helper`);
  requireText(touch, "multiFingerGesture ? TH_BUTTON_RETURNMENU : TH_BUTTON_SELECTMENU", `${game} multi-finger return semantics`);
  requireText(touch, "ReleaseMenuGestureFinger(f.fingerID);", `${game} menu UP release path`);
  requireText(touch, "secondaryEndedTwoFingerMenuGesture", `${game} lost-primary-UP menu regression self-test`);
  requireText(touch, "ReleaseGameplayFingerState(f.fingerID);", `${game} finger release cleanup`);
  requireText(touch, "HasGameplayFinger(f.fingerID) || IsFinger(g_MoveFinger, f.fingerID)", `${game} stale duplicate DOWN recovery`);
  requireText(touch, "bool Touch::DebugStateSelfTest()", `${game} touch state self-test`);
  requireText(touchHeader, "bool DebugStateSelfTest();", `${game} touch state self-test declaration`);
  requireText(touch, "EMSCRIPTEN_KEEPALIVE void TouhouAuxTouchCancelAll()", `${game} Web cancel-all export`);
  requireText(touch, "StartDoubleTapCandidate(f.fingerID, px, py);", `${game} all-gameplay-finger double-tap candidate start`);
  requireText(touch, "UpdateDoubleTapCandidate(f.fingerID, px, py);", `${game} candidate motion tracked independent of move/focus role`);
  requireText(touch, "struct DoubleTapBombTracker", `${game} gameplay double-tap Bomb tracker`);
  requireText(touch, "DOUBLE_TAP_MAX_GAP_MS = 320", `${game} bounded double-tap Bomb timing`);
  requireText(touch, "bool TryDoubleTapBomb(f32 px, f32 py)", `${game} double-tap Bomb recognizer`);
  requireText(touch, "EaglerOptions::DoubleTapBombEnabled()", `${game} double-tap Bomb explicit opt-in gate`);
  requireText(touch, "IsGameplayTouchMode() && !g_Gui.HasCurrentMsgIdx()", `${game} double-tap Bomb gameplay-only gate`);
  requireText(touch, "bool IsDialogueTouchOwner()", `${game} centralized dialogue/Stage-Clear touch owner`);
  requireText(touch, "g_Gui.IsDialogueSkippable() || g_Gui.IsWaitingForPlayerAdvance()", `${game} WAIT can own a Z tap without making automatic dialogue globally touch-owned`);
  requireText(gui, "IsWaitingForPlayerAdvance", `${game} GUI owns WAIT/PAUSE advance state`);
  requireText(gui, game === "th06" ? "MSG_OPCODE_WAIT" : "MSG_PAUSE", `${game} touch advance follows the original message wait opcode`);
  requireText(touch, "else if (TryDoubleTapBomb(px, py))", `${game} double-tap Bomb gameplay dispatch`);
  requireText(touch, "ResetDoubleTapBomb();", `${game} double-tap Bomb lifecycle reset`);
  requireText(touch, "if (EaglerOptions::TouchMovementUsesJoystick())", `${game} wheel/direct-touch mutual exclusion gate`);
  requireText(touch, "void MarkNonReplayableTouchUse()", `${game} replay eligibility owner`);
  requireText(touch, "if (!EaglerOptions::TouchMovementUsesJoystick())", `${game} both replay-capable joystick modes stay Replay eligible`);
  requireText(touch, "EaglerOptions::TouchMovementUsesJoystick() || !g_MoveFinger.active", `${game} wheel modes cannot consume direct drag delta`);
  requireText(touch, "bool Touch::GetFreeJoystickVector(f32 *x, f32 *y)", `${game} free-angle joystick vector consumer`);
  requireText(touch, "EaglerOptions::TouchMovementIsFreeJoystick()", `${game} free-angle joystick explicit mode gate`);
  requireText(touch, "MarkNonReplayableTouchUse();", `${game} touch legality owner remains centralized`);
  requireText(playerSource, "Touch::GetFreeJoystickVector(&joystickX, &joystickY)", `${game} free-angle joystick reaches player movement`);
  requireText(playerSource, "horizontalSpeed = joystickX * maxSpeed;", `${game} free-angle joystick preserves continuous X direction`);
  requireText(playerSource, "verticalSpeed = joystickY * maxSpeed;", `${game} free-angle joystick preserves continuous Y direction`);
  requireText(shell, 'document.addEventListener("pointerdown", event => {', `${game} canvas-exterior touch forwarding owner`);
  requireText(shell, "Module._TouhouAuxTouchDown(touch.id, x, y);", `${game} canvas-exterior touch reaches gameplay recognizer`);

  const upStart = touch.indexOf("void Touch::FingerUp(const SDL_TouchFingerEvent &f)");
  const motionStart = touch.indexOf("void Touch::FingerMotion", upStart);
  if (upStart < 0 || motionStart < 0) throw new Error(`${game}: FingerUp function bounds not found`);
  const up = touch.slice(upStart, motionStart);
  const dialogueTapPos = up.indexOf("if (held < 500 && std::abs(dx) <= threshold && std::abs(dy) <= threshold)");
  const releasePos = dialogueTapPos < 0 ? -1 : up.indexOf("ReleaseGameplayFingerState(f.fingerID);", dialogueTapPos);
  const modePos = up.indexOf("if (!IsGameplayTouchMode())");
  if (dialogueTapPos < 0 || releasePos < 0 || dialogueTapPos > releasePos) {
    throw new Error(`${game}: dialogue tap must be recognized on FingerUp before dialogue ownership cleanup`);
  }
  if (releasePos < 0 || modePos < 0 || releasePos > modePos) {
    throw new Error(`${game}: FingerUp cleanup must happen before current-mode routing`);
  }

  const downStart = touch.indexOf("void Touch::FingerDown(const SDL_TouchFingerEvent &f)");
  if (downStart < 0 || upStart < 0) throw new Error(`${game}: FingerDown function bounds not found`);
  const down = touch.slice(downStart, upStart);
  if (down.includes("g_DialogueTapPending = true;")) {
    throw new Error(`${game}: dialogue tap must not be deferred until a later FingerDown`);
  }
  const skippableDialogueGatePos = down.indexOf("if (IsDialogueTouchOwner())");
  const dialogueOwnerPos = down.indexOf("AssignFinger(&g_DialogueHoldFinger, f.fingerID, px, py);");
  const joystickEarlyReturnPos = down.indexOf("if (EaglerOptions::TouchMovementUsesJoystick())");
  if (skippableDialogueGatePos < 0 || dialogueOwnerPos < skippableDialogueGatePos || joystickEarlyReturnPos < 0 || dialogueOwnerPos > joystickEarlyReturnPos) {
    throw new Error(`${game}: dialogue touch ownership must be established before joystick-mode early return`);
  }
  const candidateStartPos = down.indexOf("StartDoubleTapCandidate(f.fingerID, px, py);");
  const addGameplayPos = down.indexOf("AddGameplayFinger(f.fingerID);");
  if (candidateStartPos < 0 || addGameplayPos < 0 || candidateStartPos > addGameplayPos) {
    throw new Error(`${game}: double-tap candidate must be created before move/focus gameplay ownership`);
  }

  const nextAfterMotion = touch.indexOf("u16 Touch::GetButtonBits()", motionStart);
  if (motionStart < 0 || nextAfterMotion < 0) throw new Error(`${game}: FingerMotion function bounds not found`);
  const motion = touch.slice(motionStart, nextAfterMotion);
  const candidateMotionPos = motion.indexOf("UpdateDoubleTapCandidate(f.fingerID, px, py);");
  const moveRolePos = motion.indexOf("if (IsFinger(g_MoveFinger, f.fingerID))");
  if (candidateMotionPos < 0 || moveRolePos < 0 || candidateMotionPos > moveRolePos) {
    throw new Error(`${game}: double-tap motion must be tracked before move/focus role-specific motion`);
  }
  requireText(motion, "const f32 sensitivity = EaglerOptions::TouchSensitivity();", `${game} direct-drag sensitivity sampled at movement mapping layer`);
  requireText(motion, "g_AccumDx += dxPx / scale * sensitivity;", `${game} sensitivity scales direct-drag X target distance`);
  requireText(motion, "g_AccumDy += dyPx / scale * sensitivity;", `${game} sensitivity scales direct-drag Y target distance`);

  requireText(main, '"--touch-selftest"', `${game} touch self-test CLI`);
  requireText(main, "if (!g_TouchStateSelfTest && !g_ReplayExtensionSelfTest)", `${game} developer self-tests share the persistent-shutdown guard`);

  requireText(sdl, "const SDL_FingerID id = event->pointerid + 1;", `${game} SDL Emscripten touch ID mapping`);
  requireText(shell, "const nativeCanvasTouches = new Map();", `${game} native canvas touch tracker`);
  requireText(shell, "id: event.pointerId + 1", `${game} shell SDL ID mapping`);
  requireText(shell, 'document.addEventListener("lostpointercapture", releaseTouch', `${game} lost capture release`);
  requireText(shell, 'document.addEventListener("visibilitychange"', `${game} visibility release`);
  requireText(shell, 'window.addEventListener("blur", () => { cancelAllTouches(); clearBrowserKeyboard(); });', `${game} blur touch+keyboard release`);
  requireText(shell, 'window.addEventListener("pagehide", () => { setWebAudioActive(false); cancelAllTouches(); clearBrowserKeyboard(); });', `${game} pagehide audio+touch+keyboard release`);
  requireText(shell, 'window.addEventListener("pageshow", () => setWebAudioActive(true));', `${game} Safari page restore audio lifecycle`);
  requireText(shell, 'Module._TouhouWebSetAudioActive(active ? 1 : 0)', `${game} browser lifecycle audio bridge`);
  requireText(shell, "Module._TouhouAuxTouchCancelAll()", `${game} shell cancel-all call`);

  // Web physical-key fallback: SDL_GetKeyboardState remains the normal source,
  // while browser KeyboardEvent code/key state covers Edge/IME and tablet or
  // Bluetooth keyboards whose physical keys do not reach SDL as scancodes.
  requireText(eaglerOptions, "inline u16 BrowserKeyboardBits()", `${game} browser keyboard option bridge`);
  requireText(eaglerOptions, "inline bool TouchMovementIsJoystick()", `${game} touch movement mode bridge`);
  requireText(eaglerOptions, "inline bool TouchMovementIsFreeJoystick()", `${game} free-angle joystick mode bridge`);
  requireText(eaglerOptions, "inline bool TouchMovementUsesJoystick()", `${game} all-wheel mode bridge`);
  requireText(eaglerOptions, "inline bool DoubleTapBombEnabled()", `${game} double-tap Bomb option bridge`);
  requireText(eaglerOptions, "inline i32 TouchJoystickX()", `${game} virtual joystick X bridge`);
  requireText(eaglerOptions, "inline i32 TouchJoystickY()", `${game} virtual joystick Y bridge`);
  requireText(eaglerOptions, "Module.eaglerControls.keyboardBits", `${game} browser keyboard bitset source`);
  requireText(eaglerOptions, "keyboardPulseBits", `${game} browser keyup-only pulse consumer`);
  requireText(eaglerOptions, "inline u16 BrowserGamepadDirectionBits()", `${game} browser Gamepad D-pad option bridge`);
  requireText(eaglerOptions, "pad.buttons[12]?.pressed", `${game} browser Gamepad D-pad Up`);
  requireText(eaglerOptions, "pad.buttons[13]?.pressed", `${game} browser Gamepad D-pad Down`);
  requireText(eaglerOptions, "pad.buttons[14]?.pressed", `${game} browser Gamepad D-pad Left`);
  requireText(eaglerOptions, "pad.buttons[15]?.pressed", `${game} browser Gamepad D-pad Right`);
  requireText(eaglerOptions, "if (!/keyboard|\\bkb\\b/i.test(id)) continue;", `${game} browser Gamepad fallback keyboard-only ownership`);
  if (eaglerOptions.includes("pad.mapping !== 'standard'")) {
    throw new Error(`${game}: real standard gamepads must remain SDL-owned; browser D-pad fallback is keyboard-only`);
  }
  requireText(eaglerOptions, "inline void ResetBrowserKeyboard()", `${game} browser keyboard reset bridge`);
  requireText(controller, "buttons |= EaglerOptions::BrowserKeyboardBits();", `${game} SDL + browser keyboard merge`);
  requireText(controller, "buttons |= EaglerOptions::BrowserGamepadDirectionBits();", `${game} browser Gamepad D-pad merge`);
  requireText(controller, "EaglerOptions::TouchMovementIsJoystick()", `${game} virtual joystick enters controller input path`);
  requireText(controller, "EaglerOptions::TouchJoystickX()", `${game} virtual joystick X consumed by controller`);
  requireText(controller, "EaglerOptions::TouchJoystickY()", `${game} virtual joystick Y consumed by controller`);
  if (game === "th06") {
    const replay = read("th06-eagler/src/ReplayManager.cpp");
    requireText(replay, "TH_BUTTON_SHOOT | TH_BUTTON_BOMB | TH_BUTTON_FOCUS | TH_BUTTON_SKIP | TH_BUTTON_DIRECTION", "th06 Replay captures controller direction/action bits");
    requireText(controller, "JOYSTICK_MIDPOINT(0, INT16_MAX)", "th06 virtual wheel uses original 50-percent axis threshold");
  } else {
    const replay = read("th07-eagler/src/ReplayManager.cpp");
    requireText(replay, "g_CurFrameGameInput = curInput = g_CurFrameRawInput;", "th07 Replay captures raw controller input word");
    requireText(controller, "x > g_Supervisor.cfg.padAxisX", "th07 virtual wheel uses configured original X threshold");
    requireText(controller, "y > g_Supervisor.cfg.padAxisY", "th07 virtual wheel uses configured original Y threshold");
  }
  requireText(controller, "EaglerOptions::ResetBrowserKeyboard();", `${game} reset clears browser keyboard`);
  requireText(controller, "SDL_GAMEPAD_BUTTON_DPAD_UP", `${game} Android/multi-source Gamepad D-pad Up fallback`);
  requireText(controller, "SDL_GAMEPAD_BUTTON_DPAD_DOWN", `${game} Android/multi-source Gamepad D-pad Down fallback`);
  requireText(controller, "SDL_GAMEPAD_BUTTON_DPAD_LEFT", `${game} Android/multi-source Gamepad D-pad Left fallback`);
  requireText(controller, "SDL_GAMEPAD_BUTTON_DPAD_RIGHT", `${game} Android/multi-source Gamepad D-pad Right fallback`);
  requireText(shell, 'case "KeyZ": return 1 << 0;', `${game} physical Z bridge`);
  requireText(shell, 'case "KeyX": return 1 << 1;', `${game} physical X bridge`);
  requireText(shell, 'case "ArrowUp": case "Numpad8": return 1 << 4;', `${game} physical Up bridge`);
  requireText(shell, 'if (key === "z") return 1 << 0;', `${game} key fallback for external Z`);
  requireText(shell, 'if (key === "arrowup") return 1 << 4;', `${game} key fallback for external Up`);
  requireText(shell, 'case 38: return 1 << 4;  // Up', `${game} legacy DOM Up fallback`);
  requireText(shell, 'case 37: return 1 << 6;  // Left', `${game} legacy DOM Left fallback`);
  requireText(shell, 'case "keyboard":', `${game} host keyboard message bridge`);
  requireText(shell, '!Number.isInteger(message.keyCode)', `${game} host keyboard legacy keyCode validation`);
  requireText(shell, 'case "keyboard-clear": clearBrowserKeyboard(); break;', `${game} host keyboard clear bridge`);
  requireText(shell, 'case "touch-cancel": cancelAllTouches(); reply(message.request, true); break;', `${game} host mouse-mode touch cancellation bridge`);
  requireText(shell, 'case "thprac-mouse":', `${game} hosted thprac mouse protocol`);
  requireText(shell, 'Module._TouhouThpracMouseEvent', `${game} shell forwards thprac mouse to native bridge`);
  requireText(shell, 'Module.canvas.getBoundingClientRect()', `${game} shell owns thprac mouse DOM coordinate conversion`);
  requireText(shell, '* 640 / mouseRect.width', `${game} thprac mouse X becomes fixed game coordinate`);
  requireText(shell, '* 480 / mouseRect.height', `${game} thprac mouse Y becomes fixed game coordinate`);
  requireText(thpracImGui, 'EMSCRIPTEN_KEEPALIVE void TouhouThpracMouseEvent', `${game} native thprac mouse bridge`);
  requireText(thpracImGui, 'ThpracImGui::ProcessEvent(event);', `${game} thprac mouse bridge reuses existing ImGui SDL event owner`);
  requireText(thpracImGui, 'g_MousePositionFromBridge', `${game} native thprac mouse keeps bridged coordinate ownership`);
  requireText(thpracImGui, '!g_MousePositionFromBridge && SDL_GetMouseFocus()', `${game} SDL native mouse cannot overwrite bridged position`);
  requireText(shell, 'case "Backspace": return 1 << 0;', `${game} thprac Backspace browser bridge`);
  requireText(shell, 'case "F1": return 1 << 1;', `${game} thprac F1 browser bridge`);
  requireText(shell, 'case "F7": return 1 << 7;', `${game} thprac F7 browser bridge`);
  requireText(shell, 'thpracKeyboardBits: 0', `${game} thprac browser key bitset`);
  requireText(practiceRuntime, 'case SDL_SCANCODE_BACKSPACE: bit = 0; break;', `${game} thprac Backspace Emscripten bit consumer`);
  requireText(practiceRuntime, 'case SDL_SCANCODE_F7: bit = 7; break;', `${game} thprac F7 Emscripten bit consumer`);
  requireText(practiceRuntime, 'EaglerOverlayKeyDown(scancode)', `${game} SDL and hosted thprac key merge`);
  requireText(practiceRuntime, 'window.dispatchEvent(new CustomEvent("eagler-thprac-menu"', `${game} actual THOverlay menu-state publication`);
  requireText(shell, 'touchMovementMode: options.touchMovementMode || "touch"', `${game} movement-mode install`);
  requireText(shell, 'touchSensitivity: options.touchSensitivity ?? 100', `${game} touch sensitivity configure install`);
  requireText(shell, 'Module.eaglerOptions.touchSensitivity = message.touchSensitivity', `${game} live touch sensitivity update`);
  requireText(shell, '["joystick", "joystick-free", "touch", "touch-unlimited"]', `${game} movement-mode validator includes free-angle joystick`);
  requireText(shell, 'doubleTapBombEnabled: !!options.touchEnabled && !!options.doubleTapBombEnabled', `${game} double-tap Bomb install`);
  requireText(shell, 'Module.eaglerControls.joystickX = message.joystickX', `${game} hosted joystick X install`);
  requireText(shell, 'Module.eaglerControls.joystickY = message.joystickY', `${game} hosted joystick Y install`);
  requireText(shell, "if (event.metaKey || event.altKey) return;", `${game} browser chord isolation`);
  requireText(shell, "keyboardBits: 0", `${game} keyboard bitset initial state`);
  requireText(shell, "keyboardPulseBits: 0", `${game} keyboard pulse initial state`);
  requireText(shell, "const hadDownOwner = browserKeyboardDown.delete(id);", `${game} keyup owner detection`);

  // iOS/WebKit must not be allowed to turn an active game gesture into text
  // selection, callout, magnifier or browser zoom. Canvas sizing must use an
  // explicit 4:3 contain against the iframe's measured client box: width-first
  // CSS can overflow short desktop windows, while 100vw/100vh can become stale
  // during mobile fullscreen/orientation transitions.
  requireText(shell, "maximum-scale=1,user-scalable=no", `${game} fixed mobile viewport scale`);
  requireText(shell, "-webkit-user-select:none", `${game} Safari selection suppression`);
  requireText(shell, "-webkit-touch-callout:none", `${game} Safari callout suppression`);
  requireText(shell, "width:var(--touhou-canvas-width)!important;height:var(--touhou-canvas-height)!important", `${game} runtime-proof canvas CSS ownership`);
  requireText(shell, "const containCanvasSize = (width, height) => {", `${game} measured 4:3 contain helper`);
  requireText(shell, "let cssHeight = Math.floor(cssWidth * 3 / 4);", `${game} width-constrained 4:3 sizing`);
  requireText(shell, "cssWidth = Math.floor(cssHeight * 4 / 3);", `${game} height-constrained 4:3 sizing`);
  requireText(shell, "if (!root) return;", `${game} canvas sizing DOM readiness guard`);
  requireText(shell, "const size = containCanvasSize(root.clientWidth, root.clientHeight);", `${game} iframe client-box sizing source`);
  requireText(shell, 'root.style.setProperty("--touhou-canvas-width", `${size.width}px`);', `${game} canvas width publication`);
  requireText(shell, 'root.style.setProperty("--touhou-canvas-height", `${size.height}px`);', `${game} canvas height publication`);
  requireText(shell, 'window.addEventListener("resize", fitCanvasToViewport, { passive: true });', `${game} canvas resize lifecycle`);
  if (shell.includes("@media (min-aspect-ratio:4/3){canvas{width:auto;height:100%}}")) {
    throw new Error(`${game}: width-first media-query canvas sizing can overflow ordinary desktop windows`);
  }
  requireText(shell, '["contextmenu", "selectstart", "dragstart", "gesturestart", "gesturechange", "gestureend"]', `${game} browser gesture cancellation set`);
}

const hostApp = read("eagler-touhou/app.js");
const hostCss = read("eagler-touhou/styles.css");
const touchGuideCss = read("eagler-touhou/touch-guide.css");
const aboutCss = read("eagler-touhou/about.css");
const migrateHtml = read("eagler-touhou/migrate.html");
const hostHtml = read("eagler-touhou/index.html");
const faqHtml = read("eagler-touhou/faq.html");
const hostPackage = JSON.parse(read("eagler-touhou/package.json"));
const th06Touch = read("th06-eagler/src/Touch.cpp");
const th07Touch = read("th07-eagler/src/Touch.cpp");

requireText(hostApp, "const target = player;", "dedicated player fullscreen owner");
requireText(hostHtml, 'id="lessMotionToggle"', "desktop reduced-motion control");
requireText(hostHtml, 'href="faq.html">常见问题</a>', "FAQ navigation link");
requireText(hostApp, 'const lessMotionStorageKey = "eagler-touhou-less-motion-v1";', "reduced-motion preference persistence");
requireText(hostApp, 'document.body.classList.toggle("less-motion", state.lessMotion);', "reduced-motion body state");
if (hostApp.includes("bringSelectedCardForward") || hostApp.includes("main.insertBefore(card")) {
  throw new Error("selected game cards must expand in their existing DOM position");
}
requireText(hostApp, "function renderChangelogText(target, source)", "structured changelog renderer");
requireText(hostHtml, '<h1 id="changelogTitle">更新日志</h1>', "FAQ-like changelog heading");
requireText(hostCss, '.motion-toggle{display:none}', "reduced-motion control hidden on mobile");
requireText(hostCss, '--ui-font:"ET Yatra","ET Chill Round",sans-serif', "Yatra and Chill Round UI stack without Unifont fallback");
requireText(hostCss, 'assets/fonts/yatra-one-latin.woff2?v=20260821-1', "local Yatra font-face");
requireText(hostCss, 'assets/fonts/chill-round-gothic-site-medium.woff2?v=20260821-1', "local Chill Round medium body font-face");
requireText(hostCss, 'assets/fonts/chill-round-gothic-site-bold.woff2?v=20260821-1', "local Chill Round bold font-face");
requireText(hostCss, 'assets/fonts/chill-round-gothic-site-heavy.woff2?v=20260821-1', "local Chill Round heavy title font-face");
requireText(hostHtml, 'href="assets/fonts/yatra-one-latin.woff2?v=20260821-1" as="font"', "Yatra preload");
requireText(hostHtml, 'href="assets/fonts/chill-round-gothic-site-medium.woff2?v=20260821-1" as="font"', "Chill Round body preload");
requireText(hostHtml, 'href="assets/fonts/chill-round-gothic-site-heavy.woff2?v=20260821-1" as="font"', "Chill Round card-title preload");
for (const [source, label] of [[hostCss, "host CSS"], [touchGuideCss, "touch guide CSS"], [aboutCss, "about CSS"]]) {
  if (source.includes('"Courier New"') || source.includes('"Microsoft YaHei"')) {
    throw new Error(`${label} must not retain legacy ordinary UI font stacks`);
  }
}
if (migrateHtml.includes('"Courier New"') || migrateHtml.includes('"Microsoft YaHei"')) {
  throw new Error("migration page must not retain legacy ordinary UI font stacks");
}
requireText(hostCss, '.changelog-window{display:grid', "changelog surface present");
requireText(hostCss, 'font:13px/1.65 var(--ui-font)', "FAQ-like changelog uses the unified font stack");
requireText(hostCss, '.changelog-item{padding:16px 0 17px;border-bottom:1px dotted #555}', "FAQ-like changelog item rhythm");
if (hostCss.includes("ET Exotic 350") || hostCss.includes("ET Zen Maru") || hostCss.includes("ET Touhou Serif")) {
  throw new Error("retired Exotic, Zen Maru, and serif UI fonts must not remain active");
}
requireText(hostCss, '.game h2{margin:0;font:900 clamp(32px,3.6vw,58px)/.98 var(--ui-font)', "main game titles opt into Chill Round Heavy");
requireText(hostCss, '.tools-head h3{position:relative;z-index:1;margin:17px 0 0;font:900 25px/1.15 var(--ui-font)', "tool game title uses Chill Round Heavy");
requireText(hostCss, '.game-id{position:absolute;z-index:0;left:-3px;top:-8px;margin:0;color:rgba(218,224,215,.08);font:900 56px/.9 var(--art-font)', "tool game ID forms a large translucent title backdrop");
if (hostCss.includes('content:"TOOLS"')) throw new Error("the decorative TOOLS label must stay removed");
requireText(hostHtml, '<div class="no">06</div>', "TH06 card number omits its TH prefix");
requireText(hostHtml, '<div class="no">07</div>', "TH07 card number omits its TH prefix");
if (hostHtml.includes('<div class="no"><span>TH</span>')) throw new Error("game-card numbers must not retain the TH prefix");
requireText(hostCss, '.less-motion .game{transform:none!important;transform-style:flat;transition:border-color .12s ease', "desktop reduced-motion mirrors mobile flat cards");
requireText(hostCss, '.less-motion .tools{transform:none;transition:none!important}', "desktop reduced-motion uses the mobile direct layout change");
requireText(hostCss, '.less-motion .game:before{display:block;inset:0;transform:scale(1.02);transition:filter .18s ease,opacity .16s ease}', "desktop reduced-motion preserves imagery and lightweight transitions");
requireText(hostApp, 'const mobileLite = matchMedia("(max-width: 780px), (hover: none), (pointer: coarse)").matches || state.lessMotion;', "desktop reduced motion reuses the mobile lightweight selection trigger");
requireText(hostCss, '.less-motion .main.mobile-selection-enter .game.selected{animation:mobile-lite-enter .14s ease-out both}', "desktop reduced motion reuses the mobile card cue");
if (hostCss.includes('.less-motion .game:before{display:none}')) throw new Error("desktop reduced-motion must not remove card backgrounds");
requireText(hostCss, '.main.has-selection .game.selected:before{display:block;inset:0;background-image:', "mobile selected card retains its background layer");
requireText(hostCss, '.main.has-selection .game-th07.selected:before{background-position:58% center}', "mobile selected TH07 keeps its intended crop");
requireText(hostCss, '.main.has-selection .game:not(.selected):before{display:block', "unselected card background blur surface");
requireText(hostCss, 'filter:brightness(.72) saturate(.72) blur(3px)', "unselected card dimmed background blur");
requireText(hostCss, '.main:not(.has-selection) .game,.main.has-selection .game:not(.selected){background:#171615;border-color:rgba(235,231,223,.22)}', "mobile initial and collapsed cards share clean border surface");
requireText(hostCss, '.main:not(.has-selection) .game:before{display:block;inset:0', "mobile initial cards use one internal image layer");
requireText(hostCss, 'filter:brightness(.72) saturate(.72);transform:scale(1.02)', "mobile initial cards stay dimmed without blur");
requireText(hostCss, '.main.has-selection .game:not(.selected){background:#171615;border-color:rgba(235,231,223,.22)}', "mobile unselected card keeps a crisp border over a solid base");
requireText(hostCss, '.main.has-selection .game:not(.selected):before{inset:0}', "mobile unselected blur layer stays inside the card edge");
requireText(hostHtml, '<div class="file-tools-grid">', "save and replay actions share one two-column group");
requireText(hostCss, '.file-tools-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr))', "save and replay actions use two columns");
requireText(hostCss, '.item{padding:10px 0;border:0}', "tool items do not use horizontal separators");
requireText(hostCss, '.itemtop:before,.mobile-options-head:before{content:"";', "tool headings use the reference-style vertical accent");
requireText(hostCss, '.feature-language .itemtop:before,.mobile-options-head:before{top:.6em}', "translation and mobile adaptation accents align to the title text");
requireText(hostCss, '.feature-language .option-select{width:calc(100% - 14px);margin-left:14px;', "translation select aligns beneath the title text");
requireText(hostCss, '.mobile-option{display:flex;align-items:center;justify-content:space-between;gap:11px;min-height:36px;padding:7px 0 7px 2px;border:0', "mobile adaptation items do not use horizontal separators");
requireText(hostCss, '.site-notice{display:none!important}', "site notice stays temporarily hidden");
requireText(hostCss, '.masthead{position:relative;z-index:10;margin:0 calc(var(--sheet-edge)*-1);', "masthead extends to the top page edges");
requireText(hostCss, 'border-radius:0 0 20px 20px;background:transparent;box-shadow:none;backdrop-filter:none', "masthead stays transparent with bottom-only rounded geometry");
requireText(hostCss, '.masthead{margin:0 -14px;padding:11px 14px 8px;', "mobile masthead stays close to the system-protected top edge");
requireText(hostCss, '.masthead-link{position:relative;isolation:isolate;min-height:36px;box-sizing:border-box;padding:0 12px;border:0;border-radius:8px;background:transparent;', "masthead actions use the reference navbar button geometry");
requireText(hostCss, '.masthead-link:before{content:"";position:absolute;inset:0;z-index:-1;border-radius:inherit;background:transparent;transform:scale(.85);', "masthead actions keep the reference background layer transparent at rest");
requireText(hostCss, '.masthead-link:hover:before{background:#f1e4e6;transform:scale(1)}', "masthead actions expand the light theme layer only on hover");
requireText(hostCss, '.masthead-link:hover{background:transparent;color:#b33142}', "masthead actions switch to prominent theme text only on hover");
requireText(hostCss, 'text-decoration:none;font-weight:700;transition:color .15s ease', "masthead action labels use the requested bold weight");
requireText(hostCss, '.motion-toggle i{display:none}', "reduced-motion toggle does not use the old status dot");
requireText(hostCss, '.motion-toggle[aria-pressed="true"]{color:#8f2633}.motion-toggle[aria-pressed="true"]:before{background:#f1e4e6;transform:scale(1)}', "reduced-motion toggle uses a selected MD3 container");
requireText(hostCss, '.masthead-link:active{background:transparent;color:#8f2633;transform:scale(.9)}', "masthead actions use the reference press scale");
requireText(hostCss, '.masthead-link[hidden]{display:none}', "hidden masthead actions do not occupy layout space");
requireText(hostCss, '.masthead-link{min-height:32px;padding:0 5px;border-radius:8px;letter-spacing:.08em}', "mobile masthead actions stay compact on one line");
requireText(hostCss, 'border-radius:0 0 16px 16px;column-gap:12px}.brand{font-size:7.5px}', "mobile masthead keeps breathing room between brand and actions");
requireText(hostCss, '/* MD3-style filled surfaces: elevation and tonal fill replace edge outlines. */', "MD3 filled surface treatment");
requireText(hostCss, '.tools{border:0;background:#101210;box-shadow:0 5px 18px rgba(0,0,0,.34)}', "tools use a borderless filled card");
if (hostHtml.includes('id="musicOptions"') || hostHtml.includes('id="musicMore"') || hostHtml.includes('data-music=')) {
  throw new Error("the homepage music selector must stay removed");
}
requireText(hostCss, '.game small{display:block;margin-top:10px;font:600 13px/1.3 var(--art-font)', "game English subtitle uses Yatra through the art stack");
requireText(hostCss, '.game .no,.game h2{text-shadow:0 0 2px rgba(0,0,0,.85),2px 2px 8px rgba(0,0,0,.8)}', "large game-card text follows the reference title-shadow proportions");
requireText(hostCss, '.game small,.game .rail-title{text-shadow:0 0 1px rgba(0,0,0,.8),1px 1px 4px rgba(0,0,0,.7)}', "small game-card text follows the reference subtitle-shadow proportions");
requireText(hostHtml, '<span class="rail-title"><strong>東方紅魔郷</strong> ~ the Embodiment of Scarlet Devil</span>', "TH06 collapsed card separates its Chinese title for bold styling");
requireText(hostHtml, '<span class="rail-title"><strong>東方妖々夢</strong> ~ Perfect Cherry Blossom</span>', "TH07 collapsed card separates its Chinese title for bold styling");
requireText(hostCss, '.main:not(.has-selection) .game .rail-title strong,.main.has-selection .game:not(.selected) .rail-title strong{font-weight:700}', "default and unselected card Chinese titles use bold without affecting Latin text");
requireText(hostCss, '.transfer{position:absolute', "download transfer surface present");
requireText(hostCss, 'font:12px/1.35 var(--ui-font)', "download transfer uses the unified font stack");
requireText(hostCss, '.touch-fire strong{font:700 13px/1.1 var(--ui-font)', "touch game buttons use Chill Round through the unified stack");
requireText(faqHtml, "感谢 Goan114 的整理。", "FAQ commenter attribution");
requireText(aboutCss, '.about-page h2:before{content:"";position:absolute;left:0;top:.675em;width:4px;height:16px;border-radius:999px;background:var(--red-bright);', "FAQ and About headings use the shared vertical accent");
requireText(aboutCss, '.about-page h2~p:not(.about-foot),.about-page h2~dl{margin-left:14px}', "FAQ and About section copy aligns with heading text");
requireText(aboutCss, '.about-page hr{display:none}', "About horizontal separators are removed");
requireText(aboutCss, '.faq-list{margin-top:18px;border:0}.faq-item{padding:16px 0 17px;border:0}', "FAQ horizontal separators are removed");
requireText(faqHtml, "<strong>Android：</strong>Via（仅 &lt; 5 MB） / Edge / Chrome", "FAQ Android browser recommendations without links");
if (faqHtml.includes('https://viayoo.com/zh-cn/docs/get-via.html#org5b6c6b7') ||
    faqHtml.includes('https://learn.microsoft.com/zh-cn/deployedge/microsoft-edge-install-mobile-china') ||
    faqHtml.includes('https://chrome.cn.uptodown.com/android')) {
  throw new Error("Android browser recommendations must not include download links");
}
requireText(faqHtml, "游戏闪退 / 卡顿 / 黑屏 / 加载异常 / 断触（夸克）等浏览器相关问题怎么办？", "FAQ browser troubleshooting question");
requireText(faqHtml, 'href="https://www.google.com/chrome/"', "FAQ Windows Chrome official link");
requireText(faqHtml, "若使用以上任一浏览器却仍然遇到了问题，请与我们反馈。", "FAQ browser feedback request");
requireText(faqHtml, "会有永夜抄/风神录......（其他作品）/小数点/格斗作/二次创作......吗？", "FAQ original future-games question");
requireText(faqHtml, "下载不了资源怎么办？", "FAQ original download question");
if (faqHtml.includes("手机版 Replay 无法保存！") || faqHtml.includes("手机版更新以后不能跳过剧情了！")) {
  throw new Error("removed FAQ questions must stay absent");
}
if (hostApp.includes("mobileDevice ? document.documentElement : player")) {
  throw new Error("mobile fullscreen must not own documentElement; root fullscreen can poison page gesture state after exit");
}
requireText(hostApp, "function isPlayerFullscreen()", "mobile/desktop fullscreen state helper");
requireText(hostApp, 'const hostedGameKeyCodes = new Set([', "host external-keyboard bridge inventory");
requireText(hostApp, 'const hostedGameLegacyKeyCodes = new Set([8, 13, 16, 17, 27, 36, 37, 38, 39, 40', "host legacy DOM keyboard bridge inventory including Backspace");
requireText(hostApp, '112, 113, 114, 115, 116, 117, 118', "host legacy F1-F7 keyboard bridge inventory");
requireText(hostApp, 'window.addEventListener("keydown", forwardHostedKeyboard, true);', "host keydown relay");
requireText(hostApp, 'window.addEventListener("keyup", forwardHostedKeyboard, true);', "host keyup relay");
requireText(hostApp, 'command: "keyboard-clear"', "host keyboard lifecycle clear message");
requireText(hostApp, 'window.addEventListener("blur", clearHostedKeyboard);', "host keyboard blur clear");
requireText(hostApp, 'command: "keyboard", down: event.type === "keydown"', "host-to-shell keyboard message");
requireText(hostApp, 'keyCode,', "host-to-shell legacy keyCode relay");
requireText(hostApp, '"Escape", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"', "fullscreen game keyboard lock directions");
if (hostApp.includes('if (mobileDevice || !isPlayerFullscreen() || !navigator.keyboard?.lock) return;')) {
  throw new Error("mobile external-keyboard lock must not be disabled before feature detection");
}
requireText(hostApp, 'for (const type of ["contextmenu", "selectstart", "dragstart", "gesturestart", "gesturechange", "gestureend"])', "host Safari gesture suppression");
requireText(hostApp, 'fullscreenToggle.addEventListener("click"', "fullscreen activates only after the pointer sequence completes");
if (hostApp.includes('fullscreenToggle.addEventListener("pointerdown"')) throw new Error("fullscreen must never transition during active pointerdown");
requireText(hostHtml, 'id="gameZoomToggle"', "mobile game zoom mode button");
requireText(hostHtml, 'id="magnifierOption"', "mobile adaptation magnifier option");
requireText(hostHtml, '>放大镜<small id="magnifierHint">允许在游戏过程中通过双指手势放大游戏画面。<em class="option-warning" id="magnifierConflict" hidden>与双指低速不兼容。</em>', "mobile adaptation magnifier copy and two-finger conflict warning");
requireText(hostHtml, '<section class="item feature-section feature-language" id="languageOption">', "translation uses an independent stacked section");
requireText(hostHtml, '<section class="item feature-section" id="thpracOption">', "thprac uses an independent stacked section");
if (hostHtml.includes('id="featureColumns"') || hostCss.includes('.feature-columns')) {
  throw new Error("translation and thprac must not be grouped into columns");
}
if (/<section[^>]+id="(?:languageOption|thpracOption|magnifierOption)"[^>]*\shidden(?:\s|>)/.test(hostHtml)) {
  throw new Error("translation, thprac, and magnifier controls must always be rendered visibly");
}
if (hostApp.includes('languageOption.hidden') || hostApp.includes('$("#thpracOption").hidden') || hostApp.includes('$("#magnifierOption").hidden')) {
  throw new Error("feature availability must not hide translation, thprac, or magnifier UI");
}
if (hostHtml.includes('id="experimentalOptions"') || hostHtml.includes('id="experimentalOptionsToggle"') || hostHtml.includes('>实验性功能<')) {
  throw new Error("the experimental feature accordion must stay removed");
}
const mobileOptionsBodyStart = hostHtml.indexOf('id="mobileOptionsBody"');
const magnifierOptionStart = hostHtml.indexOf('id="magnifierOption"');
const touchLayoutOptionStart = hostHtml.indexOf('class="mobile-option touch-layout-option"', mobileOptionsBodyStart);
const alwaysHitboxOptionStart = hostHtml.indexOf('id="alwaysHitboxToggle"', mobileOptionsBodyStart);
const mobileOptionsEnd = hostHtml.indexOf('<div class="launch-wrap">', mobileOptionsBodyStart);
const laterMobileOption = hostHtml.indexOf('class="mobile-option', magnifierOptionStart + 1);
if (mobileOptionsBodyStart < 0 || touchLayoutOptionStart < mobileOptionsBodyStart ||
    alwaysHitboxOptionStart < touchLayoutOptionStart || magnifierOptionStart < alwaysHitboxOptionStart || magnifierOptionStart > mobileOptionsEnd ||
    (laterMobileOption >= 0 && laterMobileOption < mobileOptionsEnd)) {
  throw new Error("always-hitbox must live inside mobile adaptation and magnifier must remain its final item");
}
requireText(hostHtml, '>低速时显示判定点</span><button class="option-switch" id="th06HitboxToggle"', "TH06 focus hitbox label");
requireText(hostApp, 'magnifierEnabled: false', "magnifier remains an opt-in preference");
requireText(hostApp, 'state.mobileOpen = mobileDevice || document.documentElement.clientWidth <= 780;', "mobile adaptation defaults collapsed on desktop and expanded on mobile before first render");
requireText(hostApp, 'const available = state.options.magnifierEnabled && (mobileDevice || navigator.maxTouchPoints > 0) && state.launched && !touchLayoutEditing;', "enabled magnifier is continuously active on touch-capable launched players");
requireText(hostHtml, 'id="magnifierOption"', "magnifier setting remains visible regardless of current device capability");
requireText(hostApp, 'const available = (mobileDevice || navigator.maxTouchPoints > 0) && state.launched && !touchLayoutEditing;', "orientation action is available on touch-capable devices, including touch PCs");
requireText(hostApp, 'gameZoomToggle.addEventListener("click"', "zoom mode activates only after the pointer sequence completes");
if (hostApp.includes('gameZoomToggle.addEventListener("pointerdown"')) throw new Error("zoom mode must never transition during active pointerdown");
const zoomBridgeStart = hostApp.indexOf("function installGameZoomInputBridge()");
const zoomBridgeEnd = hostApp.indexOf("function clampGameZoomScale", zoomBridgeStart);
if (zoomBridgeStart < 0 || zoomBridgeEnd < 0) throw new Error("zoom input bridge function bounds not found");
const zoomBridge = hostApp.slice(zoomBridgeStart, zoomBridgeEnd);
requireText(zoomBridge, "uninstallGameZoomInputBridge();", "zoom bridge is rebound for every iframe load");
if (zoomBridge.includes("gameZoomInputWindow === win")) throw new Error("zoom bridge must not trust stable iframe WindowProxy identity across reloads");
requireText(hostApp, 'function resetGameZoomFromControl()', "magnifier control is a reset action");
requireText(hostApp, 'showToast("画面缩放已恢复为 100%"', "magnifier reset reports restored 100% view");
requireText(hostHtml, 'id="gameZoomToggle" type="button" aria-label="恢复游戏画面原位置和大小" title="恢复原位置和大小" hidden><strong>复位</strong>', "in-game magnifier button is a reset control");
requireText(hostHtml, 'id="magnifierToggle" type="button" role="switch" aria-checked="false"', "mobile adaptation magnifier option remains a switch");
requireText(hostApp, '$("#magnifierConflict").hidden = state.options.touchFocusMode !== "two-finger";', "magnifier incompatibility copy follows two-finger focus mode");
requireText(hostApp, 'gameZoomState.active = available;', "enabled magnifier no longer needs a second mode toggle");
if (hostApp.includes('function setGameZoomMode(')) throw new Error("enabled magnifier must not require a separate zoom mode");
const resetRuntimeStart = hostApp.indexOf("function resetRuntime()");
const resetRuntimeEnd = hostApp.indexOf("function prepareMidi()", resetRuntimeStart);
if (resetRuntimeStart < 0 || resetRuntimeEnd < 0) throw new Error("resetRuntime function bounds not found");
const resetRuntimeBody = hostApp.slice(resetRuntimeStart, resetRuntimeEnd);
requireText(resetRuntimeBody, "uninstallGameZoomInputBridge();", "runtime reset removes stale zoom input bridge");
requireText(hostCss, ".game-zoom-toggle,.orientation-toggle{position:absolute;z-index:32", "zoom/orientation UI stays outside transformed game frame");
requireText(hostCss, ".orientation-toggle{right:max(114px", "orientation action stays ahead of the later magnifier action");
requireText(hostHtml, 'id="orientationToggle"', "top-right mobile orientation action");
requireText(hostApp, 'orientationToggle.addEventListener("click"', "orientation action activates after click");
requireText(hostApp, 'void switchTouchLayoutOrientation();', "top-right orientation action reuses real orientation path");
requireText(hostCss, ".game-zoom-toggle{right:max(174px", "later magnifier action is the leftmost/last top-right action");
if (hostHtml.indexOf('id="orientationToggle"') > hostHtml.indexOf('id="gameZoomToggle"')) {
  throw new Error("orientation action must precede the later-added magnifier in DOM order");
}
requireText(hostApp, "const gameZoomMinScale = 1;", "game zoom cannot shrink below the original 100-percent view");
requireText(hostApp, "const gameZoomMaxScale = 3;", "game zoom maximum scale");
requireText(hostApp, "resetGameZoom();", "magnifier reset restores original viewport");
requireText(hostApp, 'function syncTransientOverlayHost()', "fullscreen-aware transient overlay host");
requireText(hostApp, 'fullscreenElement === player ? player : document.body', "toast and startup errors move inside the fullscreen player");
const showToastBody = hostApp.slice(hostApp.indexOf("function showToast("), hostApp.indexOf("function syncTransientOverlayHost("));
requireText(showToastBody, 'syncTransientOverlayHost();', "toast resolves its fullscreen host before display");
const fullscreenChangeBody = hostApp.slice(hostApp.indexOf("function handleFullscreenChange()"), hostApp.indexOf('document.addEventListener("fullscreenchange"'));
requireText(fullscreenChangeBody, 'syncTransientOverlayHost();', "fullscreen changes rehome visible transient overlays");
requireText(hostCss, '.toast{z-index:80}', "toast remains above fullscreen player controls and editor overlays");
requireText(hostApp, 'loading.className = "replay-loading";', "replay manager exposes an immediate loading state");
requireText(hostApp, 'loading.innerHTML = \'<i aria-hidden="true"></i><span>正在读取录像…</span>\';', "replay loading state has visible progress copy");
requireText(hostCss, '@keyframes replay-loading-spin{to{transform:rotate(360deg)}}', "replay manager loading spinner animation");
requireText(hostHtml, '<header><strong>录像管理</strong>', "replay manager title is localized");
requireText(hostHtml, '拖放 .RPY / .RPYX / .ZIP 到此处导入', "replay import hint is localized");
requireText(hostApp, 'rename.textContent = "改名";', "replay rename is a separate action");
requireText(hostApp, 'throw new Error("已存在同名录像文件")', "replay rename cannot overwrite another replay");
requireText(hostApp, 'remove.className = "replay-delete"; remove.textContent = "删除";', "replay delete is a separate destructive action");
requireText(hostApp, 'if (!confirm(`确定删除录像「${name}」吗？\\n\\n此操作无法撤销。`)) return;', "replay deletion requires explicit confirmation");
if (hostApp.includes('改名/删除') || hostHtml.includes('REPLAY MANAGER') || hostHtml.includes('DROP .RPY')) throw new Error("replay manager must not retain the old combined or English controls");
requireText(hostHtml, '<span id="launchText">启动游戏</span><span class="launch-icon" aria-hidden="true"><svg viewBox="0 0 24 24">', "launch action uses localized copy and an inline MD arrow");
requireText(hostApp, '$("#launchText").textContent = "启动游戏";', "launch copy stays stable after render");
requireText(hostCss, 'html,body,.sheet{background:#0d0d0c}', "page uses the requested solid background color");
requireText(hostApp, 'const keepReplayManagerOpen = kind === "replay" && replayDialog.open;', "replay imports preserve an open manager window");
requireText(hostApp, 'if (keepReplayManagerOpen) await refreshReplayManager();', "replay manager refreshes in place after import");
const manageReplayBody = hostApp.slice(hostApp.indexOf("async function manageReplays()"), hostApp.indexOf("const replayWindow", hostApp.indexOf("async function manageReplays()")));
if (manageReplayBody.indexOf('dialog.showModal();') > manageReplayBody.indexOf('await refreshReplayManager();')) {
  throw new Error("replay manager must open its loading UI before the potentially slow replay listing");
}
requireText(hostApp, "Math.hypot(b.x - a.x, b.y - a.y)", "pinch zoom uses finger distance only");
requireText(hostHtml, 'id="gameViewport"', "game viewport wrapper isolates visual transform from iframe input owner");
requireText(hostApp, 'gameViewport.style.transform = `translate3d(${base.x + clamped.x}px,${base.y + clamped.y}px,0) scale(${clamped.scale})`;', "game wrapper composes saved default position with pinch transform instead of transforming iframe directly");
if (hostApp.includes('frame.style.transform =')) throw new Error("live iframe must never be transformed during active pointer ownership");
requireText(hostApp, 'resetGameZoomFromControl();', "zoom button resets the always-on magnifier transform");
requireText(hostApp, 'document.addEventListener("fullscreenerror", () => {', "fullscreen failure clears transient gesture state");
requireText(hostApp, 'cancelGameZoomGesture();', "fullscreen/menu lifecycle clears pinch gesture state");
if (/gameZoom[\s\S]{0,2000}(atan2|rotate\s*\()/i.test(hostApp)) throw new Error("game zoom must never rotate the game image");

for (const [source, game] of [[th06Touch, "TH06"], [th07Touch, "TH07"]]) {
  requireText(source, "void Touch::SetReplayUsageState(bool usedThisRun, bool bombedWithTouch, bool cheatMovementUsed)", `${game} replay restores touch-owned simulation state through a narrow owner API`);
  requireText(source, "bool g_DialogueTapPending = false;", `${game} dialogue tap pulse state`);
  requireText(source, "if (held < 500 && std::abs(dx) <= threshold && std::abs(dy) <= threshold)", `${game} short stationary dialogue tap detection`);
  requireText(source, "g_DialogueTapPending = true;", `${game} dialogue tap arms one-shot Z pulse`);
  requireText(source, "if (g_DialogueTapPending)", `${game} dialogue tap pulse consumer`);
  requireText(source, "buttons |= TH_BUTTON_SHOOT;", `${game} dialogue tap advances with original Z input`);
  requireText(source, "EaglerOptions::TouchFireEnabled() && IsGameplayTouchMode() && !g_Gui.HasCurrentMsgIdx()", `${game} continuous fire does not mask dialogue Z edges`);
}
requireText(hostApp, "button.setPointerCapture(event.pointerId)", "touch HUD pointer ownership");
requireText(hostHtml, 'id="touchMovementMode"', "mobile movement selector");
requireText(hostHtml, 'id="touchSensitivityPreview"', "touch sensitivity background-preview crosshair");
requireText(hostHtml, '手指拖动距离与自机目标移动距离的比例。在背景拖动可以预览效果。', "touch sensitivity concise preview copy");
const touchSensitivityRowPos = hostHtml.indexOf('class="touch-layout-setting-row touch-sensitivity-row"');
const touchMovementModePos = hostHtml.indexOf('id="touchMovementMode"');
const touchFocusModePos = hostHtml.indexOf('id="touchFocusMode"');
const doubleTapBombPos = hostHtml.indexOf('id="doubleTapBombToggle"');
const thpracTouchControlsPos = hostHtml.indexOf('id="thpracTouchControlsToggle"');
const touchViewportAdjustPos = hostHtml.indexOf('id="touchViewportAdjust"');
if ([touchMovementModePos, touchFocusModePos, doubleTapBombPos, thpracTouchControlsPos, touchSensitivityRowPos, touchViewportAdjustPos].some(pos => pos < 0) ||
    !(touchMovementModePos < touchFocusModePos && touchFocusModePos < doubleTapBombPos && doubleTapBombPos < thpracTouchControlsPos && thpracTouchControlsPos < touchSensitivityRowPos && touchSensitivityRowPos < touchViewportAdjustPos)) {
  throw new Error("touch settings order must end with sensitivity then game viewport adjustment");
}
for (const preset of [50, 100, 200]) {
  requireText(hostHtml, `data-touch-sensitivity-preset="${preset}"`, `touch sensitivity ${preset}-percent preset`);
}
requireText(hostHtml, 'data-touch-sensitivity-preset="200">200%</button>', "200-percent sensitivity preset stays available without a recommendation badge");
requireText(hostHtml, 'id="touchSensitivityCustomToggle"', "touch sensitivity custom choice");
requireText(hostHtml, 'id="touchSensitivityCustom" for="touchSensitivity" hidden', "custom sensitivity slider is collapsed by default");
requireText(hostApp, "const touchSensitivityPresets = new Set([50, 100, 200]);", "touch sensitivity preset inventory");
requireText(hostApp, "touchSensitivityCustomOpen || !touchSensitivityPresets.has(state.options.touchSensitivity)", "saved non-preset sensitivity reopens as Custom");
requireText(hostApp, 'document.querySelectorAll("[data-touch-sensitivity-preset]")', "touch sensitivity preset live controls");
requireText(hostApp, "touchSensitivityCustomOpen = true;", "Custom explicitly expands the continuous sensitivity slider");
requireText(hostCss, ".touch-sensitivity-presets{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));", "touch sensitivity presets use one four-item row");
requireText(hostCss, ".touch-sensitivity-custom[hidden]{display:none}", "custom sensitivity range stays hidden until selected");
requireText(hostApp, "function beginTouchSensitivityPreview(event)", "touch sensitivity preview pointer owner");
requireText(hostApp, 'touchLayoutEditing || touchViewportEditing || touchSensitivityPreviewGesture || touchMovementUsesJoystick(state.options.touchMovementMode)', "touch sensitivity preview stays edit-only, stays off during viewport positioning, and is disabled for wheel modes");
requireText(hostApp, 'touch-layout-editor,.touch-layout-settings,[data-touch-layout-control]', "touch sensitivity preview ignores editor windows and draggable controls");
requireText(hostApp, "resetTouchSensitivityPreviewPosition();", "touch sensitivity preview has a stable centered idle position");
requireText(hostApp, "(event.clientX - gesture.startX) * gain", "touch sensitivity preview scales X displacement from center by live sensitivity gain");
requireText(hostApp, "(event.clientY - gesture.startY) * gain", "touch sensitivity preview scales Y displacement from center by live sensitivity gain");
requireText(hostApp, "touchSensitivityPreview.hidden = !touchLayoutEditing || wheelMovement;", "touch sensitivity preview remains visible while editing direct-touch modes and hidden for wheel modes");
requireText(hostApp, "player.setPointerCapture(event.pointerId)", "touch sensitivity preview keeps background drag ownership");
requireText(hostApp, 'const touchSurfaceVisible = state.options.touchEnabled || touchLayoutEditing;', "touch manager preview remains independent from gameplay touch enablement");
requireText(hostApp, 'focusButton.hidden = !focusButtonMode;', "focus button visibility depends only on whether the selected focus mode uses a button");
requireText(hostApp, '$("#touchJoystick").hidden = !(wheelMovement && touchSurfaceVisible);', "joystick remains previewable while editing even when gameplay touch is disabled");
requireText(hostCss, ".touch-sensitivity-preview{position:absolute;z-index:43", "touch sensitivity long-cross visual layer");
requireText(hostCss, ".touch-sensitivity-preview[hidden]{display:none}", "touch sensitivity preview explicit visibility gate");
requireText(hostCss, ".touch-sensitivity-presets{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));", "touch sensitivity preset choices stay in one four-item row");
requireText(hostCss, '.touch-layout-editor,.touch-layout-settings,.touch-layout-orientation-help-window{border:0;border-radius:14px', "touch management uses rounded filled surfaces");
if (hostCss.includes('.touch-layout-setting-row:has(')) throw new Error("touch settings theme must not alter row structure through :has()");
requireText(hostCss, '.touch-layout-setting-row{min-height:38px;padding:6px 7px;border-top:1px solid #232620', "touch settings preserve the established row geometry");
requireText(hostCss, '.touch-hud button,.touch-escape,.touch-help-open,.touch-thprac-input,.touch-thprac-menu button{border:0;border-radius:11px', "touch controls use filled tonal buttons");
requireText(hostCss, '.touch-joystick-base{border:0;background:radial-gradient', "touch joystick uses the themed filled surface");
if (hostCss.includes('.player.touch-layout-edit:not(.touch-layout-custom) [data-touch-layout-control]:not(#touchJoystick){position:relative}')) {
  throw new Error("fresh default touch-layout capture must not override absolute thprac default positions");
}
requireText(hostHtml, '<option value="hold-button">按钮（按住时低速）</option><option value="toggle-button">按钮（按下时切换状态）</option><option value="two-finger">双指</option>', "focus methods are ordered hold, toggle, two-finger");
requireText(hostApp, 'touchFocusMode: "hold-button"', "hold-button is the default focus method");
requireText(hostApp, 'touchSensitivity: 100', "100-percent is the default touch sensitivity");
requireText(hostHtml, 'id="touchSensitivityValue">100%</output>', "fresh touch settings show the 100-percent default");
requireText(hostHtml, 'value="100" aria-label="自定义触控灵敏度"', "fresh custom-sensitivity slider starts from the 100-percent default");
if (hostHtml.includes('200%<small>推荐</small>')) throw new Error("200-percent sensitivity preset must not carry a recommendation badge");
requireText(hostApp, 'focusButton.hidden = !focusButtonMode;', "focus button stays available in the layout editor even before touch is enabled");
requireText(hostHtml, '<option value="touch">触摸（推荐）</option><option value="touch-unlimited">触摸（作弊，不限速）</option><option value="joystick">轮盘</option><option value="joystick-free">轮盘（无方向限制）</option>', "four mutually-exclusive movement choices in user-facing order");
requireText(hostHtml, 'id="doubleTapBombToggle"', "double-tap Bomb opt-in switch");
requireText(hostHtml, '在同一位置快速双击以使用 Bomb。', "double-tap Bomb concise copy");
requireText(hostApp, 'doubleTapBombEnabled: false', "double-tap Bomb defaults disabled");
requireText(hostHtml, 'id="thpracTouchControlsToggle"', "thprac touch-key collection switch");
requireText(hostHtml, '显示鼠标模拟和 Backspace 菜单按键。', "thprac touch-key concise copy");
requireText(hostApp, 'thpracTouchControlsEnabled: false', "thprac touch-key collection defaults disabled");
requireText(hostHtml, 'data-touch-layout-control="thpracInput"', "thprac touch/mouse switch is layout-adjustable");
requireText(hostHtml, 'data-touch-layout-control="thpracMenu"', "thprac Backspace/F-key group is layout-adjustable");
requireText(hostHtml, 'id="touchThpracInput" data-touch-layout-control="thpracInput" type="button" aria-pressed="false" hidden><strong>模拟鼠标</strong>', "thprac mouse toggle keeps fixed label");
requireText(hostApp, 'touchThpracInput.querySelector("strong").textContent = "模拟鼠标";', "thprac mouse toggle text does not change with state");
if (hostApp.includes('touchThpracInput.querySelector("strong").textContent = thpracMouseMode ?')) {
  throw new Error("thprac mouse toggle must use click styling only, not state-dependent wording");
}
requireText(hostCss, '.touch-thprac-input{position:absolute;z-index:36;right:max(10px,env(safe-area-inset-right));left:auto;top:calc(50% - 6px);width:56px;height:56px', "thprac mouse default is a square lower control on the center-right");
requireText(hostCss, '.touch-thprac-menu{position:absolute;z-index:37;right:max(10px,env(safe-area-inset-right));left:auto;top:calc(50% - 50px)', "Backspace menu defaults above mouse control at higher priority");
requireText(hostCss, '.player #touchThpracInput{z-index:36}.player #touchThpracMenu{z-index:37}', "default Backspace menu priority exceeds mouse control");
requireText(hostCss, '.player.touch-layout-edit:not(.touch-layout-custom) [data-touch-layout-control]:not(#touchJoystick):not(#touchThpracInput):not(#touchThpracMenu){position:relative}', "fresh default capture preserves absolute thprac positions instead of folding them into the left-side flow");
requireText(hostApp, 'priority: touchLayoutControlMeta[name].priority', "touch layout captures default control priority");
requireText(hostApp, 'element.style.zIndex = String(31 + (Number.isFinite(item.priority)', "saved touch-control priority drives actual stacking");
requireText(hostApp, 'item.priority = Math.max(-1, ...Object.values(profile.controls).map', "editing a selected control raises it above all peers");
requireText(hostApp, 'normalizeTouchLayoutPriorityOrder(profile.controls);', "touch-control priority remains canonical and persistable");
requireText(hostHtml, 'data-thprac-key="F1"', "thprac F1 touch key");
requireText(hostHtml, 'data-thprac-key="F7"', "thprac F7 touch key");
requireText(hostApp, 'function installThpracMouseInputBridge()', "thprac touch-to-mouse input bridge");
requireText(hostApp, 'event.stopImmediatePropagation();', "thprac mouse mode prevents the same touch from also entering game touch input");
requireText(hostApp, 'command: "thprac-mouse", type,', "thprac mouse mode uses the narrow hosted input protocol");
requireText(hostApp, 'event.target.setPointerCapture?.(event.pointerId)', "thprac mouse keeps pointer ownership through drag");
requireText(hostApp, 'event.target.releasePointerCapture?.(event.pointerId)', "thprac mouse releases pointer ownership on UP");
if (hostApp.includes("new win.MouseEvent")) throw new Error("thprac mouse mode must not depend on untrusted synthetic DOM MouseEvent delivery");
const thpracMouseBridgeStart = hostApp.indexOf("function installThpracMouseInputBridge()");
const thpracMouseBridgeEnd = hostApp.indexOf("function uninstallGameZoomInputBridge()", thpracMouseBridgeStart);
if (thpracMouseBridgeStart < 0 || thpracMouseBridgeEnd < 0) throw new Error("thprac mouse input bridge bounds not found");
const thpracMouseBridge = hostApp.slice(thpracMouseBridgeStart, thpracMouseBridgeEnd);
requireText(thpracMouseBridge, "uninstallThpracMouseInputBridge();", "thprac mouse bridge is rebound for every iframe load");
if (thpracMouseBridge.includes("thpracMouseInputWindow === win")) throw new Error("thprac mouse bridge must not trust stable iframe WindowProxy identity across reloads");
requireText(hostApp, 'pulseThpracKey("Backspace")', "thprac Backspace touch pulse");
requireText(hostApp, 'setTimeout(() => postHostedKey(spec, false), 70);', "thprac touch key pulse spans trainer ticks");
requireText(hostApp, 'frame.contentWindow.addEventListener("eagler-thprac-menu"', "host follows actual THOverlay menu state");
requireText(hostApp, 'touchThpracFunctionKeys.hidden = !thpracMenuOpen;', "F1-F7 visibility follows actual Backspace menu state");
requireText(hostApp, 'const touchMovementModes = new Set(["touch", "touch-unlimited", "joystick", "joystick-free"]);', "movement mode inventory follows user-facing order");
requireText(hostApp, 'touchControls = { fireEnabled: true, focusEnabled: false, bombSerial: 0, escapeSerial: 0, joystickX: 0, joystickY: 0 }', "host virtual joystick state");
requireText(hostApp, 'const touchMovementUsesJoystick = mode => mode === "joystick" || mode === "joystick-free";', "host wheel routing helper");
requireText(hostApp, 'touchControls.joystickX = Math.round(ux * magnitude * 32767);', "360-degree joystick X publication");
requireText(hostApp, 'touchControls.joystickY = Math.round(uy * magnitude * 32767);', "360-degree joystick Y publication");
requireText(hostApp, 'touchJoystick.setPointerCapture(event.pointerId)', "joystick pointer capture owner");
requireText(hostCss, ".touch-joystick{position:absolute", "joystick visual surface");
requireText(hostHtml, '<div class="mobile-option"><span>启用触摸功能</span><button class="option-switch" id="touchToggle"', "original mobile touch switch keeps its location with clearer wording");
requireText(hostHtml, 'id="touchToggle"', "touch-enable switch lives in layout settings");
requireText(hostApp, '$("#touchToggle").addEventListener("click", () => {', "touch-enable explicit user owner");
requireText(hostApp, 'if (enabling && !confirmTouchModeBeforeEnable(state.options.touchMovementMode)) return;', "touch confirmation gates enablement");
requireText(hostApp, 'setOption("touchEnabled", enabling);', "touch enablement occurs only after confirmation");
requireText(hostApp, 'touchMovementMode.disabled = false;', "movement settings remain editable while touch runtime is disabled");
requireText(hostApp, '$("#doubleTapBombToggle").disabled = false;', "double-tap Bomb remains configurable while touch runtime is disabled");
requireText(hostApp, 'touchFocusMode.disabled = false;', "focus-method settings remain editable while touch runtime is disabled");
requireText(hostApp, '$("#thpracTouchControlsToggle").disabled = !state.options.thpracEnabled;', "thprac touch-key setting is independent of touch runtime enablement");
requireText(hostApp, 'function thpracTouchControlsVisible()', "thprac layout preview has a configuration-time visibility owner");
requireText(hostApp, '(touchLayoutEditing || !!state.options.touchEnabled);', "thprac touch controls remain previewable while editing with touch runtime disabled");
if (hostApp.includes('touchMovementMode.disabled = !state.options.touchEnabled') ||
    hostApp.includes('$("#doubleTapBombToggle").disabled = !state.options.touchEnabled') ||
    hostApp.includes('touchFocusMode.disabled = !state.options.touchEnabled') ||
    hostApp.includes('if (state.options.touchEnabled) setOption("doubleTapBombEnabled"')) {
  throw new Error("disabling touch runtime must not disable configuration controls");
}
requireText(hostHtml, 'class="touch-layout-settings-list"', "touch settings window content");
requireText(hostCss, ".touch-layout-settings-list{flex:1 1 auto;min-height:0;overflow-x:hidden;overflow-y:auto", "independently scrollable touch settings list");
requireText(hostCss, ".touch-layout-setting-row{box-sizing:border-box;min-height:38px;display:grid;grid-template-columns:minmax(0,1fr);", "narrow touch settings stack label and control instead of crushing copy");
if (hostHtml.indexOf('<small>多作共用该横竖屏布局。</small>') > hostHtml.indexOf('<b class="touch-layout-profile-note">横屏和竖屏会分别保存！</b>')) {
  throw new Error("touch layout red profile-save note must be the final copy line");
}
requireText(hostApp, 'const touchLayoutStorageKey = "eagler-touhou-touch-layout-v1";', "cross-game touch layout storage key");
if (/touchLayoutStorageKey\s*=\s*gameId|touchLayoutStorageKey\s*=.*state\.game/.test(hostApp)) {
  throw new Error("touch layout must be shared by TH06/TH07 rather than keyed per game");
}
if (hostPackage.dependencies?.interactjs) throw new Error("touch layout must not carry an InteractJS runtime dependency");
if (fs.existsSync(path.join(root, "eagler-touhou/vendor/interact.min.js")) ||
    fs.existsSync(path.join(root, "eagler-touhou/vendor/interact.LICENSE")) ||
    fs.existsSync(path.join(root, "eagler-touhou/vendor/interact-test.js"))) {
  throw new Error("obsolete InteractJS vendor artifacts must stay removed");
}
if (/interact\.min\.js|window\.interact|touchLayoutInteractables/.test(hostHtml + hostApp)) {
  throw new Error("touch layout must have one native PointerEvent owner, not a second InteractJS owner");
}
for (const control of ["focus", "fire", "bomb", "joystick", "escape", "thpracInput", "thpracMenu"]) {
  requireText(hostApp, `${control}: Object.freeze({ id:`, `touch layout ${control} inventory`);
  requireText(hostHtml, `data-touch-layout-control="${control}"`, `touch layout ${control} DOM owner`);
}
requireText(hostApp, "function normalizeTouchLayout(value)", "touch layout fail-closed schema");
requireText(hostApp, "item.scale < touchLayoutScaleMin || item.scale > touchLayoutScaleMax", "touch layout scale validation");
requireText(hostApp, "const touchLayoutVersion = 4;", "orientation-aware touch layout schema with horizontal-only saved game viewport position");
requireText(hostApp, 'Object.freeze(["landscape", "portrait"])', "portrait/landscape touch layout profiles");
requireText(hostApp, "function captureDefaultTouchLayoutProfile()", "default touch layout capture");
requireText(hostApp, "viewport: { x: 0 }", "new touch layout profiles start from the original horizontal game viewport position");
requireText(hostApp, "function currentTouchViewportPosition", "orientation-specific saved game viewport position");
requireText(hostApp, "viewport.x < -.5 || viewport.x > .5", "saved horizontal game viewport position validation");
requireText(hostApp, "function effectiveTouchLayoutPosition(element, item)", "viewport-relative touch layout clamping");
requireText(hostApp, "const safeRect = touchLayoutSafeZone.getBoundingClientRect();", "safe-area-normalized touch layout geometry");
requireText(hostApp, "function beginTouchLayoutDrag(name, event)", "native pointer drag start owner");
requireText(hostApp, 'event.target.closest?.(".touch-layout-resize-handle")', "native resize-handle mode selection");
requireText(hostApp, "function resizeTouchLayoutItem(drag, event)", "native uniform resize implementation");
requireText(hostApp, "function moveTouchLayoutDrag(event)", "native pointer drag move owner");
requireText(hostApp, "function endTouchLayoutDrag(event)", "native pointer drag release owner");
requireText(hostApp, "setPointerCapture(event.pointerId)", "native pointer drag capture");
requireText(hostApp, "function scaleTouchLayoutItem(name, scale)", "uniform button scaling model");
requireText(hostApp, 'const names = visibleTouchLayoutControlNames();', "layout collision oracle only inspects visible controls");
requireText(hostApp, "function updateTouchLayoutWarnings()", "touch layout overlap warning");
requireText(hostApp, 'window.addEventListener("resize", refreshTouchLayoutForViewport', "touch layout resize lifecycle");
requireText(hostApp, 'window.visualViewport?.addEventListener("resize", refreshTouchLayoutForViewport', "touch layout visual viewport lifecycle");
requireText(hostApp, 'new ResizeObserver(refreshTouchLayoutForViewport).observe(touchLayoutSafeZone)', "touch layout safe-zone geometry observer");
requireText(hostApp, 'if (touchLayoutEditing) updateTouchLayoutEditorUi();', "touch layout orientation feedback must update synchronously with geometry");
requireText(hostApp, "function saveTouchLayoutEditor()", "touch layout save stays inside editor");
requireText(hostApp, "persistTouchLayout(touchLayoutDraft);", "touch layout explicit-save persistence");
requireText(hostApp, "applyGameZoomTransform(1, 0, 0);", "saved viewport position is explicitly reapplied after editing and at runtime launch");
requireText(hostApp, "if (touchLayoutEditing) applyTouchViewportDraftPosition();", "touch layout preview reapplies the orientation-specific viewport draft on viewport changes");
requireText(hostCss, '.player.touch-layout-edit .game-viewport{background-color:#080808;background-image:linear-gradient', "touch layout demo artwork is owned by the movable game viewport rather than the fixed player background");
if (hostCss.includes('.player.touch-layout-edit{background-color:#080808;background-image:')) throw new Error("touch layout preview image must not remain fixed on the player background");
requireText(hostApp, 'await send("launch"); state.launched = true; clearStartupError();', "runtime launch reaches persisted viewport reapply point");
requireText(hostApp, "live player has been opened and the runtime has actually launched", "viewport offset is reapplied only after player geometry is measurable");
requireText(hostHtml, 'id="touchViewportAdjust" type="button">＋ 调整游戏画面</button>', "touch layout exposes game viewport position adjustment");
requireText(hostHtml, 'class="touch-layout-setting-row touch-layout-viewport-row"', "game viewport position controls live inside touch settings");
requireText(hostHtml, '仅可水平调整，横屏和竖屏分别保存。', "touch settings explain horizontal-only per-orientation viewport positions");
requireText(hostHtml, 'id="touchViewportReset" type="button">复位</button>', "game viewport position has a dedicated reset");
requireText(hostHtml, 'id="touchViewportDone" type="button" hidden>调整完成</button>', "viewport adjustment has one explicit completion action");
requireText(hostApp, "function startTouchViewportEditing()", "viewport position edit mode entry");
requireText(hostApp, "function finishTouchViewportEditing()", "viewport position edit mode completion");
requireText(hostApp, "function resetTouchViewportPosition()", "viewport position reset owner");
requireText(hostApp, "function beginTouchViewportDrag(event)", "viewport position pointer drag owner");
requireText(hostApp, "profile.viewport.x = Math.max(-.5, Math.min(.5, profile.viewport.x + dx / width));", "viewport editor changes position only on X");
if (hostApp.includes("profile.viewport.y")) throw new Error("viewport editor must not save or change vertical position");
requireText(hostApp, "return { x: viewport.x * player.clientWidth, y: 0 };", "saved viewport offset keeps Y fixed at the default position");
requireText(hostCss, "cursor:ew-resize", "viewport adjustment visually indicates horizontal-only dragging");
requireText(hostApp, "applyGameZoomTransform(1, 0, 0);", "viewport editor forces original scale while positioning");
requireText(hostCss, '.player.touch-viewport-edit>:not(#gameViewport):not(#touchViewportDragSurface):not(#touchViewportDone){visibility:hidden!important;pointer-events:none!important}', "viewport edit hides every player control/window except its drag surface and Done action");
requireText(hostCss, '.touch-viewport-done{position:absolute;z-index:80', "viewport edit completion action remains visible above the drag surface");
requireText(hostApp, 'showToast("保存成功：触控布局已保存", 2200);', "touch layout save success feedback");
requireText(hostApp, "function touchLayoutHasUnsavedChanges()", "touch layout unsaved-change guard");
requireText(hostApp, "退出将丢弃这些修改", "touch layout exit discard confirmation");
requireText(hostApp, "确认将${orientationTitle}触控布局恢复为默认位置和大小吗？", "touch layout reset requires confirmation");
requireText(hostApp, "当前${orientationTitle}布局中的未保存调整会被清除。", "touch layout reset confirmation explains loss");
requireText(hostHtml, 'id="touchLayoutEdit"', "touch layout editor entry");
requireText(hostHtml, 'id="touchLayoutSafeZone"', "touch layout safe-area geometry owner");
requireText(hostHtml, 'id="touchLayoutReservedZone"', "touch layout browser-control reserved guide");
requireText(hostHtml, 'id="touchLayoutOrientation"', "touch layout orientation feedback");
requireText(hostHtml, 'id="touchLayoutScale" type="range" min="60" max="180"', "touch layout scale control");
if ((hostHtml.match(/class="touch-layout-resize-handle"/g) || []).length !== 7) throw new Error("all seven touch controls including thprac groups must expose edit-only resize handles");
if (hostHtml.includes('id="touchLayoutMirror"') || hostApp.includes("mirrorTouchLayoutGameplayControls")) throw new Error("touch layout mirror action must stay removed");
requireText(hostHtml, 'id="touchLayoutReset"', "touch layout reset action");
requireText(hostHtml, 'id="touchLayoutSave"', "touch layout save action");
requireText(hostHtml, 'id="touchLayoutExit"', "touch layout exit action");
requireText(hostCss, ".touch-layout-editor{top:max(8px,env(safe-area-inset-top));left:50%;width:min(160px", "narrow touch layout editor panel");
requireText(hostCss, ".touch-layout-settings{position:absolute;z-index:44;right:max(8px,env(safe-area-inset-right));left:auto;top:max(8px,env(safe-area-inset-top));width:220px;height:180px", "independently right-anchored touch settings window");
requireText(hostCss, ".touch-layout-settings>strong{flex:0 0 auto;margin:-2px -2px 0;padding:7px 2px 8px", "touch settings title has a larger drag hit area");
requireText(hostCss, ".touch-layout-settings-list{flex:1 1 auto;min-height:0;overflow-x:hidden;overflow-y:auto", "independently scrollable touch settings window");
requireText(hostHtml, 'id="touchLayoutSettingsDragHandle"', "touch settings independent drag handle");
requireText(hostApp, 'function beginTouchLayoutSettingsDrag(event)', "touch settings independent drag owner");
requireText(hostApp, 'document.addEventListener("pointermove", event => {', "touch editor drags use document lifecycle");
const windowDragBody = hostApp.slice(hostApp.indexOf("function beginTouchLayoutEditorDrag"), hostApp.indexOf("function updateTouchLayoutOrientationActionUi"));
if (windowDragBody.includes("setPointerCapture")) throw new Error("touch editor windows must stay on the established document pointer lifecycle");
if (hostApp.slice(hostApp.indexOf("function beginTouchLayoutDrag"), hostApp.indexOf("function resizeTouchLayoutItem")).includes("setPointerCapture")) throw new Error("touch layout control editing must not use pointer capture");
requireText(hostApp, 'document.addEventListener("fullscreenchange", cancelTouchLayoutGestures);', "fullscreen transition cancels transient editor gestures");
requireText(hostApp, "const touchLayoutWindowMargin = 16;", "drag windows stay outside browser fullscreen edge-gesture hot zones");
requireText(hostCss, ".player.open{display:grid;touch-action:none;overscroll-behavior:none", "active player blocks browser overscroll gestures without persistent page state");
if (hostApp.includes("touchLayoutEditorGroupBounds")) throw new Error("touch layout/settings windows must not share group bounds");
const editorDragBody = hostApp.slice(hostApp.indexOf("function beginTouchLayoutEditorDrag"), hostApp.indexOf("function endTouchLayoutEditorDrag"));
if (editorDragBody.includes("touchLayoutSettingsElement")) throw new Error("dragging touch layout window must not move touch settings window");
requireText(hostApp, 'function positionTouchLayoutWindowsInitial()', "independent default positioning for touch windows");
requireText(hostApp, 'const touchLayoutWindowPositionsStorageKey = "eagler-touhou-touch-layout-window-positions-v1";', "touch window positions have their own persistent UI preference");
requireText(hostApp, 'landscape: { editor: null, settings: null }', "landscape remembers both touch windows");
requireText(hostApp, 'portrait: { editor: null, settings: null }', "portrait remembers both touch windows");
requireText(hostApp, 'rememberTouchLayoutWindowPosition("editor", $("#touchLayoutEditor"));', "touch layout window position persists after dragging");
requireText(hostApp, 'rememberTouchLayoutWindowPosition("settings", touchLayoutSettingsElement());', "touch settings window position persists after dragging");
requireText(hostApp, 'function rememberTouchLayoutWindowsNow()', "both touch windows can be force-saved before lifecycle transitions");
requireText(hostApp, 'touchLayoutWindowPositions = loadTouchLayoutWindowPositions();', "touch window positions are reloaded from persistent storage before restoration");
requireText(hostApp, 'restoreTouchLayoutWindowPosition("editor", $("#touchLayoutEditor"));', "touch layout window restores its remembered position");
requireText(hostApp, 'restoreTouchLayoutWindowPosition("settings", touchLayoutSettingsElement());', "touch settings window restores its remembered position");
requireText(hostApp, 'let touchLayoutWindowOrientation = null;', "touch window restore tracks the orientation whose positions are currently applied");
requireText(hostApp, 'touchLayoutWindowOrientation = touchLayoutOrientation();', "touch window restore records the applied orientation");
requireText(hostApp, 'if (touchLayoutWindowOrientation !== touchLayoutOrientation()) positionTouchLayoutWindows();', "physical orientation and fullscreen viewport changes restore the matching saved window positions");
if (hostApp.includes("stackHeight") || hostApp.includes("settingsTop = groupTop")) throw new Error("touch layout/settings initial placement must never switch to a vertical stack");
requireText(hostApp, 'const groupLeft = (host.width - sideBySideWidth) / 2;', "touch layout/settings default side-by-side group is horizontally centered");
requireText(hostApp, 'const panelTop = (host.height - panelRect.height) / 2;', "touch layout default is vertically centered");
requireText(hostApp, 'const settingsTop = (host.height - settingsRect.height) / 2;', "touch settings default is vertically centered");
requireText(hostApp, 'settings.style.right = "auto";', "touch settings switches to independent player coordinates");
requireText(hostApp, 'settings.style.left = `${rect.left - host.left}px`;', "touch settings drag freezes into player coordinates on pointerdown");
requireText(hostApp, 'positionTouchLayoutWindowsInitial();', "independent touch-window initial placement fallback owner");
if (hostApp.includes('frame.contentWindow?.dispatchEvent(new Event("blur"))')) throw new Error("zoom mode must never fake iframe blur because it pauses the running game");
requireText(hostApp, 'function touchModeConfirmationText(mode)', "touch feature confirmation text owner");
requireText(hostApp, '触摸移动会使用 ReplayX（.rpyx）保存录像。', "direct-touch ReplayX warning");
requireText(hostApp, 'ZUN 原版 Replay 不兼容，只能由 EAGLER TOUHOU 打开。', "direct-touch ZUN incompatibility warning");
requireText(hostApp, '不限速触摸会绕过原游戏移动速度限制。', "unlimited touch warning");
requireText(hostApp, '无方向限制轮盘支持 360° 连续移动。', "free joystick warning");
requireText(hostApp, 'if (enabling && !confirmTouchModeBeforeEnable(state.options.touchMovementMode)) return;', "touch warning occurs before enabling touch");
requireText(hostApp, 'if (value !== state.options.touchMovementMode && !confirmTouchModeBeforeEnable(value)) { render(); return; }', "movement warning occurs before mode selection");
const launchWarningStart = hostApp.indexOf("function confirmInputWarnings()");
const launchWarningEnd = hostApp.indexOf("function resetRuntime()", launchWarningStart);
if (launchWarningStart < 0 || launchWarningEnd < 0) throw new Error("launch input warning bounds missing");
const launchWarningBody = hostApp.slice(launchWarningStart, launchWarningEnd);
if (launchWarningBody.includes("ReplayX") || launchWarningBody.includes("joystick-free") || launchWarningBody.includes("touch-unlimited")) {
  throw new Error("feature compatibility confirmations must not be deferred to game launch");
}
if (hostApp.includes("确认使用轮盘启动吗？") || hostApp.includes("确认使用触控启动吗？")) {
  throw new Error("obsolete launch-time touch legality confirmations must be removed");
}
if (hostHtml.includes('id="gameZoomSurface"') || hostApp.includes("gameZoomSurface") || hostCss.includes(".game-zoom-surface")) {
  throw new Error("game zoom must not use an overlay that steals pointer input from the game");
}
if (hostCss.includes(".player.game-zoom-editing #gameFrame{pointer-events:none}")) {
  throw new Error("game zoom mode must keep iframe pointer input enabled");
}
requireText(hostApp, 'function installGameZoomInputBridge()', "game zoom iframe capture observer");
requireText(hostApp, 'win.addEventListener("pointerdown", beginGameZoomPointer, true);', "game zoom capture-stage pointer down observer");
requireText(hostApp, 'win.addEventListener("pointermove", moveGameZoomPointer, true);', "game zoom capture-stage pointer move observer");
requireText(hostApp, 'x: base.x + gameZoomState.x + event.clientX * gameZoomState.scale', "zoom gesture maps iframe-local X through saved base position plus current transform");
requireText(hostApp, 'y: base.y + gameZoomState.y + event.clientY * gameZoomState.scale', "zoom gesture maps iframe-local Y through saved base position plus current transform");
const beginZoomBody = hostApp.slice(hostApp.indexOf("function beginGameZoomPointer"), hostApp.indexOf("function moveGameZoomPointer"));
const moveZoomBody = hostApp.slice(hostApp.indexOf("function moveGameZoomPointer"), hostApp.indexOf("function endGameZoomPointer"));
if (beginZoomBody.includes("preventDefault") || beginZoomBody.includes("stopPropagation") || moveZoomBody.includes("preventDefault") || moveZoomBody.includes("stopPropagation")) {
  throw new Error("game zoom observer must not consume the game's pointer stream");
}
requireText(hostApp, '$("#touchLayoutOrientationHelpOpen").addEventListener("click", () => { if (touchLayoutEditing) void switchTouchLayoutOrientation(); });', "touch layout orientation action must directly attempt real rotation");
requireText(hostApp, 'showToast("切换失败，请查看右上角问号菜单中的横竖屏说明。", 4200);', "orientation failure only points to the question-mark help");
const orientationBody = hostApp.slice(hostApp.indexOf("async function switchTouchLayoutOrientation()"), hostApp.indexOf("async function openTouchLayoutEditor()"));
if (orientationBody.includes("openTouchLayoutOrientationHelp")) throw new Error("orientation failure must not auto-open a second help surface");
requireText(orientationBody, 'positionTouchLayoutWindows();', "switching orientation restores that orientation's remembered touch-window positions");
requireText(hostCss, ".touch-layout-editor-actions{display:grid;grid-template-columns:repeat(2,minmax(0,1fr))", "touch layout editor equal-size action grid");
requireText(hostCss, ".player.touch-layout-custom .touch-hud", "touch layout custom positioning CSS owner");
requireText(hostCss, ".player.touch-layout-edit [data-touch-layout-control]", "touch layout editing CSS owner");
requireText(hostCss, ".touch-layout-safe-zone{position:absolute", "safe-area guide CSS");
requireText(hostCss, ".touch-layout-resize-handle{display:none}", "resize handles hidden outside edit mode");
requireText(hostCss, ".player.touch-layout-edit .touch-layout-resize-handle", "edit-only resize handle CSS");
requireText(hostCss, ".player.open{display:grid;touch-action:none;overscroll-behavior:none;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none", "active player Safari CSS ownership");
requireText(hostCss, ".fullscreen-toggle{", "fullscreen button CSS surface");
requireText(hostCss, "touch-action:none;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;-webkit-tap-highlight-color:transparent", "host control Safari gesture CSS");
requireText(hostHtml, "maximum-scale=1,user-scalable=no", "host fixed mobile viewport scale");
requireText(hostApp, "document.webkitFullscreenElement", "Safari fullscreen state fallback");
requireText(hostApp, "target.webkitRequestFullscreen", "Safari fullscreen request fallback");
requireText(hostApp, 'document.addEventListener("webkitfullscreenchange", handleFullscreenChange);', "Safari fullscreen lifecycle shares the standard handler");

console.log("TH06/TH07 mobile touch contract: PASS");
