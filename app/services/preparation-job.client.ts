/** Framework-independent root-lifetime job lifecycle shared by fixed and general launch. */
import type { PackageInstallProgress } from '../../package/package-installer.mjs';
import type { RuntimePlan, RuntimeSnapshot } from './runtime.client';
export interface PreparationRuntimeService {
  prepare(plan: RuntimePlan): Promise<RuntimeSnapshot>;
  cancel(): void;
  getSnapshot(): RuntimeSnapshot;
  subscribe(listener: () => void): () => void;
}
export interface InspectionResult { available: boolean; reason: {message: string} | null }
export interface PreparationJobSnapshot<I, S> {
  readonly selection: S | null;
  readonly inspection: I | null;
  readonly inspecting: boolean;
  readonly preparing: boolean;
  readonly progress: Readonly<PackageInstallProgress> | null;
  readonly error: string | null;
  readonly warnings: readonly string[];
  readonly preparedEpoch: number | null;
}
export interface PreparationPorts {
  signal: AbortSignal;
  onWarning(warning: string): void;
  onProgress(progress: PackageInstallProgress): void;
  runtimeService: {prepare(plan: RuntimePlan): Promise<RuntimeSnapshot>};
}
export interface PreparationJobOptions<I extends InspectionResult, S> {
  runtimeService: PreparationRuntimeService;
  key(selection: S): string;
  inspect(selection: S, signal: AbortSignal): Promise<I>;
  prepare(selection: S, ports: PreparationPorts): Promise<RuntimeSnapshot>;
}
export class PreparationJobCancelledError extends Error {
  override name = 'AbortError';
  constructor() { super('Preparation job was cancelled or replaced'); }
}
interface Job<T> { controller: AbortController; promise: Promise<T>; cancelled: boolean; key: string }
interface PreparationJob extends Job<RuntimeSnapshot> { startedEpoch: number | null; completedEpoch: number | null }
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
function immutableCopy<T>(value: T): T {
  const copy = structuredClone(value);
  const freeze = (item: unknown) => { if (item && typeof item === 'object') {
    for (const child of Object.values(item)) freeze(child); Object.freeze(item);
  }};
  freeze(copy); return copy;
}

