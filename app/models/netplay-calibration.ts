import {parseMeasuredNetplayTiming} from '../../src/contracts/netplay-timing.mts';

export interface CalibrationSnapshot {
  epoch: number;
  connection: Readonly<Record<string, unknown>> | null;
  report: Readonly<Record<string, unknown>> | null;
  reportText: string | null;
}
export interface CalibrationOptions {
  epoch?: number;
  userAgent: string;
  now?: () => number;
  timers: Pick<Window, 'setTimeout' | 'clearTimeout'>;
}
/** Instance-scoped extraction of original netplay-calibration-{connection,report}.
 * The host feeds only its authenticated runtime-info subscription and epoch. */
export function createNetplayCalibration(options: CalibrationOptions) {
  const now = options.now ?? Date.now, listeners = new Set<() => void>();
  let epoch = options.epoch ?? 0, disposed = false, timer: number | null = null;
  let connection: Readonly<Record<string, unknown>> | null = null;
  let report: Readonly<Record<string, unknown>> | null = null, reportText: string | null = null;
  let snapshot: Readonly<CalibrationSnapshot> = Object.freeze({epoch, connection, report, reportText});
  function publish() {
    if (disposed) return;
    snapshot = Object.freeze({epoch, connection, report, reportText});
    for (const listener of listeners) listener();
  }
  function clearTimer() {if (timer !== null) options.timers.clearTimeout(timer); timer = null;}
  function dismiss() {clearTimer(); connection = null; publish();}
  function record(value: unknown, sourceEpoch: number) {
    if (disposed || sourceEpoch !== epoch || !value || typeof value !== 'object') return;
    const raw = value as Record<string, unknown>;
    if (raw.phase === 'closed') {dismiss(); return;}
    const timing = parseMeasuredNetplayTiming(raw);
    if (raw.phase === 'ready') {
      if (!timing || raw.route === 'spectator') return;
      clearTimer(); connection = Object.freeze({...raw});
      const ownedEpoch = epoch;
      timer = options.timers.setTimeout(() => {timer = null; if (!disposed && epoch === ownedEpoch) {connection = null; publish();}}, 8000);
    } else if (['waiting', 'stabilizing', 'measuring', 'negotiating', 'retrying', 'suspended', 'unavailable'].includes(String(raw.phase))) {
      clearTimer(); connection = Object.freeze({...raw});
    } else return;
    const calibration = raw.calibration && typeof raw.calibration === 'object' ? raw.calibration as Record<string, unknown> : null;
    const players = Array.isArray(calibration?.players) ? calibration.players as Record<string, unknown>[] : null;
    if (timing && timing.route !== 'spectator' && calibration && players && [2, 3].includes(players.length) &&
      players.every((p, index) => p && p.player === index && Number.isInteger(p.p95Us) && Number(p.p95Us) >= 1 && Number(p.p95Us) <= 1_000_000 &&
        Number.isInteger(p.samples) && Number(p.samples) >= 96 && Number(p.samples) <= 120 && p.lost === 120 - Number(p.samples))) {
      const game = ['th08mp', 'th09mp', 'th10mp'].includes(String(calibration.game)) ? String(calibration.game) : 'th09mp';
      report = Object.freeze({schema: `eagler-touhou/${game.slice(0, 4)}-calibration-report/1`, game, ...timing,
        completedAt: calibration.completedAt, runtimeBuild: calibration.build, localPlayer: calibration.localPlayer,
        players: players.map(p => ({player: p.player, p95Us: p.p95Us, samples: p.samples, lost: p.lost, minUs: p.minUs, maxUs: p.maxUs, meanUs: p.meanUs})),
        formula: 'B=max(1,ceil(floor(max(players.p95Us)/2)*60/1000000)); automatic hybrid P=min(configuredReserve,B-1), configuredReserve<=2; automatic D=B-P>=1',
        measurement: 'Startup input-channel RTT; arrival-triggered echo and high-resolution clock; frozen for this match',
        method: calibration.method, intervalMs: calibration.intervalMs, tailWaitMs: calibration.tailWaitMs, scope: calibration.scope,
        probes: calibration.probes, windowStart: calibration.windowStart, windowEnd: calibration.windowEnd, userAgent: options.userAgent});
    }
    publish();
  }
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {listeners.add(listener); return () => {listeners.delete(listener);};},
    record, dismiss,
    reset(nextEpoch: number) {if (disposed) return; clearTimer(); epoch = nextEpoch; connection = null; report = null; reportText = null; publish();},
    openReport(currentNetwork: string) {
      if (disposed || !report) return;
      reportText = JSON.stringify({...report, copiedAt: new Date(now()).toISOString(), liveNetworkDisplay: currentNetwork}, null, 2); publish();
    },
    closeReport() {if (reportText === null || disposed) return; reportText = null; publish();},
    dispose() {disposed = true; clearTimer(); listeners.clear();},
  };
}
export type NetplayCalibration = ReturnType<typeof createNetplayCalibration>;

