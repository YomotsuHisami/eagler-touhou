import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..", "..");
const read = rel => fs.readFileSync(path.join(root, rel), "utf8");

for (const game of ["th06", "th07"]) {
  const source = read(`${game}-eagler/src/GameWindow.cpp`).replaceAll("\r\n", "\n");
  for (const [needle, label] of [
    ["#ifdef __EMSCRIPTEN__", "Web-only guard"],
    ["const bool limitPresentationTo60 = EaglerOptions::LimitPresentationTo60();", "optional 60 FPS presentation mode"],
    ["const bool preserveReplayCadence", "replay cadence gate"],
    ["if (limitPresentationTo60 || preserveReplayCadence)", "original-style replay timing path"],
    ["if (limitPresentationTo60 && !updated)", "optional 60 FPS presentation gate"],
    ["if (limitPresentationTo60)", "locked presentation alpha override"],
    ["g_RenderAlpha = 1.0f;", "authoritative current-state draw in locked mode"],
    ["do\n            {\n                this->accumulator -= targetDt;\n            } while (this->accumulator >= targetDt);", "original-style overdue-time discard"],
    ["const i32 res = runSimulationTick();", "single locked-mode simulation tick"],
    ["return RENDER_RESULT_KEEP_RUNNING;", "presentation skip"],
  ]) {
    if (!source.includes(needle)) throw new Error(`${game}: missing ${label}`);
  }

  const locked = source.indexOf("if (limitPresentationTo60 || preserveReplayCadence)");
  const discard = source.indexOf("do\n            {\n                this->accumulator -= targetDt;", locked);
  const singleTick = source.indexOf("const i32 res = runSimulationTick();", discard);
  const catchUp = source.indexOf("while (this->accumulator >= targetDt)", singleTick + 1);
  if (locked < 0 || discard < locked || singleTick < discard || catchUp < singleTick)
    throw new Error(`${game}: locked one-tick path must precede the high-refresh catch-up loop`);
}

const targetDt = 1 / 60;

function simulateIntervals(intervals, limitPresentationTo60, preserveReplayCadence = false) {
  let accumulator = 0;
  let updates = 0;
  let draws = 0;
  let skipped = 0;
  let maxUpdatesBeforeDraw = 0;
  const renderAlphas = [];
  for (const callbackDt of intervals) {
    accumulator += callbackDt;
    let updatesThisCallback = 0;
    if (limitPresentationTo60 || preserveReplayCadence) {
      if (accumulator + 1e-12 >= targetDt) {
        // Faithful TH06/TH07 60 Hz behavior: consume every overdue timing
        // interval, but advance game state exactly once before the picture.
        do accumulator -= targetDt;
        while (accumulator + 1e-12 >= targetDt);
        updates++;
        updatesThisCallback = 1;
      }
    } else {
      while (accumulator + 1e-12 >= targetDt) {
        accumulator -= targetDt;
        updates++;
        updatesThisCallback++;
      }
    }
    if (limitPresentationTo60 && updatesThisCallback === 0) {
      skipped++;
      continue;
    }
    maxUpdatesBeforeDraw = Math.max(maxUpdatesBeforeDraw, updatesThisCallback);
    const residualAlpha = Math.max(0, Math.min(1, accumulator / targetDt));
    renderAlphas.push(limitPresentationTo60 ? 1 : residualAlpha);
    draws++;
  }
  return { callbacks: intervals.length, updates, draws, skipped, maxUpdatesBeforeDraw, renderAlphas };
}

function simulate(refreshHz, seconds, limitPresentationTo60, preserveReplayCadence = false) {
  const callbacks = Math.round(refreshHz * seconds);
  return {
    refreshHz,
    ...simulateIntervals(Array(callbacks).fill(1 / refreshHz), limitPresentationTo60, preserveReplayCadence),
  };
}

const cases = [
  simulate(60, 10, true),
  simulate(75, 10, true),
  simulate(90, 10, true),
  simulate(120, 10, true),
  simulate(144, 10, true),
  simulate(120, 10, false),
];

const lockedCases = cases.slice(0, 5);
for (const result of lockedCases) {
  const hz = result.refreshHz;
  if (result.updates !== 600 || result.draws !== 600)
    throw new Error(`${hz} Hz locked presentation must preserve 60 simulation ticks and cap draws to 60 Hz`);
  if (result.renderAlphas.some(alpha => alpha !== 1))
    throw new Error(`${hz} Hz locked presentation must draw the current simulation state (alpha=1)`);
  if (result.maxUpdatesBeforeDraw !== 1)
    throw new Error(`${hz} Hz locked presentation must never run multiple game ticks before one picture`);
}
const unlocked120 = cases.at(-1);
if (unlocked120.draws !== 1200 || unlocked120.updates !== 600 || unlocked120.skipped !== 0)
  throw new Error("unlocked 120 Hz presentation must remain high-refresh");

// A single late browser callback is the failure mode that makes fast bullets
// visibly jump: the old portable loop would catch up several 60 Hz simulation
// ticks before one draw. The original TH06 and TH07 timing loops discard those
// overdue intervals and run the chain once. Lock that distinction permanently.
const delayedIntervals = [
  ...Array(120).fill(1 / 144),
  0.055,
  ...Array(120).fill(1 / 144),
];
const delayedLocked = simulateIntervals(delayedIntervals, true);
const delayedUnlocked = simulateIntervals(delayedIntervals, false);
const delayedReplay = simulateIntervals(delayedIntervals, false, true);
if (delayedLocked.maxUpdatesBeforeDraw !== 1)
  throw new Error("locked 60 Hz delayed callback must still advance at most one simulation tick before a draw");
if (delayedUnlocked.maxUpdatesBeforeDraw <= 1)
  throw new Error("high-refresh delayed callback contract must retain accumulator catch-up behavior");
if (delayedReplay.maxUpdatesBeforeDraw !== 1)
  throw new Error("replay playback must never catch up multiple game ticks before one picture");

console.log(JSON.stringify({
  targetSimulationHz: 60,
  optionalPresentationLimitHz: 60,
  cases: cases.map(({ renderAlphas, ...result }) => ({
    ...result,
    alphaMin: Math.min(...renderAlphas),
    alphaMax: Math.max(...renderAlphas),
  })),
  delayedCallback: {
    locked: { ...delayedLocked, renderAlphas: undefined },
    highRefresh: { ...delayedUnlocked, renderAlphas: undefined },
    replay: { ...delayedReplay, renderAlphas: undefined },
  },
}));