export function createPreparationJobController<I extends InspectionResult, S>(options: PreparationJobOptions<I, S>) {
  const runtime = options.runtimeService;
  let snapshot: PreparationJobSnapshot<I, S> = Object.freeze({ selection: null, inspection: null, inspecting: false,
    preparing: false, progress: null, error: null, warnings: Object.freeze([]), preparedEpoch: null });
  const listeners = new Set<() => void>();
  let disposed = false;
  let inspection: Job<I> | null = null;
  let preparation: PreparationJob | null = null;
  let preparedKey: string | null = null;
  let starting: { job: PreparationJob; plan: RuntimePlan } | null = null;

  function update(patch: Partial<PreparationJobSnapshot<I, S>>) {
    snapshot = Object.freeze({ ...snapshot, ...patch });
    for (const listener of listeners) listener();
  }
  function assertActive(job: Job<unknown>) {
    if (disposed || job.cancelled || job.controller.signal.aborted) throw new PreparationJobCancelledError();
  }
  function stopInspection() {
    const old = inspection; inspection = null;
    if (old) { old.cancelled = true; old.controller.abort(); }
  }
  function cancelEpoch(epoch: number | null) {
    if (epoch === null) return;
    const live = runtime.getSnapshot();
    // launch() can be pending while launched is still false. Its phase must
    // also remain outside cancellation, as must a save/close operation.
    if (live.epoch !== epoch || live.launched || !['loading', 'configuring', 'prepared'].includes(live.phase)) return;
    runtime.cancel();
  }
  function freeRuntime() {
    const live = runtime.getSnapshot();
    return live.epoch === null && !live.ready && !live.launched && ['idle', 'exited', 'error'].includes(live.phase);
  }
  function unavailable(reason: string): Promise<never> {
    const error = new Error(reason);
    if (!disposed) update({ error: reason });
    const rejected = Promise.reject<never>(error); void rejected.catch(() => {}); return rejected;
  }
  function captureStart(job: PreparationJob, plan: RuntimePlan) {
    const live = runtime.getSnapshot();
    if (job.startedEpoch === null && live.epoch !== null && live.game === plan.game && live.generationId === plan.generation.id &&
        ['loading', 'configuring', 'prepared'].includes(live.phase) && !live.launched) job.startedEpoch = live.epoch;
  }
  const unsubscribeRuntime = runtime.subscribe(() => {
    // Capture the first synchronous publication before later subscriber work
    // can cancel or replace it during the same prepare() call stack.
    if (starting) captureStart(starting.job, starting.plan);
    if (disposed || snapshot.preparedEpoch === null) return;
    const live = runtime.getSnapshot();
    if (live.epoch !== snapshot.preparedEpoch || live.phase !== 'prepared' || live.launched) update({ preparedEpoch: null });
  });

  function inspect(input: S): Promise<I> {
    if (disposed) return unavailable('Game job controller is disposed');
    const selection = structuredClone(input), key = options.key(selection);
    if (inspection?.key === key) return inspection.promise;
    stopInspection();
    if (preparation) return unavailable('Wait for or cancel game preparation before inspecting again');
    const job = { controller: new AbortController(), cancelled: false, key } as Job<I>;
    job.promise = Promise.resolve().then(async () => {
      assertActive(job);
      const value = await options.inspect(selection, job.controller.signal);
      assertActive(job);
      const result = immutableCopy(value);
      if (inspection === job) update({ inspection: result, inspecting: false,
        error: result.available ? null : result.reason?.message ?? 'The game is unavailable' });
      assertActive(job);
      return result;
    }).catch(error => {
      if (inspection === job && !disposed && !job.cancelled) update({ inspecting: false, error: message(error) });
      throw job.cancelled || disposed ? new PreparationJobCancelledError() : error;
    }).finally(() => { if (inspection === job) inspection = null; });
    // A UI may rely entirely on the error snapshot instead of awaiting a click.
    void job.promise.catch(() => {});
    inspection = job; update({ inspecting: true, error: null }); return job.promise;
  }

  function prepare(input: S): Promise<RuntimeSnapshot> {
    if (disposed) return unavailable('Game job controller is disposed');
    const selection = structuredClone(input), key = options.key(selection);
    if (preparation) return preparation.key === key ? preparation.promise : unavailable('Another preparation request is active; cancel it before changing product or settings');
    const live = runtime.getSnapshot();
    if (preparedKey === key && snapshot.preparedEpoch !== null && live.epoch === snapshot.preparedEpoch && live.phase === 'prepared' && !live.launched) {
      return Promise.resolve(live);
    }
    if (!freeRuntime()) return unavailable('Save and close the current Runtime before preparing the game');
    stopInspection();
    const job = { controller: new AbortController(), cancelled: false, key, startedEpoch: null, completedEpoch: null } as PreparationJob;
    job.promise = Promise.resolve().then(async () => {
      assertActive(job);
      const result = await options.prepare(selection, { signal: job.controller.signal,
        onWarning(warning) {
          if (preparation === job && !disposed && !job.cancelled) update({warnings: Object.freeze([...snapshot.warnings, warning])});
        },
        onProgress(progress) {
          if (preparation === job && !disposed && !job.cancelled) update({ progress: Object.freeze({ ...progress }) });
        },
        runtimeService: { prepare(plan) {
          assertActive(job);
          // Acquisition may have taken time. A Runtime opened by another
          // owner during that interval must not be replaced by this job.
          if (!freeRuntime()) throw new Error('A Runtime session started while the game was being acquired');
          let pending: Promise<RuntimeSnapshot>;
          starting = { job, plan };
          try { pending = runtime.prepare(plan); } finally { starting = null; }
          // The real service begins its epoch synchronously before its first
          // await. Capture at this boundary, not from a later mutable current.
          captureStart(job, plan);
          if (job.cancelled || disposed) cancelEpoch(job.startedEpoch);
          return pending.then(value => {
            // A code-generation retry can create another epoch inside the
            // SAME prepare call. Only its returned result is authoritative;
            // never infer ownership from an unrelated newer live snapshot.
            job.completedEpoch = value.epoch;
            if (job.cancelled || disposed) cancelEpoch(value.epoch);
            return value;
          });
        } },
      });
      assertActive(job);
      const current = runtime.getSnapshot();
      if (job.startedEpoch === null || result.epoch === null || current.epoch !== result.epoch ||
          current.phase !== 'prepared' || current.launched || result.phase !== 'prepared') {
        throw new Error('Game Runtime preparation was replaced before it completed');
      }
      if (preparation === job) { preparedKey = key; update({ preparing: false, progress: null, error: null, preparedEpoch: result.epoch }); }
      assertActive(job);
      return result;
    }).catch(error => {
      if (preparation === job && !disposed && !job.cancelled) update({ preparing: false, progress: null,
        preparedEpoch: null, error: message(error) });
      throw job.cancelled || disposed ? new PreparationJobCancelledError() : error;
    }).finally(() => { if (preparation === job) preparation = null; });
    void job.promise.catch(() => {});
    preparation = job;
    update({ selection: immutableCopy(selection), inspection: null, inspecting: false, preparing: true, progress: null, error: null, warnings: Object.freeze([]), preparedEpoch: null });
    return job.promise;
  }

  function cancel() {
    stopInspection(); preparedKey = null;
    const job = preparation; preparation = null;
    if (job) { job.cancelled = true; job.controller.abort(); }
    let error: string | null = null;
    try { cancelEpoch(job?.completedEpoch ?? job?.startedEpoch ?? snapshot.preparedEpoch); }
    catch (failure) { error = message(failure); }
    update({ inspecting: false, preparing: false, progress: null, error, preparedEpoch: null });
  }
  function dispose() {
    if (disposed) return;
    disposed = true; cancel(); unsubscribeRuntime(); listeners.clear();
  }
  return Object.freeze({ getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      if (disposed) return () => {};
      listeners.add(listener); return () => { listeners.delete(listener); };
    }, inspect, prepare, cancel, dispose });
}
