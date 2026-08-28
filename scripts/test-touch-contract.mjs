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
  const focusBeforeMain = shell.indexOf('document.getElementById("canvas").focus({ preventScroll: true });');
  const callMain = shell.indexOf('Module.callMain([]);');
  if (focusBeforeMain < 0 || callMain < 0 || focusBeforeMain > callMain) {
    throw new Error(`${game}: canvas focus must happen before callMain`);
  }
  if (shell.includes("startStartupFocusKeeper") || shell.includes("startupFocusTimer")) {
    throw new Error(`${game}: shell must not own cross-iframe startup focus retries`);
  }
  requireText(shell, 'sync().then(finish, error => {', `${game} Runtime flushes IDBFS before emitting exit`);
  requireText(shell, 'Local save restore timed out; reload the page before retrying', `${game} bounded initial IDBFS restore`);
  requireText(shell, 'Keep the run dependency held.', `${game} fail-closed IDBFS timeout policy`);
  requireText(shell, 'Module.getPreloadedPackage = (_name, expectedBytes)', `${game} generated preload-compatible DATA path`);
  requireText(shell, 'window.parent.__eaglerPrepareManagedRuntimeDataV1', `${game} App-managed DATA provider`);
  if (/packageBridge|package-bootstrap|__eaglerPackageBootstrapState/.test(shell)) {
    throw new Error(`${game}: retired Package Runtime bridge must not remain in the shell`);
  }
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
    requireText(replay, "g_CurFrameGameInput = g_CurFrameRawInput;", "th07 normal Replay captures the raw controller input word");
    requireText(replay, "g_CurFrameGameInputs[0] = g_CurFrameRawInput;", "th07 multiplayer fallback captures raw input into P1 logical slot");
    requireText(replay, "Netplay::Input::PlayerButtonOverridesActive()", "th07 netplay preserves synchronized per-player input slots");
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
  requireText(shell, 'case "Tab": return 1 << 8;', `${game} thprac Tab browser bridge`);
  requireText(shell, 'thpracKeyboardBits: 0', `${game} thprac browser key bitset`);
  requireText(practiceRuntime, 'case SDL_SCANCODE_BACKSPACE: bit = 0; break;', `${game} thprac Backspace Emscripten bit consumer`);
  requireText(practiceRuntime, 'case SDL_SCANCODE_F7: bit = 7; break;', `${game} thprac F7 Emscripten bit consumer`);
  requireText(practiceRuntime, 'case SDL_SCANCODE_TAB: bit = 8; break;', `${game} thprac Tab Emscripten bit consumer`);
  requireText(practiceRuntime, 'OverlayKeyPressed(8, SDL_SCANCODE_TAB)', `${game} thprac Tracker consumes hosted Tab slot 8`);
  requireText(practiceRuntime, 'EaglerOverlayKeyDown(scancode)', `${game} SDL and hosted thprac key merge`);
  requireText(practiceRuntime, 'window.dispatchEvent(new CustomEvent("eagler-thprac-menu"', `${game} actual THOverlay menu-state publication`);
  requireText(shell, 'touchMovementMode: options.touchMovementMode || "touch"', `${game} movement-mode install`);
  requireText(shell, 'touchSensitivity: options.touchSensitivity ?? 100', `${game} touch sensitivity configure install`);
  requireText(shell, 'Module.eaglerOptions.touchSensitivity = message.touchSensitivity', `${game} live touch sensitivity update`);
  requireText(shell, 'if (message.request) reply(message.request, true);', `${game} live touch controls may use the no-ACK fast path`);
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
const webAppManifest = JSON.parse(read("eagler-touhou/site.webmanifest"));
const faqHtml = read("eagler-touhou/faq.html");
const hostPackage = JSON.parse(read("eagler-touhou/package.json"));
const th06Touch = read("th06-eagler/src/Touch.cpp");
const th07Touch = read("th07-eagler/src/Touch.cpp");
const th06SoundPlayer = read("th06-eagler/src/SoundPlayer.cpp");
const th07SoundPlayer = read("th07-eagler/src/SoundPlayer.cpp");
const th06GameWindow = read("th06-eagler/src/GameWindow.cpp");
const th07GameWindow = read("th07-eagler/src/GameWindow.cpp");
const th06AnmManager = read("th06-eagler/src/AnmManager.cpp");
const th07AnmManager = read("th07-eagler/src/AnmManager.cpp");
const th06Supervisor = read("th06-eagler/src/Supervisor.cpp");
const th07Supervisor = read("th07-eagler/src/Supervisor.cpp");

const musicOptionIndex = hostHtml.indexOf('id="musicOption"');
const frameLimitIndex = hostHtml.indexOf('class="item option-frame-limit"');
if (!/class="file-tools-grid"[\s\S]*?<\/section>\s*<\/div>\s*<section class="item feature-section feature-language feature-music" id="musicOption"/.test(hostHtml) ||
    musicOptionIndex < 0 || frameLimitIndex < musicOptionIndex) {
  throw new Error("Host music selector must sit directly below the side-by-side save/replay tools and before frame-limit options");
}
for (const label of [
  "ogg(流式解码，避免切歌时卡顿)",
  "ogg(全量解码，避免音频卡顿)",
  "midi",
  "无",
]) requireText(hostHtml, label, `Host music selector exposes ${label}`);
requireText(hostHtml, 'class="item feature-section feature-language feature-music"', "Host music selector reuses language selector styling");
requireText(hostApp, 'const musicModes = new Set(["ogg-stream", "ogg-full", "midi", "none"]);', "Host persists the four explicit music modes");
requireText(hostApp, 'oggDecodeMode: oggDecodeMode(state.music)', "Host passes OGG stream/full decode policy into runtime options");

requireText(th06SoundPlayer, "stb_vorbis_open_filename", "TH06 Web OGG is streamed instead of synchronously decoding the whole track");
requireText(th06SoundPlayer, "UseWebFullTrackOggDecode", "TH06 allows explicit full-track OGG decode without changing the streaming default");
requireText(th06SoundPlayer, "stb_vorbis_decode_filename", "TH06 full-track OGG mode decodes the selected track eagerly");
requireText(th06SoundPlayer, "constexpr u32 FRAMES_PER_CHUNK = 1024;", "TH06 Web audio uses small 1024-frame producer slices");
requireText(th06SoundPlayer, "constexpr u32 LOW_WATER_FRAMES = 4096;", "TH06 Web audio A/B uses a ~93 ms low watermark");
requireText(th06SoundPlayer, "constexpr u32 HIGH_WATER_FRAMES = 6144;", "TH06 Web audio A/B uses a ~139 ms high watermark");
requireText(th06SoundPlayer, "HIGH_WATER_FRAMES - queuedFrames", "TH06 final producer slice is bounded by the verified high watermark");
requireText(th06SoundPlayer, "if (!this->webAudioRefilling)", "TH06 Web audio keeps persistent low/high hysteresis across presentation callbacks");
for (const forbidden of ["ROBUST_LOW_WATER_MS", "ROBUST_HIGH_WATER_MS", "PrepareWebAudioForMainThreadStall", "HasWebAudioWorkletOutput", "DrainWebAudioWorklet"]) {
  if (th06SoundPlayer.includes(forbidden)) throw new Error(`TH06 rejected audio experiment must stay removed: ${forbidden}`);
}
requireText(th06GameWindow, "g_SoundPlayer.PlaySounds();", "TH06 sound-event queue remains owned by the fixed simulation tick");
requireText(th06GameWindow, "g_SoundPlayer.PumpWebAudio()", "TH06 Web audio queue maintenance follows presentation cadence");
requireText(th07SoundPlayer, "constexpr ma_uint64 FRAMES_PER_CHUNK = 1024;", "TH07 Web OGG uses small 1024-frame decode slices");
requireText(th07SoundPlayer, "UseWebFullTrackOggDecode", "TH07 allows explicit full-track OGG decode without changing the streaming default");
requireText(th07SoundPlayer, "stb_vorbis_decode_filename", "TH07 full-track OGG mode decodes the selected track eagerly");
requireText(th07SoundPlayer, "constexpr ma_uint64 LOW_WATER_FRAMES = 4096;", "TH07 Web audio A/B uses a ~93 ms low watermark");
requireText(th07SoundPlayer, "constexpr ma_uint64 HIGH_WATER_FRAMES = 6144;", "TH07 Web audio A/B uses a ~139 ms high watermark");
requireText(th07SoundPlayer, "HIGH_WATER_FRAMES - queuedFrames", "TH07 final decode slice is bounded by the verified high watermark");
requireText(th07SoundPlayer, "if (!this->webAudioRefilling)", "TH07 Web audio keeps persistent low/high hysteresis across presentation callbacks");
for (const forbidden of ["ROBUST_LOW_WATER_MS", "ROBUST_HIGH_WATER_MS", "PrepareWebAudioForMainThreadStall", "HasWebAudioWorkletOutput", "DrainWebAudioWorklet"]) {
  if (th07SoundPlayer.includes(forbidden)) throw new Error(`TH07 rejected audio experiment must stay removed: ${forbidden}`);
}
requireText(th07GameWindow, "g_SoundPlayer.PumpWebAudio()", "TH07 Web audio queue maintenance follows presentation cadence");
requireText(th06Supervisor, "Module.touhouMusicMode === 'none' ? 0", "TH06 maps no-BGM mode to the game's original OFF music mode");
requireText(th07Supervisor, "Module.touhouMusicMode === 'none' ? 0", "TH07 maps no-BGM mode to the game's original OFF music mode");
requireText(th06Supervisor, "? 1 : -1", "TH06 leaves an unconfigured standalone Web runtime's existing music setting untouched");
requireText(th07Supervisor, "? 1 : -1", "TH07 leaves an unconfigured standalone Web runtime's existing music setting untouched");

