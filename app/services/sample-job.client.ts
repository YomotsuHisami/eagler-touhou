/** Root-lifetime preparation jobs, independent of React and route subscriptions.
 * This controller never launches, owns no Package/Runtime lease, and never closes
 * a running session. Start remains an explicit UI action for preparedEpoch.
 */
import { inspectTh06Sample, prepareTh06Sample,
  type Th06SampleInspection, type Th06SampleOptions, type SampleLaunchDependencies,
} from './sample-launch.client';
import type { PackageInstallProgress } from '../../package/package-installer.mjs';
import type { RuntimePlan, RuntimeSnapshot } from './runtime.client';

export interface SampleJobRuntimeService {
  prepare(plan: RuntimePlan): Promise<RuntimeSnapshot>;
  cancel(): void;
  getSnapshot(): RuntimeSnapshot;
  subscribe(listener: () => void): () => void;
}
export interface SampleJobSnapshot {
  readonly inspection: Readonly<Th06SampleInspection> | null;
  readonly inspecting: boolean;
  readonly preparing: boolean;
  readonly progress: Readonly<PackageInstallProgress> | null;
  readonly error: string | null;
  readonly preparedEpoch: number | null;
}
export interface SampleJobDependencies {
  inspect: typeof inspectTh06Sample;
  prepare: typeof prepareTh06Sample;
}
export interface SampleJobOptions extends Omit<Th06SampleOptions, 'signal' | 'dependencies'> {
  runtimeService: SampleJobRuntimeService;
  packageDependencies?: Partial<SampleLaunchDependencies>;
  dependencies?: Partial<SampleJobDependencies>;
}
export class SampleJobCancelledError extends Error {
  override name = 'AbortError';
  constructor() { super('Sample preparation job was cancelled or replaced'); }
}
interface Job<T> { controller: AbortController; promise: Promise<T>; cancelled: boolean }
interface PreparationJob extends Job<RuntimeSnapshot> { startedEpoch: number | null; completedEpoch: number | null }
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
function immutableInspection(value: Th06SampleInspection): Readonly<Th06SampleInspection> {
  return Object.freeze({ ...value, scope: Object.freeze({ ...value.scope }),
    reason: value.reason ? Object.freeze({ ...value.reason }) : null,
    checks: Object.freeze(value.checks.map(check => Object.freeze({ ...check }))) });
}

export function createSampleJobController(options: SampleJobOptions) {
  const runtime = options.runtimeService;
  const deps: SampleJobDependencies = { inspect: inspectTh06Sample, prepare: prepareTh06Sample, ...options.dependencies };
  const sampleOptions: Omit<Th06SampleOptions, 'signal'> = {
    baseUrl: options.baseUrl, fetchImpl: options.fetchImpl, requestTimeoutMs: options.requestTimeoutMs,
    dependencies: options.packageDependencies,
  };
  let snapshot: SampleJobSnapshot = Object.freeze({ inspection: null, inspecting: false,
    preparing: false, progress: null, error: null, preparedEpoch: null });
  const listeners = new Set<() => void>();
  let disposed = false;
  let inspection: Job<Th06SampleInspection> | null = null;
  let preparation: PreparationJob | null = null;
  let starting: { job: PreparationJob; plan: RuntimePlan } | null = null;

  function update(patch: Partial<SampleJobSnapshot>) {
    snapshot = Object.freeze({ ...snapshot, ...patch });
    for (const listener of listeners) listener();
  }
  function assertActive(job: Job<unknown>) {
    if (disposed || job.cancelled || job.controller.signal.aborted) throw new SampleJobCancelledError();
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

  function inspect(): Promise<Th06SampleInspection> {
    if (disposed) return unavailable('Sample job controller is disposed');
    if (inspection) return inspection.promise;
    if (preparation) return unavailable('Wait for or cancel sample preparation before inspecting again');
    const job = { controller: new AbortController(), cancelled: false } as Job<Th06SampleInspection>;
    job.promise = Promise.resolve().then(async () => {
      assertActive(job);
      const value = await deps.inspect({ ...sampleOptions, signal: job.controller.signal });
      assertActive(job);
      const result = immutableInspection(value);
      if (inspection === job) update({ inspection: result, inspecting: false,
        error: result.available ? null : result.reason?.message ?? 'TH06 sample is unavailable' });
      assertActive(job);
      return result;
    }).catch(error => {
      if (inspection === job && !disposed && !job.cancelled) update({ inspecting: false, error: message(error) });
      throw job.cancelled || disposed ? new SampleJobCancelledError() : error;
    }).finally(() => { if (inspection === job) inspection = null; });
    // A UI may rely entirely on the error snapshot instead of awaiting a click.
    void job.promise.catch(() => {});
    inspection = job; update({ inspecting: true, error: null }); return job.promise;
  }

  function prepare(): Promise<RuntimeSnapshot> {
    if (disposed) return unavailable('Sample job controller is disposed');
    if (preparation) return preparation.promise;
    const live = runtime.getSnapshot();
    if (snapshot.preparedEpoch !== null && live.epoch === snapshot.preparedEpoch && live.phase === 'prepared' && !live.launched) {
      return Promise.resolve(live);
    }
    if (!freeRuntime()) return unavailable('Save and close the current Runtime before preparing the sample');
    stopInspection();
    const job = { controller: new AbortController(), cancelled: false, startedEpoch: null, completedEpoch: null } as PreparationJob;
    job.promise = Promise.resolve().then(async () => {
      assertActive(job);
      const result = await deps.prepare({ ...sampleOptions, signal: job.controller.signal,
        onProgress(progress) {
          if (preparation === job && !disposed && !job.cancelled) update({ progress: Object.freeze({ ...progress }) });
        },
        runtimeService: { prepare(plan) {
          assertActive(job);
          // Acquisition may have taken time. A Runtime opened by another
          // owner during that interval must not be replaced by this job.
          if (!freeRuntime()) throw new Error('A Runtime session started while the sample was being acquired');
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
        throw new Error('Sample Runtime preparation was replaced before it completed');
      }
      if (preparation === job) update({ preparing: false, progress: null, error: null, preparedEpoch: result.epoch });
      assertActive(job);
      return result;
    }).catch(error => {
      if (preparation === job && !disposed && !job.cancelled) update({ preparing: false, progress: null,
        preparedEpoch: null, error: message(error) });
      throw job.cancelled || disposed ? new SampleJobCancelledError() : error;
    }).finally(() => { if (preparation === job) preparation = null; });
    void job.promise.catch(() => {});
    preparation = job;
    update({ inspection: null, inspecting: false, preparing: true, progress: null, error: null, preparedEpoch: null });
    return job.promise;
  }

  function cancel() {
    stopInspection();
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
