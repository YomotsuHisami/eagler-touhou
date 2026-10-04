/**
 * Bounded current-main Runtime orchestration seam, independent of React/DOM UI.
 * The caller supplies ONE permanent direct iframe and a resolved launch plan.
 * Package acquisition, language/music selection and MIDI/focus bridges are still
 * caller prerequisites; this is not a replacement for app.mts or a full launcher.
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
  Module?: { FS?: RuntimeFilesystem };
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
  /** An already installed, verified Package Store generation, never mutable current lookup. */
  generation: InstalledPackageGeneration;
  entry: string;
  /** Must reflect the current Host Manifest's runtimeManifest capability. */
  publishedRuntime: boolean;
  /** Exact current wire payload. Adonis options are passed through, never inferred. */
  configure: RuntimeCommandPayloads['configure'];
  /** Package resource IDs selected by the acquisition owner, excluding DATA/code. */
  resourceFileIds?: readonly string[];
  /** Click-time Launcher-only controls, never added to native configure wire. */
  launcherControls?: RuntimeLauncherControls;
}
export type RuntimePhase = 'idle' | 'loading' | 'configuring' | 'prepared' | 'launching' | 'running' | 'saving' | 'exited' | 'error';
export type RuntimeRequestCommand = 'list' | 'read' | 'write' | 'remove' | 'resources' | 'retry-music';
export type RuntimeFileCommand = 'list' | 'read' | 'write' | 'remove';
/** Exclusive access to the existing prepared Runtime filesystem, never another writer. */
export interface RuntimeFileSession {
  readonly epoch: number;
  send<C extends RuntimeFileCommand>(command: C, payload: RuntimeCommandPayloads[C]): Promise<RuntimeResponseMessage>;
  sync(): Promise<void>;
  /** Retire this native owner, restore the captured plan and keep the same lock. */
  restart(): Promise<RuntimeFileSession>;
}
export type RuntimeInputCommand = 'keyboard' | 'keyboard-clear' | 'touch-controls' | 'touch-cancel' | 'direct-touch' | 'thprac-mouse' | 'network-cancel';
export interface RuntimeSnapshot {
  readonly phase: RuntimePhase;
  readonly fileOperationBusy: boolean;
  readonly game: GameId | null;
  readonly runtimeVariant?: RuntimePlan['runtimeVariant'];
  readonly epoch: number | null;
  readonly generationId: string | null;
  readonly codeGeneration: string | null;
  readonly source: string | null;
  readonly ready: boolean;
  readonly launched: boolean;
  readonly firstFrame: boolean;
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
export interface RuntimeServiceOptions {
  frame: RuntimeFrame;
  hostWindow?: RuntimeHost;
  /** Explicit application mount, independent of a Router's current URL. */
  baseUrl: string;
  fetchImpl?: typeof fetch;
  worker?: NonNullable<Parameters<typeof prepareRuntimeLaunch>[1]>['worker'];
  dependencies?: Partial<RuntimeDependencies>;
  timers?: RuntimeTimers;
  timeouts?: { ready?: number; configure?: number; command?: number; launch?: number; firstFrame?: number; lease?: number };
  onEvent?: (message: RuntimeEventMessage) => void;
  onNetworkChange?: (snapshot: NetworkActivitySnapshot) => void;
  onWarning?: (error: unknown) => void;
}
export class RuntimeSessionSupersededError extends Error {
  override name = 'AbortError';
  constructor() { super('EAGLER_RUNTIME_SESSION_SUPERSEDED'); }
}
export class RuntimeOperationError extends Error { errno?: number }
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
const initialSnapshot = (): RuntimeSnapshot => Object.freeze({
  phase: 'idle', fileOperationBusy: false, game: null, epoch: null, generationId: null, codeGeneration: null, source: null,
  ready: false, launched: false, firstFrame: false, spectator: false, error: null, saveError: null,
  saveUnavailable: false, closeError: null,
  saveRoot: null, scoreFile: null, configFiles: Object.freeze([]), runtimeInfo: Object.freeze({}),
  netplayTiming: null, progress: null, frameHealth: null, audioHealth: null, exit: null,
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
  const network = createNetworkActivityTracker({ fetchImpl: options.fetchImpl ?? globalThis.fetch.bind(globalThis), onChange: options.onNetworkChange });
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
  let closing: Promise<boolean> | null = null;
  let fileClosing: Promise<boolean> | null = null;
  interface FileSessionOwner { token: RuntimeSessionToken; promise: Promise<unknown>; invalidated: boolean; restarting: boolean; invalidate(): void }
  let fileSession: FileSessionOwner | null = null;
  function invalidateFileSession() { fileSession?.invalidate(); }
  let telemetry: Partial<Pick<RuntimeSnapshot, 'frameHealth' | 'audioHealth'>> | null = null;
  let telemetryTimer: Timer | null = null;

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
    for (const item of pending.values()) { timers.clearTimeout(item.timer); item.reject(error); }
    pending.clear();
    for (const item of waiters) { timers.clearTimeout(item.timer); item.reject(error); }
    waiters.clear();
  }
  function releaseLease() {
    const previous = lease; lease = null;
    if (previous) {
      timers.clearInterval(previous.timer);
      void deps.releaseGeneration(previous.id).catch(warn);
    }
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
        waiters.delete(waiter); reject(new Error(`Runtime ${kind} timed out`));
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
    if (!token || !snapshot.ready || !runtime || disposed) return Promise.reject(new Error('Runtime is not ready'));
    try { runtimeIdentity(token); } catch (error) { return Promise.reject(error); }
    const request = `runtime-${token.id}-${++requestSerial}`;
    return new Promise((resolve, reject) => {
      const expire = () => { pending.delete(request); reject(new Error(`Runtime ${command} timed out`)); };
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
      fail(error); throw error;
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
        const error = new RuntimeOperationError(typeof message.error === 'string' ? message.error : 'Runtime operation failed');
        if (Number.isInteger(message.errno)) error.errno = Number(message.errno);
        item.reject(error);
      }
      return;
    }
    if (message.event === 'thprac-session') return;
    if (message.event === 'ready' && !snapshot.ready) {
      try { runtimeDocument = runtimeIdentity(token).document; }
      catch (error) { fail(error); return; }
      update({ ready: true }); settle('ready');
    } else if (message.event === 'first-frame' && launchRequested) {
      update({ firstFrame: true }); settle('first-frame');
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
    else if (message.event === 'error') fail(new Error(errorText(message.error ?? message.message ?? 'Runtime failed')));
    else if (message.event === 'exit') {
      // Runtime has already exited; no sync receiver remains, but failure must
      // not become a successful close merely because the frame was removed.
      const success = message.status === 'success' && (message.code === undefined || message.code === 0);
      const saveRisk = !success && snapshot.ready ? 'Runtime exited abnormally; unsaved progress may be lost' : null;
      reset(success ? 'exited' : 'error', success ? null : 'Runtime exited abnormally', Object.freeze({ ...message }), saveRisk);
    }
    options.onEvent?.(message);
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
  async function installResources(token: RuntimeSessionToken, plan: RuntimePlan, extensionGuard?: () => void) {
    extensionGuard?.();
    if (!plan.resourceFileIds?.length) return;
    const before = runtimeIdentity(token);
    const fs = before.runtime.FS ?? before.runtime.Module?.FS;
    if (!fs) throw new Error('Runtime filesystem is unavailable');
    for (const id of plan.resourceFileIds) {
      const declaration = plan.generation.descriptor.files[id];
      if (!declaration || id === 'game-data' || id === plan.generation.descriptor.runtimeRequirement?.dataFile ||
          /\.(?:html|m?js|wasm|data)$/i.test(declaration.source) || /\.(?:html|m?js|wasm|data)$/i.test(declaration.target)) {
        throw new Error(`Not a managed Runtime resource: ${id}`);
      }
      const resource = await deps.readResource(plan.generation, id);
      extensionGuard?.();
      const after = runtimeIdentity(token);
      if (after.runtime !== before.runtime || after.document !== before.document) throw new RuntimeSessionSupersededError();
      if (!resource || resource.path !== declaration.target) throw new Error(`Installed resource is missing or damaged: ${id}`);
      if (extensionGuard) {
        if (!declaration.sha256 || await sha256Hex(resource.buffer) !== declaration.sha256.toLowerCase()) throw new Error(`Installed OGG integrity failure: ${id}`);
        extensionGuard();
      }
      const slash = resource.path.lastIndexOf('/');
      if (slash > 0) fs.mkdirTree(resource.path.slice(0, slash));
      fs.writeFile(resource.path, new Uint8Array(resource.buffer), { canOwn: true });
    }
  }
  /** The only progressive OGG filesystem attachment boundary. Same-revision
   * optional bytes never replace active DATA/code generation or the save owner. */
  function extendOggResources(epoch: number, input: InstalledPackageGeneration, fileIds: readonly string[]): Promise<void> {
    const token = sessions.current(), original = preparedPlan;
    if (!token || token.id !== epoch || !original) return Promise.reject(new RuntimeSessionSupersededError());
    const generation = structuredClone(input), ids = [...new Set(fileIds)];
    const guard = () => {
      assertCurrent(token); runtimeIdentity(token);
      if (preparedPlan !== original || closing || fileClosing || fileSession || !snapshot.launched ||
          !['running', 'launching'].includes(snapshot.phase)) throw new RuntimeSessionSupersededError();
    };
    try {
      guard();
      if (generation.game !== original.game || generation.descriptor.game !== original.game ||
          generation.descriptor.revision !== original.generation.descriptor.revision) throw new Error('OGG generation revision changed');
      const originalFiles = original.generation.descriptor.files;
      const same = (id: string) => ['revision', 'source', 'target', 'bytes', 'sha256'].every(key =>
        generation.descriptor.files[id]?.[key] === originalFiles[id]?.[key]);
      if (!original.generation.descriptor.base.files.every(same)) throw new Error('OGG extension changed the Package base');
      const allowed = new Set(componentFileIds(original.generation.descriptor, 'ogg'));
      const mount = PRODUCT_GAMES[original.game].package.musicMounts.ogg;
      if (!ids.length || ids.some(id => {
        const declaration = originalFiles[id], ref = generation.files[id], name = declaration?.source.split('/').at(-1);
        return !allowed.has(id) || !same(id) || !ref?.objectId || ref.revision !== declaration.revision ||
          !name || !/^[A-Za-z0-9][A-Za-z0-9._-]*\.ogg$/i.test(name) ||
          declaration.target !== `${mount}/${name}` ||
          !Number.isSafeInteger(declaration.bytes) || Number(declaration.bytes) <= 0 || !/^[a-f0-9]{64}$/i.test(declaration.sha256 ?? '');
      })) throw new Error('Only canonical unchanged OGG resources may extend this Runtime');
    } catch (error) {return Promise.reject(error);}
    const task = oggExtensionTail.then(async () => {
      guard();
      const leaseId = `ogg-${token.game}-${token.id}-${Math.random().toString(36).slice(2)}`;
      try {
        await deps.retainGeneration(token.game, generation.id, {leaseId}); guard();
        await installResources(token, {...original, generation, resourceFileIds: ids}, guard); guard();
      } finally {await deps.releaseGeneration(leaseId);}
    });
    oggExtensionTail = task.catch(() => {});
    return task;
  }
  function prepare(input: RuntimePlan): Promise<RuntimeSnapshot> { return prepareOwned(input); }
  // Only this closure can supply a genuine held file owner; the public API has
  // no boolean/option that can bypass lifecycle exclusivity.
  async function prepareOwned(input: RuntimePlan, fileOwner?: FileSessionOwner): Promise<RuntimeSnapshot> {
    if (disposed) throw new Error('Runtime service is disposed');
    if (frame.isConnected === false) { disposeDetachedFrame(); throw new RuntimeSessionSupersededError(); }
    if (fileOwner && (fileOwner !== fileSession || fileOwner.invalidated || !fileOwner.restarting)) throw new RuntimeSessionSupersededError();
    if (sessions.current() || closing || (fileClosing && fileOwner !== fileSession) || (fileSession && fileOwner !== fileSession)) throw new Error('Close the current Runtime before preparing another');
    if (!isGameId(input.game) || !input.generation?.id || input.generation.game !== input.game || input.generation.descriptor.game !== input.game) throw new Error('Invalid Runtime package generation');
    if (input.runtimeVariant !== 'normal' && input.runtimeVariant !== 'multiplayer') throw new Error('Invalid Runtime variant');
    const source = new URL(input.entry, baseUrl);
    if (source.origin !== origin) throw new Error('Runtime must share the Launcher origin');
    // Isolate asynchronous preparation from caller mutation of the plan/config.
    const plan = structuredClone(input);
    const ticket = ++operation;
    const assertOperation = () => { if (disposed || ticket !== operation) throw new RuntimeSessionSupersededError(); };
    const product = PRODUCT_GAMES[plan.game];
    const excluded: string[] = [];
    let token: RuntimeSessionToken | null = null;
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        terminalLossEpoch = null;
        token = sessions.begin({ game: plan.game, runtimeVariant: plan.runtimeVariant,
          generationId: plan.generation.id, revision: plan.generation.descriptor.revision });
        update({ ...initialSnapshot(), fileOperationBusy: fileSession !== null, phase: 'loading', game: plan.game, epoch: token.id,
          runtimeVariant: plan.runtimeVariant,
          generationId: plan.generation.id, saveRoot: product.storage.saveRoot,
          scoreFile: product.storage.scoreFile, configFiles: product.storage.configFiles,
          spectator: plan.configure.options?.netplaySpectator === true });
        await retain(token, plan.generation); assertOperation(); assertCurrent(token);
        let codeGeneration: string | null = null;
        try {
          let entry = source.href;
          if (plan.publishedRuntime) {
            // Keep current main's complete-generation verification + idle-based
            // download helper. No replacement timeout or latest-file fallback.
            const prepared = await deps.prepareCode(entry, { baseUrl, fetchImpl: network.fetch as typeof fetch,
              exclude: excluded, worker: options.worker });
            assertOperation(); assertCurrent(token);
            entry = prepared.url; codeGeneration = prepared.generation;
          }
          const url = new URL(managedRuntimeUrl(entry, plan.generation, plan.runtimeVariant, baseUrl));
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
      update({ phase: 'configuring' });
      await send('configure', plan.configure, options.timeouts?.configure ?? 120_000);
      assertOperation(); assertCurrent(token);
      await installResources(token, plan); assertOperation(); assertCurrent(token);
      preparedPlan = plan;
      const controls = structuredClone({epoch: token.id, game: plan.game, runtimeVariant: plan.runtimeVariant,
        options: plan.configure.options ?? {}, launcherControls: plan.launcherControls ?? {
          restartButtonEnabled: false, thpracTouchControlsEnabled: false, magnifierEnabled: false, touchLayout: null,
        }});
      const freeze = (value: unknown) => {if (value && typeof value === 'object') {
        for (const child of Object.values(value)) freeze(child); Object.freeze(value);
      }};
      freeze(controls); launcherControlContext = controls;
      update({ phase: 'prepared', progress: null }); return snapshot;
    } catch (error) {
      assertOperation();
      reset('error', errorText(error)); throw error;
    }
  }
  async function launch(): Promise<RuntimeSnapshot> {
    if (frame.isConnected === false) { disposeDetachedFrame(); throw new RuntimeSessionSupersededError(); }
    const token = sessions.current();
    const plan = preparedPlan;
    if (!token || !plan || snapshot.phase !== 'prepared' || closing || fileClosing || fileSession) throw new Error('Prepare the Runtime before launch');
    const product = PRODUCT_GAMES[plan.game];
    const directory = 'runtimeFileLayout' in product && product.runtimeFileLayout === 'directory';
    const networked = plan.configure.options?.netplayMode === 'lan';
    launchRequested = true;
    update({ phase: 'launching' });
    const presented = waitFor('first-frame', token, options.timeouts?.firstFrame ?? (directory || networked ? 122_000 : 14_000));
    void presented.catch(() => {});
    try {
      await send('launch', {}, options.timeouts?.launch ?? (directory ? 120_000 : 15_000));
      assertCurrent(token); update({ launched: true });
      await presented; assertCurrent(token);
      update({ phase: 'running' }); return snapshot;
    } catch (error) {
      assertCurrent(token);
      // A timed-out launch may already be executing. Keep the frame and permit
      // save/retry/explicit discard instead of silently destroying user progress.
      fail(error); throw error;
    }
  }
  async function sync() {
    if (fileSession) throw new Error('Wait for the Runtime file operation before saving');
    const token = sessions.current();
    if (!token || !snapshot.ready) throw new Error('Runtime is not ready');
    await send('sync', {}, 10_000); assertCurrent(token); update({ saveError: null });
  }
  function request<C extends RuntimeRequestCommand>(command: C, payload: RuntimeCommandPayloads[C], timeout?: number) {
    if (!['list', 'read', 'write', 'remove', 'resources', 'retry-music'].includes(command)) {
      return Promise.reject(new Error('Lifecycle commands must use prepare, launch or sync'));
    }
    if (fileSession || fileClosing) return Promise.reject(new Error('Runtime file access is already in progress'));
    return send(command, payload, timeout);
  }
  /** Acquire synchronously so a same-tick Start cannot race file decoding or writes.
   * A terminal Runtime event invalidates callbacks even while local file I/O waits. */
  function withFileSession<T>(game: GameId, operation: (access: RuntimeFileSession) => Promise<T>): Promise<T> {
    const token = sessions.current();
    if (!token || disposed || closing || fileClosing || fileSession || launchRequested || snapshot.launched ||
        snapshot.game !== game || snapshot.phase !== 'prepared' || !snapshot.ready || snapshot.saveUnavailable) {
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
        if (session.token !== currentToken || session.restarting || snapshot.phase !== 'prepared' || launchRequested || snapshot.launched) throw new RuntimeSessionSupersededError();
      };
      return Object.freeze({
        epoch: currentToken.id,
        async send<C extends RuntimeFileCommand>(command: C, payload: RuntimeCommandPayloads[C]) {
          assertAccess();
          if (!['list', 'read', 'write', 'remove'].includes(command)) throw new Error('Invalid Runtime file command');
          const response = await send(command, payload); assertAccess(); return response;
        },
        async sync() {
          assertAccess(); await send('sync', {}, 10_000); assertAccess(); update({saveError: null});
        },
        async restart() {
          assertAccess();
          const plan = preparedPlan;
          if (!plan || plan.game !== game) throw new RuntimeSessionSupersededError();
          session.restarting = true;
          // A separate Package lease bridges retirement's release and the new
          // owner's retain, including asynchronous code/resource preparation.
          const pin = `runtime-restart-${game}-${currentToken.id}-${Math.random().toString(36).slice(2)}`;
          let pinAcquired = false, pinActive = false, pinTimer: Timer | null = null;
          try {
            await send('sync', {}, 10_000); assertOwner(); assertCurrent(currentToken);
            await deps.retainGeneration(game, plan.generation.id, {leaseId: pin}); pinAcquired = true;
            assertOwner(); assertCurrent(currentToken);
            pinActive = true;
            pinTimer = timers.setInterval(() => {
              if (!pinActive) return;
              void deps.retainGeneration(game, plan.generation.id, {leaseId: pin}).then(() => {
                if (!pinActive) return deps.releaseGeneration(pin);
              }).catch(warn);
            }, options.timeouts?.lease ?? 300_000);
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
    if (closing) return closing;
    if (fileClosing) return fileClosing;
    if (fileSession) {
      const continueClose = () => {fileClosing = null; return close({discardUnsaved, decide});};
      const waiting = fileSession.promise.then(continueClose, continueClose);
      fileClosing = waiting; return waiting;
    }
    if (disposed) return Promise.resolve(!detachedFrameLost && terminalLossEpoch === null);
    const token = sessions.current();
    if (terminalLossEpoch !== null && !discardUnsaved) return Promise.resolve(false);
    const previousPhase = snapshot.phase;
    const task = (async () => {
      if (!discardUnsaved && token && snapshot.ready) {
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
        if (!leave) { update({ phase: previousPhase }); return false; }
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
  return Object.freeze({ prepare, launch, sync, close, cancel, dispose, disposeDetachedFrame, withFileSession, send: request, postInput, getInputContext, getMidiEventContext, getLauncherControlContext, extendOggResources,
    getSnapshot: () => snapshot, getNetworkSnapshot: () => network.snapshot(),
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    subscribeEvents: (listener: (message: RuntimeEventMessage) => void) => {eventListeners.add(listener); return () => {eventListeners.delete(listener);};},
  });
}
export type RuntimeService = ReturnType<typeof createRuntimeService>;
