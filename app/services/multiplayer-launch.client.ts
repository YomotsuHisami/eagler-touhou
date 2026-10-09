import {isValidatedDevelopmentRuntime} from './development-runtime';
/** Captured Package/Host plan -> the existing single Runtime. This adapter never
 * creates frames/transports, changes native timing, or treats prepare as launch. */
import {PRODUCT_GAMES, gameIdForProduct, isMultiplayerProductId, multiplayerConfigForProduct, type MultiplayerProductId} from '../../src/contracts/product-catalog.mts';
import {buildMultiplayerRuntimeOptions} from '../../src/launcher/multiplayer-runtime-options.mts';
import type {LaunchWarningSettings} from './launch-warnings';
import type {TouchLayout} from '../../src/launcher/touch-layout-model.mts';
import {buildPublishedGamePlan, buildPublishedGamePreparation, preparePublishedGame, type PublishedGameOptions} from './game-launch.client';
import type {PreferencesSnapshot} from './preferences.client';
import type {RuntimeService} from './runtime.client';
import {checkPublishedCancelled} from './sample-launch.client';
import {createCalibrationOwner, type CalibrationSnapshot} from './netplay-calibration.client';
import type {MultiplayerRoomRuntimePort, RoomLaunchRequest} from './multiplayer-room.client';
import {waitForMultiplayerGameplayPath} from './multiplayer-gameplay-path.client';
import {prepareMultiplayerRoomResources} from './multiplayer-room-resources.client';
import type {PreparedOggSeed} from './ogg-progressive.client';
import type {EntryPackageUpdateHooks} from './entry-package-update.client';
import {isGameDataAcquisitionFailure} from './game-data-acquisition';

