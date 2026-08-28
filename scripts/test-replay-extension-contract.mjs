import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..", "..");
const read = rel => fs.readFileSync(path.join(root, rel), "utf8");
const requireText = (source, needle, label) => {
  if (!source.includes(needle)) throw new Error(`missing ${label}: ${needle}`);
};
const requireMatch = (source, pattern, label) => {
  if (!pattern.test(source)) throw new Error(`missing ${label}: ${pattern}`);
};

for (const game of ["th06", "th07"]) {
  const extensionHeader = read(`${game}-eagler/src/ReplayExtension.hpp`);
  const extension = read(`${game}-eagler/src/ReplayExtension.cpp`);
  const replay = read(`${game}-eagler/src/ReplayManager.cpp`);
  const player = read(`${game}-eagler/src/Player.cpp`);
  const gameWindow = read(`${game}-eagler/src/GameWindow.cpp`);
  const practice = read(`${game}-eagler/src/PracticeRuntime.cpp`);
  const touch = read(`${game}-eagler/src/Touch.cpp`);
  const menu = read(`${game}-eagler/src/MainMenu.cpp`);
  const result = read(`${game}-eagler/src/ResultScreen.cpp`);

  requireText(extensionHeader, "namespace ReplayExtension", `${game} isolated replay extension namespace`);
  requireText(extension, 'std::memcmp(bytes + size - 4, "EAGX", 4)', `${game} EAGX trailer identity`);
  requireText(extension, "constexpr u32 VERSION = 1;", `${game} first public deterministic replay extension version`);
  requireText(extension, "constexpr u32 DETERMINISM_ABI = 1;", `${game} deterministic replay ABI marker`);
  requireText(extension, "ReadLe32(bytes + payloadOffset + 92) != DETERMINISM_ABI", `${game} incompatible deterministic replay ABI is rejected`);
  requireText(extension, "if (version != VERSION", `${game} rejects every non-final ReplayX version`);
  for (const forbidden of ["SAMPLED_VERSION", "EVENT_VERSION", "LEGACY_VERSION", "LEGACY_HEADER_SIZE", "EVENT_HEADER_SIZE", "SAMPLED_HEADER_SIZE"]) {
    if (extension.includes(forbidden)) throw new Error(`${game}: final ReplayX must not keep development compatibility symbol ${forbidden}`);
  }
  requireText(extensionHeader, "TOUCH_ACTION_DOWN", `${game} raw touch down action`);
  requireText(extensionHeader, "TOUCH_ACTION_MOTION", `${game} raw touch motion action`);
  requireText(extensionHeader, "TOUCH_ACTION_UP", `${game} raw touch up action`);
  requireText(extensionHeader, "struct TouchEvent", `${game} raw touch event record`);
  requireText(extension, 'result += extended ? ".rpyx" : ".rpy";', `${game} extension-only replay suffix`);
  requireText(extension, "SwapExtension(requestedPath, g_RecordUsesExtension)", `${game} suffix follows actual extended input use`);
  requireText(extension, "if (!g_RecordUsesExtension)", `${game} normal replay never receives EAGX payload`);
  requireText(extension, "WriteLe32(bytes.data() + payloadOffset + 8 + stage * 4", `${game} stage-local sample counts`);
  requireText(extension, "sizeof(InputSample)", `${game} raw joystick sample stream`);
  requireText(extension, "sizeof(DirectTouchSample)", `${game} fixed-tick direct-touch sample stream`);
  requireText(extension, "sizeof(TouchEvent)", `${game} raw touch action stream`);
  requireText(extension, "CaptureTouchEvent", `${game} touch action capture API`);
  requireText(extension, "CaptureJoystick", `${game} raw joystick capture API`);
  requireText(extension, "CaptureDirectTouch", `${game} fixed-tick direct touch capture API`);
  requireText(extension, "CaptureTouchState", `${game} fixed-tick touch semantic-state capture API`);
  requireText(extension, "BeginStageRecording", `${game} stage-local extension reset API`);
  requireText(extension, "GetPlaybackDirectTouch", `${game} fixed-tick direct touch playback API`);
  requireText(extension, "GetPlaybackTouchState", `${game} fixed-tick touch semantic-state playback API`);
  requireText(extension, "GetPlaybackTouchEvents", `${game} playback touch action API`);
  if (extension.includes('"PRAC"')) {
    throw new Error(`${game}: ReplayExtension must not parse or own thprac PRAC metadata`);
  }

  requireText(replay, "ReplayExtension::RecordFrame", `${game} fixed-tick extended-input recording boundary`);
  requireText(replay, "ReplayExtension::ResolveSavePath", `${game} replay save suffix boundary`);
  requireText(replay, "ReplayExtension::AppendRecording", `${game} EAGX append after original replay writer`);
  requireText(replay, "ReplayExtension::MatchesPath", `${game} suffix/trailer agreement validation`);
  requireText(replay, "ReplayExtension::LoadPlayback", `${game} ReplayX load before vanilla parser mutates raw bytes`);
  requireText(replay, "ReplayExtension::SetPlaybackFrame", `${game} playback tick publication`);
  requireText(replay, "ReplayExtension::BeginStageRecording", `${game} EAGX stage slot is replaced with vanilla StageReplayData`);
  requireText(replay, "ReplayExtension::CaptureTouchState(Touch::WasUsedThisRun(), Touch::UsedTouchToBomb()", `${game} touch simulation state is sampled by ReplayManager`);
  requireText(replay, "ReplayExtension::GetPlaybackTouchState", `${game} touch simulation state is restored before Player`);
  requireText(replay, "Touch::SetReplayUsageState", `${game} touch owner receives replay semantic state`);
  requireText(replay, "Touch::ApplyReplayTouchEvent", `${game} replay touch actions are published before player update`);
  requireText(replay, "Touch::GetReplayTouchPoints", `${game} replay displays recorded touch positions`);
  requireText(replay, 'AddString(&position, "+")', `${game} replay touch marker uses native UI drawing`);
  requireText(player, "ReplayExtension::BeginInputFrame();", `${game} player owns per-frame raw input capture reset`);
  requireText(player, "ReplayExtension::GetPlaybackJoystick(&joystickX, &joystickY)", `${game} final ReplayX replays raw joystick input`);
  requireText(player, "Touch::GetFreeJoystickVector(&joystickX, &joystickY)", `${game} unrestricted joystick remains an extended movement source`);
  requireText(player, "ReplayExtension::CaptureJoystick(joystickX, joystickY)", `${game} unrestricted joystick records pre-scaling player input`);
  requireText(player, "ReplayExtension::GetPlaybackDirectTouch(&touchDx, &touchDy, &touchUnlimited)", `${game} final direct touch playback is fixed-tick sampled`);
  requireText(player, "ReplayExtension::CaptureDirectTouch(touchDx, touchDy, touchUnlimited)", `${game} live direct touch is sampled before movement equations`);
  if (player.includes("GetPlaybackMovement") || player.includes("UsesTouchEventMovementPlayback") || player.includes("GetReplayPlayerDelta")) {
    throw new Error(`${game}: final ReplayX must not retain v2/v3 movement fallback paths`);
  }
  requireMatch(player, /!replayPlayback\s*&&[\s\S]{0,400}?Touch::GetPlayerDelta/, `${game} live touch can never leak into replay playback`);
  requireMatch(player, /!replayPlayback\s*&&[\s\S]{0,400}?Touch::GetFreeJoystickVector/, `${game} live free joystick can never leak into replay playback`);
  requireText(replay, "ReplayExtension::ClearPlayback();", `${game} ReplayManager owns ReplayX playback lifetime cleanup`);
  if (player.includes("ReplayExtension::CaptureMovement("))
    throw new Error(`${game}: ReplayX must not record derived final player movement`);
  requireText(touch, "ReplayExtension::CaptureTouchEvent", `${game} Touch owner records raw touch actions`);
  requireText(touch, "ReplayTouchRole", `${game} Touch owner records its classification decision`);
  requireText(touch, "void Touch::SetReplayUsageState", `${game} replay semantic-state setter remains Touch-owned`);
  requireText(touch, "if (EaglerOptions::UnlimitedTouch() && (*dx != 0.0f || *dy != 0.0f))", `${game} unlimited touch is cheat-marked only after actual movement`);
  requireText(touch, "g_UsedCheatMovementThisRun = true;", `${game} unlimited movement taint is sticky for the run`);
  requireText(replay, "Touch::UsedCheatMovementThisRun()", `${game} replay slowdown metadata is forced to 100 only after unlimited movement was actually used`);
  if (touch.includes("GetReplayPlayerDelta") || touch.includes("SetReplayPlayerDelta") ||
      touch.includes("ConsumeReplayPlayerDelta") || touch.includes("g_ReplayAccumD")) {
    throw new Error(`${game}: final ReplayX must not retain raw-event movement reconstruction state`);
  }

  requireText(gameWindow, "preserveReplayCadence", `${game} replay playback has an explicit original-style cadence mode`);
  requireText(gameWindow, "if (limitPresentationTo60 || preserveReplayCadence)", `${game} replay playback never uses multi-tick accumulator catch-up`);

  if (practice.includes("ReplayUnsafeAssistUsedThisRun") || result.includes("ReplayUnsafeAssistUsedThisRun") ||
      practice.includes("ResetReplayDeterminismUsage")) {
    throw new Error(`${game}: thprac assists must not invent an extra replay-save ban absent from upstream`);
  }
  if (game === "th06") {
    requireText(practice, "return !g_GameManager.isInReplay && g_Overlay.invincible;", `${game} replay playback keeps its existing assist isolation`);
  } else {
    requireText(practice, "return !g_GameManager.replay && g_Overlay.invincible;", `${game} replay playback keeps its existing assist isolation`);
  }

  requireText(touch, "if (!EaglerOptions::TouchMovementUsesJoystick())", `${game} both joystick modes remain replay-save eligible`);
  requireText(practice, "ReplayExtension::BaseFileSize", `${game} thprac sees its original PRAC trailer beneath EAGX`);
  if (practice.includes('std::memcmp(bytes + size - 4, "EAGX"') || practice.includes('std::memcmp(bytes.data() + bytes.size() - 4, "EAGX"')) {
    throw new Error(`${game}: thprac must not parse ReplayExtension's EAGX payload`);
  }
  requireText(menu, ".rpyx", `${game} replay menu discovers extended replay files`);
  requireText(result, ".rpyx", `${game} replay slot UI discovers extended replay files`);

  if (result.includes("numRetries != 0 || Touch::WasUsedThisRun()"))
    throw new Error(`${game}: touch use must not globally disable replay saving now that extended movement is replayable`);
}

