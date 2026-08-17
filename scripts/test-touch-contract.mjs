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
  const shell = read(`${game}-eagler/resources/shell.html`);
  const sdl = read(`${game}-eagler/vendored/SDL/src/video/emscripten/SDL_emscriptenevents.c`);

  requireText(touch, "void ReleaseGameplayFingerState(SDL_FingerID id)", `${game} id-keyed release helper`);
  requireText(touch, "bool ReleaseMenuGestureFinger(SDL_FingerID id)", `${game} menu gesture release helper`);
  requireText(touch, "multiFingerGesture ? TH_BUTTON_RETURNMENU : TH_BUTTON_SELECTMENU", `${game} multi-finger return semantics`);
  requireText(touch, "ReleaseMenuGestureFinger(f.fingerID);", `${game} menu UP release path`);
  requireText(touch, "secondaryEndedTwoFingerMenuGesture", `${game} lost-primary-UP menu regression self-test`);
  requireText(touch, "ReleaseGameplayFingerState(f.fingerID);", `${game} finger release cleanup`);
  requireText(touch, "HasGameplayFinger(f.fingerID) || IsFinger(g_MoveFinger, f.fingerID)", `${game} stale duplicate DOWN recovery`);
  requireText(touch, "bool Touch::DebugStateSelfTest()", `${game} touch state self-test`);
  requireText(touchHeader, "bool DebugStateSelfTest();", `${game} touch state self-test declaration`);
  requireText(touch, "EMSCRIPTEN_KEEPALIVE void TouhouAuxTouchCancelAll()", `${game} Web cancel-all export`);

  const upStart = touch.indexOf("void Touch::FingerUp(const SDL_TouchFingerEvent &f)");
  const motionStart = touch.indexOf("void Touch::FingerMotion", upStart);
  if (upStart < 0 || motionStart < 0) throw new Error(`${game}: FingerUp function bounds not found`);
  const up = touch.slice(upStart, motionStart);
  const releasePos = up.indexOf("ReleaseGameplayFingerState(f.fingerID);");
  const modePos = up.indexOf("if (!IsGameplayTouchMode())");
  if (releasePos < 0 || modePos < 0 || releasePos > modePos) {
    throw new Error(`${game}: FingerUp cleanup must happen before current-mode routing`);
  }

  requireText(main, '"--touch-selftest"', `${game} touch self-test CLI`);
  requireText(main, "if (!g_TouchStateSelfTest)", `${game} self-test persistent-shutdown guard`);

  requireText(sdl, "const SDL_FingerID id = event->pointerid + 1;", `${game} SDL Emscripten touch ID mapping`);
  requireText(shell, "const nativeCanvasTouches = new Map();", `${game} native canvas touch tracker`);
  requireText(shell, "id: event.pointerId + 1", `${game} shell SDL ID mapping`);
  requireText(shell, 'document.addEventListener("lostpointercapture", releaseTouch', `${game} lost capture release`);
  requireText(shell, 'document.addEventListener("visibilitychange"', `${game} visibility release`);
  requireText(shell, 'window.addEventListener("blur", cancelAllTouches);', `${game} blur release`);
  requireText(shell, 'window.addEventListener("pagehide", cancelAllTouches);', `${game} pagehide release`);
  requireText(shell, "Module._TouhouAuxTouchCancelAll()", `${game} shell cancel-all call`);
}

console.log("TH06/TH07 mobile touch contract: PASS");