export interface MultiplayerLaunchSnapshot {
  readonly productId: MultiplayerProductId | null; readonly prepared: boolean; readonly warning: string | null;
  readonly active: Readonly<{productId: MultiplayerProductId; roomCode: string; serial: number; epoch: number}> | null;
  readonly calibration: CalibrationSnapshot;
  readonly startup: 'runtime' | 'path' | null;
}
export interface MultiplayerLaunchOptions extends Omit<PublishedGameOptions, 'productId' | 'signal'>, EntryPackageUpdateHooks {
  runtimeService: Pick<RuntimeService, 'getSnapshot' | 'getInputContext' | 'subscribe' | 'prepare' | 'prepareWithReady' | 'launch' | 'cancel' | 'checkMultiplayer' | 'close'>;
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
  acquireStart?(): () => void;
  enterPlayer?(): Promise<unknown> | undefined;
  /** WebKit touch must expose the Runtime's own gesture gate. */
  coverUntilGameplayPath?: boolean;
  buildPlan?: typeof buildPublishedGamePlan;
  buildPreparation?: typeof buildPublishedGamePreparation;
  onPreparedOgg?(seed: PreparedOggSeed): void;
  currentRequest?(request: RoomLaunchRequest): boolean;
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
  let importProof: string | null = null;
  let preparedProduct: MultiplayerProductId | null = null;
  let state: MultiplayerLaunchSnapshot = Object.freeze({productId: null, prepared: false, active: null, calibration: calibration.getSnapshot(), warning: null, startup: null});
  let lastTiming: unknown = null, expiry: ReturnType<typeof setTimeout> | null = null;
  function update(patch: Partial<MultiplayerLaunchSnapshot>) {if (disposed) return; state = Object.freeze({...state, ...patch}); for (const listener of listeners) listener();}
  function capture(productId: MultiplayerProductId) {
    const value = options.getPreferences(productId);
    if (!value || value.productId !== productId) throw Error('请等待当前作品的设置与资源信息载入。');
    const preferences = structuredClone(value), touchLayout = structuredClone(options.getTouchLayout?.() ?? null);
    return {preferences, touchLayout, key: JSON.stringify({productId: preferences.productId, preferenceId: preferences.preferenceId,
      options: preferences.options, language: preferences.language, music: preferences.music, touchLayout})};
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
      if (preparedProduct === productId) {progress({status: 'ready', stage: 'runtime', percent: 100}); return;}
      const ticket = ++generation, request = new AbortController(); building?.abort(); building = request;
      const abort = () => request.abort(signal.reason); signal.addEventListener('abort', abort, {once: true});
      update({productId, prepared: false, warning: null});
      progress({status: 'preparing', stage: 'package', percent: null});
      try {
        await prepareMultiplayerRoomResources({...options, productId, signal: request.signal,
          progress: value => {if (!disposed && ticket === generation && !request.signal.aborted) progress(value);}});
        checkPublishedCancelled(request.signal);
        if (disposed || ticket !== generation) throw Error('联机准备已被替换。');
        preparedProduct = productId;
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
      const captured = capture(productId), ticket = generation;
      if (preparedProduct !== productId) throw Error('请先等待房间基础资源准备完成。');
      checking = true;
      const releaseStart = options.acquireStart?.() ?? (() => {});
      const request = new AbortController(); checkRequest = request;
      const abort = () => request.abort(signal.reason); signal.addEventListener('abort', abort, {once: true});
      try {
        const current = () => !disposed && generation === ticket && !request.signal.aborted && checkRequest === request && capture(productId).key === captured.key;
        const background = await options.preparePackageUpdate?.(productId, request.signal, current);
        const acquisition = {...options, productId, preferences: captured.preferences, touchLayout: captured.touchLayout, progressiveOgg: true, signal: request.signal};
        if (runtime.prepareWithReady && !options.buildPlan && !options.buildPreparation) {
          await buildPublishedGamePreparation({...acquisition, prepareRuntime: async (base, finish) => {
            let resources: Awaited<ReturnType<typeof finish>> | undefined;
            await runtime.checkMultiplayer(base, request.signal, prepared => {
              if (!current() || !resources || prepared.epoch == null) throw new DOMException('Game check was cancelled', 'AbortError');
              if (resources.oggIds.length && prepared.music !== 'midi') options.onPreparedOgg?.({epoch: prepared.epoch, resolved: resources.resolved, fileIds: resources.oggIds});
              if (background && prepared.generationId) options.onPreparedPackageUpdate?.(background, prepared.epoch, prepared.generationId);
            }, async () => {
              if (!current()) throw new DOMException('Game check was cancelled', 'AbortError');
              resources = await finish();
              if (!current()) throw new DOMException('Game check was cancelled', 'AbortError');
              return resources.plan;
            });
            if (!resources) throw new Error('Game check did not prepare its native-ready resources');
            return resources;
          }}, 'multiplayer');
          checkPublishedCancelled(signal);
          if (!current()) throw new DOMException('Game check was cancelled', 'AbortError');
          return;
        }
        const preparedResources = options.buildPlan ? {plan: await options.buildPlan(acquisition, 'multiplayer'), ogg: null}
          : await (options.buildPreparation ?? buildPublishedGamePreparation)(acquisition, 'multiplayer');
        const {plan} = preparedResources;
        checkPublishedCancelled(request.signal);
        if (disposed || generation !== ticket || capture(productId).key !== captured.key) throw Error('游戏检查已被替换。');
        if (plan.game !== gameIdForProduct(productId) || plan.runtimeVariant !== 'multiplayer' || !plan.publishedRuntime && !isValidatedDevelopmentRuntime(plan, options.baseUrl)) throw Error('检查结果不是当前作品的已验证多人 Runtime。');
        await runtime.checkMultiplayer(structuredClone(plan), request.signal, prepared => {
          if (!current() || prepared.epoch == null) throw new DOMException('Game check was cancelled', 'AbortError');
          if (preparedResources.ogg && prepared.music !== 'midi') options.onPreparedOgg?.({epoch: prepared.epoch, ...preparedResources.ogg});
          if (background && prepared.generationId) options.onPreparedPackageUpdate?.(background, prepared.epoch, prepared.generationId);
        });
        checkPublishedCancelled(signal);
        if (disposed || generation !== ticket || capture(productId).key !== captured.key) throw Error('游戏检查已被替换。');
      } finally {signal.removeEventListener('abort', abort);releaseStart(); if (checkRequest === request) checkRequest = null; checking = false;}
    },
    async launch(request, signal, imported = false) {
      if (disposed) throw Error('联机启动器已关闭。');
      checkPublishedCancelled(signal);
      if (checking) throw Error('请等待游戏检查清理完成。');
      const exact = structuredClone(request), runtimeOptions = validateRoomLaunchRequest(exact), captured = capture(exact.productId);
      const proofKey = JSON.stringify([exact, captured.key]);
      const resuming = imported && importProof === proofKey;
      importProof = null;
      if (imported && !resuming) throw new DOMException('Room DATA continuation was replaced', 'AbortError');
      if (preparedProduct !== exact.productId) throw Error('请先等待房间基础资源准备完成。');
      const ticket = generation, intent = ++launchIntent, source = runtime.getSnapshot();
      const intentCurrent = () => !disposed && !signal.aborted && launchIntent === intent && generation === ticket && preparedProduct === exact.productId && capture(exact.productId).key === captured.key && options.currentRequest?.(exact) !== false;
      if (!intentCurrent()) throw new DOMException('Room startup intent was replaced', 'AbortError');
      const current = () => {
        const actual = runtime.getSnapshot();
        return intentCurrent() &&
          actual.epoch === source.epoch && actual.phase === source.phase && !actual.fileOperationBusy && !actual.saveError &&
          capture(exact.productId).key === captured.key;
      };
      const fromTitle = options.retainedTitle?.retains(exact.productId) === true;
      if (!runtimeOptions.netplaySpectator && !resuming) {
        available(exact.productId);
        const selectedMusic = captured.preferences.music;
        if (!selectedMusic) throw Error('请等待当前作品的音乐设置载入。');
        const confirmed = await options.confirmInputWarnings({music: selectedMusic === 'midi' || selectedMusic === 'none' ? selectedMusic : 'ogg',
          touchEnabled: captured.preferences.options.touchEnabled === true}, exact, signal, current, 'preparation', null);
        checkPublishedCancelled(signal);
        if (!confirmed) throw new DOMException('Game launch was cancelled', 'AbortError');
        if (!current()) throw Error('联机启动确认已被替换，请重新准备。');
      }
      if (fromTitle) await options.retainedTitle!.retire(exact, signal);
      checkPublishedCancelled(signal); available();
      let ownedEpoch: number | null = null;
      const releaseStart = options.acquireStart?.() ?? (() => {});
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
        update({startup: 'runtime'});
        if (!resuming) await options.enterPlayer?.();
        checkPublishedCancelled(signal);
        const background = await options.preparePackageUpdate?.(exact.productId, signal, intentCurrent);
        const acquisition = {...options, productId: exact.productId, preferences: captured.preferences, touchLayout: captured.touchLayout,
          progressiveOgg: !!options.onPreparedOgg, signal, onWarning: (warning: string) => {if (!disposed && generation === ticket) update({warning});}};
        let prepared: Awaited<ReturnType<RuntimeService['prepare']>>;
        let requestedMusic: 'ogg' | 'midi' | 'none';
        if (runtime.prepareWithReady && !options.buildPlan && !options.buildPreparation) {
          prepared = await preparePublishedGame({...acquisition, runtimeService: {
            prepare: runtime.prepare,
            prepareWithReady: (plan, ready, signal) => runtime.prepareWithReady!(plan, async epoch => {
              ownedEpoch = epoch;
              if (!intentCurrent()) throw new DOMException('Room startup intent was replaced', 'AbortError');
              const final = await ready(epoch);
              if (!intentCurrent()) throw new DOMException('Room startup intent was replaced', 'AbortError');
              return final;
            }, signal),
          }}, 'multiplayer', runtimeOptions);
          requestedMusic = prepared.music ?? 'none';
        } else {
        const preparedResources = options.buildPlan ? {plan: await options.buildPlan(acquisition, 'multiplayer'), ogg: null}
          : await (options.buildPreparation ?? buildPublishedGamePreparation)(acquisition, 'multiplayer');
        const {plan} = preparedResources;
        checkPublishedCancelled(signal);
        if (!intentCurrent()) throw new DOMException('Room startup intent was replaced', 'AbortError');
        if (plan.game !== gameIdForProduct(exact.productId) || plan.runtimeVariant !== 'multiplayer' || !plan.publishedRuntime && !isValidatedDevelopmentRuntime(plan, options.baseUrl)) throw Error('准备结果不是当前作品的已验证多人 Runtime。');
        plan.configure.options = {...plan.configure.options, ...runtimeOptions};
        const preparing = runtime.prepare(plan, signal);
        ownedEpoch = runtime.getSnapshot().epoch;
        // Runtime preparation may replace its native frame and acquire a new
        // session epoch while retrying a failed code generation.  The epoch
        // that owns the launch is therefore the epoch returned by the
        // completed preparation, not the first loading snapshot.
        prepared = await preparing;
        requestedMusic = plan.configure.music;
        if (preparedResources.ogg && prepared.music !== 'midi' && prepared.epoch != null) options.onPreparedOgg!({epoch: prepared.epoch, ...preparedResources.ogg});
        }
        ownedEpoch = prepared.epoch;
        checkPublishedCancelled(signal);
        const preparedCurrent = () => {
          const actual = runtime.getSnapshot();
          return intentCurrent() &&
            prepared.epoch != null && prepared.epoch === ownedEpoch && actual.epoch === ownedEpoch && actual.phase === 'prepared' &&
            !actual.fileOperationBusy && !actual.saveError && capture(exact.productId).key === captured.key;
        };
        if (!preparedCurrent()) throw Error('多人 Runtime 准备已被替换。');
        // main confirms selected input/music once, before opening Player.
        // Optional OGG fallback reports a notice and keeps the same Start.
        const effectiveMusic = runtime.getSnapshot().music ?? requestedMusic;
        if (background && prepared.generationId) options.onPreparedPackageUpdate?.(background, ownedEpoch!, prepared.generationId);
        const needsMidiStart = effectiveMusic === 'midi' && PRODUCT_GAMES[gameIdForProduct(exact.productId)].musicCapabilities.midi;
        if (needsMidiStart) {
          // Output preparation uses the existing MIDI owner without adding a
          // second confirmation after fullscreen and resource acquisition.
          try {await options.prepareMidiAtLaunch?.(ownedEpoch!, preparedCurrent);} catch {}
          if (!preparedCurrent()) throw Error('多人 Runtime 准备已被替换。');
        }
        calibration.begin(ownedEpoch!, exact.productId);
        update({active: Object.freeze({productId: exact.productId, roomCode: exact.roomCode, serial: exact.serial, epoch: ownedEpoch!}), calibration: calibration.getSnapshot()});
        const launched = await runtime.launch();
        checkPublishedCancelled(signal);
        if (disposed || launched.epoch !== ownedEpoch || runtime.getSnapshot().epoch !== ownedEpoch || launched.phase !== 'running' || !launched.firstFrame) throw Error('多人 Runtime 尚未确认首帧。');
        if (options.coverUntilGameplayPath !== false && !fromTitle) {
          update({startup: 'path'});
          await waitForMultiplayerGameplayPath({runtime, request: exact, epoch: ownedEpoch!, signal,
            current: intentCurrent});
        }
      } catch (error) {
        if (intentCurrent() && isGameDataAcquisitionFailure(error)) importProof = proofKey;
        const actual = runtime.getSnapshot();
        if (!signal.aborted && !disposed && !(error instanceof Error && error.name === 'AbortError') && actual.epoch === ownedEpoch && actual.launched) {
          if (!await runtime.close()) throw Error(actual.saveError ?? runtime.getSnapshot().saveError ?? runtime.getSnapshot().closeError ?? '联机启动失败后未能返回房间。');
        }
        throw error;
      } finally {signal.removeEventListener('abort', abort); releaseStart(); update({startup: null});}
    },
    dismissCalibration() {calibration.dismiss(); update({calibration: calibration.getSnapshot()});},
    reportText() {return state.calibration.report ? JSON.stringify({...state.calibration.report, copiedAt: new Date().toISOString()}, null, 2) : null;},
    dispose() {if (disposed) return; disposed = true; importProof = null; generation++; checkRequest?.abort(); building?.abort(); building = null; if (expiry !== null) clearTimeout(expiry); expiry = null; unsubscribe(); listeners.clear(); preparedProduct = null; calibration.reset();},
  });
}