const th07Replay = read("th07-eagler/src/ReplayManager.cpp");
const th07Extension = read("th07-eagler/src/ReplayExtension.cpp");
const th07Player = read("th07-eagler/src/Player.cpp");
const th06Replay = read("th06-eagler/src/ReplayManager.cpp");
const th06BoundaryCapture = th06Replay.indexOf("mgr->replayFileSize = ReplayGameplayDataSize");
const th06Validate = th06Replay.indexOf("ValidateReplayData(mgr->replayData->header, fileSize)");
if (th06BoundaryCapture < 0 || th06Validate < 0 || th06BoundaryCapture > th06Validate) {
  throw new Error("th06: ReplayX base replay boundary must be cached before vanilla validation deobfuscates the file in place");
}
requireText(th06Replay, "u32 nextOffset = mgr->replayFileSize;", "th06 playback input bounds use the cached pre-deobfuscation replay boundary");
const th06PostValidate = th06Replay.slice(th06Validate);
if (th06PostValidate.includes("ReplayGameplayDataSize(reinterpret_cast<const u8 *>(mgr->replayData->header)")) {
  throw new Error("th06: deobfuscated ReplayX bytes must never be rescanned to rediscover the base replay boundary");
}
const rewriteStart = th07Replay.indexOf("void ReplayManager::SaveReplay2(const char *filename)");
if (rewriteStart < 0) throw new Error("th07: SaveReplay2 rewrite boundary missing");
const rewrite = th07Replay.slice(rewriteStart);
requireText(rewrite, "if (Touch::UsedCheatMovementThisRun())", "th07 SaveReplay2 preserves the forced 100% slowdown marker after actual unlimited movement on special replay rewrites");
requireText(rewrite, "replayCopy.data.slowdownRate = 100.0f;", "th07 SaveReplay2 writes the forced 100% slowdown marker");
const pracPos = rewrite.indexOf("PracticeRuntime::SaveReplayMetadata(filename);");
const eagxPos = rewrite.indexOf("ReplayExtension::AppendPlayback(filename);");
if (pracPos < 0 || eagxPos < 0 || pracPos > eagxPos) {
  throw new Error("th07: special replay rewrite must restore PRAC first and EAGX second without either parser owning the other");
}
requireText(th07Extension, "if (g_PlaybackVersion != VERSION)", "th07 SaveReplay2 rejects non-final ReplayX identity");
requireText(th07Extension, "AppendInputEvents(path, g_PlaybackInputs, g_PlaybackTouchEvents, g_PlaybackDirectTouch)", "th07 SaveReplay2 rewrites only final ReplayX layout");
requireText(th07Replay, "u8 replayFps = 60;", "th07 portable replay records logical FPS by default");
requireText(th07Replay, "if (EaglerOptions::LimitPresentationTo60())", "th07 only records measured presentation FPS in original one-tick-per-picture mode");
requireText(th07Player, "AnmVm g_EaglerHitboxVm", "th07 always-hitbox visual owns a standalone render VM");
requireText(th07Player, "const Rng savedRng = g_Rng;", "th07 always-hitbox visual preserves gameplay RNG around ANM execution");
requireText(th07Player, "g_Rng = savedRng;", "th07 always-hitbox visual restores gameplay RNG");
if (/AlwaysShowHitbox\(\)[\s\S]{0,300}SpawnEffect\(24/.test(th07Player)) {
  throw new Error("th07: always-show-hitbox must never allocate native EffectManager effect 24");
}

const host = read("eagler-touhou/app.js");
requireText(host, "/\\.rpyx?$/i.test(path)", "host replay listing preserves rpy/rpyx identity");
requireText(host, 'extended ? ".rpyx" : ".rpy"', "host collision renaming preserves replay class");
requireText(host, 'kind === "replay" ? ".zip,.rpy,.rpyx" : ".dat"', "host file picker accepts ReplayX");
if (host.includes('"EAGX"')) throw new Error("host file manager must not parse the game-owned EAGX format");

console.log("TH06/TH07 ReplayExtension contract: PASS");
