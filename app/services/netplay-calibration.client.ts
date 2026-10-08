/** Runtime-reported startup progress/report only. No probes, timing calculation,
 * native configuration, global document state or DOM rendering lives here. */
import {parseMeasuredNetplayTiming, type MeasuredNetplayTiming} from '../../src/contracts/netplay-timing.mts';
export interface CalibrationProgress {
  readonly phase: 'waiting' | 'stabilizing' | 'measuring' | 'negotiating' | 'retrying' | 'suspended' | 'unavailable' | 'ready';
  readonly probes: number; readonly replies: number; readonly timing: MeasuredNetplayTiming | null;
  readonly attempt?: number; readonly maxAttempts?: number; readonly reason?: number;
}
export interface CalibrationReport extends Record<string, unknown> {
  readonly schema: string; readonly game: string; readonly players: readonly Readonly<Record<string, unknown>>[];
}
export interface CalibrationSnapshot {readonly epoch: number | null; readonly progress: CalibrationProgress | null; readonly report: CalibrationReport | null; readonly dismissed: boolean}
const record = (value: unknown): Record<string, unknown> | null => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
const count = (value: unknown, max: number) => typeof value === 'number' && Number.isInteger(value) ? Math.max(0, Math.min(max, value)) : 0;
export function parseCalibrationProgress(value: unknown): CalibrationProgress | null {
  const row = record(value); if (!row) return null;
  const phase = row.phase;
  if (phase === 'ready') {
    const timing = parseMeasuredNetplayTiming(row);
    return timing && timing.route !== 'spectator' ? Object.freeze({phase, probes: 129, replies: timing.samples, timing: Object.freeze(timing)}) : null;
  }
  if (phase === 'waiting' || phase === 'stabilizing' || phase === 'measuring' || phase === 'negotiating')
    return Object.freeze({phase, probes: count(row.probes, 129), replies: count(row.replies, 120), timing: null});
  if (phase === 'retrying') {
    const maxAttempts = Math.max(1, count(row.maxAttempts, 8) || 4);
    return Object.freeze({phase, probes: 0, replies: 0, timing: null,
      attempt: Math.min(maxAttempts, Math.max(1, count(row.attempt, 8) || 1)), maxAttempts});
  }
  if (phase === 'suspended') return Object.freeze({phase, probes: 0, replies: 0, timing: null});
  if (phase === 'unavailable') return Object.freeze({phase, probes: 0, replies: 0, timing: null, reason: count(row.reason, 255)});
  return null;
}
export function parseCalibrationReport(value: unknown, expectedProduct: string, userAgent = ''): CalibrationReport | null {
  const timing = parseMeasuredNetplayTiming(value), raw = record(value), calibration = record(raw?.calibration);
  if (!timing || timing.route === 'spectator' || !calibration || !['th08mp', 'th09mp', 'th10mp'].includes(expectedProduct) || calibration.game !== expectedProduct ||
    !Array.isArray(calibration.players) || ![2,3].includes(calibration.players.length)) return null;
  const players = calibration.players.map(record);
  if (!players.every((player, index) => player && player.player === index && Number.isInteger(player.p95Us) && Number(player.p95Us) >= 1 && Number(player.p95Us) <= 1_000_000 &&
    Number.isInteger(player.samples) && Number(player.samples) >= 96 && Number(player.samples) <= 120 && player.lost === 120 - Number(player.samples))) return null;
  // Preserve original measurement fields for diagnostics. They do not authorize
  // changing the accepted timing or opening another data channel.
  return Object.freeze({schema: `eagler-touhou/${expectedProduct.slice(0,4)}-calibration-report/1`, game: expectedProduct, ...timing,
    completedAt: calibration.completedAt, runtimeBuild: calibration.build, localPlayer: calibration.localPlayer,
    players: Object.freeze(players.map(player => Object.freeze({player: player!.player, p95Us: player!.p95Us, samples: player!.samples, lost: player!.lost,
      minUs: player!.minUs, maxUs: player!.maxUs, meanUs: player!.meanUs}))),
    formula: 'B=max(1,ceil(floor(max(players.p95Us)/2)*60/1000000)); automatic hybrid P=min(configuredReserve,B-1), configuredReserve<=2; automatic D=B-P>=1',
    measurement: 'Startup input-channel RTT; arrival-triggered echo and high-resolution clock; frozen for this match',
    method: calibration.method, intervalMs: calibration.intervalMs, tailWaitMs: calibration.tailWaitMs, scope: calibration.scope,
    probes: calibration.probes, windowStart: calibration.windowStart, windowEnd: calibration.windowEnd, userAgent,
  });
}
export function createCalibrationOwner({now = Date.now, userAgent = ''}: {now?: () => number; userAgent?: string} = {}) {
  let state: CalibrationSnapshot = Object.freeze({epoch: null, progress: null, report: null, dismissed: false});
  let product = '', resultUntil = 0;
  return Object.freeze({
    getSnapshot: () => state,
    begin(epoch: number, productId: string) {product = productId; resultUntil = 0; state = Object.freeze({epoch, progress: null, report: null, dismissed: false});},
    receive(epoch: number, value: unknown) {
      if (state.epoch !== epoch) return false;
      if (record(value)?.phase === 'closed') {state = Object.freeze({...state, progress: null}); resultUntil = 0; return true;}
      const progress = parseCalibrationProgress(value); if (!progress) return false;
      if (progress.phase === 'ready' && state.progress?.timing && JSON.stringify(state.progress.timing) !== JSON.stringify(progress.timing)) return false;
      const report = progress.phase === 'ready' ? parseCalibrationReport(value, product, userAgent) : null;
      if (progress.phase === 'ready' && state.progress?.phase !== 'ready') resultUntil = now() + 8000;
      state = Object.freeze({...state, progress, report: report ?? state.report, dismissed: progress.phase === 'ready' ? state.dismissed : false}); return true;
    },
    expire() {if (state.progress?.phase === 'ready' && now() >= resultUntil && !state.dismissed) {state = Object.freeze({...state, dismissed: true}); return true;} return false;},
    dismiss() {state = Object.freeze({...state, dismissed: true});},
    reset() {product = ''; resultUntil = 0; state = Object.freeze({epoch: null, progress: null, report: null, dismissed: false});},
  });
}