for (const [source, label, endMarker] of [
  [th06SoundPlayer, "TH06", "void SoundPlayer::PlaySoundByIdx"],
  [th07SoundPlayer, "TH07", "ZunResult SoundPlayer::InitializeSound"],
]) {
  const pumpStart = source.indexOf("bool SoundPlayer::PumpWebAudio()");
  const pumpEnd = source.indexOf(endMarker, pumpStart);
  if (pumpStart < 0 || pumpEnd < 0) throw new Error(`${label} PumpWebAudio bounds not found`);
  if (source.slice(pumpStart, pumpEnd).includes("while (true)")) {
    throw new Error(`${label} Web audio pump must not use an unbounded refill loop`);
  }
}
const th07ProcessQueuesStart = th07SoundPlayer.indexOf("i32 SoundPlayer::ProcessQueues()");
const th07PushCommandStart = th07SoundPlayer.indexOf("void SoundPlayer::PushCommand", th07ProcessQueuesStart);
if (th07ProcessQueuesStart < 0 || th07PushCommandStart < 0) throw new Error("TH07 ProcessQueues bounds not found");
if (th07SoundPlayer.slice(th07ProcessQueuesStart, th07PushCommandStart).includes("PumpWebAudio")) {
  throw new Error("TH07 fixed-tick ProcessQueues must not also pump the Web output queue");
}

for (const [anm, supervisor, game] of [
  [th06AnmManager, th06Supervisor, "TH06"],
  [th07AnmManager, th07Supervisor, "TH07"],
]) {
  requireText(anm, '"data/title/title00.jpg"', `${game} Web transition cache keeps the title background`);
  requireText(anm, '"data/title/select00.jpg"', `${game} Web transition cache keeps the selection background`);
  requireText(anm, '"data/result/music.jpg"', `${game} Web transition cache keeps the Music Room background`);
  requireText(anm, '"data/result/result.jpg"', `${game} Web transition cache keeps the result background`);
  requireText(anm, "PreloadTransitionSurface", `${game} Web transition cache exposes a startup preload path`);
  requireText(supervisor, 'PreloadTransitionSurface("data/title/title00.jpg")', `${game} title background is warmed before menu presentation`);
  requireText(supervisor, 'PreloadTransitionSurface("data/title/select00.jpg")', `${game} selection background is warmed before menu presentation`);
  requireText(supervisor, 'PreloadTransitionSurface("data/result/music.jpg")', `${game} Music Room background is warmed before menu presentation`);
  requireText(supervisor, 'PreloadTransitionSurface("data/result/result.jpg")', `${game} result background is warmed before menu presentation`);
}
requireText(th07AnmManager, '"data/title/phantasm.jpg"', "TH07 Web transition cache keeps the Phantasm unlock background");
requireText(th07Supervisor, 'PreloadTransitionSurface("data/title/phantasm.jpg")', "TH07 Phantasm background is warmed before menu presentation");
requireText(th06AnmManager, "WebTransitionAnmCacheEntry", "TH06 Web menu ANM backing resources stay resident across scene changes");
requireText(th06AnmManager, "PreloadTransitionAnm", "TH06 Web menu ANMs expose a startup prewarm path");
requireText(th06AnmManager, '"data/music00.anm"', "TH06 Music Room ANM is part of the resident transition cache");
requireText(th06AnmManager, '"data/result00.anm"', "TH06 Result ANM is part of the resident transition cache");
requireText(th06AnmManager, "RestoreWebTransitionAnmBindings", "TH06 cached ANMs restore sprite/script bindings without reloading backing resources");
requireText(th06AnmManager, "ClearWebTransitionAnmBindings", "TH06 cached ANMs clear active bindings while retaining backing resources");
requireText(th07AnmManager, "WebTransitionAnmCacheEntry", "TH07 Web menu ANM backing resources stay resident across scene changes");
requireText(th07AnmManager, "PreloadTransitionAnms", "TH07 Web menu ANM groups expose a startup prewarm path");
requireText(th07AnmManager, '"data/music00.anm", ANM_FILE_MUSIC', "TH07 Music Room ANM group is part of the resident transition cache");
requireText(th07AnmManager, '"data/title01.anm", ANM_FILE_TITLE', "TH07 title ANM group is part of the resident transition cache");
requireText(th07AnmManager, "FindWebTransitionAnmContaining", "TH07 cached child ANM releases are owned by their resident group");
requireText(th07AnmManager, "RestoreWebTransitionAnmBindings", "TH07 cached ANMs restore overlapping sprite/script bindings without reloading textures");

