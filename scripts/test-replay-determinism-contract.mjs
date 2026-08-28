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

const th06Replay = read("th06-eagler/src/ReplayManager.cpp");
const th06Player = read("th06-eagler/src/Player.cpp");
const th06Priorities = read("th06-eagler/src/ChainPriorities.hpp");
const th06Window = read("th06-eagler/src/GameWindow.cpp");

requireText(th06Priorities, "TH_CHAIN_PRIO_CALC_LOW_PRIO_REPLAYMANAGER_DEMO 5", "TH06 replay injection priority 5");
requireText(th06Priorities, "TH_CHAIN_PRIO_CALC_PLAYER 7", "TH06 Player priority 7");
requireText(th06Priorities, "TH_CHAIN_PRIO_CALC_REPLAYMANAGER 15", "TH06 replay recording priority 15");
requireText(th06Replay, "g_Rng.Initialize(replayData->randomSeed)", "TH06 recorded stage RNG seed restore");
requireText(th06Replay, "g_GameManager.rank = replayData->rank", "TH06 rank restore");
requireText(th06Replay, "g_GameManager.livesRemaining = replayData->livesRemaining", "TH06 lives restore");
requireText(th06Replay, "g_GameManager.bombsRemaining = replayData->bombsRemaining", "TH06 bombs restore");
requireText(th06Replay, "g_GameManager.currentPower = replayData->power", "TH06 power restore");
requireText(th06Replay, "ReplayExtension::ClearPlayback();", "TH06 extension playback lifetime follows ReplayManager");
requireText(th06Player, "const bool replayPlayback = g_GameManager.isInReplay != 0;", "TH06 explicit replay movement ownership");
requireText(th06Player, "!replayPlayback && Touch::GetPlayerDelta", "TH06 live touch blocked during replay");
requireText(th06Player, "!replayPlayback && Touch::GetFreeJoystickVector", "TH06 live free joystick blocked during replay");
requireText(th06Window, "const bool preserveReplayCadence = g_GameManager.isInReplay != 0;", "TH06 original-style replay presentation cadence");
requireText(th06Window, "if (limitPresentationTo60 || preserveReplayCadence)", "TH06 replay cannot multi-tick catch up inside one presentation callback");

const th07Replay = read("th07-eagler/src/ReplayManager.cpp");
const th07Player = read("th07-eagler/src/Player.cpp");
const th07Window = read("th07-eagler/src/GameWindow.cpp");
const th07Game = read("th07-eagler/src/GameManager.cpp");
const th07Supervisor = read("th07-eagler/src/Supervisor.cpp");
const th07SupervisorHeader = read("th07-eagler/src/Supervisor.hpp");

requireText(th07Replay, "g_Chain.AddToCalcChain(mgr->calcChain, 5)", "TH07 replay injection priority 5");
requireText(th07Replay, "g_Chain.AddToCalcChain(mgr->rngCalcChain, 6)", "TH07 replay RNG/event recording priority 6");
requireText(th07Replay, "g_Chain.AddToCalcChain(mgr->calcChain, 16)", "TH07 replay recording priority 16");
requireText(th07Replay, "g_Rng.SetSeed(replayData->stageRngSeed)", "TH07 recorded stage RNG seed restore");
requireText(th07Replay, "*g_GameManager.defaultCfg = arg->data->data.cfg", "TH07 recorded gameplay config restore");
requireText(th07Replay, "g_GameManager.cherry = replayData->cherry", "TH07 cherry restore");
requireText(th07Replay, "g_GameManager.globals->grazeInTotal = replayData->grazeInTotal", "TH07 total graze restore");
requireText(th07Replay, "g_GameManager.globals->nextNeededPointItemsForExtend", "TH07 point-extend threshold restore");
requireText(th07Replay, "g_Supervisor.curFps = (i16) * (arg->fpsCursor + 1) & 0x7f", "TH07 saved replay FPS restore");
requireText(th07Replay, "u8 replayFps = 60;", "TH07 catch-up recording stores logical simulation FPS");
requireText(th07Replay, "if (EaglerOptions::LimitPresentationTo60())", "TH07 measured FPS is used only in original one-tick-per-picture Web mode");
requireText(th07Game, "g_Supervisor.curFps < 20", "TH07 replay lag skip consumes saved replay FPS");
requireText(th07Supervisor, "if (!g_GameManager.replay)", "TH07 playback machine FPS cannot overwrite saved replay FPS");
requireText(th07SupervisorHeader, "CheckIntegrity(const char *version, i32 exeSize, i32 exeChecksum)", "TH07 original replay executable identity API");
requireText(th07Replay, "g_Supervisor.CheckIntegrity(parsed->data.replayStr, parsed->data.exeSize", "TH07 original replay executable identity validation");
requireText(th07Replay, "if (parsed->data.cfg.slowMode)", "TH07 slow-mode replay rejection");
requireText(th07Replay, "memcmp(&g_Supervisor.cfg, &mgr->data->data.cfg", "TH07 mid-run config save guard");
requireText(th07Replay, "ReplayExtension::ClearPlayback();", "TH07 extension playback lifetime follows ReplayManager");
requireText(th07Player, "const bool replayPlayback = g_GameManager.replay != 0;", "TH07 explicit replay movement ownership");
requireMatch(th07Player, /!replayPlayback\s*&&[\s\S]{0,400}?Touch::GetPlayerDelta/, "TH07 live touch blocked during replay");
requireMatch(th07Player, /!replayPlayback\s*&&[\s\S]{0,400}?Touch::GetFreeJoystickVector/, "TH07 live free joystick blocked during replay");
requireText(th07Window, "const bool preserveReplayCadence = g_GameManager.replay != 0;", "TH07 original-style replay presentation cadence");
requireText(th07Window, "if (limitPresentationTo60 || preserveReplayCadence)", "TH07 replay cannot multi-tick catch up inside one presentation callback");

const updateStart = th07Game.indexOf("u32 GameManager::OnUpdate(GameManager *arg)");
const drawStart = th07Game.indexOf("u32 GameManager::OnDraw(GameManager *arg)");
const drawEnd = th07Game.indexOf("void GameManager::DrawLoadingSprite", drawStart);
if (updateStart < 0 || drawStart < 0 || drawEnd < 0) throw new Error("TH07 GameManager update/draw bounds missing");
const update = th07Game.slice(updateStart, drawStart);
const draw = th07Game.slice(drawStart, drawEnd);
requireText(update, "if (arg->isInPauseMenu == 1)", "TH07 pause transition is simulation-owned");
if (draw.includes("isInPauseMenu = 2")) throw new Error("TH07 presentation must not advance pause simulation state");

for (const game of ["th06", "th07"]) {
  const extension = read(`${game}-eagler/src/ReplayExtension.cpp`);
  requireText(extension, "constexpr u32 VERSION = 1;", `${game} first public ReplayX format`);
  requireText(extension, "constexpr u32 DETERMINISM_ABI = 1;", `${game} ReplayX deterministic core ABI`);
  requireText(extension, "if (version != VERSION", `${game} rejects every development-era ReplayX version`);
  requireText(extension, "ReadLe32(bytes + payloadOffset + 92) != DETERMINISM_ABI", `${game} incompatible ReplayX deterministic ABI rejected`);
}

console.log("TH06/TH07 replay determinism contract: PASS");
