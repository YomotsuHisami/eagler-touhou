/** Captured Package/Host plan -> the existing single Runtime. This adapter never
 * creates frames/transports, changes native timing, or treats prepare as launch. */
import {gameIdForProduct, isMultiplayerProductId, multiplayerConfigForProduct, type MultiplayerProductId} from '../../src/contracts/product-catalog.mts';
import {buildMultiplayerRuntimeOptions} from '../../src/launcher/multiplayer-runtime-options.mts';
import type {TouchLayout} from '../../src/launcher/touch-layout-model.mts';
import {buildPublishedGamePlan, type PublishedGameOptions} from './game-launch.client';
import type {PreferencesSnapshot} from './preferences.client';
import type {RuntimePlan, RuntimeService} from './runtime.client';
import {checkPublishedCancelled} from './sample-launch.client';
import {createCalibrationOwner, type CalibrationSnapshot} from './netplay-calibration.client';
import type {MultiplayerRoomRuntimePort, RoomLaunchRequest} from './multiplayer-room.client';

export interface MultiplayerLaunchSnapshot {
  readonly productId: MultiplayerProductId | null; readonly prepared: boolean; readonly warning: string | null;
  readonly active: Readonly<{productId: MultiplayerProductId; roomCode: string; serial: number; epoch: number}> | null;
  readonly calibration: CalibrationSnapshot;
}
export interface MultiplayerLaunchOptions extends Omit<PublishedGameOptions, 'productId' | 'signal'> {
  runtimeService: Pick<RuntimeService, 'getSnapshot' | 'subscribe' | 'prepare' | 'launch' | 'cancel'>;
  getPreferences(productId: MultiplayerProductId): PreferencesSnapshot | null;
  getTouchLayout?(): TouchLayout | null;
  prepareMidi?: (signal?: AbortSignal) => Promise<void>;
  onTiming?(serial: number, value: unknown): void;
  onRuntimeEnd?(active: NonNullable<MultiplayerLaunchSnapshot['active']>): void;
  buildPlan?: typeof buildPublishedGamePlan;
  userAgent?: string;
}
export interface MultiplayerLaunchController extends MultiplayerRoomRuntimePort {
  getSnapshot(): MultiplayerLaunchSnapshot; subscribe(listener: () => void): () => void;
  dismissCalibration(): void; reportText(): string | null; dispose(): void;
}
export function validateRoomLaunchRequest(request: RoomLaunchRequest) {
  if (!isMultiplayerProductId(request.productId) || !/^\d{4,8}$/.test(request.roomCode) || !Number.isSafeInteger(request.serial) || request.serial < 1) throw Error('联机启动请求无效。');
  const source = request.options, url = new URL(source.netplayUrl);
  if (url.searchParams.get('room') !== `${request.productId}-${request.roomCode}` || url.searchParams.get('run') !== String(request.serial) ||
    url.searchParams.has('lobby') || url.searchParams.has('directory') || url.searchParams.has('signal') ||
    (source.netplaySpectator ? url.searchParams.get('spectator') !== source.netplaySpectatorId || url.searchParams.has('player')
      : url.searchParams.get('player') !== String(source.netplayPlayer) || url.searchParams.has('spectator'))) throw Error('Runtime 启动目标与已确认房间不一致。');
  return buildMultiplayerRuntimeOptions({url: source.netplayUrl, player: source.netplayPlayer, playerCount: source.netplayPlayerCount,
    seed: source.netplaySeed, difficulty: source.netplayDifficulty, inputDelay: source.netplayInputDelay, inputDelayAuto: source.netplayInputDelayAuto,
    predictionReserve: source.netplayPredictionReserve, adonisMode: source.netplayAdonisMode, predictionLimit: source.netplayPredictionLimit,
    spectator: source.netplaySpectator, spectatorId: source.netplaySpectatorId, spectatorCount: source.netplaySpectatorCount,
    iceServers: source.netplayIceServers, loadouts: source.netplayLoadouts,
  }, multiplayerConfigForProduct(request.productId)!);
}
export function createMultiplayerLaunch(options: MultiplayerLaunchOptions): MultiplayerLaunchController {
  const runtime = options.runtimeService, calibration = createCalibrationOwner({userAgent: options.userAgent});
  const listeners = new Set<() => void>();
  let disposed = false, generation = 0, building: AbortController | null = null, launchSignal: AbortSignal | null = null;
  let cached: {productId: MultiplayerProductId; key: string; plan: RuntimePlan} | null = null;
  let state: MultiplayerLaunchSnapshot = Object.freeze({productId: null, prepared: false, active: null, calibration: calibration.getSnapshot(), warning: null});
  let lastTiming: unknown = null, expiry: ReturnType<typeof setTimeout> | null = null;
  function update(patch: Partial<MultiplayerLaunchSnapshot>) {if (disposed) return; state = Object.freeze({...state, ...patch}); for (const listener of listeners) listener();}
  function capture(productId: MultiplayerProductId) {
    const value = options.getPreferences(productId);
    if (!value || value.productId !== productId) throw Error('请等待当前作品的设置与资源信息载入。');
    const preferences = structuredClone(value), touchLayout = structuredClone(options.getTouchLayout?.() ?? null);
    return {preferences, touchLayout, key: JSON.stringify({preferences, touchLayout})};
  }
  function available() {
    const snapshot = runtime.getSnapshot();
    if (snapshot.epoch != null || snapshot.ready || snapshot.launched || snapshot.fileOperationBusy || snapshot.saveError) throw Error('请先保存并关闭当前 Runtime，再准备联机游戏。');
  }
  const unsubscribe = runtime.subscribe(() => {
    const active = state.active, actual = runtime.getSnapshot();
    if (!active) return;
    if (actual.epoch !== active.epoch || actual.phase === 'exited' || actual.game !== gameIdForProduct(active.productId) || actual.runtimeVariant !== 'multiplayer') {
      if (actual.epoch !== active.epoch || actual.phase === 'exited') {calibration.reset(); update({active: null, calibration: calibration.getSnapshot()}); options.onRuntimeEnd?.(active);}
      return;
    }
    if (actual.netplayTiming === lastTiming || launchSignal?.aborted) return;
    lastTiming = actual.netplayTiming;
    if (!calibration.receive(active.epoch, actual.netplayTiming)) return;
    update({calibration: calibration.getSnapshot()});
    options.onTiming?.(active.serial, actual.netplayTiming);
    if (calibration.getSnapshot().progress?.phase === 'ready') {
      if (expiry !== null) clearTimeout(expiry);
      expiry = setTimeout(() => {expiry = null; if (calibration.expire()) update({calibration: calibration.getSnapshot()});}, 8000);
    }
  });
  return Object.freeze<MultiplayerLaunchController>({
    getSnapshot: () => state, subscribe(listener) {listeners.add(listener); return () => {listeners.delete(listener);};},
    async prepare(productId, signal, progress) {
      if (disposed) throw Error('联机启动器已关闭。');
      checkPublishedCancelled(signal); available();
      const captured = capture(productId);
      if (cached?.productId === productId && cached.key === captured.key) {progress({status: 'ready', stage: 'runtime', percent: 100}); return;}
      const ticket = ++generation, request = new AbortController(); building?.abort(); building = request;
      const abort = () => request.abort(signal.reason); signal.addEventListener('abort', abort, {once: true});
      update({productId, prepared: false, warning: null});
      progress({status: 'preparing', stage: 'package', percent: null});
      try {
        const plan = await (options.buildPlan ?? buildPublishedGamePlan)({...options, productId, preferences: captured.preferences, touchLayout: captured.touchLayout,
          signal: request.signal, onWarning: warning => {if (!disposed && ticket === generation) update({warning});},
          onProgress: value => {if (!disposed && ticket === generation && !request.signal.aborted) progress({status: 'preparing', stage: 'package', percent: value.total ? Math.round(value.completed / value.total * 100) : null});},
        }, 'multiplayer');
        checkPublishedCancelled(request.signal);
        if (disposed || ticket !== generation) throw Error('联机准备已被替换。');
        if (plan.game !== gameIdForProduct(productId) || plan.runtimeVariant !== 'multiplayer' || !plan.publishedRuntime) throw Error('准备结果不是当前作品的已发布多人 Runtime。');
        available();
        // Keep the captured plan immutable to callers; the sole Runtime owner
        // will hash/lease code and data again when the server starts this run.
        cached = {productId, key: captured.key, plan: structuredClone(plan)};
        update({prepared: true}); progress({status: 'ready', stage: 'runtime', percent: 100});
      } finally {signal.removeEventListener('abort', abort); if (building === request) building = null;}
    },
    async launch(request, signal) {
      if (disposed) throw Error('联机启动器已关闭。');
      checkPublishedCancelled(signal); available();
      const exact = structuredClone(request), runtimeOptions = validateRoomLaunchRequest(exact), captured = capture(exact.productId);
      if (!cached || cached.productId !== exact.productId || cached.key !== captured.key) throw Error('资源准备后设置已变化，请重新准备并确认准备。');
      const plan = structuredClone(cached.plan);
      plan.configure.options = {...plan.configure.options, ...runtimeOptions};
      let ownedEpoch: number | null = null;
      launchSignal = signal; lastTiming = null;
      const abort = () => {
        const current = runtime.getSnapshot();
        // Never discard a launched game. Route/Close decisions belong to the
        // existing root blocker; cancel only our not-yet-launched preparation.
        if (ownedEpoch != null && current.epoch === ownedEpoch && !current.launched && ['loading', 'configuring', 'prepared'].includes(current.phase)) {
          try {runtime.cancel();} catch {}
        }
      };
      signal.addEventListener('abort', abort, {once: true});
      try {
        const preparing = runtime.prepare(plan);
        ownedEpoch = runtime.getSnapshot().epoch;
        const prepared = await preparing;
        checkPublishedCancelled(signal);
        if (disposed || prepared.epoch == null || prepared.epoch !== ownedEpoch || runtime.getSnapshot().epoch !== ownedEpoch || prepared.phase !== 'prepared') throw Error('多人 Runtime 准备已被替换。');
        calibration.begin(ownedEpoch!, exact.productId);
        update({active: Object.freeze({productId: exact.productId, roomCode: exact.roomCode, serial: exact.serial, epoch: ownedEpoch!}), calibration: calibration.getSnapshot()});
        const launched = await runtime.launch();
        checkPublishedCancelled(signal);
        if (disposed || launched.epoch !== ownedEpoch || runtime.getSnapshot().epoch !== ownedEpoch || launched.phase !== 'running' || !launched.firstFrame) throw Error('多人 Runtime 尚未确认首帧。');
      } finally {signal.removeEventListener('abort', abort);}
    },
    dismissCalibration() {calibration.dismiss(); update({calibration: calibration.getSnapshot()});},
    reportText() {return state.calibration.report ? JSON.stringify({...state.calibration.report, copiedAt: new Date().toISOString()}, null, 2) : null;},
    dispose() {if (disposed) return; disposed = true; generation++; building?.abort(); building = null; if (expiry !== null) clearTimeout(expiry); expiry = null; unsubscribe(); listeners.clear(); cached = null; calibration.reset();},
  });
}
