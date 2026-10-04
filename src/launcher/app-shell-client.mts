export interface AppShellClientState {
  readonly registration: ServiceWorkerRegistrationLike | null;
  readonly updateReady: boolean;
  readonly updateWaiting: boolean;
  readonly updateCheckFailed: boolean;
  readonly updateError: unknown | null;
  readonly reloadPending: boolean;
  readonly reloadScheduled: boolean;
  readonly activationPending: boolean;
}
interface EventTargetLike {
  addEventListener(type: string, callback: () => void): void;
  removeEventListener?(type: string, callback: () => void): void;
}
interface ServiceWorkerLike extends EventTargetLike {
  readonly state: string;
  postMessage?(message: unknown, transfer?: unknown[]): void;
}
interface ServiceWorkerRegistrationLike extends EventTargetLike {
  readonly active?: ServiceWorkerLike | null;
  readonly waiting: ServiceWorkerLike | null;
  readonly installing: ServiceWorkerLike | null;
  update(): Promise<unknown>;
}
interface ServiceWorkerContainerLike {
  readonly controller: { readonly scriptURL?: string } | null;
  register(url: string, options: { scope: string; updateViaCache: "none" }): Promise<ServiceWorkerRegistrationLike>;
  getRegistration(scope: string): Promise<ServiceWorkerRegistrationLike | null | undefined>;
}
interface LoggerLike { warn?(message: string, error: unknown): void; }
export interface AppShellClientOptions {
  serviceWorker?: ServiceWorkerContainerLike | null;
  secureContext?: boolean;
  workerUrl?: string;
  scope?: string;
  shouldDeferReload?: () => boolean;
  onChange?: (state: Readonly<AppShellClientState>) => void;
  reload?: () => void;
  schedule?: (callback: () => void) => unknown;
  logger?: LoggerLike;
  activationTimeoutMs?: number;
  activationRetryMs?: number;
  activationHandoffTimeoutMs?: number;
}
function browserServiceWorker(): ServiceWorkerContainerLike | null {
  // The getter itself may throw in a restricted/embedded browser context.
  try { return globalThis.navigator?.serviceWorker as ServiceWorkerContainerLike || null; }
  catch { return null; }
}
export function createAppShellClient({
  serviceWorker = browserServiceWorker(),
  secureContext = globalThis.isSecureContext === true,
  workerUrl = "./app-shell-sw.js", scope = "./",
  shouldDeferReload = () => false, onChange = () => {},
  reload = () => globalThis.location?.reload(),
  schedule = callback => globalThis.setTimeout(callback, 0), logger = globalThis.console,
  activationTimeoutMs = 120000, activationRetryMs = 1000,
  activationHandoffTimeoutMs = 10000,
}: AppShellClientOptions = {}) {
  const state: { -readonly [K in keyof AppShellClientState]: AppShellClientState[K] } = {
    registration: null, updateReady: false, updateWaiting: false,
    updateCheckFailed: false, updateError: null, reloadPending: false, reloadScheduled: false,
    activationPending: false,
  };
  let waitingCandidate: ServiceWorkerLike | null = null;
  let activationRequest: Promise<boolean> | null = null;
  let activationRetryTimer: ReturnType<typeof setTimeout> | null = null;
  let activationStartedAt = 0;
  let disposed = false;
  const cleanups = new Set<() => void>();
  function listen(target: EventTargetLike, type: string, callback: () => void) {
    target.addEventListener(type, callback);
    cleanups.add(() => target.removeEventListener?.(type, callback));
  }
  const snapshot = (): Readonly<AppShellClientState> => Object.freeze({ ...state });
  const notify = () => {if (!disposed) onChange(snapshot());};
  function clearActivationRetry() {
    if (activationRetryTimer != null) clearTimeout(activationRetryTimer);
    activationRetryTimer = null;
  }
  function scheduleActivationRetry() {
    clearActivationRetry();
    if (disposed || !(activationRetryMs > 0) || !state.updateWaiting
      || (!state.activationPending && shouldDeferReload())) return;
    activationRetryTimer = setTimeout(() => {
      activationRetryTimer = null;
      void maybeActivateWaiting();
    }, activationRetryMs);
  }
  function maybeActivateWaiting() {
    if (disposed) return Promise.resolve(false);
    const worker = state.registration?.waiting || waitingCandidate;
    // Reconcile the actual worker state as well as listening to events. Mobile
    // browsers may suspend the page while activation/message delivery completes.
    if (state.updateWaiting && worker?.state === "activated") {
      finishActivation();
      return Promise.resolve(true);
    }
    if (!state.updateWaiting) return Promise.resolve(false);
    if (state.activationPending) {
      if (worker?.state === "activating" || Date.now() - activationStartedAt < activationHandoffTimeoutMs) {
        scheduleActivationRetry();
        return Promise.resolve(false);
      }
      // A lost handoff must not leave Launcher input disabled indefinitely.
      // Retry through the same eligibility checks; never reload on a timeout.
      state.activationPending = false;
      notify();
    }
    if (shouldDeferReload()) return Promise.resolve(false);
    if (!worker || activationRequest) return activationRequest || Promise.resolve(false);
    clearActivationRetry();
    activationRequest = Promise.resolve().then(() => {
      if (disposed || shouldDeferReload() || !state.updateWaiting || worker.state !== "installed" || typeof worker.postMessage !== "function") return false;
      state.activationPending = true;
      activationStartedAt = Date.now();
      notify();
      // The installed worker has already precached and verified the entire
      // required shell. Other old tabs are not a reason to block this page.
      worker.postMessage({ type: "ACTIVATE_APP_SHELL" });
      // A browser may activate synchronously or while the page is suspended.
      const actualState = (worker as ServiceWorkerLike).state;
      if (actualState === "activated") { finishActivation(); return true; }
      return true;
    }).catch(error => {
      state.activationPending = false;
      notify();
      logger?.warn?.("App Shell activation unavailable", error);
      return false;
    }).finally(() => {
      activationRequest = null;
      // Missing/late MessageChannel replies are transient too, not just a
      // second window. Keep observing until activation or Launcher activity.
      scheduleActivationRetry();
    });
    return activationRequest;
  }
  function maybeReload() {
    if (disposed) return false;
    if (state.updateWaiting) { void maybeActivateWaiting(); return false; }
    if (!state.updateReady || !state.reloadPending || state.reloadScheduled || shouldDeferReload()) return false;
    state.reloadScheduled = true;
    notify();
    schedule(() => {
      // An operation may start after scheduling, before the next task runs.
      if (disposed || shouldDeferReload()) { state.reloadScheduled = false; notify(); return; }
      reload();
    });
    return true;
  }
  async function checkForUpdate() {
    if (disposed || !state.registration) return false;
    try {
      await state.registration.update();
      state.updateCheckFailed = false; state.updateError = null; notify(); return true;
    } catch (error) {
      state.updateCheckFailed = true; state.updateError = error; notify();
      logger?.warn?.("App Shell update check unavailable", error); return false;
    }
  }
  const watched = new WeakSet<ServiceWorkerLike>();
  function finishActivation() {
    if (disposed || state.updateReady) return;
    state.updateWaiting = false; state.updateReady = true; state.reloadPending = true;
    waitingCandidate = null;
    clearActivationRetry();
    notify(); maybeReload();
  }
  function watchWorker(worker: ServiceWorkerLike | null, replacing: boolean) {
    if (!worker || watched.has(worker)) return;
    watched.add(worker);
    const changed = () => {
      if (disposed || !replacing) return;
      if (worker.state === "installed") {
        waitingCandidate = worker;
        state.updateWaiting = true;
        state.updateReady = false;
        state.reloadPending = false;
        notify();
        void maybeActivateWaiting();
      } else if (worker.state === "activated") {
        finishActivation();
      } else if (worker.state === "redundant") {
        state.updateWaiting = !!state.registration?.waiting;
        if (!state.updateWaiting) {
          waitingCandidate = null;
          state.activationPending = false;
          clearActivationRetry();
        }
        notify();
      }
    };
    listen(worker, "statechange", changed);
    changed();
  }
  const resolvedWorkerUrl = (() => {
    try { return new URL(workerUrl, globalThis.location?.href).href; }
    catch { return workerUrl; }
  })();
  const controllerBelongsToRegistration = () => {
    const controller = serviceWorker?.controller;
    if (!controller) return false;
    // A page below a nested scope can initially be controlled by the parent
    // scope. That controller does not make the nested scope's first install an
    // update. Older test doubles do not expose scriptURL, so retain the
    // conservative controlled-page behavior for them.
    return typeof controller.scriptURL !== "string" || controller.scriptURL === resolvedWorkerUrl;
  };
  const controlledBeforeRegistration = controllerBelongsToRegistration();
  function watchRegistration(registration: ServiceWorkerRegistrationLike) {
    if (registration === state.registration) return;
    state.registration = registration;
    state.updateWaiting = !!registration.waiting && controlledBeforeRegistration;
    waitingCandidate = registration.waiting || null;
    listen(registration, "updatefound", () => {if (!disposed) watchWorker(registration.installing, controllerBelongsToRegistration());});
    // register() may resolve after updatefound. Observe the in-flight worker too.
    watchWorker(registration.installing, controlledBeforeRegistration);
    // A refresh can find a candidate that finished installing on the previous
    // page. It will never emit updatefound here, but still needs state tracking.
    watchWorker(registration.waiting, controlledBeforeRegistration);
    notify();
    if (state.updateWaiting) void maybeActivateWaiting();
    // register() already fetches the current worker on first install. Calling
    // update() again while that uncontrolled installation is settling can
    // create a second installing worker; a following controlled navigation may
    // then observe its activation as an update and reload itself mid-navigation.
    if (controlledBeforeRegistration) void checkForUpdate();
  }
  async function waitForInitialActivation(registration: ServiceWorkerRegistrationLike) {
    const worker = registration.installing;
    if (serviceWorker?.controller || registration.active || !worker) return registration;
    // register() resolves before install finishes. Callers preparing Runtime
    // caches await ready and need an active worker even on the first visit.
    // Do not wait for controllerchange: we intentionally do not clients.claim().
    await new Promise<void>(resolve => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const finish = () => {
        if (timer !== undefined) clearTimeout(timer);
        worker.removeEventListener?.("statechange", changed);
        cleanups.delete(finish);
        resolve();
      };
      const changed = () => {
        if (worker.state === "activated" || worker.state === "redundant") finish();
      };
      timer = setTimeout(finish, activationTimeoutMs);
      cleanups.add(finish);
      worker.addEventListener("statechange", changed);
      changed();
    });
    return registration;
  }
  const ready = secureContext && serviceWorker
    ? Promise.resolve().then(() => disposed ? null : serviceWorker.register(workerUrl, { scope, updateViaCache: "none" }))
      .catch(async error => {
        logger?.warn?.("App Shell Service Worker unavailable; continuing without it", error);
        try { return disposed ? null : await serviceWorker.getRegistration(scope); } catch { return null; }
      }).then(registration => {
        if (disposed) return null;
        if (registration) watchRegistration(registration);
        return registration ? waitForInitialActivation(registration) : null;
      })
    : Promise.resolve(null);
  function dispose() {
    if (disposed) return;
    disposed = true; clearActivationRetry();
    for (const cleanup of cleanups) cleanup();
    cleanups.clear();
  }
  return Object.freeze({ ready, snapshot, checkForUpdate, maybeReload, maybeActivateWaiting, dispose });
}
