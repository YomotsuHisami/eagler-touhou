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
  type RuntimeEventMessage, type RuntimeEventPayloads,
} from '../../src/contracts/runtime-protocol.mts';
import type { InstalledPackageGeneration } from '../../src/contracts/package-read-models.mts';
import { createRuntimeSessionOwner, type RuntimeSessionToken } from '../../src/launcher/runtime-session.mts';
import { createManagedRuntimeGenerationLease } from '../../src/launcher/runtime-generation-lease.mts';
import { managedRuntimeUrl, readManagedRuntimeData, readManagedRuntimeResource } from '../../src/launcher/runtime-preparation.mts';
import { prepareRuntimeLaunch } from '../../src/launcher/runtime-launch.mts';
import { createNetworkActivityTracker, type NetworkActivitySnapshot } from '../../src/launcher/network-activity.mts';
import { confirmRuntimeClose, type RuntimeCloseDecision } from '../../src/launcher/launcher-lifecycle.mts';
import { deliverRuntimeInput, type HostedKeySpec, type TouchRuntimeContext, type RuntimeMessageTarget } from '../../src/launcher/touch-runtime-protocol.mts';
import { retainPackageGeneration, releasePackageGeneration } from '../../package/package-store.mjs';

export interface RuntimeFilesystem {
  mkdirTree(path: string): void;
  writeFile(path: string, bytes: Uint8Array, options: { canOwn: boolean }): void;
}
export interface RuntimeWindow extends RuntimeMessageTarget {
  readonly document: object;
  readonly location: { href: string };
  FS?: RuntimeFilesystem;
  Module?: { FS?: RuntimeFilesystem };
}
export interface RuntimeFrame {
  readonly contentWindow: RuntimeWindow | null;
  /** Emergency cleanup is allowed only with positive evidence of DOM removal. */
  readonly isConnected?: boolean;
  src: string;
  removeAttribute(name: string): void;
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
}
export type RuntimePhase = 'idle' | 'loading' | 'configuring' | 'prepared' | 'launching' | 'running' | 'saving' | 'exited' | 'error';
export type RuntimeRequestCommand = 'list' | 'read' | 'write' | 'remove' | 'resources' | 'retry-music';
export type RuntimeInputCommand = 'keyboard' | 'keyboard-clear' | 'touch-controls' | 'touch-cancel' | 'direct-touch' | 'thprac-mouse' | 'network-cancel';
export interface RuntimeSnapshot {
  readonly phase: RuntimePhase;
  readonly game: GameId | null;
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
  phase: 'idle', game: null, epoch: null, generationId: null, codeGeneration: null, source: null,
  ready: false, launched: false, firstFrame: false, spectator: false, error: null, saveError: null,
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
  const pending = new Map<string, PendingRequest>();
  const waiters = new Set<Waiter>();
  let snapshot = initialSnapshot();
  let disposed = false;
  let detachedFrameLost = false;
  let operation = 0;
  let requestSerial = 0;
  let lease: { id: string; timer: Timer } | null = null;
  let runtimeDocument: object | null = null;
  let preparedPlan: RuntimePlan | null = null;
  let launchRequested = false;
  let closing: Promise<boolean> | null = null;
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
  function assertCurrent(token: RuntimeSessionToken) {
    if (disposed || !sessions.isCurrent(token)) throw new RuntimeSessionSupersededError();
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
  function reset(phase: RuntimePhase = 'idle', error: string | null = null, exit: RuntimeSnapshot['exit'] = null) {
    const context = getInputContext();
    if (context.ready && context.target) for (const command of ['keyboard-clear', 'touch-cancel']) {
      try { deliverRuntimeInput(context, { protocol: HOST_PROTOCOL, game: context.game, epoch: context.epoch, command }); }
      catch (failure) { warn(failure); }
    }
    operation++;
    sessions.clear(); generations.clear(); releaseLease();
    rejectPending(new RuntimeSessionSupersededError());
    runtimeDocument = null; preparedPlan = null; launchRequested = false;
    frame.removeAttribute('src');
    takeTelemetry(); // A display tick from an old epoch cannot repopulate reset state.
    snapshot = initialSnapshot(); update({ phase, error, exit });
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
    const message = parseRuntimeInboundMessage(event.data, snapshot.game, token.id);
    if (!message) return;
    if (snapshot.ready) {
      try { runtimeIdentity(token); }
      catch { reset('error', 'Runtime document was replaced'); return; }
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
      reset(success ? 'exited' : 'error', success ? null : 'Runtime exited abnormally', Object.freeze({ ...message }));
    }
    options.onEvent?.(message);
  }
  const onLoad: EventListener = () => {
    const token = sessions.current();
    if (!token || !snapshot.ready) return;
    try { runtimeIdentity(token); }
    catch { reset('error', 'Runtime document was replaced'); }
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
  async function installResources(token: RuntimeSessionToken, plan: RuntimePlan) {
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
      const after = runtimeIdentity(token);
      if (after.runtime !== before.runtime || after.document !== before.document) throw new RuntimeSessionSupersededError();
      if (!resource || resource.path !== declaration.target) throw new Error(`Installed resource is missing or damaged: ${id}`);
      const slash = resource.path.lastIndexOf('/');
      if (slash > 0) fs.mkdirTree(resource.path.slice(0, slash));
      fs.writeFile(resource.path, new Uint8Array(resource.buffer), { canOwn: true });
    }
  }
  async function prepare(input: RuntimePlan): Promise<RuntimeSnapshot> {
    if (disposed) throw new Error('Runtime service is disposed');
    if (sessions.current() || closing) throw new Error('Close the current Runtime before preparing another');
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
        token = sessions.begin({ game: plan.game, runtimeVariant: plan.runtimeVariant,
          generationId: plan.generation.id, revision: plan.generation.descriptor.revision });
        update({ ...initialSnapshot(), phase: 'loading', game: plan.game, epoch: token.id,
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
          frame.src = url.href;
          await ready; assertOperation(); assertCurrent(token);
          break;
        } catch (error) {
          assertOperation(); assertCurrent(token);
          if (!codeGeneration || attempt === 2) throw error;
          excluded.push(codeGeneration);
          sessions.clear(); generations.clear(); releaseLease(); rejectPending(error);
          runtimeDocument = null; frame.removeAttribute('src');
          warn(error);
        }
      }
      if (!token) throw new Error('Runtime session is unavailable');
      update({ phase: 'configuring' });
      await send('configure', plan.configure, options.timeouts?.configure ?? 120_000);
      assertOperation(); assertCurrent(token);
      await installResources(token, plan); assertOperation(); assertCurrent(token);
      preparedPlan = plan;
      update({ phase: 'prepared', progress: null }); return snapshot;
    } catch (error) {
      assertOperation();
      reset('error', errorText(error)); throw error;
    }
  }
  async function launch(): Promise<RuntimeSnapshot> {
    const token = sessions.current();
    const plan = preparedPlan;
    if (!token || !plan || snapshot.phase !== 'prepared' || closing) throw new Error('Prepare the Runtime before launch');
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
    const token = sessions.current();
    if (!token || !snapshot.ready) throw new Error('Runtime is not ready');
    await send('sync', {}, 10_000); assertCurrent(token); update({ saveError: null });
  }
  function request<C extends RuntimeRequestCommand>(command: C, payload: RuntimeCommandPayloads[C], timeout?: number) {
    if (!['list', 'read', 'write', 'remove', 'resources', 'retry-music'].includes(command)) {
      return Promise.reject(new Error('Lifecycle commands must use prepare, launch or sync'));
    }
    return send(command, payload, timeout);
  }
  function close({ discardUnsaved = false, decide }: {
    discardUnsaved?: boolean;
    decide?: (error: unknown) => Promise<RuntimeCloseDecision>;
  } = {}): Promise<boolean> {
    if (closing) return closing;
    if (disposed) return Promise.resolve(!detachedFrameLost);
    const token = sessions.current();
    const previousPhase = snapshot.phase;
    const task = (async () => {
      if (!discardUnsaved && token && snapshot.ready) {
        update({ phase: 'saving', saveError: null });
        const leave = await confirmRuntimeClose({
          runtimeReady: () => sessions.isCurrent(token) && snapshot.ready,
          sync,
          decide: async error => {
            if (sessions.isCurrent(token)) update({ saveError: errorText(error) });
            return decide ? decide(error) : 'stay';
          },
        });
        if (!sessions.isCurrent(token)) return !detachedFrameLost;
        if (!leave) { update({ phase: previousPhase }); return false; }
      }
      if (!token || sessions.isCurrent(token)) reset();
      return true;
    })().catch(error => {
      // A dismissed/rejected UI decision is not consent to leave and must not
      // strand the service in its transient saving state.
      if (token && sessions.isCurrent(token)) update({ phase: previousPhase, saveError: errorText(error) });
      throw error;
    }).finally(() => { if (closing === task) closing = null; });
    closing = task; return task;
  }
  function cancel() {
    if (launchRequested || snapshot.launched || closing) throw new Error('Save and close the current Runtime first');
    reset();
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
    if (snapshot.ready || launchRequested || closing) throw new Error('Close the Runtime before disposing its service');
    reset(); finishDisposal();
  }
  function finishDisposal() {
    disposed = true;
    host.removeEventListener('message', onMessage); frame.removeEventListener('load', onLoad);
    if (host.__eaglerPrepareManagedRuntimeDataV1 === provideData) delete host.__eaglerPrepareManagedRuntimeDataV1;
    listeners.clear();
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
    operation++; sessions.clear(); generations.clear(); releaseLease();
    rejectPending(failure); takeTelemetry();
    runtimeDocument = null; preparedPlan = null; launchRequested = false;
    // Do not post input/sync or navigate a frame which its DOM owner destroyed.
    update({ phase: hadSession ? 'error' : snapshot.phase, ready: false, launched: false,
      epoch: null, source: null, firstFrame: false, progress: null,
      error: snapshot.error ?? (hadSession ? failure.message : null),
      saveError: mayHaveUnsavedProgress ? failure.message : snapshot.saveError });
    finishDisposal();
    if (hadSession) warn(failure);
  }
  host.__eaglerPrepareManagedRuntimeDataV1 = provideData;
  host.addEventListener('message', onMessage); frame.addEventListener('load', onLoad);
  return Object.freeze({ prepare, launch, sync, close, cancel, dispose, disposeDetachedFrame, send: request, postInput, getInputContext,
    getSnapshot: () => snapshot, getNetworkSnapshot: () => network.snapshot(),
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  });
}
export type RuntimeService = ReturnType<typeof createRuntimeService>;
