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
export {PreparationJobCancelledError as SampleJobCancelledError} from './preparation-job.client';
import {createPreparationJobController} from './preparation-job.client';
export function createSampleJobController(options: SampleJobOptions) {
  const deps: SampleJobDependencies = {inspect: inspectTh06Sample, prepare: prepareTh06Sample, ...options.dependencies};
  const sampleOptions: Omit<Th06SampleOptions, 'signal'> = {
    baseUrl: options.baseUrl, fetchImpl: options.fetchImpl, requestTimeoutMs: options.requestTimeoutMs,
    dependencies: options.packageDependencies,
  };
  const controller = createPreparationJobController({runtimeService: options.runtimeService, key: () => 'th06-sample',
    inspect: (_selection: null, signal) => deps.inspect({...sampleOptions, signal}),
    prepare: (_selection: null, ports) => deps.prepare({...sampleOptions, ...ports}),
  });
  return Object.freeze({...controller, inspect: () => controller.inspect(null), prepare: () => controller.prepare(null)});
}
