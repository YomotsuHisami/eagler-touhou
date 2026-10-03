/**
 * React launcher's browser business boundary. Root supplies one permanent frame;
 * this service owns Runtime epochs, acquisition, protocol and save transactions.
 * It never queries UI elements, writes history, or executes legacy app.mts.
 */
import {
  HOST_PROTOCOL, PRODUCT_GAMES, gameIdForProduct, isProductId, isMultiplayerProductId,
  productEnabledForBuild, productFeatureAvailable, scoreStorageFileForGame, type GameId, type ProductId,
} from '../../src/contracts/product-catalog.mts';
import { RUNTIME_EPOCH_QUERY_PARAMETER, parseRuntimeInboundMessage, isRuntimeResponseMessage,
  type RuntimeProtocolCommand, type RuntimeConfigureOptions, type RuntimeResponseMessage,
} from '../../src/contracts/runtime-protocol.mts';
import type { InstalledPackageGeneration } from '../../src/contracts/package-read-models.mts';
import { createRuntimeSessionOwner, type RuntimeSessionToken } from '../../src/launcher/runtime-session.mts';
import { createManagedRuntimeGenerationLease } from '../../src/launcher/runtime-generation-lease.mts';
import { readManagedRuntimeData, readManagedRuntimeResource, managedRuntimeUrl } from '../../src/launcher/runtime-preparation.mts';
import { prepareRuntimeLaunch } from '../../src/launcher/runtime-launch.mts';
import { loadRemoteMetadata } from '../../src/launcher/remote-metadata.mts';
import { DEFAULT_GAME_OPTIONS, type GameOptions, type MusicMode } from '../../src/launcher/game-preferences.mts';
import { resolveEffectiveMusicMode } from '../../src/launcher/music-availability.mts';
import { thpracLocaleForLanguage } from '../../src/launcher/language-catalog.mts';
import { applyPendingScoreSave, updateActiveScoreSave } from '../../src/launcher/score-saves.mts';
import { deliverRuntimeInput, type TouchRuntimeContext } from '../../src/launcher/touch-runtime-protocol.mts';
import { createNetworkActivityTracker } from '../../src/launcher/network-activity.mts';
import { readRuntimeSavedScore } from './runtime-save-storage';
import { retainPackageGeneration, releasePackageGeneration, readCurrentPackageGeneration } from '../../package/package-store.mjs';
import { componentFileIds } from '../../package/package-generation.mjs';
import { installPublishedPackage } from '../../package/package-launcher.mjs';
import {
  acquireRuntimeGeneration, completeInitialOgg, prepareRuntimeLanguage, runtimeLanguages,
  runtimeResourceIds, sharedRuntimeResources, catalogUrl, type RuntimeMetadata, type AssetContext,
} from './runtime-assets';

