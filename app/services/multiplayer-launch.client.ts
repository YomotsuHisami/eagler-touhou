import {isValidatedDevelopmentRuntime} from './development-runtime';
/** Captured Package/Host plan -> the existing single Runtime. This adapter never
 * creates frames/transports, changes native timing, or treats prepare as launch. */
import {PRODUCT_GAMES, gameIdForProduct, isMultiplayerProductId, multiplayerConfigForProduct, type MultiplayerProductId} from '../../src/contracts/product-catalog.mts';
import {buildMultiplayerRuntimeOptions} from '../../src/launcher/multiplayer-runtime-options.mts';
import type {LaunchWarningSettings} from './launch-warnings';
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
  runtimeService: Pick<RuntimeService, 'getSnapshot' | 'subscribe' | 'prepare' | 'launch' | 'cancel' | 'checkMultiplayer' | 'close'>;
  getPreferences(productId: MultiplayerProductId): PreferencesSnapshot | null;
  getTouchLayout?(): TouchLayout | null;
  /** Invoked only for seated launches, before retiring a retained native title.
   * The UI acknowledgment must stay bound to this room/run and captured plan. */
  confirmInputWarnings(settings: LaunchWarningSettings, request: RoomLaunchRequest, signal: AbortSignal, current: () => boolean,
    stage: 'preparation' | 'launch', epoch: number | null, onAccept?: () => unknown | Promise<unknown>): Promise<boolean>;
  prepareMidi?: (signal?: AbortSignal) => Promise<void>;
  /** Synchronously resume the existing MIDI owner, then await its external output open. */
  prepareMidiAtLaunch?: (epoch: number, current: () => boolean) => Promise<void>;
  onTiming?(serial: number, value: unknown): void;
  onRuntimeEnd?(active: NonNullable<MultiplayerLaunchSnapshot['active']>): void;
  buildPlan?: typeof buildPublishedGamePlan;
  userAgent?: string;
  /** Sole exception to idle preparation: an epoch-owned native title request.
   * Acquisition still does not change that Runtime; launch must save-close it. */
  retainedTitle?: {retains(productId: MultiplayerProductId): boolean; retire(request: RoomLaunchRequest, signal: AbortSignal): Promise<void>};
}
export interface MultiplayerLaunchController extends MultiplayerRoomRuntimePort {
  getSnapshot(): MultiplayerLaunchSnapshot; subscribe(listener: () => void): () => void;
  returnToRoom(active: NonNullable<MultiplayerLaunchSnapshot['active']>): Promise<boolean>;
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
    seed: source.netplaySeed, difficulty: source.netplayDifficulty, challengeMode: source.netplayChallengeMode,
    inputDelay: source.netplayInputDelay, inputDelayAuto: source.netplayInputDelayAuto,
    predictionReserve: source.netplayPredictionReserve, adonisMode: source.netplayAdonisMode, predictionLimit: source.netplayPredictionLimit,
    spectator: source.netplaySpectator, spectatorId: source.netplaySpectatorId, spectatorCount: source.netplaySpectatorCount,
    iceServers: source.netplayIceServers, loadouts: source.netplayLoadouts,
  }, multiplayerConfigForProduct(request.productId)!);
}
export function createMultiplayerLaunch(options: MultiplayerLaunchOptions): MultiplayerLaunchController {
  const runtime = options.runtimeService, calibration = createCalibrationOwner({userAgent: options.userAgent});
  const listeners = new Set<() => void>();
  let disposed = false, generation = 0, launchIntent = 0, building: AbortController | null = null, launchSignal: AbortSignal | null = null;
  let checking = false, checkRequest: AbortController | null = null, returningEpoch: number | null = null;
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
  function available(productId?: MultiplayerProductId) {
    const snapshot = runtime.getSnapshot();
    if (productId && options.retainedTitle?.retains(productId) && !snapshot.fileOperationBusy && !snapshot.saveError) return;
    if (snapshot.epoch != null || snapshot.ready || snapshot.launched || snapshot.fileOperationBusy || snapshot.saveError) throw Error('请先保存并关闭当前 Runtime，再准备联机游戏。');
  }
  const unsubscribe = runtime.subscribe(() => {
    const active = state.active, actual = runtime.getSnapshot();
    if (!active) return;
    if (actual.epoch !== active.epoch || actual.phase === 'exited' || actual.game !== gameIdForProduct(active.productId) || actual.runtimeVariant !== 'multiplayer') {
      if (actual.epoch !== active.epoch || actual.phase === 'exited') {
        const preserve = returningEpoch === active.epoch;
        returningEpoch = null;
        if (preserve) {const saved = calibration.getSnapshot(); update({active: null, calibration: Object.freeze({...saved, epoch: null, progress: null, dismissed: true})});}
        else {calibration.reset(); update({active: null, calibration: calibration.getSnapshot()});}
        options.onRuntimeEnd?.(active);
      }
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
      checkPublishedCancelled(signal);
      if (checking) throw Error('请等待游戏检查完成。');
      available(productId);
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
        if (plan.game !== gameIdForProduct(productId) || plan.runtimeVariant !== 'multiplayer' || !plan.publishedRuntime && !isValidatedDevelopmentRuntime(plan, options.baseUrl)) throw Error('准备结果不是当前作品的已验证多人 Runtime。');
        available(productId);
        // Keep the captured plan immutable to callers; the sole Runtime owner
        // will hash/lease code and data again when the server starts this run.
        cached = {productId, key: captured.key, plan: structuredClone(plan)};
        update({prepared: true}); progress({status: 'ready', stage: 'runtime', percent: 100});
      } finally {signal.removeEventListener('abort', abort); if (building === request) building = null;}
    },
    async returnToRoom(active) {
      const current = state.active, source = runtime.getSnapshot();
      if (!current || current.productId !== active.productId || current.roomCode !== active.roomCode || current.serial !== active.serial || current.epoch !== active.epoch ||
          source.epoch !== active.epoch || source.runtimeVariant !== 'multiplayer') throw Error('标定状态已变化，请返回当前房间后重试。');
      returningEpoch = active.epoch;
      try {
        const closed = await runtime.close();
        if (!closed) throw Error(runtime.getSnapshot().saveError ?? runtime.getSnapshot().closeError ?? '当前游戏未能安全保存并返回房间。');
        if (state.active?.epoch === active.epoch) {
          const saved = calibration.getSnapshot(); returningEpoch = null;
          update({active: null, calibration: Object.freeze({...saved, epoch: null, progress: null, dismissed: true})});
          options.onRuntimeEnd?.(active);
        }
        return true;
      } catch (error) {returningEpoch = null; throw error;}
    },
    async checkGame(productId, signal) {
      if (disposed || checking) throw Error('游戏检查已关闭或正在进行。');
      checkPublishedCancelled(signal); available();
      const captured = capture(productId), capturedPlan = cached, ticket = generation;
      if (!capturedPlan || capturedPlan.productId !== productId || capturedPlan.key !== captured.key) throw Error('资源准备后设置已变化，请重新准备并检查。');
      checking = true;
      const request = new AbortController(); checkRequest = request;
      const abort = () => request.abort(signal.reason); signal.addEventListener('abort', abort, {once: true});
      try {
        await runtime.checkMultiplayer(structuredClone(capturedPlan.plan), request.signal);
        checkPublishedCancelled(signal);
        if (disposed || generation !== ticket || cached !== capturedPlan || capture(productId).key !== captured.key) throw Error('游戏检查已被替换。');
      } finally {signal.removeEventListener('abort', abort); if (checkRequest === request) checkRequest = null; checking = false;}
    },
    async launch(request, signal) {
      if (disposed) throw Error('联机启动器已关闭。');
      checkPublishedCancelled(signal);
      if (checking) throw Error('请等待游戏检查清理完成。');
      const exact = structuredClone(request), runtimeOptions = validateRoomLaunchRequest(exact), captured = capture(exact.productId);
      if (!cached || cached.productId !== exact.productId || cached.key !== captured.key) throw Error('资源准备后设置已变化，请重新准备并确认准备。');
      const capturedPlan = cached, ticket = generation, intent = ++launchIntent, source = runtime.getSnapshot();
      const current = () => {
        const actual = runtime.getSnapshot();
        return !disposed && !signal.aborted && launchIntent === intent && generation === ticket && cached === capturedPlan &&
          actual.epoch === source.epoch && actual.phase === source.phase && !actual.fileOperationBusy && !actual.saveError &&
          capture(exact.productId).key === captured.key;
      };
      const plan = structuredClone(capturedPlan.plan);
      if (!runtimeOptions.netplaySpectator) {
        available(exact.productId);
        const confirmed = await options.confirmInputWarnings({music: plan.configure.music,
          touchEnabled: plan.configure.options?.touchEnabled === true}, exact, signal, current, 'preparation', null);
        checkPublishedCancelled(signal);
        if (!confirmed) throw new DOMException('Game launch was cancelled', 'AbortError');
        if (!current()) throw Error('联机启动确认已被替换，请重新准备。');
      }
      plan.configure.options = {...plan.configure.options, ...runtimeOptions};
      if (options.retainedTitle?.retains(exact.productId)) await options.retainedTitle.retire(exact, signal);
      checkPublishedCancelled(signal); available();
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
        const preparedCurrent = () => {
          const actual = runtime.getSnapshot();
          return !disposed && !signal.aborted && launchIntent === intent && generation === ticket && cached === capturedPlan &&
            prepared.epoch != null && prepared.epoch === ownedEpoch && actual.epoch === ownedEpoch && actual.phase === 'prepared' &&
            !actual.fileOperationBusy && !actual.saveError && capture(exact.productId).key === captured.key;
        };
        if (!preparedCurrent()) throw Error('多人 Runtime 准备已被替换。');
        // Installing an optional local OGG can change the effective mode after
        // resource preparation. Acknowledge that result too, never saved intent.
        const effectiveMusic = runtime.getSnapshot().music ?? plan.configure.music;
        const needsMidiStart = effectiveMusic === 'midi' && PRODUCT_GAMES[gameIdForProduct(exact.productId)].musicCapabilities.midi;
        if (!runtimeOptions.netplaySpectator && effectiveMusic && (needsMidiStart || effectiveMusic !== plan.configure.music)) {
          const confirmed = await options.confirmInputWarnings({music: effectiveMusic, touchEnabled: true}, exact, signal, preparedCurrent, 'launch', ownedEpoch,
            needsMidiStart ? () => options.prepareMidiAtLaunch?.(ownedEpoch!, preparedCurrent) : undefined);
          checkPublishedCancelled(signal);
          if (!confirmed) {abort(); throw new DOMException('Game launch was cancelled', 'AbortError');}
          if (!preparedCurrent()) throw Error('多人 Runtime 准备已被替换。');
        } else if (runtimeOptions.netplaySpectator && needsMidiStart) {
          // Spectators have no launch confirmation dialog. Prepare output best-effort
          // under the same Runtime epoch before native launch; external failures
          // remain in the MIDI owner's status and use its built-in synth fallback.
          try {await options.prepareMidiAtLaunch?.(ownedEpoch!, preparedCurrent);} catch {}
          if (!preparedCurrent()) throw Error('多人 Runtime 准备已被替换。');
        }
        calibration.begin(ownedEpoch!, exact.productId);
        update({active: Object.freeze({productId: exact.productId, roomCode: exact.roomCode, serial: exact.serial, epoch: ownedEpoch!}), calibration: calibration.getSnapshot()});
        const launched = await runtime.launch();
        checkPublishedCancelled(signal);
        if (disposed || launched.epoch !== ownedEpoch || runtime.getSnapshot().epoch !== ownedEpoch || launched.phase !== 'running' || !launched.firstFrame) throw Error('多人 Runtime 尚未确认首帧。');
      } finally {signal.removeEventListener('abort', abort);}
    },
    dismissCalibration() {calibration.dismiss(); update({calibration: calibration.getSnapshot()});},
    reportText() {return state.calibration.report ? JSON.stringify({...state.calibration.report, copiedAt: new Date().toISOString()}, null, 2) : null;},
    dispose() {if (disposed) return; disposed = true; generation++; checkRequest?.abort(); building?.abort(); building = null; if (expiry !== null) clearTimeout(expiry); expiry = null; unsubscribe(); listeners.clear(); cached = null; calibration.reset();},
  });
}