/** Exact original bilingual text, intentionally not rewritten. */
export function calibrationConnectionCopy(progress: Readonly<Record<string, unknown>>, english: boolean) {
  const phase = progress.phase, ready = phase === 'ready';
  const title = ready ? (english ? 'Connection measured' : '联机测量完成')
    : phase === 'unavailable' ? (english ? 'Unable to start multiplayer' : '暂时无法开始联机')
    : phase === 'suspended' ? (english ? 'Waiting for the game page…' : '等待返回游戏页面…')
    : phase === 'retrying' ? (english ? 'Retrying connection measurement…' : '连接波动，正在重新测量…')
    : phase === 'waiting' ? (english ? 'Connecting to players…' : '正在连接其他玩家…')
    : phase === 'stabilizing' ? (english ? 'Allowing connection to settle…' : '正在稳定连接…')
    : phase === 'negotiating' ? (english ? 'Confirming measured delay…' : '各方确认测量结果…')
    : (english ? 'Measuring connection latency…' : '正在测量连接延迟…');
  const summary = phase === 'unavailable'
    ? Number(progress.reason) === 8 ? (english ? 'The measured delay is too high. Return to the room and choose a manual delay.' : '测得的延迟过高，请返回房间调整输入延迟。')
      : (english ? 'Connection measurement could not finish. Return to the room to try again.' : '暂时无法完成联机测量，请返回房间重新开始。')
    : phase === 'suspended' ? (english ? 'Keep this game page open. Measurement resumes automatically.' : '请保持游戏页面在前台，恢复后会自动重新测量。')
    : phase === 'retrying' ? (english ? `Preparing attempt ${progress.attempt ?? 1}/${progress.maxAttempts ?? 4}. Waiting for all players to reconnect.` : `准备第 ${progress.attempt ?? 1}/${progress.maxAttempts ?? 4} 次测量，正在等待所有玩家恢复。`)
    : phase === 'stabilizing' ? (english ? 'Measurement starts after one second.' : '等待 1 秒后开始测量。')
    : phase === 'waiting' ? (english ? 'Waiting for all player input channels.' : '等待所有玩家的输入通道就绪。')
    : phase === 'negotiating' ? (english ? 'Waiting for every player to confirm.' : '等待所有玩家确认测量结果。')
    : (english ? `Probes ${progress.probes ?? 0}/129 · replies ${progress.replies ?? 0}/120` : `探测 ${progress.probes ?? 0}/129 · 有效应答 ${progress.replies ?? 0}/120`);
  return {title, summary,
    delay: english ? `Input delay: ${progress.inputDelay} frame(s)` : `输入延迟：${progress.inputDelay} 帧`,
    rollback: english ? `Rollback: ${Number(progress.adonisMode) === 2 ? 'on' : 'off'}` : `回滚：${Number(progress.adonisMode) === 2 ? '开启' : '关闭'}`,
    columns: english ? ['Player', 'Measured latency', 'Maximum latency'] : ['玩家', '测定延迟', '最大延迟'],
    note: english ? 'Each player’s slowest input link.' : '各玩家最慢的输入链路。',
    dismiss: english ? 'Dismiss' : '收起', returnToRoom: english ? 'Return to room' : '返回房间'};
}