export type { RuntimeMetadata } from './runtime-assets';
export type RuntimePhase = 'idle' | 'prepared' | 'preparing' | 'loading' | 'configuring' | 'launching' | 'running' | 'saving' | 'exited' | 'error';
export interface RuntimeProgress { mode: string; loaded: number; total: number; label?: string }
export interface RuntimeSnapshot {
  phase: RuntimePhase;
  intent: 'launch' | 'prepare' | null;
  productId: ProductId | null;
  game: GameId | null;
  epoch: number | null;
  source: string | null;
  ready: boolean;
  launched: boolean;
  firstFrame: boolean;
  generationId: string | null;
  saveRoot: string | null;
  scoreFile: string | null;
  storageFile: string | null;
  language: string;
  music: MusicMode;
  error: string | null;
  saveError: string | null;
  warnings: readonly string[];
  progress: RuntimeProgress | null;
  metadata: RuntimeMetadata;
  diagnostics: Readonly<Record<string, unknown>>;
  inputOptions: Readonly<GameOptions>;
  spectator: boolean;
  replayViewer: boolean;
}
export interface RuntimeLaunchRequest {
  productId: ProductId;
  language?: string;
  music?: MusicMode;
  options?: Partial<GameOptions>;
  replayViewer?: boolean;
  configureOptions?: RuntimeConfigureOptions;
  awaitFirstFrame?: boolean;
}
export interface RuntimeMidiSynth {
  send(bytes: readonly number[]): void;
  reset(): void;
  getAudioContext(): { state: string; resume(): Promise<void>; suspend(): Promise<void> };
}
interface RuntimeFS { mkdirTree(path: string): void; writeFile(path: string, bytes: Uint8Array, options?: { canOwn?: boolean }): void }
export type RuntimeWindow = Window & { FS?: RuntimeFS; Module?: { FS?: RuntimeFS; touhouMusicMode?: string; [key: string]: unknown } };
/** A structural port: actual iframe binding lives in Root, not in this service. */
export interface RuntimeFrame {
  contentWindow: Window | null;
  src: string;
  removeAttribute(name: string): void;
  addEventListener(type: 'load', listener: EventListener): void;
  removeEventListener(type: 'load', listener: EventListener): void;
}
interface DataRequest { epoch: number; game: string; generation: string }
export interface RuntimeHostWindow {
  location: { href: string; origin: string };
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
  removeEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
  __eaglerPrepareManagedRuntimeDataV1?: (request: DataRequest) => Promise<{ buffer: ArrayBuffer; bytes: number; fileId: string }>;
  WebAudioTinySynth?: new (options: { quality: number; useReverb: number; voices: number }) => RuntimeMidiSynth;
}
export class RuntimeSessionSupersededError extends Error {
  override name = 'AbortError';
  constructor() { super('Runtime session is no longer active'); }
}
export class RuntimeSaveError extends Error {
  readonly code = 'SAVE_FAILED';
  constructor(error: unknown) { super(`保存未完成，游戏仍然保留。请重试保存，或确认放弃未保存进度：${errorText(error)}`, { cause: error }); }
}
export class RuntimeOperationError extends Error { errno?: number }
export interface RuntimeDependencies {
  acquireGeneration: typeof acquireRuntimeGeneration;
  retainGeneration: typeof retainPackageGeneration;
  releaseGeneration: typeof releasePackageGeneration;
  prepareCode: typeof prepareRuntimeLaunch;
  readData: typeof readManagedRuntimeData;
  readResource: typeof readManagedRuntimeResource;
  prepareLanguage: typeof prepareRuntimeLanguage;
  completeOgg: typeof completeInitialOgg;
  applyPendingSave: typeof applyPendingScoreSave;
  updateActiveSave: typeof updateActiveScoreSave;
  readSavedScore: typeof readRuntimeSavedScore;
}
export interface RuntimeServiceOptions {
  baseUrl?: string;
  hostWindow?: RuntimeHostWindow;
  fetchImpl?: typeof fetch;
  storage?: Storage | null;
  cacheStorage?: CacheStorage;
  loadMidiSynth?: () => Promise<RuntimeMidiSynth>;
  dependencies?: Partial<RuntimeDependencies>;
  timeouts?: { ready?: number; configure?: number; launch?: number; firstFrame?: number; command?: number; lease?: number };
}
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error || 'Runtime 操作失败');
const TELEMETRY_DISPLAY_INTERVAL_MS = 250;
const isOgg = (music: MusicMode) => music === 'ogg-stream' || music === 'ogg-full';
const EMPTY_METADATA: RuntimeMetadata = Object.freeze({ hostManifest: null, releaseCatalog: null, errors: Object.freeze([]) });
export const INITIAL_RUNTIME_SNAPSHOT: RuntimeSnapshot = Object.freeze({
  phase: 'idle', intent: null, productId: null, game: null, epoch: null, source: null, ready: false, launched: false,
  firstFrame: false, generationId: null, saveRoot: null, scoreFile: null, storageFile: null,
  language: 'ja', music: 'none', error: null, saveError: null, warnings: Object.freeze([]), progress: null,
  metadata: EMPTY_METADATA, diagnostics: Object.freeze({}), inputOptions: DEFAULT_GAME_OPTIONS, spectator: false, replayViewer: false,
});
interface PendingRequest {
  token: RuntimeSessionToken;
  resolve(value: RuntimeResponseMessage): void;
  reject(error: unknown): void;
  timer: ReturnType<typeof setTimeout>;
  progress?(mode: string, loaded: number): void;
}
interface EventWaiter { token: RuntimeSessionToken; kind: 'ready' | 'first-frame'; resolve(): void; reject(error: unknown): void; timer: ReturnType<typeof setTimeout> }