requireText(hostApp, "const target = player;", "dedicated player fullscreen owner");
requireText(hostHtml, 'id="lessMotionToggle"', "desktop reduced-motion control");
requireText(hostHtml, 'href="faq.html"><span class="masthead-label"><span>常见</span><wbr><span>问题</span></span></a>', "FAQ navigation link");
requireText(hostApp, 'const lessMotionStorageKey = "eagler-touhou-less-motion-v1";', "reduced-motion preference persistence");
requireText(hostApp, 'for (const select of document.querySelectorAll("select.option-select")) installCustomSelect(select);', "all host option selects are upgraded to the shared custom dropdown");
requireText(hostApp, 'select.classList.add("custom-select-native");', "native select remains only as the hidden state owner");
requireText(hostApp, 'select.dispatchEvent(new Event("change", { bubbles: true }));', "custom dropdown preserves the existing select change contract");
requireText(hostApp, 'const host = customSelectHost();', "custom dropdown menu can escape clipped panels and fullscreen safely");
requireText(hostApp, 'if (ui.menu.parentNode !== host) host.append(ui.menu);', "custom dropdown menu is rehomed to the visible top-level host");
requireText(hostApp, 'event.key === "ArrowDown" || event.key === "ArrowUp"', "custom dropdown supports keyboard list navigation");
requireText(hostCss, '.option-select.custom-select-native{position:absolute!important;width:1px!important;height:1px!important', "native OS select picker is visually and interactively removed");
requireText(hostCss, '.mizuki-select-menu{position:fixed;z-index:120', "Mizuki-derived select menu renders as a floating panel above clipped settings");
requireText(hostCss, '@keyframes mizuki-select-menu-in{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:translateY(0)}}', "custom select reuses Mizuki dropdown translate/fade motion");
const hostSelectCount = (hostHtml.match(/<select\b/g) || []).length;
const customHostSelectCount = (hostHtml.match(/<select class="option-select"/g) || []).length;
if (hostSelectCount < 4 || customHostSelectCount !== hostSelectCount) {
  throw new Error("all host option selects must remain covered by the shared custom dropdown owner");
}
requireText(hostApp, 'document.body.classList.toggle("less-motion", state.lessMotion);', "reduced-motion body state");
if (hostApp.includes("bringSelectedCardForward") || hostApp.includes("main.insertBefore(card")) {
  throw new Error("selected game cards must expand in their existing DOM position");
}
requireText(hostApp, "function renderChangelogText(target, source)", "structured changelog renderer");
requireText(hostHtml, '<h1 id="changelogTitle">更新日志</h1>', "FAQ-like changelog heading");
requireText(hostCss, '.motion-toggle{display:none}', "reduced-motion control hidden on mobile");
requireText(hostCss, '--ui-font:"ET Yatra","ET Chill Round",sans-serif', "Yatra and Chill Round UI stack without Unifont fallback");
requireText(hostCss, 'assets/fonts/yatra-one-latin.woff2', "local Yatra font-face");
requireText(hostCss, 'assets/fonts/chill-round-gothic-site-medium.woff2', "local Chill Round medium body font-face");
requireText(hostCss, 'assets/fonts/chill-round-gothic-site-bold.woff2', "local Chill Round bold font-face");
requireText(hostCss, 'assets/fonts/chill-round-gothic-site-heavy.woff2', "local Chill Round heavy title font-face");
requireText(hostHtml, 'href="assets/fonts/yatra-one-latin.woff2" as="font"', "Yatra preload");
requireText(hostHtml, 'href="assets/fonts/chill-round-gothic-site-medium.woff2" as="font"', "Chill Round body preload");
requireText(hostHtml, 'href="assets/fonts/chill-round-gothic-site-heavy.woff2" as="font"', "Chill Round card-title preload");
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
requireText(hostCss, '.tools-head h3{position:relative;z-index:1;display:inline-block;margin:17px 0 0;font:900 25px/1.15 var(--ui-font)', "tool game title uses Chill Round Heavy");
requireText(hostCss, '.tools-head .game-id[data-game="th06"]+h3:before{content:"";', "TH06 tool title owns its translucent decorative backing");
requireText(hostCss, '.game-id{position:absolute;z-index:0;right:5px;top:5px;margin:0;text-align:right;color:rgba(218,224,215,.08);font:900 56px/.9 var(--art-font)', "tool game ID forms a large translucent title backdrop");
if (hostCss.includes('content:"TOOLS"')) throw new Error("the decorative TOOLS label must stay removed");
requireText(hostHtml, '<div class="no">06</div>', "TH06 card number omits its TH prefix");
requireText(hostHtml, '<div class="no">07</div>', "TH07 card number omits its TH prefix");
if (hostHtml.includes('<div class="no"><span>TH</span>')) throw new Error("game-card numbers must not retain the TH prefix");
requireText(hostCss, '.less-motion .game{transform:none!important;transform-style:flat;transition:border-color .12s ease', "desktop reduced-motion mirrors mobile flat cards");
if (hostCss.includes(".less-motion .prompt:before{animation:none")) throw new Error("less-motion must not suppress the prompt animation when current mobile keeps it");
requireText(hostCss, '.less-motion .tools{transform:none;transition:none!important}', "desktop reduced-motion uses the mobile direct layout change");
requireText(hostHtml, 'href="touch-guide.css"', "stable Workbox-managed touch-help stylesheet URL");
requireText(hostHtml, 'id="touchHelp" role="dialog" aria-modal="true" aria-labelledby="touchHelpTitle"', "touch help uses its visible themed title as the dialog label");
requireText(hostHtml, 'id="touchHelpTitle">帮助</strong>', "touch help has a visible title");
requireText(hostHtml, '<button id="touchHelpClose" type="button" aria-label="关闭帮助" title="关闭">', "touch help uses a dedicated close action");
requireText(hostHtml, '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17"/></svg>', "touch help close action uses the themed icon button");
if (hostHtml.includes('关闭 ×')) throw new Error("touch help must not retain the old text close button");
requireText(touchGuideCss, '.touch-help{background:rgba(0,0,0,.72)}', "touch help uses the shared solid dim overlay without background blur");
requireText(touchGuideCss, 'border:1px solid rgba(255,255,255,.1);border-radius:16px;background:#191a17', "touch help uses the Mizuki float-panel surface");
requireText(touchGuideCss, 'box-shadow:0 25px 50px -12px rgba(0,0,0,.72)', "touch help uses a soft elevated shadow instead of an offset hard shadow");
requireText(touchGuideCss, '@keyframes touchHelpPanelIn{from{opacity:0;transform:translateY(14px) scale(.985)}to{opacity:1;transform:translateY(0) scale(1)}}', "touch help follows Mizuki translate-and-scale panel motion");
const nonGameBackdropBlur = /(?:^|[;}])(?:-webkit-)?backdrop-filter\s*:\s*(?!none\b)[^;}]*blur\(/i;
if (nonGameBackdropBlur.test(hostCss) || nonGameBackdropBlur.test(touchGuideCss)) throw new Error("non-game UI must not use backdrop blur");
requireText(hostCss, 'filter:brightness(.72) saturate(.72) blur(3px)', "game cards remain the only intentional blur surface");
requireText(touchGuideCss, '.guide-scene{position:relative;width:min(660px,100%);overflow:hidden;border:0;border-radius:12px;background:#151714', "touch help tutorial sections use rounded tonal cards");
requireText(touchGuideCss, '.guide-tab-card:hover,.guide-tab-card:focus-visible{background:#242720;color:#fff;outline:none}', "touch help accordion rows use Mizuki-like tonal hover states");
requireText(hostHtml, 'class="guide-tab-arrow mizuki-select-arrow" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false"><path d="m7 10 5 5 5-5"/></svg></i>', "touch help accordion uses the same chevron control as the language dropdown");
requireText(touchGuideCss, '.guide-tab-card[aria-expanded="true"] .guide-tab-arrow{transform:rotate(180deg)}', "touch help chevron opens like the shared custom select arrow");
if (hostHtml.includes('<i aria-hidden="true">＋</i>')) throw new Error("touch help accordion must not retain the old plus control");
requireText(touchGuideCss, '@media(max-width:780px),(hover:none),(pointer:coarse){.touch-help:not([hidden]){animation-duration:.16s}', "touch help mobile motion uses the shared mobile-lite intensity");
if (touchGuideCss.includes('box-shadow:6px 6px 0 #000') || touchGuideCss.includes('.touch-help-window{width:min(920px,97vw)')) {
  throw new Error("touch help must not retain its old hard-edged shell");
}
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
requireText(hostCss, '.site-notice{--site-notice-duration:12000ms;position:fixed;z-index:70;left:50%;bottom:', "site notice is a bottom floating announcement instead of a hidden top bar");
requireText(hostCss, '.site-notice.site-notice-scroll-hidden{opacity:0;pointer-events:none;transform:translate(-50%,calc(100% + 30px)) scale(.985)}', "site notice slides away while scrolling down");
requireText(hostCss, '.masthead{position:relative;z-index:10;margin:0 calc(var(--sheet-edge)*-1);', "masthead extends to the top page edges");
requireText(hostCss, 'border-radius:0 0 20px 20px;background:transparent;box-shadow:none;backdrop-filter:none', "masthead stays transparent with bottom-only rounded geometry");
requireText(hostCss, '.masthead{margin:0 -14px;padding:11px 14px 8px;', "mobile masthead stays close to the system-protected top edge");
requireText(hostCss, '.masthead-link{position:relative;isolation:isolate;min-width:0;min-height:36px;box-sizing:border-box;padding:0 12px;border:0;border-radius:8px;background:transparent;', "masthead actions use the reference navbar button geometry");
requireText(hostCss, '.masthead-link:before{content:"";position:absolute;inset:0;z-index:-1;border-radius:inherit;background:transparent;transform:scale(.85);', "masthead actions keep the reference background layer transparent at rest");
requireText(hostCss, '.masthead-link:hover:before{background:#f1e4e6;transform:scale(1)}', "masthead actions expand the light theme layer only on hover");
requireText(hostCss, '.masthead-link:hover{background:transparent;color:#b33142}', "masthead actions switch to prominent theme text only on hover");
requireText(hostCss, 'text-decoration:none;font-weight:700;transition:color .15s ease', "masthead action labels use the requested bold weight");
requireText(hostCss, '.motion-toggle i{display:none}', "reduced-motion toggle does not use the old status dot");
requireText(hostCss, '.motion-toggle[aria-pressed="true"]{color:#8f2633}.motion-toggle[aria-pressed="true"]:before{background:#f1e4e6;transform:scale(1)}', "reduced-motion toggle uses a selected MD3 container");
requireText(hostCss, '.masthead-link:active{background:transparent;color:#8f2633;transform:scale(.9)}', "masthead actions use the reference press scale");
requireText(hostCss, '.masthead-link[hidden]{display:none}', "hidden masthead actions do not occupy layout space");
requireText(hostCss, '.masthead-link{min-width:0;min-height:34px;padding:2px 4px;border-radius:8px;letter-spacing:.08em;white-space:normal}', "mobile masthead actions stay compact on one line with controlled internal wrap points");
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
requireText(hostApp, "function pushTouchControlsLive()", "live touch controls use a dedicated fire-and-forget transport");
requireText(hostApp, 'command: "touch-controls",', "live touch transport targets the existing touch-controls protocol");
requireText(hostHtml, 'id="touchDirectSurface"', "host direct-touch surface exists above the game iframe");
requireText(hostCss, ".touch-direct-surface{position:absolute;z-index:30;inset:0;touch-action:none", "direct-touch surface owns same-document iOS movement pointers");
requireText(hostApp, "const iosWebKitTouch = /iPhone|iPad|iPod/i.test(navigator.userAgent)", "host direct-touch bridge is scoped to iOS/iPadOS WebKit");
requireText(hostApp, 'const iosHelpPreview = new URLSearchParams(location.search).get("iosHelpPreview") === "1";', "Android/manual QA can preview iOS-only help without changing touch routing");
requireText(hostApp, "const showIosFullscreenHelp = iosWebKitTouch || iosHelpPreview;", "iOS help preview is isolated from the real WebKit touch owner");
requireText(hostApp, "if (showIosFullscreenHelp) {", "iOS help card can be previewed independently of platform touch behavior");
const queryHelperPos = hostApp.indexOf('const $ = selector => document.querySelector(selector);');
const iosHelpDomPos = hostApp.indexOf('const guideOrientationTitle = $("#guideOrientationTitle");');
if (queryHelperPos < 0 || iosHelpDomPos < 0 || iosHelpDomPos < queryHelperPos) {
  throw new Error("iOS help DOM initialization must happen after the $ query helper to avoid startup TDZ");
}
requireText(hostApp, 'const androidDirectTouchTrial = /\\bAndroid\\b/i.test(navigator.userAgent || "") &&', "Android direct-touch experiment is Android-scoped");
requireText(hostApp, 'new URLSearchParams(location.search).get("androidDirectTouch") === "1";', "Android direct-touch experiment requires an explicit URL opt-in");
requireText(hostApp, "const hostDirectTouch = iosWebKitTouch || androidDirectTouchTrial;", "iOS remains default direct-touch while Android only joins through the trial flag");
requireText(hostApp, "touchDirectSurface.hidden = !(hostDirectTouch && state.options.touchEnabled", "direct-touch surface follows the gated host bridge owner");
requireText(hostApp, 'const androidBrowsingContextFocus = /\\bAndroid\\b/i.test(navigator.userAgent || "");', "Android has a dedicated browsing-context focus relay without enabling iOS direct-touch");
requireText(hostApp, "function startPlayerFocusRelay()", "Launcher can keep the Player iframe focused during Android startup");
requireText(hostApp, "startPlayerFocusRelay();", "Android Player focus relay starts before Runtime launch waits for first-frame");
requireText(hostApp, "stopPlayerFocusRelay();", "Android Player focus relay is bounded by startup lifecycle");
requireText(hostApp, 'command: "direct-touch",', "host direct-touch movement is forwarded through Player protocol");
requireText(hostApp, 'try { frame.contentWindow.focus(); } catch {}', "Android startup relay restores the direct child Runtime browsing-context focus before first-frame without the retired nested focus-runtime protocol");
if (hostApp.includes('command: "focus-runtime"')) {
  throw new Error("direct-child Runtime startup must not retain the retired nested focus-runtime protocol");
}
if (!/function refocusGameIfNeeded\(\) \{\s*\/\/ Keep the historical gameplay hot path:/.test(hostApp)) {
  throw new Error("gameplay focus helper must document the restored no-op hot path");
}
requireText(hostApp, 'if (document.activeElement !== frame) frame.focus({ preventScroll: true });', "gameplay focus remains a no-op while the game iframe already owns focus");
if (/function refocusGameIfNeeded\(\)[\s\S]{0,800}androidBrowsingContextFocus[\s\S]{0,800}focusPlayerBrowsingContext/.test(hostApp)) {
  throw new Error("gameplay HUD must not run the Android cross-iframe startup focus relay");
}
const directPointerDown = hostApp.match(/touchDirectSurface\.addEventListener\("pointerdown"[\s\S]*?\n\}\);/)?.[0] || "";
if (directPointerDown.includes("refocusGameIfNeeded") || directPointerDown.includes("focusPlayerBrowsingContext")) {
  throw new Error("direct-touch pointerdown must not steal browsing-context focus from an active pointer stream");
}
const joystickPointerDown = hostApp.match(/touchJoystick\.addEventListener\("pointerdown"[\s\S]*?\n\}\);/)?.[0] || "";
if (joystickPointerDown.includes("refocusGameIfNeeded") || joystickPointerDown.includes("focusPlayerBrowsingContext")) {
  throw new Error("joystick pointerdown must not force cross-iframe focus on the gameplay hot path");
}
requireText(hostApp, "const directTouchPointers = new Map();", "host tracks simultaneous direct-touch pointers independently");
requireText(hostApp, "let directTouchFrameRect = null;", "direct-touch caches game-frame geometry across a normal gameplay gesture");
requireText(hostApp, "function invalidateDirectTouchFrameRect()", "direct-touch geometry cache has an explicit invalidation owner");
requireText(hostApp, "function currentDirectTouchFrameRect(force = false)", "direct-touch geometry is refreshed only when required");
requireText(hostApp, "if (!force && directTouchFrameRect) return directTouchFrameRect;", "direct-touch pointer moves reuse cached geometry instead of forcing layout");
requireText(hostApp, 'window.addEventListener("resize", invalidateDirectTouchFrameRect', "direct-touch geometry cache invalidates on viewport resize");
requireText(hostApp, 'window.visualViewport?.addEventListener("resize", invalidateDirectTouchFrameRect', "direct-touch geometry cache invalidates on visual viewport resize");
requireText(hostApp, 'touchDirectSurface.addEventListener("pointerdown"', "host direct-touch surface accepts movement pointer down");
requireText(hostApp, 'touchDirectSurface.addEventListener("pointermove"', "host direct-touch surface accepts movement pointer motion");
requireText(hostApp, 'touchDirectSurface.addEventListener("pointerup"', "host direct-touch surface releases movement pointers");
for (const game of ["th06", "th07"]) {
  const shell = read(`${game}-eagler/resources/shell.html`);
  requireText(shell, 'case "direct-touch":', `${game} Runtime accepts hosted direct-touch bridge messages`);
  requireText(shell, "Module._TouhouAuxTouchDown(message.id, touchX, touchY)", `${game} direct-touch DOWN enters native touch state`);
  requireText(shell, "Module._TouhouAuxTouchMotion(message.id, touchX, touchY)", `${game} direct-touch MOVE enters native touch state`);
  requireText(shell, "Module._TouhouAuxTouchUp(message.id, touchX, touchY)", `${game} direct-touch UP enters native touch state`);
}
requireText(hostApp, "renderTouchFireState(false);", "fire input avoids gameplay-time copy/layout updates");
requireText(hostApp, "renderTouchFocusState(false);", "focus input avoids gameplay-time copy/layout updates");
requireText(hostCss, '.touch-hud .touch-fire,.touch-hud .touch-focus{transition:none}', "fire and focus buttons avoid gameplay-time transition work");
requireText(hostApp, 'const hostedGameKeyCodes = new Set([', "host external-keyboard bridge inventory");
requireText(hostApp, '"Tab", "Backspace", "F1"', "host keyboard lock forwards Tab alongside thprac hotkeys");
requireText(hostApp, '"tab", "backspace", "f1"', "host key-name bridge forwards Tab alongside thprac hotkeys");
requireText(hostApp, 'const hostedGameLegacyKeyCodes = new Set([8, 9, 13, 16, 17, 27, 36, 37, 38, 39, 40', "host legacy DOM keyboard bridge inventory including Backspace and Tab");
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
const zoomBridgeStart = hostApp.indexOf("function bindGameZoomInputWindow(win)");
const zoomBridgeEnd = hostApp.indexOf("function clampGameZoomScale", zoomBridgeStart);
if (zoomBridgeStart < 0 || zoomBridgeEnd < 0) throw new Error("zoom input bridge function bounds not found");
const zoomBridge = hostApp.slice(zoomBridgeStart, zoomBridgeEnd);
if (zoomBridge.includes("gameZoomInputWindow === win")) throw new Error("zoom bridge must not trust stable iframe WindowProxy identity across reloads");
requireText(hostApp, 'function resetGameZoomFromControl()', "magnifier control is a reset action");
if (hostApp.includes('showToast("画面缩放已恢复为 100%")')) throw new Error("game zoom reset must be silent");
requireText(hostHtml, 'id="gameZoomToggle" type="button" aria-label="恢复游戏画面原位置和大小" title="恢复原位置和大小" hidden><strong>复位</strong>', "in-game magnifier button is a reset control");
requireText(hostHtml, 'id="magnifierToggle" type="button" role="switch" aria-checked="false"', "mobile adaptation magnifier option remains a switch");
requireText(hostApp, '$("#magnifierConflict").hidden = state.options.touchFocusMode !== "two-finger";', "magnifier incompatibility copy follows two-finger focus mode");
requireText(hostApp, 'gameZoomState.active = available;', "enabled magnifier no longer needs a second mode toggle");
if (hostApp.includes('function setGameZoomMode(')) throw new Error("enabled magnifier must not require a separate zoom mode");
const resetRuntimeStart = hostApp.indexOf("function resetRuntime()");
const resetRuntimeEnd = hostApp.indexOf("function prepareMidi()", resetRuntimeStart);
if (resetRuntimeStart < 0 || resetRuntimeEnd < 0) throw new Error("resetRuntime function bounds not found");
const resetRuntimeBody = hostApp.slice(resetRuntimeStart, resetRuntimeEnd);
requireText(resetRuntimeBody, "uninstallRuntimeDomBridges();", "runtime reset removes every stale nested Runtime DOM bridge");
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
requireText(hostApp, '["toast", "startupError", "decisionDialog", "gameDataImportWindow", "gameDataLinkWindow"]', "all transient decision/import surfaces share the same fullscreen rehome owner");
const showToastBody = hostApp.slice(hostApp.indexOf("function showToast("), hostApp.indexOf("function syncTransientOverlayHost("));
requireText(showToastBody, 'syncTransientOverlayHost();', "toast resolves its fullscreen host before display");
requireText(hostApp, 'const toastDurationMs = 2000;', "all host toasts use the same two-second lifetime");
if (/showToast\([^\n]*,\s*\d+\)/.test(hostApp)) throw new Error("toast callsites must not carry per-call duration overrides");
requireText(showToastBody, 'toastTimer = setTimeout(hideToast, toastDurationMs);', "toast auto-dismisses from the fixed lifetime owner");
if (hostHtml.includes('toastCountdown') || hostApp.includes('toastRemainingMs')) throw new Error("toast must not expose a numeric countdown or JS remaining-time state");
requireText(hostCss, '.toast.show:after{content:"";position:absolute;left:0;right:0;bottom:0;height:2px', "toast exposes a thin bottom lifetime bar");
requireText(hostCss, '@keyframes toast-life-bar{from{transform:scaleX(1)}to{transform:scaleX(0)}}', "toast lifetime bar drains over the notice lifetime");
requireText(showToastBody, 'toast.classList.remove("show");', "replacing a toast restarts the lifetime bar");
requireText(hostHtml, 'class="toast-close" id="toastClose"', "toast keeps its explicit close action beside the lifetime bar");
requireText(hostHtml, 'id="decisionDialog" aria-labelledby="decisionTitle" aria-describedby="decisionMessage"', "shared decision dialog has accessible title and description ownership");
requireText(hostHtml, '<strong id="decisionTitle">确认吗？</strong>', "every confirmation uses one Chinese-only fixed title");
requireText(hostApp, '$("#decisionTitle").textContent = "确认吗？";', "confirmation title cannot be customized per callsite");
if (/askConfirmation\(\{[^}]*\btitle\s*:/s.test(hostApp)) throw new Error("confirmation callsites must not define custom titles");
if (/askConfirmation\(\{[^}]*\bkicker\s*:/s.test(hostApp) || hostHtml.includes("decisionKicker") || hostHtml.includes(">CONFIRM<")) throw new Error("confirmation UI must not mix English kicker text with Chinese");
requireText(hostApp, 'closeDecisionDialog(["confirm", "secondary"].includes(event.submitter?.value) ? event.submitter.value : "cancel");', "decision form owns animated close before native dialog close, including the optional third choice");
requireText(hostApp, 'closeDecisionDialog("cancel");', "Escape cancellation uses the same animated close path");
requireText(hostCss, '@keyframes decision-card-in{from{opacity:0;transform:translateY(18px) scale(.98)}to{opacity:1;transform:translateY(0) scale(1)}}', "decision card follows Mizuki-style translate/scale motion without overshoot");
requireText(hostCss, '@keyframes decision-card-out{', "decision card has a matching exit motion");
if (hostCss.includes("decision-card-in-lite") || hostCss.includes(".less-motion .decision-dialog[open]")) throw new Error("less-motion must reuse the same decision animation currently shown on mobile, not a third lighter dialog tier");
requireText(hostHtml, 'class="decision-body"', "decision dialog uses the Mizuki modal body/footer split");
requireText(hostHtml, 'class="decision-mark"', "decision dialog keeps the centered Mizuki-style icon treatment");
requireText(hostCss, '.decision-dialog{width:min(384px,calc(100vw - 32px));padding:0;border:0;border-radius:16px', "decision dialog follows Mizuki max-sm rounded-2xl shell geometry");
requireText(hostCss, '.decision-dialog::backdrop{background:rgba(0,0,0,.72)}', "decision dialog backdrop matches Replay manager opacity without blur");
requireText(hostCss, '.decision-dialog[open]::backdrop{animation:decision-backdrop-in 220ms cubic-bezier(.4,0,.2,1) both}', "decision backdrop uses the Replay manager fade-in timing");
requireText(hostCss, '@keyframes decision-backdrop-in{from{background:rgba(0,0,0,0)}to{background:rgba(0,0,0,.72)}}', "decision backdrop animation lands on the Replay manager opacity");
if (hostCss.includes('.decision-dialog::backdrop{background:rgba(0,0,0,.6);backdrop-filter') || hostCss.includes('.decision-dialog::backdrop{background:rgba(0,0,0,.72);backdrop-filter')) throw new Error("decision dialog backdrop must not blur the game behind it");
requireText(hostCss, '.decision-window>footer{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:0;padding:16px;border-top:1px solid rgba(255,255,255,.1)}', "decision actions follow Mizuki two-column modal footer spacing");
requireText(hostCss, '.decision-dialog[data-options="3"] .decision-window>footer{grid-template-columns:1fr 1fr 1fr;gap:9px}', "three-choice update decisions reuse the same dialog shell with a compact three-column footer");
if (hostCss.includes(".decision-window:before")) throw new Error("decision dialog must not restore the old decorative side stripe");
requireText(hostApp, '$("#decisionCancel").focus({ preventScroll: true });', "decision dialog initially focuses the safe cancel action");
requireText(hostApp, 'if (focusReturn?.isConnected) focusReturn.focus({ preventScroll: true });', "decision dialog restores focus to its opener");
requireText(hostApp, 'if (event.currentTarget.dataset.confirmOnEnter === "true") $("#decisionConfirm").click();', "Enter only confirms when a callsite explicitly opts in");
requireText(hostApp, 'dialog.returnValue = "cancel";', "Escape/native dialog cancellation resolves from a safe cancel return value");
requireText(hostApp, 'resolve?.(["confirm", "secondary"].includes(event.currentTarget.returnValue) ? event.currentTarget.returnValue : "cancel");', "dialog close preserves the explicit three-way choice while mapping Escape to cancel");
requireText(hostApp, 'return askDecision(options).then(value => value === "confirm");', "legacy two-choice confirmations still expose a boolean and cannot treat the background choice as confirmation");
requireText(hostApp, 'if (value !== state.options.touchMovementMode && !await confirmTouchModeBeforeEnable(value)) { render(); return; }', "cancelling an async touch-mode warning restores the rendered old value before state mutation");
if (/\b(?:window\.)?confirm\s*\(/.test(hostApp)) throw new Error("native browser confirm() must not remain in app.js");
const fullscreenChangeBody = hostApp.slice(hostApp.indexOf("function handleFullscreenChange()"), hostApp.indexOf('document.addEventListener("fullscreenchange"'));
requireText(fullscreenChangeBody, 'syncTransientOverlayHost();', "fullscreen changes rehome visible transient overlays");
requireText(hostCss, '.toast{z-index:80}', "toast remains above fullscreen player controls and editor overlays");
requireText(hostApp, 'loading.className = "replay-loading";', "replay manager exposes an immediate loading state");
requireText(hostApp, 'loading.innerHTML = \'<i aria-hidden="true"></i><span>正在读取录像…</span>\';', "replay loading state has visible progress copy");
requireText(hostCss, '@keyframes replay-loading-spin{to{transform:rotate(360deg)}}', "replay manager loading spinner animation");
requireText(hostCss, '@keyframes replay-window-in{from{opacity:0;transform:translateY(14px) scale(.985)}', "replay manager opens with restrained translate/scale motion");
requireText(hostCss, '@keyframes replay-window-out{from{opacity:1;transform:translateY(0) scale(1)}', "replay manager closes with a matching short exit motion");
requireText(hostApp, 'function closeReplayManager() {', "replay manager owns animated close instead of native instant form dismissal");
requireText(hostApp, 'replayDialog.addEventListener("cancel", event => { event.preventDefault(); closeReplayManager(); });', "Escape follows replay manager exit motion");
requireText(hostHtml, 'data-replay-close', "replay manager close buttons use the animated close owner");
requireText(hostApp, 'async function refreshReplayManager({ animateRows = false } = {})', "replay rows animate only when explicitly requested");
requireText(hostApp, 'await refreshReplayManager({ animateRows: true });', "initial replay listing requests the quick row reveal");
requireText(hostCss, '.replay-row.replay-row-enter{animation:replay-row-in 180ms ease-out both;', "initial replay rows use a short restrained reveal");
requireText(hostHtml, '<header><strong>录像管理</strong>', "replay manager title is localized");
requireText(hostHtml, '拖放 .RPY / .RPYX / .ZIP 到此处导入', "replay import hint is localized");
requireText(hostApp, 'rename.textContent = "改名";', "replay rename is a separate action");
requireText(hostApp, 'throw new Error("已存在同名录像文件")', "replay rename cannot overwrite another replay");
requireText(hostApp, 'remove.className = "replay-delete"; remove.textContent = "删除";', "replay delete is a separate destructive action");
requireText(hostApp, 'if (!await askConfirmation({', "replay deletion uses the shared explicit confirmation surface");
requireText(hostApp, 'tone: "danger"', "destructive confirmation uses the danger treatment");
if (hostApp.includes('改名/删除') || hostHtml.includes('REPLAY MANAGER') || hostHtml.includes('DROP .RPY')) throw new Error("replay manager must not retain the old combined or English controls");
requireText(hostHtml, '<span id="launchText">启动游戏</span><span class="launch-icon" aria-hidden="true"><svg viewBox="0 0 24 24">', "launch action uses localized copy and an inline MD arrow");
requireText(hostApp, 'const hasInstalledPackage = installedPackageSnapshots.has(state.game);', "launch copy can distinguish a real Installed Package from missing import-only resources");
requireText(hostApp, '? "导入游戏资源" : state.runtimeVariant === "multiplayer" ? "启动 LAN 联机" : "启动游戏";', "launch copy reflects import-only resources and the selected real Runtime without hiding an installed Package launch");
requireText(hostCss, 'html,body,.sheet{background:#0d0d0c}', "page uses the requested solid background color");
requireText(hostApp, 'const keepReplayManagerOpen = kind === "replay" && replayDialog.open;', "replay imports preserve an open manager window");
requireText(hostApp, 'if (keepReplayManagerOpen) await refreshReplayManager();', "replay manager refreshes in place after import");
const manageReplayBody = hostApp.slice(hostApp.indexOf("async function manageReplays()"), hostApp.indexOf("const replayWindow", hostApp.indexOf("async function manageReplays()")));
if (manageReplayBody.indexOf('dialog.showModal();') > manageReplayBody.indexOf('await refreshReplayManager({ animateRows: true });')) {
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
requireText(hostApp, "function renderTouchActionState()", "live touch action state has a narrow HUD-only renderer");
requireText(hostApp, "if (touchControls.focusEnabled === enabled) return;", "focus release deduplicates pointerup/lostpointercapture state");
const touchFireRuntimeFn = hostApp.slice(hostApp.indexOf("async function toggleTouchFire()"), hostApp.indexOf("async function setTouchFocus(value)"));
const touchFocusRuntimeFn = hostApp.slice(hostApp.indexOf("async function setTouchFocus(value)"), hostApp.indexOf("const touchFocusButton"));
if (touchFireRuntimeFn.includes("render();") || touchFocusRuntimeFn.includes("render();")) {
  throw new Error("live fire/focus input must not run the full page renderer");
}
requireText(hostCss, ".touch-hud button:active,.touch-escape:active,.touch-thprac-input:active,.touch-thprac-tab:active,.touch-thprac-menu button:active{transform:none}", "live gameplay buttons do not animate press-scale transforms");
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
requireText(hostCss, '.touch-layout-settings{position:absolute;z-index:44;right:max(8px,env(safe-area-inset-right));left:auto;top:max(8px,env(safe-area-inset-top));width:220px;height:180px', "touch settings keep their original floating-panel height");
if (hostCss.includes('height:min(156px,46svh)')) throw new Error("touch settings must not retain the mistaken landscape-height workaround");
requireText(hostHtml, 'id="guideTabOrientation" type="button" aria-expanded="false" aria-controls="guideOrientation" data-guide-tab="orientation"', "manual-landscape/iOS-web-app help defaults collapsed like the other help sections");
requireText(hostHtml, '<strong id="guideOrientationTitle">手动横屏</strong><small id="guideOrientationSummary">屏幕没有自动旋转时</small>', "Android mobile help keeps the manual-landscape title by default");
requireText(hostHtml, '<li>把手机横过来。是的，物理上先把手机横过来。</li>', "manual-landscape help starts with the physical rotation step");
requireText(hostHtml, '<li>点击右下角出现的系统旋转按钮。</li>', "manual-landscape help points to the system rotation control in the lower-right corner");
requireText(hostHtml, '<div id="guideOrientationIos" hidden>', "iOS web-app help is present but hidden by default");
requireText(hostHtml, '<strong>Safari 浏览器打开本站</strong>', "iOS help uses Apple Safari terminology");
requireText(hostHtml, '轻点“更多”→“共享”。如果标签页布局是“底部”或“顶部”，直接轻点“共享”。', "iOS help explains the two Safari share-entry layouts");
requireText(hostHtml, '<strong>添加到主屏幕</strong>', "iOS help uses Apple Add to Home Screen terminology");
requireText(hostHtml, '滚到列表底部 →“编辑操作”→ 添加“添加到主屏幕”。', "iOS help includes the Edit Actions fallback");
requireText(hostHtml, '<strong>作为网页 App 打开</strong>', "iOS help uses Apple Open as Web App terminology");
requireText(hostHtml, '打开“作为网页 App 打开”，轻点“添加”。以后从主屏幕图标进入，即可隐藏 Safari 导航栏。', "iOS help completes the web-app launch path");
requireText(hostApp, 'guideOrientationTitle.textContent = "iPhone 全屏游玩";', "iOS swaps the Android orientation help title");
requireText(hostApp, 'guideOrientationSummary.textContent = "隐藏 Safari 导航栏";', "iOS help summary names the user-visible result");
requireText(hostApp, 'guideOrientationAndroid.hidden = true;', "iOS hides the Android rotation tutorial");
requireText(hostApp, 'guideOrientationIos.hidden = false;', "iOS reveals the web-app tutorial");
if (hostHtml.includes('<strong>推荐：横屏 + 全屏</strong>')) throw new Error("manual-landscape help must not retain the redundant secondary heading");
requireText(hostHtml, '<article class="guide-scene guide-panel help-desktop-only" data-guide-panel="game-controls">', "game-controls help is desktop-only");
requireText(hostHtml, 'id="guideTabGameControls" type="button" aria-expanded="false" aria-controls="guideGameControls" data-guide-tab="game-controls"', "game-controls help section exists and defaults collapsed");
requireText(hostHtml, '<kbd>Shift</kbd><span>按住低速移动，并显示判定点</span>', "game-controls help explains low-speed hitbox behavior");
requireText(hostHtml, '<kbd>Ctrl</kbd><span>快速跳过对话</span>', "TH06/TH07 game-controls help documents Ctrl dialogue skip without later-game replay acceleration");
requireText(hostHtml, 'id="guideTabThprac" type="button" aria-expanded="false" aria-controls="guideThprac" data-guide-tab="thprac"', "thprac help section exists and defaults collapsed");
requireText(hostHtml, '<kbd>Backspace</kbd><span>作弊菜单</span>', "desktop thprac help names the Backspace action as cheat menu");
requireText(hostHtml, '<kbd>Tab</kbd><span>打开 / 关闭练习统计 Tracker</span>', "thprac help documents Tracker key");
requireText(hostHtml, '<kbd>作弊菜单</kbd><span>打开 / 关闭作弊菜单</span>', "mobile thprac help uses the direct cheat-menu label");
for (const [key, label] of [["F1", "无敌"], ["F2", "无限残机"], ["F3", "无限 Bomb"], ["F4", "无限火力"], ["F5", "时间锁"], ["F6", "自动 Bomb"], ["F7", "敌方 BGM"]]) {
  requireText(hostHtml, `<kbd>${key}</kbd><span>${label}</span>`, `thprac help documents ${key} ${label}`);
}
requireText(touchGuideCss, '.guide-key-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px}', "game/thprac help uses compact themed key grid");
requireText(hostHtml, '<div class="guide-demo-body" id="guideOrientation" hidden>', "manual-landscape help body starts hidden");
requireText(hostHtml, 'orientation-guide help-mobile-only', "manual-landscape help is mobile-only");
for (const panelClass of ['focus-demo help-mobile-only', 'menu-demo help-mobile-only', 'dialogue-demo help-mobile-only']) requireText(hostHtml, panelClass, `touch tutorial ${panelClass} is mobile-only`);
requireText(touchGuideCss, '.help-mobile-only{display:none!important}', "mobile-only help is hidden on desktop by default");
requireText(touchGuideCss, '@media(hover:none) and (pointer:coarse){.help-desktop-only{display:none!important}.help-mobile-only{display:block!important}', "coarse no-hover touch devices swap desktop help for mobile help without classifying touch-capable desktops by either signal alone");
requireText(hostHtml, 'id="guideFocusSummary">移动与低速操作</small>', "gameplay touch help no longer hard-codes two-finger focus in static HTML");
requireText(hostApp, 'summary.textContent = "移动时，用第二指按住进入低速";', "two-finger focus help follows the selected focus mode");
requireText(hostApp, 'summary.textContent = "移动时，按住「低速」按钮";', "hold-button focus help follows the selected focus mode");
requireText(hostApp, 'summary.textContent = "移动时，点按「低速」按钮切换状态";', "toggle-button focus help follows the selected focus mode");
requireText(touchGuideCss, '.focus-demo.is-playing[data-focus-mode="hold-button"] .finger-focus{animation:focusButtonHold', "hold-button focus tutorial has a dedicated visual");
requireText(touchGuideCss, '.focus-demo.is-playing[data-focus-mode="toggle-button"] .finger-focus{animation:focusButtonTap', "toggle-button focus tutorial has a dedicated visual");
if (hostHtml.includes('<small>两指按住，可以进入低速状态</small>')) throw new Error("gameplay touch help must not hard-code two-finger focus");
requireText(hostHtml, '<span class="menu-phase phase-confirm">单击确认</span>', "menu tutorial describes confirmation independently from a particular option label");
requireText(hostHtml, '<span class="menu-phase phase-select">滑动选择，再单击确认</span>', "menu tutorial describes gesture semantics rather than tapping a visible option");
requireText(touchGuideCss, '.menu-finger-one{left:58%;top:67%', "menu tutorial keeps the primary touch gesture in open screen space below the choices");
requireText(touchGuideCss, '.menu-finger-two{left:28%;top:70%', "menu tutorial keeps the return gesture in open screen space below the choices");
requireText(touchGuideCss, '28%{opacity:1;transform:translate(-18px,8px) scale(.82)}32%{opacity:1;transform:translate(43px,-3px) scale(.82)}32.1%,33.9%{opacity:0', "menu selection gesture is one straight fast swipe with no intermediate pause/keyframe");
if (touchGuideCss.includes('31%{opacity:1;transform:translate(-3px,-3px)') || touchGuideCss.includes('33%{opacity:1;transform:translate(20px,-13px)')) throw new Error("menu selection swipe must not bend through intermediate waypoints");
requireText(touchGuideCss, '@keyframes yesChoice{0%,29.9%,80%,100%', "menu selection feedback changes while the straight swipe is crossing the selection boundary");
requireText(touchGuideCss, '@keyframes resultNo{0%,36%,51%,100%{opacity:0}37%,50%{opacity:1}}', "menu confirmation feedback appears immediately after the confirmation tap");
requireText(touchGuideCss, '@keyframes menuFingerTwo{0%,69.9%{opacity:0;transform:translate(0,5px) scale(.82)}70%,71.9%{opacity:1;transform:translate(0,0) scale(.78)}72%,74%{opacity:1;transform:translate(1px,1px) scale(.58)}', "second return finger presses on the same 70/72-percent frames as the first finger");
requireText(touchGuideCss, '70%,71.9%{opacity:1;transform:translate(-8px,2px) scale(.78)}72%,74%{opacity:1;transform:translate(-8px,2px) scale(.58)}', "first return finger shares the exact simultaneous two-finger down timing");
requireText(touchGuideCss, '.menu-demo.is-playing .menu-finger-two{animation:menuFingerTwo 12s linear 1 both}', "both return fingers use the same linear timeline");
requireText(hostCss, '.toast-close{position:absolute;top:6px;right:6px;width:30px;height:30px', "toast close action is anchored at the top-right corner rather than vertically centered");
if (touchGuideCss.includes('.menu-finger-one{left:calc(50% - 54px);top:53px') || touchGuideCss.includes('.menu-finger-two{left:calc(50% + 23px);top:53px')) throw new Error("menu touch indicators must not sit directly on the YES/NO choices");
requireText(hostCss, '.player.touch-enabled .touch-escape,.player.open>.touch-help-open{display:block}', "help button is available on desktop and mobile player views");
requireText(touchGuideCss, '.touch-help-window{width:min(560px,calc(100vw - 40px));', "help dialog uses the narrower desktop width");
requireText(touchGuideCss, '.touch-help-window{width:min(520px,88vw)', "phone help dialog stays visibly narrower than the viewport");
requireText(hostApp, 'if (!(name in guideDurations)) return;', "static help sections expand without starting an animation replay timer");
requireText(hostCss, '.touch-hud button,.touch-escape,.touch-help-open,.touch-thprac-input,.touch-thprac-tab,.touch-thprac-menu button{border:0;border-radius:11px', "touch controls use filled tonal buttons");
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
requireText(hostHtml, '显示模拟鼠标、作弊菜单和 Tab 按键。', "thprac touch-key concise copy");
requireText(hostApp, 'thpracTouchControlsEnabled: false', "thprac touch-key collection defaults disabled");
requireText(hostHtml, 'data-touch-layout-control="thpracInput"', "thprac touch/mouse switch is layout-adjustable");
requireText(hostHtml, 'data-touch-layout-control="thpracTab"', "thprac Tab key is layout-adjustable");
requireText(hostHtml, 'data-touch-layout-control="thpracMenu"', "thprac cheat-menu/F-key group is layout-adjustable");
if (hostHtml.includes('键盘与练习') || hostHtml.includes('触控与练习')) throw new Error("help header must stay plain Help without device-specific subtitles");
requireText(hostHtml, '<div class="touch-help-heading"><strong id="touchHelpTitle">帮助</strong></div>', "help header is plain Help on both desktop and mobile");
if (hostApp.includes('showToast(thpracMouseMode ? "thprac：触摸已切换为鼠标模拟"')) throw new Error("thprac mouse toggle must be silent");
requireText(hostHtml, 'id="touchThpracInput" data-touch-layout-control="thpracInput" type="button" aria-pressed="false" hidden><strong>模拟鼠标</strong>', "thprac mouse toggle keeps fixed label");
requireText(hostApp, 'touchThpracInput.querySelector("strong").textContent = "模拟鼠标";', "thprac mouse toggle text does not change with state");
if (hostApp.includes('touchThpracInput.querySelector("strong").textContent = thpracMouseMode ?')) {
  throw new Error("thprac mouse toggle must use click styling only, not state-dependent wording");
}
requireText(hostCss, '.touch-thprac-input{position:absolute;z-index:36;right:max(10px,env(safe-area-inset-right));left:auto;top:calc(50% - 6px);width:56px;height:56px', "thprac mouse default is a square lower control on the center-right");
requireText(hostCss, '.touch-thprac-tab{position:absolute;z-index:37;right:max(10px,env(safe-area-inset-right));left:auto;top:calc(50% + 54px)', "Tab defaults directly below the simulated-mouse control");
requireText(hostCss, '.touch-thprac-menu{position:absolute;z-index:38;right:max(10px,env(safe-area-inset-right));left:auto;top:calc(50% - 50px)', "cheat menu keeps the highest default stacking inside the thprac set");
requireText(hostCss, '.player #touchThpracInput{z-index:36}.player #touchThpracTab{z-index:37}.player #touchThpracMenu{z-index:38}', "default thprac stacking is mouse, Tab, then cheat menu");
requireText(hostCss, '.player.touch-layout-edit:not(.touch-layout-custom) [data-touch-layout-control]:not(#touchJoystick):not(#touchThpracInput):not(#touchThpracTab):not(#touchThpracMenu){position:relative}', "fresh default capture preserves absolute thprac positions instead of folding them into the left-side flow");
requireText(hostApp, 'priority: touchLayoutControlMeta[name].priority', "touch layout captures default control priority");
requireText(hostApp, 'element.style.zIndex = String(31 + (Number.isFinite(item.priority)', "saved touch-control priority drives actual stacking");
requireText(hostApp, 'item.priority = Math.max(-1, ...Object.values(profile.controls).map', "editing a selected control raises it above all peers");
requireText(hostApp, 'normalizeTouchLayoutPriorityOrder(profile.controls);', "touch-control priority remains canonical and persistable");
requireText(hostApp, 'const thpracNames = new Set(["thpracInput", "thpracTab", "thpracMenu"]);', "thprac priority rule is scoped to the thprac touch-key collection only");
requireText(hostApp, 'const highestThpracSlot = thpracSlots.at(-1);', "cheat menu takes only the highest slot already occupied by a thprac control");
requireText(hostApp, '[ordered[menuIndex], ordered[highestThpracSlot]] = [ordered[highestThpracSlot], ordered[menuIndex]];', "cheat-menu priority swaps only within thprac-owned slots instead of globally promoting the collection");
requireText(hostHtml, 'data-thprac-key="Tab"', "thprac Tab touch key");
requireText(hostHtml, 'data-thprac-key="F1"', "thprac F1 touch key");
requireText(hostHtml, 'data-thprac-key="F7"', "thprac F7 touch key");
requireText(hostApp, 'function bindThpracMouseInputWindow(win)', "thprac touch-to-mouse input bridge");
requireText(hostApp, 'event.stopImmediatePropagation();', "thprac mouse mode prevents the same touch from also entering game touch input");
requireText(hostApp, 'command: "thprac-mouse", type,', "thprac mouse mode uses the narrow hosted input protocol");
requireText(hostApp, 'event.target.setPointerCapture?.(event.pointerId)', "thprac mouse keeps pointer ownership through drag");
requireText(hostApp, 'event.target.releasePointerCapture?.(event.pointerId)', "thprac mouse releases pointer ownership on UP");
if (hostApp.includes("new win.MouseEvent")) throw new Error("thprac mouse mode must not depend on untrusted synthetic DOM MouseEvent delivery");
const thpracMouseBridgeStart = hostApp.indexOf("function bindThpracMouseInputWindow(win)");
const thpracMouseBridgeEnd = hostApp.indexOf("function uninstallGameZoomInputBridge()", thpracMouseBridgeStart);
if (thpracMouseBridgeStart < 0 || thpracMouseBridgeEnd < 0) throw new Error("thprac mouse input bridge bounds not found");
const thpracMouseBridge = hostApp.slice(thpracMouseBridgeStart, thpracMouseBridgeEnd);
requireText(thpracMouseBridge, "uninstallThpracMouseInputBridge();", "thprac mouse bridge is rebound for every iframe load");
if (thpracMouseBridge.includes("thpracMouseInputWindow === win")) throw new Error("thprac mouse bridge must not trust stable iframe WindowProxy identity across reloads");
requireText(hostApp, 'pulseThpracKey("Backspace")', "thprac Backspace touch pulse");
requireText(hostApp, 'setTimeout(() => postHostedKey(spec, false), 70);', "thprac touch key pulse spans trainer ticks");
requireText(hostApp, 'runtimeCustomEventWindow.addEventListener("eagler-thprac-menu", handleRuntimeThpracMenu);', "host follows actual THOverlay menu state on the Runtime Window");
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
requireText(hostApp, '$("#touchToggle").addEventListener("click", async () => {', "touch-enable explicit user owner");
requireText(hostApp, 'if (enabling && !await confirmTouchModeBeforeEnable(state.options.touchMovementMode)) return;', "touch confirmation gates enablement");
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
for (const control of ["focus", "fire", "bomb", "joystick", "escape", "thpracInput", "thpracTab", "thpracMenu"]) {
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
requireText(hostApp, 'await send("launch");', "runtime launch command reaches the runtime");
requireText(hostApp, 'state.launched = true; clearStartupError();', "runtime launch reaches persisted viewport reapply point");
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
requireText(hostApp, 'showToast("保存成功：触控布局已保存");', "touch layout save success feedback");
requireText(hostApp, "function touchLayoutHasUnsavedChanges()", "touch layout unsaved-change guard");
requireText(hostApp, "退出将丢弃当前未保存的触控布局修改。", "touch layout exit discard confirmation");
requireText(hostApp, "if (!await askConfirmation({", "touch layout reset requires shared confirmation");
requireText(hostApp, "当前${orientationTitle}布局中的未保存调整将被清除。", "touch layout reset confirmation explains loss");
requireText(hostHtml, 'id="touchLayoutEdit"', "touch layout editor entry");
requireText(hostHtml, 'id="touchLayoutSafeZone"', "touch layout safe-area geometry owner");
requireText(hostHtml, 'id="touchLayoutReservedZone"', "touch layout browser-control reserved guide");
requireText(hostHtml, 'id="touchLayoutOrientation"', "touch layout orientation feedback");
requireText(hostHtml, 'id="touchLayoutScale" type="range" min="60" max="180"', "touch layout scale control");
if ((hostHtml.match(/class="touch-layout-resize-handle"/g) || []).length !== 8) throw new Error("all eight touch controls including the Tab/thprac group must expose edit-only resize handles");
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
requireText(hostApp, '触摸移动会使用新的格式保存录像，和原版录像系统不兼容。', "direct-touch replay compatibility warning");
requireText(hostApp, '2. 不限速会破坏游戏原有的弹幕设计，非常不建议使用。', "unlimited touch gameplay-design warning");
requireText(hostApp, '3. 不限速会使你的处理落率被标记为 100%。', "unlimited touch forced processing-drop marker warning");
requireText(hostApp, '无方向限制轮盘会使用新的格式保存录像，和原版录像系统不兼容。', "free joystick replay compatibility warning");
const touchModeCopyStart = hostApp.indexOf("function touchModeConfirmationText(mode)");
const touchModeCopyEnd = hostApp.indexOf("async function confirmTouchModeBeforeEnable", touchModeCopyStart);
if (touchModeCopyStart < 0 || touchModeCopyEnd < 0) throw new Error("touch mode confirmation copy bounds missing");
const touchModeCopy = hostApp.slice(touchModeCopyStart, touchModeCopyEnd);
if (touchModeCopy.includes("1. 无方向限制轮盘")) throw new Error("single-item free joystick confirmation must not be numbered");
if (touchModeCopy.includes("2. 无方向限制轮盘")) throw new Error("free joystick confirmation must stay a single compatibility item");
if (touchModeCopy.includes("ReplayX") || touchModeCopy.includes("ZUN 原版 Replay") || touchModeCopy.includes(".rpyx")) {
  throw new Error("touch mode confirmations must describe compatibility without exposing ReplayX implementation jargon");
}
requireText(hostApp, 'if (enabling && !await confirmTouchModeBeforeEnable(state.options.touchMovementMode)) return;', "touch warning occurs before enabling touch");
requireText(hostApp, 'if (value !== state.options.touchMovementMode && !await confirmTouchModeBeforeEnable(value)) { render(); return; }', "movement warning occurs before mode selection");
const launchWarningStart = hostApp.indexOf("async function confirmInputWarnings()");
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
requireText(hostApp, 'function installRuntimeDomBridges()', "shared Runtime DOM bridge owner");
requireText(hostApp, 'function bindGameZoomInputWindow(win)', "game zoom pointer observer has a rebind owner");
requireText(hostApp, 'function currentRuntimeWindow()', "direct-child Runtime window has a single shared owner");
requireText(hostApp, 'return frame.contentWindow || null;', "shared bridge resolves the direct #gameFrame Runtime window");
requireText(hostApp, 'rebindRuntimeDomBridges();', "shared bridge rebinds after direct Runtime navigation");
if (hostApp.includes('outer.document?.getElementById("runtime")') || hostApp.includes('runtimeDomNestedFrameLoadHandler')) {
  throw new Error("direct-child Runtime DOM bridges must not retain the retired nested Runtime iframe owner");
}
requireText(hostApp, 'bindGameZoomInputWindow(win);', "zoom observer attaches to the actual Runtime Window");
requireText(hostApp, 'bindThpracMouseInputWindow(win);', "thprac mouse observer attaches to the actual Runtime Window");
requireText(hostApp, 'bindGameKeyWindow(win);', "fullscreen key observer attaches to the actual Runtime Window");
requireText(hostApp, 'bindRuntimeCustomEventWindow(win);', "Runtime custom events attach to the actual Runtime Window");
requireText(hostApp, 'win.addEventListener("pointerdown", beginGameZoomPointer, true);', "game zoom capture-stage pointer down observer");
requireText(hostApp, 'win.addEventListener("pointermove", moveGameZoomPointer, true);', "game zoom capture-stage pointer move observer");
requireText(hostApp, 'function gameZoomPointerClientPoint(event)', "zoom gesture normalizes pointer coordinates before applying the transform");
requireText(hostApp, 'if (event.currentTarget === touchDirectSurface)', "direct-touch zoom uses the host-document coordinate path");
requireText(hostApp, 'x: (event.clientX - rect.left) / scale', "direct-touch zoom converts visual X back to iframe-local coordinates");
requireText(hostApp, 'y: (event.clientY - rect.top) / scale', "direct-touch zoom converts visual Y back to iframe-local coordinates");
requireText(hostApp, 'x: base.x + gameZoomState.x + point.x * gameZoomState.scale', "zoom gesture maps normalized X through saved base position plus current transform");
requireText(hostApp, 'y: base.y + gameZoomState.y + point.y * gameZoomState.scale', "zoom gesture maps normalized Y through saved base position plus current transform");
const beginZoomBody = hostApp.slice(hostApp.indexOf("function beginGameZoomPointer"), hostApp.indexOf("function moveGameZoomPointer"));
const moveZoomBody = hostApp.slice(hostApp.indexOf("function moveGameZoomPointer"), hostApp.indexOf("function endGameZoomPointer"));
if (beginZoomBody.includes("preventDefault") || beginZoomBody.includes("stopPropagation") || moveZoomBody.includes("preventDefault") || moveZoomBody.includes("stopPropagation")) {
  throw new Error("game zoom observer must not consume the game's pointer stream");
}
requireText(hostApp, '$("#touchLayoutOrientationHelpOpen").addEventListener("click", () => { if (touchLayoutEditing) void switchTouchLayoutOrientation(); });', "touch layout orientation action must directly attempt real rotation");
requireText(hostApp, 'showToast("切换失败，请查看右上角问号菜单中的横竖屏说明。");', "orientation failure only points to the question-mark help");
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
requireText(hostHtml, '<meta name="apple-mobile-web-app-capable" content="yes">', "iOS Home Screen standalone capability");
requireText(hostHtml, '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">', "iOS standalone status bar overlays the safe-area-aware page");
requireText(hostHtml, '<link rel="manifest" href="site.webmanifest">', "Home Screen Web App manifest link");
if (webAppManifest.display !== "standalone" || webAppManifest.start_url !== "./" || webAppManifest.scope !== "./") {
  throw new Error("Home Screen Web App manifest must use same-origin standalone mode");
}
requireText(hostApp, "document.webkitFullscreenElement", "Safari fullscreen state fallback");
requireText(hostApp, "target.webkitRequestFullscreen", "Safari fullscreen request fallback");
requireText(hostApp, 'document.addEventListener("webkitfullscreenchange", handleFullscreenChange);', "Safari fullscreen lifecycle shares the standard handler");
requireText(hostHtml, 'id="frameLimitAppleNote" type="button">苹果用户注意</button>', "frame-limit warning includes Apple-specific refresh-rate help entry");
requireText(hostHtml, 'id="appleRefreshDialog" aria-labelledby="appleRefreshTitle"', "Apple refresh-rate help uses a dedicated card dialog");
requireText(hostHtml, '<h2>如何启用高刷新率？</h2>', "Apple refresh-rate help uses FAQ-style high-refresh question");
requireText(hostHtml, 'Prefer Page Rendering Updates near 60fps', "Apple refresh-rate help names the WebKit feature flag");
requireText(hostHtml, '<h2>如何解决游戏被锁定在 30 帧？</h2>', "Apple refresh-rate help uses FAQ-style 30fps question");
requireText(hostHtml, '请关闭 iPhone 的<strong>低电量模式</strong>，然后刷新网页。', "Apple refresh-rate help documents low-power-mode 30fps behavior");
requireText(hostApp, '$("#frameLimitAppleNote").addEventListener("click", openAppleRefreshDialog);', "Apple refresh-rate help entry opens the shared dialog owner");
requireText(hostApp, '$("#mpFrameLimitAppleNote").addEventListener("click", openAppleRefreshDialog);', "multiplayer Apple refresh-rate help entry shares the same dialog owner");

console.log("TH06/TH07 mobile touch contract: PASS");
