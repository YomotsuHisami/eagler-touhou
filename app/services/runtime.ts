// Selective service extraction from the audited candidate. Main remains the
// behavioral authority; first-frame and localized fallback policy are restored
// below. No candidate UI, core replacement or test oracle is imported.
import type {Translate} from '../i18n';
import {directPreloadRuntimeUrl} from './direct-preload-runtime';
import {liveRuntimeEntryAuthorized} from './runtime-entry-authority';
import {errorText} from './error-text';
import {GameDataAcquisitionError} from './game-data-acquisition';
import {isReplayFilePath, isSafeReplayArchivePath} from '../../src/launcher/replay-files.mts';
import type {HostManifest} from '../../src/contracts/host-manifest.mts';
/**
 * Bounded current-main Runtime orchestration seam, independent of React/DOM UI.
 * The caller supplies ONE permanent direct iframe and a resolved launch plan.
 * Package acquisition, language/music selection and MIDI/focus bridges are still
 * owned by separate services; this module owns only the Runtime lifecycle.
 * No private score-slot/storage policy is introduced here: save means Runtime sync.
 */
import { HOST_PROTOCOL, PRODUCT_GAMES, isGameId, type GameId } from '../../src/contracts/product-catalog.mts';
import {
  RUNTIME_EPOCH_QUERY_PARAMETER, RUNTIME_PROTOCOL_COMMAND_BEHAVIOR,
  parseRuntimeInboundMessage, isRuntimeResponseMessage,
  type RuntimeCommandPayloads, type RuntimeProtocolCommand, type RuntimeResponseMessage,
  type RuntimeEventMessage, type RuntimeEventPayloads, type RuntimeConfigureOptions,
} from '../../src/contracts/runtime-protocol.mts';
import type { InstalledPackageGeneration } from '../../src/contracts/package-read-models.mts';
import {sha256Hex} from '../../src/launcher/sha256.mts';
import {componentFileIds} from '../../package/package-generation.mjs';
import { createRuntimeSessionOwner, type RuntimeSessionToken } from '../../src/launcher/runtime-session.mts';
import { createManagedRuntimeGenerationLease } from '../../src/launcher/runtime-generation-lease.mts';
import { managedRuntimeUrl, readManagedRuntimeData, readManagedRuntimeResource } from '../../src/launcher/runtime-preparation.mts';
import { prepareRuntimeLaunch } from '../../src/launcher/runtime-launch.mts';
import { createNetworkActivityTracker, type NetworkActivitySnapshot } from '../../src/launcher/network-activity.mts';
import { confirmRuntimeClose, type RuntimeCloseDecision } from '../../src/launcher/launcher-lifecycle.mts';
import { deliverRuntimeInput, type HostedKeySpec, type TouchRuntimeContext, type RuntimeMessageTarget } from '../../src/launcher/touch-runtime-protocol.mts';
import type {TouchLayout} from '../../src/launcher/touch-layout-model.mts';
import { retainPackageGeneration, releasePackageGeneration } from '../../package/package-store.mjs';

export interface RuntimeFilesystem {
  mkdirTree(path: string): void;
  writeFile(path: string, bytes: Uint8Array, options: { canOwn: boolean }): void;
}
export interface RuntimeWindow extends RuntimeMessageTarget {
  readonly document: object;
  readonly location: { href: string; replace(url: string): void };
  addEventListener?(type: string, listener: EventListener): void;
  removeEventListener?(type: string, listener: EventListener): void;
  FS?: RuntimeFilesystem;
  Module?: { FS?: RuntimeFilesystem; touhouMusicMode?: 'ogg' | 'midi' | 'none' };
}
/** Read-only native event surface; no filesystem or lifecycle mutation port. */
export interface RuntimeMidiEventTarget {
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: EventListener): void;
}
export interface RuntimeMidiEventContext {
  readonly epoch: number;
  readonly game: GameId;
  readonly document: object;
  readonly target: RuntimeMidiEventTarget;
  readonly music: 'ogg' | 'midi' | 'none';
}
export interface RuntimeFrame {
  readonly contentWindow: RuntimeWindow | null;
  /** Emergency cleanup is allowed only with positive evidence of DOM removal. */
  readonly isConnected?: boolean;
  addEventListener(type: 'load', listener: EventListener): void;
  removeEventListener(type: 'load', listener: EventListener): void;
}
export interface ManagedDataRequest { game: string; generation: string; epoch: number }
export interface RuntimeHost {
  location: { href: string; origin: string };
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
  removeEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
  __eaglerPrepareManagedRuntimeDataV1?: (request: ManagedDataRequest) => ReturnType<typeof readManagedRuntimeData>;
}
export interface RuntimeLauncherControls {
  readonly restartButtonEnabled: boolean;
  readonly thpracTouchControlsEnabled: boolean;
  readonly magnifierEnabled: boolean;
  readonly touchLayout: TouchLayout | null;
  /** Presentation-only alpha for the Launcher-owned touch HUD. Never sent to Runtime. */
  readonly touchControlOpacity?: number;
}
export interface RuntimeLauncherControlContext {
  readonly epoch: number;
  readonly game: GameId;
  readonly runtimeVariant: 'normal' | 'multiplayer';
  readonly options: Readonly<RuntimeConfigureOptions>;
  readonly launcherControls: Readonly<RuntimeLauncherControls>;
}
export interface RuntimePlan {
  game: GameId;
  runtimeVariant: 'normal' | 'multiplayer';
  /** Main file-only ensureRuntime(false) stops at native-ready, before configure. */
  fileOnly?: boolean;
  /** An already installed, verified Package Store generation, never mutable current lookup. */
  generation: InstalledPackageGeneration | null;
  /** Exact original hosted emscripten-preload fallback, with no Package DATA. */
  directPreloadHost?: HostManifest;
  /** Optional resources acquired after native ready; never replaces loaded DATA. */
  resourceGeneration?: InstalledPackageGeneration;
  entry: string;
  /** Must reflect the current Host Manifest's runtimeManifest capability. */
  publishedRuntime: boolean;
  /** Exact validated Host authorizing live development code, never a fallback. */
  developmentRuntimeHost?: HostManifest;
  runtimeHost?: HostManifest;
  localCatalogRuntime?: boolean;
  /** Exact current wire payload. Adonis options are passed through, never inferred. */
  configure: RuntimeCommandPayloads['configure'];
  /** Package resource IDs selected by the acquisition owner, excluding DATA/code. */
  resourceFileIds?: readonly string[];
  /** Verified managed OGG; fallback permission is attested by the acquisition
   * owner against the validated Host and successfully prepared MIDI bridge. */
  localOgg?: {fileIds: readonly string[]; fallbackToMidi: boolean};
  /** Click-time Launcher-only controls, never added to native configure wire. */
  launcherControls?: RuntimeLauncherControls;
}
export type RuntimeReadyContinuation = (epoch: number) => Promise<RuntimePlan>;
export type RuntimePhase = 'idle' | 'loading' | 'configuring' | 'prepared' | 'launching' | 'running' | 'saving' | 'exited' | 'error';
export type RuntimeRequestCommand = 'list' | 'read' | 'write' | 'remove' | 'resources' | 'retry-music';
export type RuntimeFileCommand = 'list' | 'read' | 'write' | 'remove';
/** Exclusive access to the existing prepared Runtime filesystem, never another writer. */
export interface RuntimeFileSession {
  readonly epoch: number;
  send<C extends RuntimeFileCommand>(command: C, payload: RuntimeCommandPayloads[C]): Promise<RuntimeResponseMessage>;
  sync(): Promise<void>;
  /** Retire this native owner, restore the captured plan and keep the same lock. */
  restart(options?: {sync?: boolean}): Promise<RuntimeFileSession>;
  /** Imported bytes already have native persistence acknowledgment. */
  retire(): Promise<void>;
}
export type RuntimeInputCommand = 'keyboard' | 'keyboard-clear' | 'touch-controls' | 'touch-cancel' | 'direct-touch' | 'thprac-mouse' | 'network-cancel';
export interface RuntimeSnapshot {
  readonly phase: RuntimePhase;
  readonly fileOperationBusy: boolean;
  /** Current token's authored plan role; presentation only, never an RPC bypass. */
  readonly fileOnly: boolean;
  readonly game: GameId | null;
  readonly runtimeVariant?: RuntimePlan['runtimeVariant'];
  readonly epoch: number | null;
  readonly generationId: string | null;
  readonly codeGeneration: string | null;
  readonly source: string | null;
  readonly ready: boolean;
  readonly launched: boolean;
  readonly firstFrame: boolean;
  /** Main's nonfatal diagnostic watchdog is separate from caller-requested waits. */
  readonly firstFrameTimedOut: boolean;
  /** Epoch-scoped engine dry run; never a gameplay/save session. */
  readonly multiplayerPreflight?: boolean;
  /** Launch-scoped effective choice, distinct from durable user preferences. */
  readonly music?: 'ogg' | 'midi' | 'none' | null;
  readonly musicWarning?: string | null;
  readonly spectator: boolean;
  readonly error: string | null;
  readonly saveError: string | null;
  /** The native document can no longer service sync; a retained epoch is cleanup-only. */
  readonly saveUnavailable: boolean;
  /** Failure to retire the frame, distinct from failure to persist Runtime data. */
  readonly closeError: string | null;
  readonly saveRoot: string | null;
  readonly scoreFile: string | null;
  readonly configFiles: readonly string[];
  readonly runtimeInfo: Readonly<RuntimeEventPayloads['runtime-info']>;
  /** Native Runtime report only; validating/mirroring/fixing room timing is outside this seam. */
  readonly netplayTiming: unknown;
  readonly progress: Readonly<RuntimeEventPayloads['transfer']> | null;
  readonly frameHealth: Readonly<RuntimeEventPayloads['frame-health']> | null;
  readonly audioHealth: Readonly<RuntimeEventPayloads['audio-health']> | null;
  readonly exit: Readonly<RuntimeEventPayloads['exit']> | null;
}
export interface RuntimeDependencies {
  prepareCode: typeof prepareRuntimeLaunch;
  readData: typeof readManagedRuntimeData;
  readResource: typeof readManagedRuntimeResource;
  retainGeneration: typeof retainPackageGeneration;
  releaseGeneration: typeof releasePackageGeneration;
}
type Timer = ReturnType<typeof setTimeout>;
export interface RuntimeTimers {
  setTimeout(callback: () => void, ms: number): Timer;
  clearTimeout(timer: Timer): void;
  setInterval(callback: () => void, ms: number): Timer;
  clearInterval(timer: Timer): void;
}
export interface RuntimeLocalResourceProgress {
  epoch: number;
  game: GameId;
  generationId: string;
  phase: 'initial' | 'remaining';
  loaded: number;
  total: number;
  completed: number;
  files: number;
  speed: number;
}
export interface RuntimeServiceOptions {
  translate: Translate;
  frame: RuntimeFrame;
  hostWindow?: RuntimeHost;
  /** Explicit application mount, independent of a Router's current URL. */
  baseUrl: string;
  fetchImpl?: typeof fetch;
  worker?: NonNullable<Parameters<typeof prepareRuntimeLaunch>[1]>['worker'];
  dependencies?: Partial<RuntimeDependencies>;
  timers?: RuntimeTimers;
  timeouts?: { ready?: number; configure?: number; command?: number; launch?: number; firstFrame?: number; lease?: number };
  /** Authenticated source role captured before terminal events reset the snapshot.
   * Callback metadata only; never appended to a Runtime protocol message. */
  onEvent?: (message: RuntimeEventMessage, context: Readonly<{epoch: number; fileOnly: boolean}>) => void;
  onNetworkChange?: (snapshot: NetworkActivitySnapshot) => void;
  /** Optional document-wide tracker; supplying it avoids a second fetch owner. */
  network?: ReturnType<typeof createNetworkActivityTracker>;
  onLocalResourceProgress?: (progress: RuntimeLocalResourceProgress) => void;
  onWarning?: (error: unknown) => void;
}
export class RuntimeSessionSupersededError extends Error {
  override name = 'AbortError';
  constructor() { super('EAGLER_RUNTIME_SESSION_SUPERSEDED'); }
}
export class RuntimeOperationError extends Error { errno?: number }
class LocalOggBytesError extends Error {}
const initialSnapshot = (): RuntimeSnapshot => Object.freeze({
  phase: 'idle', fileOperationBusy: false, fileOnly: false, game: null, epoch: null, generationId: null, codeGeneration: null, source: null,
  ready: false, launched: false, firstFrame: false, firstFrameTimedOut: false, spectator: false, error: null, saveError: null,
  saveUnavailable: false, closeError: null,
  saveRoot: null, scoreFile: null, configFiles: Object.freeze([]), runtimeInfo: Object.freeze({}),
  netplayTiming: null, progress: null, frameHealth: null, audioHealth: null, exit: null,
  music: null, musicWarning: null,
});
interface PendingRequest {
  token: RuntimeSessionToken;
  resolve(response: RuntimeResponseMessage): void;
  reject(error: unknown): void;
  timer: Timer;
  progress?: (mode: string, loaded: number) => void;
}
interface Waiter { token: RuntimeSessionToken; kind: 'ready' | 'first-frame'; resolve(): void; reject(error: unknown): void; timer: Timer }