export function createRuntimeService(options: RuntimeServiceOptions = {}) {
  const host = options.hostWindow ?? window as unknown as RuntimeHostWindow;
  // The application mount, not the current React route, resolves publication URLs.
  const baseUrl = new URL(options.baseUrl ?? '/', host.location.href).href;
  const origin = new URL(baseUrl).origin;
  if (origin !== host.location.origin) throw new Error('Runtime must share the Launcher origin');
  const network = createNetworkActivityTracker({ fetchImpl: options.fetchImpl ?? globalThis.fetch.bind(globalThis) });
  const fetchImpl = network.fetch as typeof fetch;
  let storage: Storage | null = options.storage ?? null;
  if (options.storage === undefined) try { storage = globalThis.localStorage; } catch { /* Private/storage-denied modes. */ }
  let cacheStorage = options.cacheStorage;
  if (!cacheStorage) try { cacheStorage = globalThis.caches; } catch { /* Cache storage can be denied. */ }
  const deps: RuntimeDependencies = {
    acquireGeneration: acquireRuntimeGeneration, retainGeneration: retainPackageGeneration,
    releaseGeneration: releasePackageGeneration, prepareCode: prepareRuntimeLaunch,
    readData: readManagedRuntimeData, readResource: readManagedRuntimeResource,
    prepareLanguage: prepareRuntimeLanguage, completeOgg: completeInitialOgg, applyPendingSave: applyPendingScoreSave,
    updateActiveSave: updateActiveScoreSave, readSavedScore: readRuntimeSavedScore,
    ...options.dependencies,
  };
  const sessions = createRuntimeSessionOwner();
  const generationLease = createManagedRuntimeGenerationLease();
  const listeners = new Set<() => void>();
  const pending = new Map<string, PendingRequest>();
  const waiters = new Set<EventWaiter>();
  let snapshot = INITIAL_RUNTIME_SNAPSHOT;
  let frame: RuntimeFrame | null = null;
  let disposed = false;
  let operation = 0;
  let requestSerial = 0;
  let controller: AbortController | null = null;
  let leaseId: string | null = null;
  let leaseTimer: ReturnType<typeof setInterval> | null = null;
  let metadataTask: Promise<RuntimeMetadata> | null = null;
  let metadataSerial = 0;
  let midi: RuntimeMidiSynth | null = null;
  let midiWindow: RuntimeWindow | null = null;
  let previousProvider: RuntimeHostWindow['__eaglerPrepareManagedRuntimeDataV1'];
  let closing: Promise<void> | null = null;
  let closeSerial = 0;
  let telemetryTimer: ReturnType<typeof setTimeout> | null = null;
  let queuedDiagnostics: Record<string, unknown> | null = null;
  let queuedProgress: RuntimeProgress | undefined;

  function takeTelemetry(): Partial<RuntimeSnapshot> {
    if (telemetryTimer !== null) clearTimeout(telemetryTimer);
    telemetryTimer = null;
    const patch: Partial<RuntimeSnapshot> = {};
    if (queuedDiagnostics) patch.diagnostics = Object.freeze({ ...snapshot.diagnostics, ...queuedDiagnostics });
    if (queuedProgress !== undefined) patch.progress = queuedProgress;
    queuedDiagnostics = null; queuedProgress = undefined;
    return patch;
  }
  function scheduleTelemetry() {
    if (disposed || telemetryTimer !== null) return;
    // Display-only coalescing. Protocol ACKs, configure inactivity deadlines,
    // readiness, input delivery, and terminal transitions stay synchronous.
    telemetryTimer = setTimeout(() => update({}), TELEMETRY_DISPLAY_INTERVAL_MS);
  }
  function queueProgress(progress: RuntimeProgress) {
    if (disposed) return;
    queuedProgress = progress; scheduleTelemetry();
  }
  function queueDiagnostic(event: string, message: unknown) {
    if (disposed) return;
    (queuedDiagnostics ??= {})[event] = message; scheduleTelemetry();
  }
  function update(patch: Partial<RuntimeSnapshot>) {
    if (disposed) return;
    // An immediate state change carries the latest telemetry in its one
    // notification and cancels the pending display tick. Reset/dispose use
    // this path too, so no old epoch can publish a delayed update afterwards.
    snapshot = Object.freeze({ ...snapshot, ...takeTelemetry(), ...patch });
    for (const listener of listeners) listener();
  }
  function warn(value: unknown) {
    const message = errorText(value);
    if (!snapshot.warnings.includes(message)) update({ warnings: Object.freeze([...snapshot.warnings, message]) });
  }
  function assertCurrent(token: RuntimeSessionToken) {
    if (disposed || !sessions.isCurrent(token)) throw new RuntimeSessionSupersededError();
  }
  function settleWaiters(kind: EventWaiter['kind']) {
    for (const waiter of waiters) if (waiter.kind === kind && sessions.isCurrent(waiter.token)) {
      waiters.delete(waiter); clearTimeout(waiter.timer); waiter.resolve();
    }
  }
  function rejectPending(error: unknown) {
    for (const item of pending.values()) { clearTimeout(item.timer); item.reject(error); }
    pending.clear();
    for (const waiter of waiters) { clearTimeout(waiter.timer); waiter.reject(error); }
    waiters.clear();
  }
  function fail(error: unknown) {
    rejectPending(error);
    update({ phase: 'error', error: errorText(error), progress: null });
  }
  function onMidi(event: Event) {
    const bytes = (event as CustomEvent<{ bytes?: unknown }>).detail?.bytes;
    if (snapshot.ready && snapshot.music !== 'none' && Array.isArray(bytes)) midi?.send(bytes.filter((value): value is number => typeof value === 'number'));
  }
  function onMidiClose() { midi?.reset(); }
  function removeMidiBridge() {
    try { midiWindow?.removeEventListener('touhou-midi', onMidi); midiWindow?.removeEventListener('touhou-midi-close', onMidiClose); } catch { /* Navigated window. */ }
    midiWindow = null;
  }
  function bindMidiBridge() {
    removeMidiBridge();
    const token = sessions.current();
    const runtime = frame?.contentWindow as RuntimeWindow | null;
    if (!token || !runtime) return;
    try {
      if (new URL(runtime.location.href).searchParams.get(RUNTIME_EPOCH_QUERY_PARAMETER) !== String(token.id)) return;
      midiWindow = runtime;
      runtime.addEventListener('touhou-midi', onMidi);
      runtime.addEventListener('touhou-midi-close', onMidiClose);
    } catch { /* Runtime must still be navigating. Ready will bind again. */ }
  }
  const onFrameLoad: EventListener = () => bindMidiBridge();
  function reset(phase: RuntimePhase = 'idle', error: string | null = null) {
    operation++;
    controller?.abort(); controller = null;
    sessions.clear(); generationLease.clear();
    rejectPending(new RuntimeSessionSupersededError());
    if (leaseTimer) clearInterval(leaseTimer); leaseTimer = null;
    const released = leaseId; leaseId = null;
    if (released) void deps.releaseGeneration(released).catch(() => {});
    removeMidiBridge(); midi?.reset();
    frame?.removeAttribute('src');
    update({ phase, intent: null, epoch: null, source: null, generationId: null, ready: false, launched: false, firstFrame: false,
      progress: null, error, saveError: null });
  }
  function waitFor(kind: EventWaiter['kind'], token: RuntimeSessionToken, timeout: number) {
    assertCurrent(token);
    if (kind === 'ready' ? snapshot.ready : snapshot.firstFrame) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      const waiter: EventWaiter = { token, kind, resolve, reject, timer: setTimeout(() => {
        waiters.delete(waiter);
        reject(new Error(kind === 'ready' ? 'Runtime 初始化超时。请检查游戏数据或重新导入游戏包' : 'Runtime 已启动但未显示首帧，请重试'));
      }, timeout) };
      waiters.add(waiter);
    });
  }
  async function send(command: RuntimeProtocolCommand, payload: Record<string, unknown> = {}, timeout = options.timeouts?.command ?? 15_000): Promise<RuntimeResponseMessage> {
    const token = sessions.current();
    const runtime = frame?.contentWindow;
    if (!token || !snapshot.ready || !runtime) throw new Error('Runtime 尚未准备就绪');
    const request = `ui-${token.id}-${++requestSerial}`;
    const response = await new Promise<RuntimeResponseMessage>((resolve, reject) => {
      const expire = () => { pending.delete(request); reject(new Error(`Runtime ${command} 操作超时`)); };
      const item: PendingRequest = { token, resolve, reject, timer: setTimeout(expire, timeout) };
      if (command === 'configure') {
        const loadedByMode = new Map<string, number>();
        item.progress = (mode, loaded) => {
          if (!Number.isFinite(loaded) || loaded <= (loadedByMode.get(mode) ?? 0)) return;
          loadedByMode.set(mode, loaded); clearTimeout(item.timer); item.timer = setTimeout(expire, timeout);
        };
      }
      pending.set(request, item);
      try { runtime.postMessage({ ...payload, protocol: HOST_PROTOCOL, game: token.game, epoch: token.id, command, request }, origin); }
      catch (error) { pending.delete(request); clearTimeout(item.timer); reject(error); }
    });
    assertCurrent(token); return response;
  }
  function getInputContext(): TouchRuntimeContext {
    const token = sessions.current();
    return { target: frame?.contentWindow || null, targetOrigin: origin, protocol: HOST_PROTOCOL, game: token?.game || '', epoch: token?.id || 0, launched: snapshot.launched, ready: snapshot.ready, spectator: snapshot.spectator };
  }
  function postInput(command: 'keyboard' | 'keyboard-clear' | 'touch-controls' | 'touch-cancel' | 'direct-touch' | 'thprac-mouse', payload: Record<string, unknown> = {}) {
    const context = getInputContext();
    if (!context.ready || !context.launched || !context.target || context.spectator) return false;
    return deliverRuntimeInput(context, { ...payload, protocol: HOST_PROTOCOL, game: context.game, epoch: context.epoch, command });
  }
  function onMessage(event: MessageEvent) {
    if (event.origin !== origin || event.source !== frame?.contentWindow) return;
    const token = sessions.current();
    if (!token) return;
    const message = parseRuntimeInboundMessage(event.data, token.game as GameId, token.id);
    if (!message) return;
    if (isRuntimeResponseMessage(message)) {
      const item = pending.get(message.request);
      if (!item || !sessions.isCurrent(item.token)) return;
      clearTimeout(item.timer); pending.delete(message.request);
      if (message.ok) item.resolve(message);
      else {
        const error = new RuntimeOperationError(errorText(message.error));
        if (Number.isInteger(message.errno)) error.errno = Number(message.errno);
        item.reject(error);
      }
      return;
    }
    switch (message.event) {
      case 'ready':
        if (snapshot.ready) return;
        update({ ready: true, saveRoot: typeof message.saveRoot === 'string' ? message.saveRoot : snapshot.saveRoot, progress: null });
        bindMidiBridge(); settleWaiters('ready'); return;
      case 'first-frame':
        if (snapshot.firstFrame) return;
        update({ firstFrame: true }); settleWaiters('first-frame'); return;
      case 'transfer': {
        const progress = { mode: String(message.mode || ''), loaded: Number(message.loaded) || 0, total: Number(message.total) || 0, label: typeof message.path === 'string' ? message.path : undefined };
        for (const item of pending.values()) item.progress?.(progress.mode, progress.loaded);
        queueProgress(progress); return;
      }
      case 'error': fail(new Error(errorText(message.error || message.message))); return;
      case 'exit': {
        const success = message.status === 'success' || message.code === 0;
        const saved = { productId: snapshot.productId, root: snapshot.saveRoot, file: snapshot.storageFile };
        reset(success ? 'exited' : 'error', success ? null : `游戏异常退出${message.code == null ? '' : ` (${message.code})`}`);
        const stoppedOperation = operation;
        if (success && saved.productId && saved.root && saved.file) void deps.readSavedScore(saved.root, saved.file).then(async bytes => {
          if (bytes && operation === stoppedOperation && !disposed) await deps.updateActiveSave(saved.productId!, bytes);
        }).catch(error => { if (operation === stoppedOperation && !disposed) warn(`游戏已退出，但存档槽备份更新失败：${errorText(error)}`); });
        return;
      }
      case 'notice': if (typeof message.message === 'string') warn(message.message); return;
      case 'music-error': case 'music-incomplete': warn(`音乐资源传输未完成 (${Number(message.failed) || 1})`); return;
      case 'music-complete': update({ progress: null }); return;
      case 'midi-fallback': warn('部分音乐暂时使用 MIDI 播放'); return;
      case 'network-request':
        update({ diagnostics: Object.freeze({ ...snapshot.diagnostics, ...queuedDiagnostics, [message.event]: message }) }); return;
      default: queueDiagnostic(message.event, message);
    }
  }
  const provideData: NonNullable<RuntimeHostWindow['__eaglerPrepareManagedRuntimeDataV1']> = async request => {
    const token = sessions.current();
    if (!token || request.epoch !== token.id) throw new RuntimeSessionSupersededError();
    const generation = generationLease.resolve(request);
    try {
      const data = await deps.readData(generation); assertCurrent(token); return data;
    } catch (error) {
      assertCurrent(token);
      fail(new Error(`本地游戏数据无法读取，请重新导入或修复：${errorText(error)}`, { cause: error }));
      throw error;
    }
  };
  function bindFrame(next: RuntimeFrame) {
    if (disposed) throw new Error('Runtime service disposed');
    if (frame && frame !== next) throw new Error('Root must keep a single stable Runtime iframe');
    if (frame === next) return;
    frame = next;
    previousProvider = host.__eaglerPrepareManagedRuntimeDataV1;
    host.__eaglerPrepareManagedRuntimeDataV1 = provideData;
    host.addEventListener('message', onMessage); frame.addEventListener('load', onFrameLoad);
  }
  async function loadMetadata(force = false): Promise<RuntimeMetadata> {
    if (metadataTask && !force) return metadataTask;
    const serial = ++metadataSerial;
    const task = (async () => {
      const result = await loadRemoteMetadata(async file => {
        const abort = new AbortController();
        const timer = setTimeout(() => abort.abort(), 15_000);
        try {
          const response = await fetchImpl(new URL(file, baseUrl), { cache: 'no-store', signal: abort.signal });
          if (!response.ok) throw new Error(`${file}: HTTP ${response.status}`);
          return await response.json();
        } finally { clearTimeout(timer); }
      });
      const metadata: RuntimeMetadata = Object.freeze({
        hostManifest: result.hostManifest.ok ? result.hostManifest.value : null,
        releaseCatalog: result.releaseCatalog.ok ? result.releaseCatalog.value : null,
        errors: Object.freeze([result.hostManifest, result.releaseCatalog].flatMap(item => item.ok ? [] : [errorText(item.error)])),
      });
      if (metadataSerial === serial) update({ metadata });
      return metadata;
    })();
    metadataTask = task;
    return task;
  }
  async function retain(token: RuntimeSessionToken, generation: InstalledPackageGeneration) {
    const id = `runtime-${token.game}-${token.id}-${Math.random().toString(36).slice(2)}`;
    await deps.retainGeneration(token.game, generation.id, { leaseId: id });
    if (!sessions.isCurrent(token)) { await deps.releaseGeneration(id); throw new RuntimeSessionSupersededError(); }
    leaseId = id;
    generationLease.bind(token.game, generation);
    leaseTimer = setInterval(() => {
      if (!sessions.isCurrent(token)) return;
      void deps.retainGeneration(token.game, generation.id, { leaseId: id }).then(async () => {
        if (!sessions.isCurrent(token)) await deps.releaseGeneration(id);
      }).catch(error => { if (sessions.isCurrent(token)) warn(`无法续期游戏包保护：${errorText(error)}`); });
    }, options.timeouts?.lease ?? 5 * 60_000);
  }
  async function installFiles(token: RuntimeSessionToken, generation: InstalledPackageGeneration, ids: readonly string[]) {
    if (!ids.length) return;
    assertCurrent(token);
    const runtime = frame?.contentWindow as RuntimeWindow | null;
    const documentIdentity = runtime?.document;
    const fs = runtime?.FS || runtime?.Module?.FS;
    if (!runtime || !documentIdentity || !fs) throw new Error('Runtime 文件系统不可用');
    for (const id of ids) {
      const resource = await deps.readResource(generation, id);
      assertCurrent(token);
      // WindowProxy survives navigation. Document and epoch must also match.
      if (frame?.contentWindow !== runtime || runtime.document !== documentIdentity ||
          new URL(runtime.location.href).searchParams.get(RUNTIME_EPOCH_QUERY_PARAMETER) !== String(token.id)) throw new RuntimeSessionSupersededError();
      if (!resource || resource.path !== generation.descriptor.files[id]?.target) throw new Error(`本地资源缺失或损坏：${id}`);
      const slash = resource.path.lastIndexOf('/');
      if (slash > 0) fs.mkdirTree(resource.path.slice(0, slash));
      fs.writeFile(resource.path, new Uint8Array(resource.buffer), { canOwn: true });
    }
  }
  async function prepareMidi(token: RuntimeSessionToken) {
    if (!midi) {
      let prepared: RuntimeMidiSynth;
      if (options.loadMidiSynth) prepared = await options.loadMidiSynth();
      else if (host.WebAudioTinySynth) prepared = new host.WebAudioTinySynth({ quality: 1, useReverb: 1, voices: 64 });
      else throw new Error('MIDI 合成器不可用');
      if (!sessions.isCurrent(token)) { prepared.reset(); throw new RuntimeSessionSupersededError(); }
      midi = prepared;
    }
    assertCurrent(token);
    const context = midi.getAudioContext();
    if (context.state === 'suspended') await context.resume();
    assertCurrent(token);
    bindMidiBridge();
  }
  async function launch(input: RuntimeLaunchRequest, prepareOnly = false): Promise<RuntimeSnapshot> {
    if (!frame) throw new Error('Runtime iframe has not been bound by Root');
    if (snapshot.launched || closing) throw new Error('请先保存并关闭当前游戏');
    if (!isProductId(input.productId)) throw new Error('未知游戏');
    reset();
    const ticket = operation;
    const assertOperation = () => { if (ticket !== operation || disposed) throw new RuntimeSessionSupersededError(); };
    controller = new AbortController();
    const abort = controller;
    const game = gameIdForProduct(input.productId);
    const product = PRODUCT_GAMES[game];
    const variant = isMultiplayerProductId(input.productId) ? 'multiplayer' : 'normal';
    const config = { ...DEFAULT_GAME_OPTIONS, ...input.options };
    let token: RuntimeSessionToken | null = null;
    update({ phase: 'preparing', intent: prepareOnly ? 'prepare' : 'launch', productId: input.productId, game, error: null, warnings: Object.freeze([]), diagnostics: Object.freeze({}),
      language: input.language || 'ja', music: input.music || 'ogg-stream', saveRoot: product.storage.saveRoot,
      scoreFile: product.storage.scoreFile, storageFile: product.storage.scoreFile, inputOptions: Object.freeze({ ...config }),
      spectator: input.configureOptions?.netplaySpectator === true, replayViewer: input.replayViewer === true });
    try {
      const metadata = await loadMetadata(); assertOperation();
      if (!productEnabledForBuild(input.productId, metadata.hostManifest?.shared.testBuild === true)) throw new Error('该游戏未在当前版本开放');
      const hosted = metadata.hostManifest?.games[game];
      if (variant === 'multiplayer' && !prepareOnly && !input.replayViewer && !input.configureOptions?.netplayMode && !input.configureOptions?.multiplayerPreflight) {
        throw new Error('联机启动需要已验证的房间配置');
      }
      const context: AssetContext = { game, metadata, baseUrl, fetchImpl, signal: abort.signal, storage, cacheStorage, assertCurrent: assertOperation,
        progress: progress => { assertOperation(); queueProgress(progress); } };
      let generation = await deps.acquireGeneration(context, isOgg(input.music || 'ogg-stream')); assertOperation();
      let music = resolveEffectiveMusicMode({ requested: input.music || 'ogg-stream', explicit: input.music !== undefined,
        audio: true, midiAvailable: product.musicCapabilities.midi && hosted?.music.midi.supported !== false,
        importServer: metadata.hostManifest?.shared.resourceMode === 'import', remoteOggAdvertised: !!hosted?.music.ogg,
        remoteRevision: metadata.releaseCatalog?.games[game]?.revision,
        installed: generation ? { revision: generation.descriptor.revision, oggFileIds: componentFileIds(generation.descriptor, 'ogg'), files: generation.files } : null });
      if (generation && isOgg(music)) {
        try { generation = await deps.completeOgg(context, generation); assertOperation(); }
        catch (error) { assertOperation(); music = product.musicCapabilities.midi ? 'midi' : 'none'; warn(`开场音乐不可用，本次使用 ${music}：${errorText(error)}`); }
      }
      const sourceEntry = variant === 'multiplayer'
        ? hosted?.multiplayerRuntime || ('multiplayerRuntime' in product ? product.multiplayerRuntime : null)
        : hosted?.runtime || product.runtime;
      if (!sourceEntry) throw new Error('该游戏的 Runtime 不可用');
      const excluded: string[] = [];
      // Only complete immutable code generations may be retried before ready.
      for (let attempt = 0; attempt < 3; attempt++) {
        token = sessions.begin({ game, runtimeVariant: variant, generationId: generation?.id || null, revision: generation?.descriptor.revision || null });
        update({ epoch: token.id, generationId: generation?.id || null, phase: 'loading', ready: false });
        if (generation) await retain(token, generation);
        assertOperation(); assertCurrent(token);
        let codeGeneration: string | null = null;
        try {
          let entry = sourceEntry;
          if (metadata.hostManifest?.shared.runtimeManifest) {
            const prepared = await deps.prepareCode(sourceEntry, { baseUrl, fetchImpl, exclude: excluded });
            assertOperation(); assertCurrent(token); entry = prepared.url; codeGeneration = prepared.generation;
          }
          const source = new URL(generation ? managedRuntimeUrl(entry, generation, variant, baseUrl) : entry, baseUrl);
          if (source.origin !== origin) throw new Error('Runtime 必须与 Launcher 同源');
          source.searchParams.set('hosted', '1'); source.searchParams.set('runtimeVariant', variant);
          source.searchParams.set(RUNTIME_EPOCH_QUERY_PARAMETER, String(token.id));
          if (!generation && hosted?.gameData.version) source.searchParams.set('asset', hosted.gameData.version);
          if (hosted?.music.ogg?.version) source.searchParams.set('oggAsset', hosted.music.ogg.version);
          const ready = waitFor('ready', token, options.timeouts?.ready ?? 120_000);
          update({ source: source.href }); frame.src = source.href;
          await ready; assertOperation(); assertCurrent(token); break;
        } catch (error) {
          assertOperation(); assertCurrent(token);
          if (!codeGeneration || attempt === 2) throw error;
          excluded.push(codeGeneration);
          rejectPending(error); sessions.clear(); generationLease.clear();
          if (leaseTimer) clearInterval(leaseTimer); leaseTimer = null;
          if (leaseId) { const id = leaseId; leaseId = null; await deps.releaseGeneration(id); assertOperation(); }
          frame.removeAttribute('src');
          warn(`Runtime 启动失败，正在尝试完整的上一版本：${errorText(error)}`);
        }
      }
      if (!token) throw new Error('Runtime session missing');
      const session = token;
      context.assertCurrent = () => { assertOperation(); assertCurrent(session); };
      let language = input.language || 'ja';
      let runtimePack: Awaited<ReturnType<typeof prepareRuntimeLanguage>> = null;
      try { runtimePack = await deps.prepareLanguage(context, language, generation, storage, cacheStorage); }
      catch (error) { context.assertCurrent(); language = 'ja'; warn(`语言包不可用，本次使用日语：${errorText(error)}`); }
      context.assertCurrent();
      if (music === 'midi' || (isOgg(music) && product.musicCapabilities.midi)) {
        try { await prepareMidi(session); }
        catch (error) { context.assertCurrent(); warn(error); if (music === 'midi') music = 'none'; }
      }
      const thprac = variant === 'normal' && config.thpracEnabled && productFeatureAvailable(game, 'thprac', hosted?.features);
      const shared = sharedRuntimeResources(hosted, metadata.hostManifest, game, generation, language, thprac, baseUrl);
      const localOggIds = generation && isOgg(music) ? componentFileIds(generation.descriptor, 'ogg').filter(id => generation?.files[id]?.objectId) : [];
      const remoteMusic = !generation && isOgg(music) && hosted?.music.ogg ? hosted.music.ogg.files.map((name, index) => {
        const pack = hosted.music.ogg!;
        const url = new URL(name, new URL(typeof pack.base === 'string' ? pack.base : './', baseUrl));
        url.searchParams.set('v', pack.version);
        return { url: url.href, path: `${typeof pack.mount === 'string' ? pack.mount : '/bgm-ogg'}/${name}`, size: pack.sizes[index] || 0 };
      }) : [];
      const runtimeOptions: RuntimeConfigureOptions = {
        limitPresentationTo60: config.frameLimit60Enabled, touchEnabled: config.touchEnabled,
        touchMovementMode: config.touchMovementMode, touchSensitivity: config.touchSensitivity,
        touchFocusMode: config.touchFocusMode, doubleTapBombEnabled: config.doubleTapBombEnabled, alwaysHitbox: config.alwaysHitbox,
        oggDecodeMode: music === 'ogg-full' ? 'full' : 'stream',
        ...(variant === 'normal' && productFeatureAvailable(game, 'thprac', hosted?.features) ? { thpracEnabled: thprac, thpracLocale: thpracLocaleForLanguage(language) } : {}),
        ...(productFeatureAvailable(game, 'focusHitbox', hosted?.features) ? { focusHitboxEnabled: config.focusHitboxEnabled } : {}),
        ...(variant === 'multiplayer' ? { multiplayerLocalPlayerVisibility: config.multiplayerLocalPlayerVisibility, ...(input.replayViewer ? { replayViewer: true } : {}) } : {}),
        ...input.configureOptions,
        ...(prepareOnly && variant === 'multiplayer' ? { multiplayerPreflight: true } : {}),
      };
      if (input.replayViewer) for (const key of Object.keys(runtimeOptions)) if (key.startsWith('netplay')) delete (runtimeOptions as Record<string, unknown>)[key];
      const inputOptions: Readonly<GameOptions> = Object.freeze({
        ...config,
        thpracEnabled: runtimeOptions.thpracEnabled === true,
        frameLimit60Enabled: runtimeOptions.limitPresentationTo60 ?? config.frameLimit60Enabled,
        touchEnabled: runtimeOptions.touchEnabled ?? config.touchEnabled,
        touchMovementMode: runtimeOptions.touchMovementMode ?? config.touchMovementMode,
        touchSensitivity: runtimeOptions.touchSensitivity ?? config.touchSensitivity,
        touchFocusMode: runtimeOptions.touchFocusMode ?? config.touchFocusMode,
        doubleTapBombEnabled: runtimeOptions.doubleTapBombEnabled ?? config.doubleTapBombEnabled,
        alwaysHitbox: runtimeOptions.alwaysHitbox ?? config.alwaysHitbox,
        focusHitboxEnabled: runtimeOptions.focusHitboxEnabled === true,
        multiplayerLocalPlayerVisibility: runtimeOptions.multiplayerLocalPlayerVisibility === true,
      });
      update({ phase: 'configuring', language, music, inputOptions,
        spectator: runtimeOptions.netplaySpectator === true, replayViewer: runtimeOptions.replayViewer === true,
        storageFile: scoreStorageFileForGame(game, language) });
      await send('configure', { language, music: localOggIds.length && product.musicRuntime.localOggConfigureMode === 'midi-sentinel' ? 'midi' : isOgg(music) ? 'ogg' : music,
        resources: remoteMusic, runtimeResources: [], sharedResources: shared, runtimePack, options: runtimeOptions }, options.timeouts?.configure ?? 120_000);
      context.assertCurrent();
      if (generation) await installFiles(session, generation, runtimeResourceIds(generation));
      context.assertCurrent();
      if (generation && localOggIds.length) {
        try {
          await installFiles(session, generation, localOggIds.slice(0, 2)); context.assertCurrent();
          const runtime = frame.contentWindow as RuntimeWindow | null;
          if (runtime?.Module) runtime.Module.touhouMusicMode = 'ogg';
        } catch (error) {
          context.assertCurrent(); music = product.musicCapabilities.midi && midi ? 'midi' : 'none';
          const runtime = frame.contentWindow as RuntimeWindow | null;
          if (runtime?.Module) runtime.Module.touhouMusicMode = music;
          update({ music }); warn(`本地音乐损坏，本次使用 ${music}：${errorText(error)}`);
        }
      }
      if (prepareOnly) { update({ phase: 'prepared', progress: null }); return snapshot; }
      await deps.applyPendingSave(input.productId, {
        read: async () => { context.assertCurrent(); try { const response = await send('read', { path: product.storage.scoreFile }); context.assertCurrent(); return responseBytes(response); } catch (error) { context.assertCurrent(); if (error instanceof RuntimeOperationError && error.errno === 44) return null; throw error; } },
        write: async bytes => { context.assertCurrent(); await send('write', { path: product.storage.scoreFile, bytes: Array.from(bytes) }); context.assertCurrent(); },
        sync: async () => { context.assertCurrent(); await send('sync'); context.assertCurrent(); },
      });
      context.assertCurrent(); update({ phase: 'launching' });
      const directory = 'runtimeFileLayout' in product && product.runtimeFileLayout === 'directory';
      const firstFrame = input.awaitFirstFrame === false ? null : waitFor('first-frame', session, options.timeouts?.firstFrame ?? (directory ? 125_000 : 32_000));
      if (firstFrame) void firstFrame.catch(() => {});
      await send('launch', {}, options.timeouts?.launch ?? (directory ? 120_000 : 15_000));
      context.assertCurrent(); update({ phase: 'running', launched: true, progress: null });
      if (generation && isOgg(music)) void installRemainingOgg(context, session, generation).catch(error => { if (sessions.isCurrent(session)) warn(`后台音乐加载中断：${errorText(error)}`); });
      if (firstFrame) await firstFrame;
      context.assertCurrent(); return snapshot;
    } catch (error) {
      assertOperation();
      if (!snapshot.launched) reset('error', errorText(error)); else fail(error);
      throw error;
    }
  }
  async function installRemainingOgg(context: AssetContext, token: RuntimeSessionToken, original: InstalledPackageGeneration) {
    let generation = original;
    for (const fileId of componentFileIds(original.descriptor, 'ogg').slice(2)) {
      context.assertCurrent();
      if (!generation.files[fileId]?.objectId) {
        const catalog = context.metadata.releaseCatalog;
        if (context.metadata.hostManifest?.shared.resourceMode === 'import' || catalog?.games[context.game]?.revision !== original.descriptor.revision) return;
        const result = await installPublishedPackage(context.game, { catalog, catalogUrl: catalogUrl(baseUrl), addFileIds: [fileId], preserveLocalSource: true, fetchImpl, signal: context.signal });
        context.assertCurrent();
        if (result.generation.descriptor.revision !== original.descriptor.revision) throw new Error('后台更新版本变化，下一次启动将使用新版本');
        generation = result.generation;
      }
      await installFiles(token, generation, [fileId]); context.assertCurrent();
    }
  }
  async function sync() {
    const token = sessions.current();
    if (!token || !snapshot.ready) return;
    await send('sync', {}, 10_000); assertCurrent(token);
    const productId = snapshot.productId;
    if (productId && snapshot.scoreFile) {
      try { const bytes = responseBytes(await send('read', { path: snapshot.scoreFile })); assertCurrent(token); await deps.updateActiveSave(productId, bytes); assertCurrent(token); }
      catch (error) { assertCurrent(token); if (!(error instanceof RuntimeOperationError && error.errno === 44)) warn(`游戏已保存，但存档槽备份更新失败：${errorText(error)}`); }
    }
    update({ saveError: null });
  }
  function close({ discardUnsaved = false }: { discardUnsaved?: boolean } = {}): Promise<void> {
    if (closing) return closing;
    const ticket = ++closeSerial;
    const token = sessions.current();
    const previousPhase = snapshot.phase;
    const task = (async () => {
      if (!discardUnsaved && token && snapshot.ready) {
        update({ phase: 'saving', saveError: null });
        try { await sync(); }
        catch (error) {
          if (!sessions.isCurrent(token)) return;
          const failure = new RuntimeSaveError(error);
          update({ phase: previousPhase, saveError: failure.message }); throw failure;
        }
      }
      if (token && !sessions.isCurrent(token)) return;
      reset();
    })().finally(() => { if (closeSerial === ticket) closing = null; });
    closing = task; return task;
  }
  function cancel() {
    if (snapshot.launched) throw new Error('运行中的游戏需要先保存并关闭');
    reset();
  }
  function dispose() {
    if (disposed) return;
    reset();
    if (frame) { host.removeEventListener('message', onMessage); frame.removeEventListener('load', onFrameLoad); }
    if (host.__eaglerPrepareManagedRuntimeDataV1 === provideData) {
      if (previousProvider) host.__eaglerPrepareManagedRuntimeDataV1 = previousProvider;
      else delete host.__eaglerPrepareManagedRuntimeDataV1;
    }
    frame = null; disposed = true; listeners.clear();
  }
  return Object.freeze({
    bindFrame, getSnapshot: () => snapshot, subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    loadMetadata, launch: (request: RuntimeLaunchRequest) => launch(request), prepare: (request: RuntimeLaunchRequest) => launch(request, true), close, sync, cancel, dispose, send, postInput, getInputContext,
    list: () => send('list'),
    read: async (path: string) => responseBytes(await send('read', { path })),
    write: (path: string, bytes: Uint8Array) => send('write', { path, bytes: Array.from(bytes) }),
    remove: (path: string) => send('remove', { path }),
    languages: async (productId: ProductId) => {
      const game = gameIdForProduct(productId);
      const [metadata, current] = await Promise.all([loadMetadata(), readCurrentPackageGeneration(game)]);
      return runtimeLanguages({ game, metadata }, current.generation, storage);
    },
  });
}
function responseBytes(response: RuntimeResponseMessage): Uint8Array {
  if (response.bytes instanceof Uint8Array) return new Uint8Array(response.bytes);
  if (response.bytes instanceof ArrayBuffer) return new Uint8Array(response.bytes.slice(0));
  if (!Array.isArray(response.bytes) || response.bytes.some(byte => !Number.isInteger(byte) || byte < 0 || byte > 255)) throw new Error('Runtime 返回了无效文件数据');
  return Uint8Array.from(response.bytes);
}
export type RuntimeService = ReturnType<typeof createRuntimeService>;