export function createRuntimeService(options: RuntimeServiceOptions) {
  const host = options.hostWindow ?? window as unknown as RuntimeHost;
  const frame = options.frame;
  const baseUrl = new URL(options.baseUrl, host.location.href).href;
  const origin = new URL(baseUrl).origin;
  if (origin !== host.location.origin) throw new Error('Runtime must share the Launcher origin');
  if (host.__eaglerPrepareManagedRuntimeDataV1) throw new Error('A Runtime DATA owner is already installed');
  const timers: RuntimeTimers = options.timers ?? {
    setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: id => clearTimeout(id),
    setInterval: (fn, ms) => setInterval(fn, ms), clearInterval: id => clearInterval(id),
  };
  const deps: RuntimeDependencies = { prepareCode: prepareRuntimeLaunch, readData: readManagedRuntimeData,
    readResource: readManagedRuntimeResource, retainGeneration: retainPackageGeneration,
    releaseGeneration: releasePackageGeneration, ...options.dependencies };
  const network = options.network ?? createNetworkActivityTracker({ fetchImpl: options.fetchImpl ?? globalThis.fetch.bind(globalThis), onChange: options.onNetworkChange });
  const sessions = createRuntimeSessionOwner();
  const generations = createManagedRuntimeGenerationLease();
  const listeners = new Set<() => void>();
  const eventListeners = new Set<(message: RuntimeEventMessage) => void>();
  const pending = new Map<string, PendingRequest>();
  const waiters = new Set<Waiter>();
  let snapshot = initialSnapshot();
  let disposed = false;
  let detachedFrameLost = false;
  let terminalLossEpoch: number | null = null;
  let operation = 0;
  let requestSerial = 0;
  let lease: { id: string; timer: Timer } | null = null;
  let runtimeDocument: object | null = null;
  let preparedPlan: RuntimePlan | null = null;
  let oggExtensionTail: Promise<void> = Promise.resolve();
  let launcherControlContext: RuntimeLauncherControlContext | null = null;
  let launchRequested = false;
  interface PreflightOwner {epoch: number | null; interrupt?(): void}
  let preflight: PreflightOwner | null = null;
  let preflightEpoch: number | null = null;
  let closing: Promise<boolean> | null = null;
  let fileClosing: Promise<boolean> | null = null;
  interface FileSessionOwner { token: RuntimeSessionToken; promise: Promise<unknown>; invalidated: boolean; restarting: boolean; invalidate(): void }
  let fileSession: FileSessionOwner | null = null;
  function invalidateFileSession() { fileSession?.invalidate(); }
  let telemetry: Partial<Pick<RuntimeSnapshot, 'frameHealth' | 'audioHealth'>> | null = null;
  let telemetryTimer: Timer | null = null;
  let firstFrameWatchdog: Timer | null = null;
  function clearFirstFrameWatchdog() {
    if (firstFrameWatchdog !== null) timers.clearTimeout(firstFrameWatchdog);
    firstFrameWatchdog = null;
  }
  function armFirstFrameWatchdog(token: RuntimeSessionToken, timeout: number) {
    clearFirstFrameWatchdog();
    firstFrameWatchdog = timers.setTimeout(() => {
      firstFrameWatchdog = null;
      if (!sessions.isCurrent(token) || !snapshot.ready || snapshot.firstFrame) return;
      update({firstFrameTimedOut: true});
    }, timeout);
  }

  const warn = (error: unknown) => options.onWarning?.(error);
  function takeTelemetry() {
    if (telemetryTimer !== null) timers.clearTimeout(telemetryTimer);
    telemetryTimer = null;
    const patch = telemetry ?? {}; telemetry = null;
    return patch;
  }
  function queueHealth(patch: NonNullable<typeof telemetry>) {
    telemetry = { ...telemetry, ...patch };
    if (telemetryTimer === null) telemetryTimer = timers.setTimeout(() => update({}), 250);
  }
  function update(patch: Partial<RuntimeSnapshot>) {
    if (disposed) return;
    // Only display health is coalesced. An immediate business/protocol update
    // carries the latest health in one notification and cancels the display tick.
    snapshot = Object.freeze({ ...snapshot, ...takeTelemetry(), ...patch });
    for (const listener of listeners) listener();
  }
  function assertOwned(token: RuntimeSessionToken) {
    if (disposed || frame.isConnected === false || !sessions.isCurrent(token)) throw new RuntimeSessionSupersededError();
  }
  function assertCurrent(token: RuntimeSessionToken) {
    assertOwned(token);
    // A failed clear can retain the document and epoch solely for cleanup. Its
    // old async operations must not write DATA/resources or resume live state.
    if (snapshot.saveUnavailable) throw new RuntimeSessionSupersededError();
  }
  function rejectPending(error: unknown) {
    clearFirstFrameWatchdog();
    for (const item of pending.values()) { timers.clearTimeout(item.timer); item.reject(error); }
    pending.clear();
    for (const item of waiters) { timers.clearTimeout(item.timer); item.reject(error); }
    waiters.clear();
  }
  let resourceLease: {id: string; timer: Timer} | null = null;
  function releaseLease() {
    const previous = lease; lease = null;
    if (previous) {
      timers.clearInterval(previous.timer);
      void deps.releaseGeneration(previous.id).catch(warn);
    }
    const resources = resourceLease; resourceLease = null;
    if (resources) {timers.clearInterval(resources.timer);void deps.releaseGeneration(resources.id).catch(warn);}
  }
  function getInputContext(): TouchRuntimeContext {
    let target: RuntimeMessageTarget | null = null;
    const token = sessions.current();
    if (token && snapshot.ready) {
      try { target = runtimeIdentity(token).runtime; } catch { /* A replaced document never receives old input. */ }
    }
    return { target, targetOrigin: origin, protocol: HOST_PROTOCOL,
      game: snapshot.game ?? '', epoch: sessions.current()?.id ?? 0,
      launched: snapshot.launched, ready: snapshot.ready, spectator: snapshot.spectator };
  }
  function getLauncherControlContext(): RuntimeLauncherControlContext | null {
    const token = sessions.current();
    if (!token || !snapshot.ready || !preparedPlan || launcherControlContext?.epoch !== token.id) return null;
    try {runtimeIdentity(token); return launcherControlContext;} catch {return null;}
  }
  function getMidiEventContext(): RuntimeMidiEventContext | null {
    const token = sessions.current();
    if (!token || !snapshot.ready || !preparedPlan || preparedPlan.game !== token.game) return null;
    try {
      const identity = runtimeIdentity(token), target = identity.runtime;
      if (typeof target.addEventListener !== 'function' || typeof target.removeEventListener !== 'function') return null;
      return Object.freeze({epoch: token.id, game: token.game, document: identity.document,
        target: target as RuntimeMidiEventTarget, music: preparedPlan.configure.music});
    } catch { return null; }
  }
  function reset(phase: RuntimePhase = 'idle', error: string | null = null,
    exit: RuntimeSnapshot['exit'] = null, saveError: string | null = null, fileOwner?: FileSessionOwner): boolean {
    if (fileOwner && (fileOwner !== fileSession || fileOwner.invalidated)) throw new RuntimeSessionSupersededError();
    if (frame.isConnected === false) { disposeDetachedFrame(); return false; }
    const context = getInputContext();
    // An operation's catch may retry cleanup after a native/document loss. That
    // retry must not replace the terminal report with its incidental clear
    // failure, or interpret successful frame cleanup as acknowledgment of loss.
    const preserveTerminal = phase === 'error' && snapshot.saveUnavailable;
    if (preserveTerminal) {
      error = snapshot.error ?? error;
      exit = snapshot.exit ?? exit;
      saveError = snapshot.saveError ?? saveError;
    }
    const saveUnavailable = preserveTerminal || exit !== null || (phase === 'error' && saveError !== null);
    const hasTerminalSaveLoss = phase === 'error' && saveError !== null;
    // An exit before readiness has no save risk. It may require another frame
    // cleanup attempt, but must not require consent to a loss that never existed.
    if (hasTerminalSaveLoss) terminalLossEpoch = sessions.current()?.id ?? terminalLossEpoch;
    if (context.ready && context.target) for (const command of ['keyboard-clear', 'touch-cancel']) {
      try { deliverRuntimeInput(context, { protocol: HOST_PROTOCOL, game: context.game, epoch: context.epoch, command }); }
      catch (failure) { warn(failure); }
    }
    try {
      // Invalidate only after the replacement call succeeds. If navigation is
      // rejected, a connected game and its Package lease must remain recoverable.
      if (snapshot.source !== null) replaceFrameLocation('about:blank', sessions.current());
    } catch (failure) {
      const cleanupError = `Could not clear Runtime iframe: ${errorText(failure)}`;
      invalidateFileSession();
      rejectPending(failure);
      update({ phase: 'error', error: error ?? snapshot.error ?? cleanupError,
        closeError: cleanupError, saveError: saveError ?? snapshot.saveError,
        ...(saveUnavailable ? { ready: false, launched: false, saveUnavailable: true } : {}),
        ...(exit ? { exit } : {}) });
      warn(failure);
      return false;
    }
    if (!fileOwner) invalidateFileSession();
    operation++;
    sessions.clear(); generations.clear(); releaseLease();
    rejectPending(new RuntimeSessionSupersededError());
    runtimeDocument = null; preparedPlan = null; launchRequested = false;
    if (!hasTerminalSaveLoss) preflightEpoch = null;
    takeTelemetry(); // A display tick from an old epoch cannot repopulate reset state.
    if (!hasTerminalSaveLoss) terminalLossEpoch = null;
    snapshot = initialSnapshot(); update({ phase, error, exit, saveError,
      fileOperationBusy: fileSession !== null, saveUnavailable });
    return true;
  }
  function replaceFrameLocation(target: string, token: RuntimeSessionToken | null) {
    if (frame.isConnected === false) throw new RuntimeSessionSupersededError();
    if (token) {
      if (target === 'about:blank') assertOwned(token);
      else assertCurrent(token);
    }
    if (target !== 'about:blank') {
      const url = new URL(target);
      if (!token || !['http:', 'https:'].includes(url.protocol) || url.origin !== origin ||
          url.href !== snapshot.source || url.searchParams.get(RUNTIME_EPOCH_QUERY_PARAMETER) !== String(token.id)) {
        throw new Error('Invalid Runtime replacement navigation');
      }
    }
    const runtime = frame.contentWindow;
    if (!runtime) throw new Error('Runtime iframe browsing context is unavailable');
    // Location.replace explicitly replaces the child session-history entry.
    // src assignment/removal uses auto history handling and can add joint Back
    // steps. There is deliberately no src-write fallback if replacement fails.
    runtime.location.replace(target);
  }
  function runtimeIdentity(token: RuntimeSessionToken) {
    assertCurrent(token);
    const runtime = frame.contentWindow;
    if (!runtime) throw new RuntimeSessionSupersededError();
    try {
      const current = new URL(runtime.location.href);
      if (current.origin !== origin || current.href !== snapshot.source ||
          current.searchParams.get(RUNTIME_EPOCH_QUERY_PARAMETER) !== String(token.id) ||
          (runtimeDocument && runtime.document !== runtimeDocument)) throw new RuntimeSessionSupersededError();
      return { runtime, document: runtime.document };
    } catch { throw new RuntimeSessionSupersededError(); }
  }
  function fail(error: unknown) {
    invalidateFileSession();
    rejectPending(error);
    update({ phase: 'error', error: errorText(error), progress: null });
  }
  function waitFor(kind: Waiter['kind'], token: RuntimeSessionToken, timeout: number): Promise<void> {
    assertCurrent(token);
    if (kind === 'ready' ? snapshot.ready : snapshot.firstFrame) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const waiter: Waiter = { token, kind, resolve, reject, timer: timers.setTimeout(() => {
        waiters.delete(waiter); reject(new Error(options.translate(kind === 'first-frame' ? 'runtime.firstFrameLate' : snapshot.generationId ? 'runtime.localLoadTimeout' : 'runtime.gameLoadTimeout')));
      }, timeout) };
      waiters.add(waiter);
    });
  }
  function settle(kind: Waiter['kind']) {
    for (const waiter of waiters) if (waiter.kind === kind && sessions.isCurrent(waiter.token)) {
      waiters.delete(waiter); timers.clearTimeout(waiter.timer); waiter.resolve();
    }
  }
  function send<C extends RuntimeProtocolCommand>(command: C, payload: RuntimeCommandPayloads[C], timeout = options.timeouts?.command ?? 15_000): Promise<RuntimeResponseMessage> {
    const token = sessions.current();
    const runtime = frame.contentWindow;
    if (!token || !snapshot.ready || !runtime || disposed) return Promise.reject(new Error(options.translate('runtime.notReady')));
    try { runtimeIdentity(token); } catch (error) { return Promise.reject(error); }
    const request = `runtime-${token.id}-${++requestSerial}`;
    return new Promise((resolve, reject) => {
      const expire = () => { pending.delete(request); reject(new Error(options.translate('runtime.operationTimeout', {command}))); };
      const item: PendingRequest = { token, resolve, reject, timer: timers.setTimeout(expire, timeout) };
      if (command === 'configure') {
        const loaded = new Map<string, number>();
        item.progress = (mode, bytes) => {
          if (!Number.isFinite(bytes) || bytes <= (loaded.get(mode) ?? 0)) return;
          loaded.set(mode, bytes); timers.clearTimeout(item.timer); item.timer = timers.setTimeout(expire, timeout);
        };
      }
      pending.set(request, item);
      try {
        // Envelope fields always win, including over untyped configure payloads.
        runtime.postMessage({ ...payload, protocol: HOST_PROTOCOL, game: snapshot.game, epoch: token.id, command, request }, origin);
      } catch (error) { timers.clearTimeout(item.timer); pending.delete(request); reject(error); }
    });
  }
  const provideData: NonNullable<RuntimeHost['__eaglerPrepareManagedRuntimeDataV1']> = async request => {
    const token = sessions.current();
    if (!token || request?.epoch !== token.id) throw new RuntimeSessionSupersededError();
    const generation = generations.resolve(request);
    const before = runtimeIdentity(token);
    try {
      const result = await deps.readData(generation);
      const after = runtimeIdentity(token);
      if (after.runtime !== before.runtime || after.document !== before.document) throw new RuntimeSessionSupersededError();
      return result;
    } catch (error) {
      assertCurrent(token);
      // Surface failures directly to readiness; older shells only log rejection.
      const failure = new GameDataAcquisitionError(errorText(error), {cause: error});
      fail(failure); throw failure;
    }
  };
  function onMessage(event: MessageEvent) {
    const token = sessions.current();
    if (!token || !snapshot.game || event.origin !== origin || event.source !== frame.contentWindow) return;
    if (frame.isConnected === false) { disposeDetachedFrame(); return; }
    const message = parseRuntimeInboundMessage(event.data, snapshot.game, token.id);
    if (!message) return;
    if (snapshot.saveUnavailable) return; // A cleanup-only epoch cannot become command-ready again.
    if (snapshot.ready) {
      try { runtimeIdentity(token); }
      catch { reset('error', 'Runtime document was replaced', null, 'Runtime document was replaced; unsaved progress may be lost'); return; }
    }
    if (isRuntimeResponseMessage(message)) {
      const item = pending.get(message.request);
      if (!item || !sessions.isCurrent(item.token)) return;
      pending.delete(message.request); timers.clearTimeout(item.timer);
      if (message.ok) item.resolve(message);
      else {
        const error = new RuntimeOperationError(typeof message.error === 'string' ? message.error : options.translate('runtime.operationFailed'));
        if (Number.isInteger(message.errno)) error.errno = Number(message.errno);
        item.reject(error);
      }
      return;
    }
    if (message.event === 'thprac-session') return;
    const eventContext = Object.freeze({epoch: token.id, fileOnly: snapshot.fileOnly});
    if (message.event === 'ready' && !snapshot.ready) {
      try { runtimeDocument = runtimeIdentity(token).document; }
      catch (error) { fail(error); return; }
      update({ ready: true }); settle('ready');
    } else if (message.event === 'first-frame' && launchRequested) {
      clearFirstFrameWatchdog();
      update({ firstFrame: true, firstFrameTimedOut: false }); settle('first-frame');
    } else if (message.event === 'runtime-info') {
      const { protocol: _protocol, game: _game, epoch: _epoch, event: _event, ...info } = message;
      // Reports are partial: an Adonis timing report must not erase renderer.
      const next = { ...snapshot.runtimeInfo };
      for (const [key, value] of Object.entries(info)) if (value !== undefined) next[key] = value;
      if (typeof info.renderer !== 'string') {
        if (snapshot.runtimeInfo.renderer !== undefined) next.renderer = snapshot.runtimeInfo.renderer;
        else delete next.renderer;
      }
      update({ runtimeInfo: Object.freeze(next), ...(info.netplayTiming !== undefined ? { netplayTiming: info.netplayTiming } : {}) });
    } else if (message.event === 'transfer') {
      for (const item of pending.values()) item.progress?.(String(message.mode ?? ''), Number(message.loaded));
      update({ progress: Object.freeze({ ...message }) });
    } else if (message.event === 'frame-health') queueHealth({ frameHealth: Object.freeze({ ...message }) });
    else if (message.event === 'audio-health') queueHealth({ audioHealth: Object.freeze({ ...message }) });
    else if (message.event === 'error') {
      // Main emits a diagnostic plus runtime-error for readiness/frame waiters.
      // It is not an engine-exit event: retain the live writer and unrelated
      // save/file RPCs until their own authenticated reply or timeout.
      const error = new Error(errorText(message.error || options.translate('runtime.startFailed')));
      update({error: error.message});
      for (const waiter of [...waiters]) {
        timers.clearTimeout(waiter.timer); waiters.delete(waiter); waiter.reject(error);
      }
    }
    else if (message.event === 'exit') {
      // Runtime has already exited; no sync receiver remains, but failure must
      // not become a successful close merely because the frame was removed.
      const success = message.status === 'success' && (message.code === undefined || message.code === 0);
      const saveRisk = !success && snapshot.ready ? 'Runtime exited abnormally; unsaved progress may be lost' : null;
      reset(success ? 'exited' : 'error', success ? null : 'Runtime exited abnormally', Object.freeze({ ...message }), saveRisk);
    }
    options.onEvent?.(message, eventContext);
    // Consumers only see messages already authenticated against the current
    // frame, origin, game, epoch and document identity above.
    for (const listener of eventListeners) listener(message);
  }
  const onLoad: EventListener = () => {
    const token = sessions.current();
    if (!token || !snapshot.ready) return;
    try { runtimeIdentity(token); }
    catch { reset('error', 'Runtime document was replaced', null, 'Runtime document was replaced; unsaved progress may be lost'); }
  };
  async function retain(token: RuntimeSessionToken, generation: InstalledPackageGeneration) {
    const id = `runtime-${token.game}-${token.id}-${Math.random().toString(36).slice(2)}`;
    await deps.retainGeneration(token.game, generation.id, { leaseId: id });
    if (!sessions.isCurrent(token)) {
      await deps.releaseGeneration(id); throw new RuntimeSessionSupersededError();
    }
    generations.bind(token.game, generation);
    lease = { id, timer: timers.setInterval(() => {
      if (!sessions.isCurrent(token)) return;
      void deps.retainGeneration(token.game, generation.id, { leaseId: id }).then(() => {
        // A completed stale heartbeat must not resurrect a released lease.
        if (!sessions.isCurrent(token)) return deps.releaseGeneration(id);
      }).catch(warn);
    }, options.timeouts?.lease ?? 300_000) };
  }
  let localResourceProgress: {epoch: number; revision: string; started: number; loaded: number; completed: Set<string>} | null = null;
  function emitLocalResourceProgress(token: RuntimeSessionToken, generation: InstalledPackageGeneration, phase: 'initial' | 'remaining') {
    if (!options.onLocalResourceProgress) return;
    runtimeIdentity(token);
    if (!localResourceProgress || localResourceProgress.epoch !== token.id || localResourceProgress.revision !== generation.descriptor.revision) {
      localResourceProgress = {epoch: token.id, revision: generation.descriptor.revision, started: performance.now(), loaded: 0, completed: new Set()};
    }
    const ids = componentFileIds(generation.descriptor, 'ogg').filter(id => !!generation.files[id]?.objectId);
    const total = ids.reduce((sum, id) => sum + (Number(generation.descriptor.files[id]?.bytes) || 0), 0);
    options.onLocalResourceProgress({epoch: token.id, game: generation.game, generationId: generation.id, phase,
      loaded: localResourceProgress.loaded, total, completed: localResourceProgress.completed.size, files: ids.length,
      speed: localResourceProgress.loaded / Math.max((performance.now() - localResourceProgress.started) / 1000, 0.1)});
  }
  function noteLocalResource(token: RuntimeSessionToken, generation: InstalledPackageGeneration, id: string, bytes: number, phase: 'initial' | 'remaining') {
    if (!options.onLocalResourceProgress) return;
    if (!localResourceProgress || localResourceProgress.epoch !== token.id) emitLocalResourceProgress(token, generation, phase);
    if (localResourceProgress && !localResourceProgress.completed.has(id)) {
      localResourceProgress.loaded += bytes; localResourceProgress.completed.add(id);
    }
    emitLocalResourceProgress(token, generation, phase);
  }
  function executableResource(plan: RuntimePlan, id: string, source: string, target: string): boolean {
    return id === 'game-data' || id === plan.generation?.descriptor.runtimeRequirement?.dataFile ||
      /\.(?:html|m?js|wasm)$/i.test(source) || /\.(?:html|m?js|wasm)$/i.test(target);
  }
  async function installResources(token: RuntimeSessionToken, plan: RuntimePlan, extensionGuard?: () => void, localProgress = true) {
    const generation = plan.resourceGeneration ?? plan.generation;
    extensionGuard?.();
    if (!plan.resourceFileIds?.length) return;
    if (!generation || !plan.generation) throw new Error('Managed resources require a Package generation');
    const before = runtimeIdentity(token), fs = before.runtime.FS ?? before.runtime.Module?.FS;
    if (!fs) throw new Error(options.translate('runtime.offlineFsUnavailable'));
    let failed = false, next = 0;
    const check = () => {
      if (failed) throw new RuntimeSessionSupersededError();
      extensionGuard?.();
      const after = runtimeIdentity(token);
      if (after.runtime !== before.runtime || after.document !== before.document) throw new RuntimeSessionSupersededError();
    };
    const installOne = async (id: string) => {
      try {
        check();
        const declaration = generation.descriptor.files[id];
        if (!declaration || executableResource(plan, id, declaration.source, declaration.target)) throw new Error(`Not a managed Runtime resource: ${id}`);
        const resource = await deps.readResource(generation, id); check();
        if (!resource || resource.path !== declaration.target || (extensionGuard && resource.buffer.byteLength <= 0) ||
            (declaration.bytes != null && resource.buffer.byteLength !== Number(declaration.bytes))) throw new Error(options.translate('runtime.resourceDamaged', {path: declaration.target}));
        if (extensionGuard && declaration.sha256 && await sha256Hex(resource.buffer) !== declaration.sha256.toLowerCase()) throw new Error(options.translate('runtime.resourceDamaged', {path: declaration.target}));
        check();
        const slash = resource.path.lastIndexOf('/');
        if (slash > 0) fs.mkdirTree(resource.path.slice(0, slash));
        fs.writeFile(resource.path, new Uint8Array(resource.buffer), {canOwn: true});
        if (extensionGuard && localProgress) noteLocalResource(token, generation, id, resource.buffer.byteLength, 'remaining');
      } catch (error) {failed = true; throw error;}
    };
    if (extensionGuard && localProgress) emitLocalResourceProgress(token, generation, 'remaining');
    const worker = async () => {while (!failed && next < plan.resourceFileIds!.length) await installOne(plan.resourceFileIds![next++]);};
    await Promise.all(Array.from({length: Math.min(extensionGuard ? 2 : 1, plan.resourceFileIds.length)}, worker));
  }
  function localOggIds(plan: RuntimePlan): string[] {
    if (!plan.localOgg) return [];
    if (!plan.generation) throw new Error('Local OGG requires a Package generation');
    const generation = plan.resourceGeneration ?? plan.generation;
    const ids = [...plan.localOgg.fileIds], allowed = new Set(componentFileIds(generation.descriptor, 'ogg'));
    if (plan.configure.music !== 'ogg' || !ids.length || new Set(ids).size !== ids.length || ids.some(id => {
      const declaration = generation.descriptor.files[id], ref = generation.files[id];
      return !allowed.has(id) || generation.descriptor.base.files.includes(id) || !declaration?.target ||
        executableResource(plan, id, declaration.source, declaration.target) || !ref?.objectId || ref.revision !== declaration.revision;
    })) throw new Error(options.translate('runtime.localOggDescriptorInvalid'));
    // The validated descriptor owns target paths. Historical descriptors may
    // use custom mounts and omit byte length/hash; do not invent a new format.
    return ids;
  }
  async function installLocalOgg(token: RuntimeSessionToken, plan: RuntimePlan, ids: readonly string[]) {
    const generation = plan.resourceGeneration ?? plan.generation;
    if (!generation) throw new Error('Local OGG requires a Package generation');
    const before = runtimeIdentity(token), fs = before.runtime.FS ?? before.runtime.Module?.FS;
    if (!before.runtime.Module) throw new Error('Runtime music selection is unavailable');
    if (!fs) throw new Error(options.translate('runtime.offlineFsUnavailable'));
    let failed = false, next = 0;
    const check = () => {
      if (failed) throw new RuntimeSessionSupersededError();
      const after = runtimeIdentity(token);
      if (after.runtime !== before.runtime || after.document !== before.document) throw new RuntimeSessionSupersededError();
    };
    const installOne = async (id: string) => {
      try {
        check(); const declaration = generation.descriptor.files[id];
        let resource;
        try {resource = await deps.readResource(generation, id);}
        catch (error) {
          check();
          if (error instanceof Error && error.name === 'AbortError') throw error;
          throw new LocalOggBytesError(errorText(error), {cause: error});
        }
        check();
        if (resource && resource.path !== declaration.target) throw new Error(options.translate('runtime.localOggDescriptorInvalid'));
        if (!resource || resource.buffer.byteLength <= 0 ||
            (declaration.bytes != null && resource.buffer.byteLength !== Number(declaration.bytes)) ||
            (declaration.sha256 && await sha256Hex(resource.buffer) !== declaration.sha256.toLowerCase())) {
          check(); throw new LocalOggBytesError(options.translate('runtime.resourceDamaged', {path: declaration.target}));
        }
        // Hashing is asynchronous too: cancelled/sibling-failed reads cannot
        // write into a replaced document or revive a failed transfer.
        check();
        const slash = declaration.target.lastIndexOf('/');
        if (slash > 0) fs.mkdirTree(declaration.target.slice(0, slash));
        fs.writeFile(declaration.target, new Uint8Array(resource.buffer), {canOwn: true});
        noteLocalResource(token, generation, id, resource.buffer.byteLength, 'initial');
      } catch (error) {failed = true; throw error;}
    };
    emitLocalResourceProgress(token, generation, 'initial');
    const worker = async () => {while (!failed && next < ids.length) await installOne(ids[next++]);};
    await Promise.all(Array.from({length: Math.min(2, ids.length)}, worker));
    check(); runtimeIdentity(token).runtime.Module!.touhouMusicMode = 'ogg';
  }
  /** The only progressive OGG filesystem attachment boundary. Same-revision
   * optional bytes never replace active DATA/code generation or the save owner. */
  function extendOggResources(epoch: number, input: InstalledPackageGeneration, fileIds: readonly string[], presentation: {localProgress?: boolean} = {}): Promise<void> {
    const token = sessions.current(), original = preparedPlan;
    if (!token || token.id !== epoch || !original?.generation) return Promise.reject(new RuntimeSessionSupersededError());
    const loadedGeneration = original.generation;
    const generation = structuredClone(input), ids = [...new Set(fileIds)];
    const guard = () => {
      assertCurrent(token); runtimeIdentity(token);
      if (preparedPlan !== original || original.configure.music !== 'ogg' || closing || fileClosing || fileSession || !snapshot.launched ||
          !['running', 'launching'].includes(snapshot.phase)) throw new RuntimeSessionSupersededError();
    };
    try {
      guard();
      if (generation.game !== original.game || generation.descriptor.game !== original.game ||
          generation.descriptor.revision !== loadedGeneration.descriptor.revision) throw new Error('OGG generation revision changed');
      const originalFiles = loadedGeneration.descriptor.files;
      const same = (id: string) => ['revision', 'source', 'target', 'bytes', 'sha256'].every(key =>
        generation.descriptor.files[id]?.[key] === originalFiles[id]?.[key]);
      if (!loadedGeneration.descriptor.base.files.every(same)) throw new Error('OGG extension changed the Package base');
      const allowed = new Set(componentFileIds(loadedGeneration.descriptor, 'ogg'));
      if (!ids.length || ids.some(id => {
        const declaration = originalFiles[id], ref = generation.files[id];
        return !allowed.has(id) || !same(id) || !declaration?.target || !ref?.objectId || ref.revision !== declaration.revision ||
          loadedGeneration.descriptor.base.files.includes(id) || executableResource(original, id, declaration.source, declaration.target);
      })) throw new Error('Only unchanged descriptor OGG resources may extend this Runtime');
    } catch (error) {return Promise.reject(error);}
    const task = oggExtensionTail.then(async () => {
      guard();
      const leaseId = `ogg-${token.game}-${token.id}-${Math.random().toString(36).slice(2)}`;
      try {
        await deps.retainGeneration(token.game, generation.id, {leaseId}); guard();
        await installResources(token, {...original, generation, resourceGeneration: generation, resourceFileIds: ids}, guard, presentation.localProgress !== false); guard();
      } finally {await deps.releaseGeneration(leaseId);}
    });
    oggExtensionTail = task.catch(() => {});
    return task;
  }
  function prepare(input: RuntimePlan, signal?: AbortSignal): Promise<RuntimeSnapshot> { return prepareOwned(input, undefined, undefined, undefined, signal); }
  // Only this closure can supply a genuine held file owner; the public API has
  // no boolean/option that can bypass lifecycle exclusivity.
  async function prepareOwned(input: RuntimePlan, fileOwner?: FileSessionOwner, checkOwner?: PreflightOwner,
    onReady?: RuntimeReadyContinuation, signal?: AbortSignal): Promise<RuntimeSnapshot> {
    if (signal?.aborted) throw new RuntimeSessionSupersededError();
    if (disposed) throw new Error('Runtime service is disposed');
    if (preflight && preflight !== checkOwner) throw new Error('Wait for the multiplayer game check to finish');
    if (input.configure.options?.multiplayerPreflight && !checkOwner) throw new Error('Multiplayer preflight requires the game-check owner');
    if (frame.isConnected === false) { disposeDetachedFrame(); throw new RuntimeSessionSupersededError(); }
    if (fileOwner && (fileOwner !== fileSession || fileOwner.invalidated || !fileOwner.restarting)) throw new RuntimeSessionSupersededError();
    if (sessions.current() || closing || (fileClosing && fileOwner !== fileSession) || (fileSession && fileOwner !== fileSession)) throw new Error('Close the current Runtime before preparing another');
    if (!isGameId(input.game)) throw new Error('Invalid Runtime game');
    if (input.generation && (!input.generation.id || input.generation.game !== input.game || input.generation.descriptor.game !== input.game)) throw new Error('Invalid Runtime package generation');
    if (!input.generation) {
      directPreloadRuntimeUrl(input, baseUrl);
      if (input.resourceGeneration || input.resourceFileIds?.length || input.localOgg) throw new Error('Direct preload cannot claim managed Package resources');
    }
    if (input.runtimeVariant !== 'normal' && input.runtimeVariant !== 'multiplayer') throw new Error('Invalid Runtime variant');
    const source = new URL(input.entry, baseUrl);
    if (source.origin !== origin) throw new Error('Runtime must share the Launcher origin');
    if (input.generation && !input.publishedRuntime && !liveRuntimeEntryAuthorized(input, baseUrl)) throw new Error('Live Runtime requires canonical catalog or validated Host authority');
    // Isolate asynchronous preparation from caller mutation of the plan/config.
    let plan = structuredClone(input);
    const ticket = ++operation;
    const assertOperation = () => { if (disposed || ticket !== operation) throw new RuntimeSessionSupersededError(); };
    const product = PRODUCT_GAMES[plan.game];
    let oggIds = localOggIds(plan);
    const excluded: string[] = [];
    let token: RuntimeSessionToken | null = null;
    const abort = () => {
      if (token && sessions.isCurrent(token) && ticket === operation && !launchRequested && !closing) {
        try {cancel();} catch (error) {warn(error);}
      }
    };
    signal?.addEventListener('abort', abort, {once: true});
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        terminalLossEpoch = null;
        token = sessions.begin({ game: plan.game, runtimeVariant: plan.runtimeVariant,
          generationId: plan.generation?.id ?? null, revision: plan.generation?.descriptor.revision ?? null });
        if (checkOwner) {checkOwner.epoch = token.id; preflightEpoch = token.id;}
        update({ ...initialSnapshot(), fileOperationBusy: fileSession !== null, fileOnly: plan.fileOnly === true, phase: 'loading', game: plan.game, epoch: token.id,
          runtimeVariant: plan.runtimeVariant, multiplayerPreflight: !!checkOwner,
          generationId: plan.generation?.id ?? null, saveRoot: product.storage.saveRoot,
          scoreFile: product.storage.scoreFile, configFiles: product.storage.configFiles,
          spectator: plan.configure.options?.netplaySpectator === true });
        if (plan.generation) await retain(token, plan.generation); assertOperation(); assertCurrent(token);
        let codeGeneration: string | null = null;
        try {
          let entry = source.href;
          if (plan.generation && plan.publishedRuntime) {
            // Keep current main's complete-generation verification + idle-based
            // download helper. No replacement timeout or latest-file fallback.
            const prepared = await deps.prepareCode(entry, { baseUrl, fetchImpl: network.fetch as typeof fetch,
              exclude: excluded, worker: options.worker });
            assertOperation(); assertCurrent(token);
            entry = prepared.url; codeGeneration = prepared.generation;
          }
          const url = plan.generation ? new URL(managedRuntimeUrl(entry, plan.generation, plan.runtimeVariant, baseUrl)) : directPreloadRuntimeUrl(plan, baseUrl);
          if (url.origin !== origin) throw new Error('Runtime must share the Launcher origin');
          url.searchParams.set(RUNTIME_EPOCH_QUERY_PARAMETER, String(token.id));
          update({ source: url.href, codeGeneration });
          const ready = waitFor('ready', token, options.timeouts?.ready ?? 120_000);
          void ready.catch(() => {});
          replaceFrameLocation(url.href, token);
          await ready; assertOperation(); assertCurrent(token);
          break;
        } catch (error) {
          assertOperation(); assertCurrent(token);
          if (!codeGeneration || attempt === 2) throw error;
          excluded.push(codeGeneration);
          replaceFrameLocation('about:blank', token);
          sessions.clear(); generations.clear(); releaseLease(); rejectPending(error);
          runtimeDocument = null;
          warn(error);
        }
      }
      if (!token) throw new Error('Runtime session is unavailable');
      if (plan.fileOnly) {
        if (checkOwner || onReady) throw new Error('File-only preload cannot own gameplay preparation');
        preparedPlan = plan;
        update({phase: 'prepared', progress: null, music: null});
        return snapshot;
      }
      if (onReady) {
        assertOperation(); assertCurrent(token);
        const final = structuredClone(await onReady(token.id));
        assertOperation(); assertCurrent(token);
        if (final.game !== plan.game || final.runtimeVariant !== plan.runtimeVariant || final.entry !== plan.entry ||
            final.publishedRuntime !== plan.publishedRuntime) throw new Error('Ready continuation changed the Runtime identity');
        if (final.configure.options?.multiplayerPreflight && !checkOwner) throw new Error('Multiplayer preflight requires the game-check owner');
        const loaded = plan.generation;
        if (!loaded && final.generation) throw new Error('Ready continuation changed preload DATA ownership');
        plan = {...final, generation: loaded, resourceGeneration: final.resourceGeneration ?? final.generation ?? undefined};
      }
      if (plan.resourceGeneration) {
        const resources = plan.resourceGeneration, loaded = plan.generation;
        if (!loaded) throw new Error('Preload Runtime cannot extend managed resources');
        if (resources.game !== loaded.game || resources.descriptor.game !== loaded.game ||
            JSON.stringify(resources.descriptor) !== JSON.stringify(loaded.descriptor) ||
            loaded.descriptor.base.files.some(id => JSON.stringify(resources.files[id]) !== JSON.stringify(loaded.files[id]))) {
          throw new Error('Ready resources changed the loaded DATA or Package declaration');
        }
      }
      if (plan.resourceGeneration && plan.resourceGeneration.id !== plan.generation?.id) {
        const resources = plan.resourceGeneration;
        const id = `runtime-resources-${token.game}-${token.id}-${Math.random().toString(36).slice(2)}`;
        await deps.retainGeneration(token.game, resources.id, {leaseId: id});
        if (!sessions.isCurrent(token)) {await deps.releaseGeneration(id);throw new RuntimeSessionSupersededError();}
        const owned = token;
        resourceLease = {id, timer: timers.setInterval(() => {
          if (!sessions.isCurrent(owned)) return;
          void deps.retainGeneration(owned.game, resources.id, {leaseId: id}).then(() => {
            if (!sessions.isCurrent(owned)) return deps.releaseGeneration(id);
          }).catch(warn);
        }, options.timeouts?.lease ?? 300_000)};
      }
      oggIds = localOggIds(plan);
      // A Back decision must finish before a late resource result configures
      // or starts the native document. Successful Close invalidates this epoch.
      if (closing) await closing;
      assertOperation(); assertCurrent(token);
      update({ phase: 'configuring' });
      const wire = oggIds.length && product.musicRuntime.localOggConfigureMode === 'midi-sentinel'
        ? {...plan.configure, music: 'midi' as const} : plan.configure;
      await send('configure', wire, options.timeouts?.configure ?? 120_000);
      assertOperation(); assertCurrent(token);
      await installResources(token, {...plan, resourceFileIds: plan.resourceFileIds?.filter(id => !oggIds.includes(id))});
      assertOperation(); assertCurrent(token);
      let musicWarning: string | null = null;
      if (oggIds.length) {
        try {await installLocalOgg(token, plan, oggIds);}
        catch (error) {
          assertOperation(); assertCurrent(token); runtimeIdentity(token);
          // main uses MIDI as the native fallback sentinel even for products
          // without MIDI playback. Native installation failures share this path.
          if (!plan.localOgg?.fallbackToMidi) throw error;
          plan.configure.music = 'midi';
          plan.resourceFileIds = plan.resourceFileIds?.filter(id => !oggIds.includes(id));
          delete plan.localOgg;
          runtimeIdentity(token).runtime.Module!.touhouMusicMode = 'midi';
          musicWarning = options.translate('runtime.localOggFallbackMidi', {reason: errorText(error)});
        }
      }
      assertOperation(); assertCurrent(token);
      if (closing) await closing;
      assertOperation(); assertCurrent(token);
      preparedPlan = plan;
      const controls = structuredClone({epoch: token.id, game: plan.game, runtimeVariant: plan.runtimeVariant,
        options: plan.configure.options ?? {}, launcherControls: plan.launcherControls ?? {
          restartButtonEnabled: false, thpracTouchControlsEnabled: false, magnifierEnabled: false, touchLayout: null, touchControlOpacity: 100,
        }});
      const freeze = (value: unknown) => {if (value && typeof value === 'object') {
        for (const child of Object.values(value)) freeze(child); Object.freeze(value);
      }};
      freeze(controls); launcherControlContext = controls;
      update({ phase: 'prepared', progress: null, music: plan.configure.music, musicWarning }); return snapshot;
    } catch (error) {
      assertOperation();
      reset('error', errorText(error)); throw error;
    } finally {signal?.removeEventListener('abort', abort);}
  }
  function prepareWithReady(input: RuntimePlan, onReady: RuntimeReadyContinuation, signal?: AbortSignal) {
    return prepareOwned(input, undefined, undefined, onReady, signal);
  }
  async function launch({awaitFirstFrame = false}: {awaitFirstFrame?: boolean} = {}): Promise<RuntimeSnapshot> {
    if (frame.isConnected === false) { disposeDetachedFrame(); throw new RuntimeSessionSupersededError(); }
    const token = sessions.current();
    const plan = preparedPlan;
    if (!token || !plan || plan.fileOnly || snapshot.phase !== 'prepared' || closing || fileClosing || fileSession) throw new Error('Prepare the Runtime before launch');
    const product = PRODUCT_GAMES[plan.game];
    const directory = 'runtimeFileLayout' in product && product.runtimeFileLayout === 'directory';
    const networked = plan.configure.options?.netplayMode === 'lan';
    launchRequested = true;
    update({ phase: 'launching' });
    const presented = awaitFirstFrame ? waitFor('first-frame', token, options.timeouts?.firstFrame ?? (directory || networked ? 122_000 : 14_000)) : null;
    if (presented) void presented.catch(() => {});
    // Main app.mts4241–4289: networked launch has no local watchdog; ordinary
    // launch does not require a first-frame event to acknowledge running.
    if (networked) clearFirstFrameWatchdog();
    else armFirstFrameWatchdog(token, directory ? 122_000 : 12_000);
    try {
      await send('launch', {}, options.timeouts?.launch ?? (directory ? 120_000 : 15_000));
      assertCurrent(token);
      if (directory && !networked && !snapshot.firstFrame) armFirstFrameWatchdog(token, 12_000);
      update({ launched: true, phase: 'running' });
      if (presented) {await presented; assertCurrent(token);}
      return snapshot;
    } catch (error) {
      assertCurrent(token);
      // Main keeps an acknowledged launch alive if an optional presentation wait
      // fails; only an unacknowledged launch is reset by this event chain.
      if (!snapshot.launched) reset('error', errorText(error));
      throw error;
    }
  }
  /** Exercise the exact multiplayer engine without attaching gameplay transport.
   * Only this private operation may retire its own launched dry run without sync.
   * An aborted dependency may settle later, but prepareOwned's operation/epoch
   * fences prevent it from acquiring or replacing the next Runtime. */
  async function checkMultiplayer(input: RuntimePlan, signal: AbortSignal, onPrepared?: (prepared: RuntimeSnapshot) => void,
    onReady?: RuntimeReadyContinuation): Promise<void> {
    if (signal.aborted) throw new RuntimeSessionSupersededError();
    if (preflight || sessions.current() || closing || fileClosing || fileSession || snapshot.saveError || snapshot.closeError || snapshot.ready || snapshot.launched) {
      throw new Error('Close the current Runtime before checking a game');
    }
    const product = PRODUCT_GAMES[input.game], multiplayer = product && 'multiplayer' in product ? product.multiplayer : null;
    if (input.runtimeVariant !== 'multiplayer' || !multiplayer || input.configure.options?.replayViewer ||
        Object.entries(input.configure.options ?? {}).some(([key, value]) => key.startsWith('netplay') && value !== undefined)) {
      throw new Error('A game check requires a multiplayer plan without gameplay transport or replay');
    }
    const plan = structuredClone(input), owner: PreflightOwner = {epoch: null};
    plan.configure.options = {...plan.configure.options};
    delete plan.configure.options.multiplayerPreflight;
    if ('preflightWithoutRoom' in multiplayer) plan.configure.options.multiplayerPreflight = true;
    preflight = owner;
    let rejectAbort!: (error: Error) => void;
    const aborted = new Promise<never>((_resolve, reject) => {rejectAbort = reject;});
    const abort = () => rejectAbort(new RuntimeSessionSupersededError());
    owner.interrupt = abort;
    signal.addEventListener('abort', abort, {once: true});
    try {
      const prepared = await Promise.race([prepareOwned(plan, undefined, owner, onReady ? async epoch => {
        const final = structuredClone(await onReady(epoch));
        if (final.configure.options?.replayViewer || Object.entries(final.configure.options ?? {}).some(([key, value]) => key.startsWith('netplay') && value !== undefined)) {
          throw new Error('A game check requires a multiplayer plan without gameplay transport or replay');
        }
        final.configure.options = {...final.configure.options};
        delete final.configure.options.multiplayerPreflight;
        if ('preflightWithoutRoom' in multiplayer) final.configure.options.multiplayerPreflight = true;
        return final;
      } : undefined), aborted]);
      if (signal.aborted || prepared.epoch !== owner.epoch || snapshot.epoch !== owner.epoch) throw new RuntimeSessionSupersededError();
      onPrepared?.(prepared);
      const launched = await Promise.race([launch({awaitFirstFrame: true}), aborted]);
      if (signal.aborted || launched.epoch !== owner.epoch || snapshot.epoch !== owner.epoch || launched.phase !== 'running' || !launched.firstFrame) {
        throw new Error(options.translate('runtime.firstFrameLate'));
      }
    } finally {
      signal.removeEventListener('abort', abort);
      try {
        // Never close a successor or an unrelated retained native title. The
        // private marker also survives a terminal native loss for cleanup.
        if (owner.epoch !== null && (snapshot.epoch === owner.epoch || terminalLossEpoch === owner.epoch)) {
          if (!await close()) throw new Error(snapshot.closeError ?? 'Could not close the multiplayer game check');
        }
      } finally {if (preflight === owner) preflight = null;}
    }
    if (signal.aborted) throw new RuntimeSessionSupersededError();
  }
  async function sync() {
    if (preflightEpoch !== null) throw new Error('Game checks do not save Runtime data');
    if (fileSession) throw new Error('Wait for the Runtime file operation before saving');
    const token = sessions.current();
    if (!token || !snapshot.ready) throw new Error(options.translate('runtime.notReady'));
    await send('sync', {}, 10_000); assertCurrent(token); update({ saveError: null });
  }
  async function cancelTitleNetwork() {
    const token = sessions.current();
    if (!token || !snapshot.ready || !snapshot.launched) throw new Error(options.translate('runtime.notReady'));
    await send('network-cancel', {}); assertCurrent(token);
  }
  function request<C extends RuntimeRequestCommand>(command: C, payload: RuntimeCommandPayloads[C], timeout?: number) {
    if (!['list', 'read', 'write', 'remove', 'resources', 'retry-music'].includes(command)) {
      return Promise.reject(new Error('Lifecycle commands must use prepare, launch or sync'));
    }
    if (preflightEpoch !== null) return Promise.reject(new Error('Game-check files are owned by its Runtime preparation'));
    if (fileSession || fileClosing) return Promise.reject(new Error('Runtime file access is already in progress'));
    return send(command, payload, timeout);
  }
  /** Acquire synchronously so a same-tick Start cannot race file decoding or writes.
   * A terminal Runtime event invalidates callbacks even while local file I/O waits. */
  function withFileSession<T>(game: GameId, operation: (access: RuntimeFileSession) => Promise<T>,
    {readOnly = false, replayMutation = false, runtimeVariant, epoch}: {readOnly?: boolean; replayMutation?: boolean; runtimeVariant?: 'normal' | 'multiplayer'; epoch?: number} = {}): Promise<T> {
    const token = sessions.current();
    const readableRunning = (readOnly || replayMutation) && snapshot.phase === 'running' && snapshot.launched;
    if (!token || preflightEpoch !== null || disposed || closing || fileClosing || fileSession ||
        (!readableRunning && (launchRequested || snapshot.launched || snapshot.phase !== 'prepared')) ||
        snapshot.game !== game || !snapshot.ready || snapshot.saveUnavailable ||
        (runtimeVariant !== undefined && snapshot.runtimeVariant !== runtimeVariant) || (epoch !== undefined && token.id !== epoch)) {
      return Promise.reject(new Error('Prepare this game and stop playback before managing its files'));
    }
    let invalidate!: () => void;
    const invalidated = new Promise<never>((_resolve, reject) => {
      invalidate = () => reject(new RuntimeSessionSupersededError());
    });
    const session: FileSessionOwner = {token, invalidated: false, restarting: false,
      invalidate() {session.invalidated = true; invalidate();}, promise: Promise.resolve()};
    const assertOwner = () => {
      if (disposed || session.invalidated || fileSession !== session) throw new RuntimeSessionSupersededError();
    };
    function fileAccess(currentToken: RuntimeSessionToken): RuntimeFileSession {
      const assertAccess = () => {
        assertOwner(); assertCurrent(currentToken);
        const allowed = snapshot.phase === 'prepared' && !launchRequested && !snapshot.launched || (readOnly || replayMutation) && snapshot.phase === 'running' && snapshot.launched;
        if (session.token !== currentToken || session.restarting || !allowed) throw new RuntimeSessionSupersededError();
      };
      return Object.freeze({
        epoch: currentToken.id,
        async send<C extends RuntimeFileCommand>(command: C, payload: RuntimeCommandPayloads[C]) {
          assertAccess();
          if (!['list', 'read', 'write', 'remove'].includes(command)) throw new Error('Invalid Runtime file command');
          if (readOnly && !['list', 'read'].includes(command)) throw new Error('Read-only Runtime file sessions cannot mutate files');
          if (replayMutation && ['write', 'remove'].includes(command)) {
            const path = (payload as {path?: unknown}).path;
            if (!isReplayFilePath(path) || !isSafeReplayArchivePath(path)) throw new Error('A Replay mutation cannot change save, config or Hint files');
          }
          const response = await send(command, payload); assertAccess(); return response;
        },
        async sync() {
          assertAccess(); await send('sync', {}, 10_000); assertAccess(); update({saveError: null});
        },
        async retire() {
          assertAccess();if (readOnly) throw new Error('Read-only Runtime file sessions cannot retire the game');
          if (!reset('idle', null, null, null, session)) throw new Error(snapshot.closeError ?? 'Could not retire the imported-file Runtime');
        },
        async restart({sync: flush = true} = {}) {
          assertAccess();
          if (readOnly) throw new Error('Read-only Runtime file sessions cannot restart the game');
          const plan = preparedPlan;
          if (!plan || plan.game !== game) throw new RuntimeSessionSupersededError();
          session.restarting = true;
          // A separate Package lease bridges retirement's release and the new
          // owner's retain, including asynchronous code/resource preparation.
          const pin = `runtime-restart-${game}-${currentToken.id}-${Math.random().toString(36).slice(2)}`;
          let pinAcquired = false, pinActive = false, pinTimer: Timer | null = null;
          try {
            if (flush) await send('sync', {}, 10_000); assertOwner(); assertCurrent(currentToken);
            const pinnedGeneration = plan.generation;
            if (pinnedGeneration) {
            await deps.retainGeneration(game, pinnedGeneration.id, {leaseId: pin}); pinAcquired = true;
            assertOwner(); assertCurrent(currentToken);
            pinActive = true;
            pinTimer = timers.setInterval(() => {
              if (!pinActive) return;
              void deps.retainGeneration(game, pinnedGeneration.id, {leaseId: pin}).then(() => {
                if (!pinActive) return deps.releaseGeneration(pin);
              }).catch(warn);
            }, options.timeouts?.lease ?? 300_000);
            }
            if (!reset('idle', null, null, null, session)) throw new Error(snapshot.closeError ?? 'Could not retire Runtime for save verification');
            assertOwner();
            await prepareOwned(plan, session); assertOwner();
            const next = sessions.current();
            if (!next || next.id === currentToken.id || next.game !== game) throw new RuntimeSessionSupersededError();
            assertCurrent(next); session.token = next;
            session.restarting = false;
            return fileAccess(next);
          } finally {
            pinActive = false;
            if (pinTimer !== null) timers.clearInterval(pinTimer);
            if (pinAcquired) await deps.releaseGeneration(pin).catch(warn);
            session.restarting = false;
          }
        },
      });
    }
    const access = fileAccess(token);
    fileSession = session;
    session.promise = Promise.race([Promise.resolve().then(() => {assertOwner(); assertCurrent(token); return operation(access);}), invalidated]).finally(() => {
      if (fileSession === session) {fileSession = null; update({fileOperationBusy: false});}
    });
    update({fileOperationBusy: true});
    return session.promise as Promise<T>;
  }
  function close({ discardUnsaved = false, decide }: {
    discardUnsaved?: boolean;
    decide?: (error: unknown) => Promise<RuntimeCloseDecision>;
  } = {}): Promise<boolean> {
    if (frame.isConnected === false) { disposeDetachedFrame(); return Promise.resolve(false); }
    preflight?.interrupt?.();
    if (closing) return closing;
    if (fileClosing) return fileClosing;
    if (fileSession) {
      const continueClose = () => {fileClosing = null; return close({discardUnsaved, decide});};
      const waiting = fileSession.promise.then(continueClose, continueClose);
      fileClosing = waiting; return waiting;
    }
    if (disposed) return Promise.resolve(!detachedFrameLost && terminalLossEpoch === null);
    const token = sessions.current();
    const dryRun = preflightEpoch !== null && (token?.id === preflightEpoch || terminalLossEpoch === preflightEpoch);
    if (terminalLossEpoch !== null && !discardUnsaved && !dryRun) return Promise.resolve(false);
    const previousPhase = snapshot.phase;
    const task = (async () => {
      if (!discardUnsaved && !dryRun && token && snapshot.ready) {
        update({ phase: 'saving', saveError: null, closeError: null });
        const leave = await confirmRuntimeClose({
          runtimeReady: () => sessions.isCurrent(token) && snapshot.ready,
          sync,
          decide: async error => {
            if (sessions.isCurrent(token)) update({ saveError: errorText(error) });
            return decide ? decide(error) : 'stay';
          },
        });
        if (terminalLossEpoch === token.id) return false;
        if (!sessions.isCurrent(token)) return !detachedFrameLost;
        // An explicit Stay resolves the pending close decision, including a
        // preparation waiting behind it. A default/no-UI failure stays visible.
        if (!leave) { update({ phase: previousPhase, ...(decide ? {saveError: null} : {}) }); return false; }
      }
      if (!token || sessions.isCurrent(token)) return reset();
      return false;
    })().catch(error => {
      // A dismissed/rejected UI decision is not consent to leave and must not
      // strand the service in its transient saving state.
      if (token && sessions.isCurrent(token)) update({ phase: previousPhase, saveError: errorText(error) });
      throw error;
    }).finally(() => { if (closing === task) closing = null; });
    closing = task; return task;
  }
  function cancel() {
    if (frame.isConnected === false) { disposeDetachedFrame(); return; }
    if (launchRequested || snapshot.launched || closing || fileClosing || fileSession || terminalLossEpoch !== null) throw new Error('Save and close the current Runtime first');
    preflight?.interrupt?.();
    if (!reset()) throw new Error(snapshot.closeError ?? snapshot.saveError ?? snapshot.error ?? 'Runtime cancellation failed');
  }
  function postInput<C extends RuntimeInputCommand>(command: C,
    payload: RuntimeCommandPayloads[C] & (C extends 'keyboard' ? Partial<HostedKeySpec> : unknown)): boolean {
    const context = getInputContext();
    if (!context.ready || !context.launched || context.spectator ||
        RUNTIME_PROTOCOL_COMMAND_BEHAVIOR[command].response !== 'optional') return false;
    return deliverRuntimeInput(context, { ...payload, protocol: HOST_PROTOCOL, game: context.game, epoch: context.epoch, command });
  }
  function dispose() {
    if (disposed) return;
    if (frame.isConnected === false) { disposeDetachedFrame(); return; }
    if (terminalLossEpoch !== null) {
      if (sessions.current()) throw new Error('Acknowledge the lost Runtime and close its frame before disposal');
      finishDisposal(); return;
    }
    if (snapshot.ready || launchRequested || closing || fileSession || fileClosing) throw new Error('Close the Runtime before disposing its service');
    if (!reset()) throw new Error(snapshot.closeError ?? snapshot.saveError ?? snapshot.error ?? 'Runtime disposal failed');
    finishDisposal();
  }
  function finishDisposal() {
    disposed = true;
    host.removeEventListener('message', onMessage); frame.removeEventListener('load', onLoad);
    if (host.__eaglerPrepareManagedRuntimeDataV1 === provideData) delete host.__eaglerPrepareManagedRuntimeDataV1;
    listeners.clear();
    eventListeners.clear();
  }
  /**
   * Last-resort cleanup AFTER a DOM owner has already removed this iframe.
   * This cannot save, confirm leaving, or force-discard a connected/unknown
   * frame. Normal navigation must await close() while the frame still exists.
   */
  function disposeDetachedFrame() {
    if (disposed) return;
    if (frame.isConnected !== false) throw new Error('Detached Runtime cleanup requires an already removed iframe');
    const hadSession = sessions.current() !== null;
    const mayHaveUnsavedProgress = snapshot.ready || launchRequested;
    const failure = new Error(mayHaveUnsavedProgress
      ? 'Runtime iframe was removed before save/close; unsaved progress may be lost'
      : 'Runtime iframe was removed while its session was active');
    detachedFrameLost = hadSession;
    invalidateFileSession();
    operation++; sessions.clear(); generations.clear(); releaseLease();
    rejectPending(failure); takeTelemetry();
    runtimeDocument = null; preparedPlan = null; launchRequested = false;
    preflightEpoch = null;
    // Do not post input/sync or navigate a frame which its DOM owner destroyed.
    update({ phase: hadSession ? 'error' : snapshot.phase, ready: false, launched: false,
      epoch: null, source: null, firstFrame: false, progress: null,
      saveUnavailable: hadSession || snapshot.saveUnavailable,
      error: snapshot.error ?? (hadSession ? failure.message : null),
      saveError: mayHaveUnsavedProgress ? failure.message : snapshot.saveError });
    finishDisposal();
    if (hadSession) warn(failure);
  }
  host.__eaglerPrepareManagedRuntimeDataV1 = provideData;
  host.addEventListener('message', onMessage); frame.addEventListener('load', onLoad);
  return Object.freeze({ prepare, prepareWithReady, launch, checkMultiplayer, sync, close, cancel, dispose, disposeDetachedFrame, withFileSession, send: request, cancelTitleNetwork, postInput, getInputContext, getMidiEventContext, getLauncherControlContext, extendOggResources,
    getSnapshot: () => snapshot, getNetworkSnapshot: () => network.snapshot(),
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    subscribeEvents: (listener: (message: RuntimeEventMessage) => void) => {eventListeners.add(listener); return () => {eventListeners.delete(listener);};},
  });
}
type RuntimeServiceImplementation = ReturnType<typeof createRuntimeService>;
export type RuntimeService = Omit<RuntimeServiceImplementation, 'prepareWithReady'> & {
  /** Optional staged hook; synthetic fixtures and legacy callers use prepare(). */
  prepareWithReady?: RuntimeServiceImplementation['prepareWithReady'];
};
