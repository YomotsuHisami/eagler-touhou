import {createAppShellClient, matchesAppShellRegistration, type AppShellClientState} from '../../src/launcher/app-shell-client.mts';
import {shouldDeferAppShellReload, type LauncherActivitySnapshot} from '../../src/launcher/launcher-lifecycle.mts';
import {createBrandUpdateAge} from '../models/brand-update-age';

type ClientOptions = NonNullable<Parameters<typeof createAppShellClient>[0]>;
export interface AppShellSnapshot {
  state: Readonly<AppShellClientState>;
  status: {text: string; kind: '' | 'update' | 'offline' | 'checking'};
}
export interface AppShellOptions {
  baseUrl: string;
  /** Explicit isolated deployment only. Omission never registers a worker. */
  deployment?: {workerUrl: string; scope: string};
  serviceWorker: ClientOptions['serviceWorker'];
  secureContext: boolean;
  activity(): LauncherActivitySnapshot;
  translate(key: string, params?: Record<string, string | number>): string;
  online(): boolean;
  reload(): void;
  timers: Pick<Window, 'setTimeout' | 'clearTimeout'>;
  fetchImpl?: typeof fetch;
  now?: () => number;
  logger?: ClientOptions['logger'];
}
/** Main app1093–1184. The original client remains the sole SW lifecycle owner;
 * this adapter exposes its presentation and the original busy/close guards. */
export function createAppShellService(options: AppShellOptions) {
  const listeners = new Set<() => void>(), now = options.now ?? Date.now;
  let disposed = false, noticeStarted: number | null = null, timer: number | null = null;
  let remote: 'unknown' | 'ready' | 'unavailable' | 'retrying' = 'unknown', remoteError: unknown = null;
  let snapshot: Readonly<AppShellSnapshot>;
  const brandAge = createBrandUpdateAge(options);
  const registrationIdentity = options.deployment ? {
    workerUrl: new URL(options.deployment.workerUrl, options.baseUrl).href,
    scopeUrl: new URL(options.deployment.scope, options.baseUrl).href,
  } : undefined;
  const defer = () => disposed || shouldDeferAppShellReload(options.activity());
  const client = createAppShellClient({
    serviceWorker: options.deployment ? options.serviceWorker : null,
    secureContext: options.secureContext,
    workerUrl: options.deployment?.workerUrl, scope: options.deployment?.scope,
    registrationIdentity,
    shouldDeferReload: defer, onChange: state => render(state),
    reload: () => {if (!disposed) options.reload();},
    schedule: callback => options.timers.setTimeout(() => {if (!disposed) callback();}, 0),
    logger: options.logger,
  });
  function reason(error: unknown) {
    if (!options.online()) return options.translate('status.deviceOffline');
    const message = error && typeof error === 'object' && 'message' in error ? String(error.message) : String(error ?? '');
    const status = message.match(/\bHTTP\s+(\d{3})\b/i)?.[1];
    if (status) return `HTTP ${status}`;
    if (/超时|timeout|timed out|没有完成请求/i.test(message)) return options.translate('status.requestTimeout');
    return options.translate('status.connectionFailed');
  }
  function render(state = client.snapshot()) {
    if (disposed) return;
    const visible = state.updateWaiting || state.updateReady;
    if (visible && noticeStarted === null) noticeStarted = now();
    if (!visible) {noticeStarted = null; if (timer !== null) options.timers.clearTimeout(timer); timer = null;}
    const seconds = noticeStarted === null ? 0 : Math.max(0, Math.floor((now() - noticeStarted) / 1000));
    let text = '', kind: AppShellSnapshot['status']['kind'] = '';
    if (state.activationPending || state.updateWaiting || state.updateReady) {
      kind = 'update';
      const key = state.activationPending ? 'status.applyingSiteUpdate'
        : options.activity().launched ? 'status.siteUpdateAfterExit'
          : defer() ? 'status.siteUpdateAfterOperation'
            : state.updateWaiting ? 'status.siteUpdateWaiting' : 'status.applyingSiteUpdate';
      text = options.translate(key, {seconds});
    } else if (remote === 'unavailable') {kind = 'offline'; text = options.translate('status.remoteUnavailable', {reason: reason(remoteError)});}
    else if (remote === 'retrying') {kind = 'checking'; text = options.translate('status.connectionRestored');}
    else if (state.updateCheckFailed) {kind = 'offline'; text = options.translate('status.updateCheckFailed', {reason: reason(state.updateError)});}
    snapshot = Object.freeze({state, status: {text, kind}});
    for (const listener of listeners) listener();
    if (kind === 'update' && timer === null) timer = options.timers.setTimeout(() => {timer = null; render();}, 1000);
  }
  render();
  void brandAge.bind(client.ready, () => !!registrationIdentity &&
    matchesAppShellRegistration(client.snapshot().registration, registrationIdentity) &&
    options.serviceWorker?.controller?.scriptURL === registrationIdentity.workerUrl);
  return {
    ready: client.ready, brandAge,
    async activeWorker() {
      if (disposed || !options.deployment) return null;
      const registration = await client.ready;
      if (disposed || !registrationIdentity || !matchesAppShellRegistration(registration, registrationIdentity)) return null;
      const worker = registration?.active;
      if (!worker?.postMessage) return null;
      const send = worker.postMessage.bind(worker);
      return {postMessage(message: unknown, transfer: Transferable[]) {
        if (disposed || registration.active !== worker || !matchesAppShellRegistration(registration, registrationIdentity)) {
          throw new Error('App Shell worker is no longer the selected deployment');
        }
        send(message, transfer);
      }};
    },
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {listeners.add(listener); return () => {listeners.delete(listener);};},
    setRemoteState(state: typeof remote, error: unknown = null) {remote = state; remoteError = error; render();},
    refreshLocale() {brandAge.refreshLocale(); render();},
    checkForUpdate() {return disposed ? Promise.resolve(false) : client.checkForUpdate();},
    notifyActivityChanged() {
      if (disposed) return;
      render(); queueMicrotask(() => {if (!disposed) {client.maybeReload(); void client.maybeActivateWaiting();}});
    },
    dispose() {disposed = true; brandAge.dispose(); if (timer !== null) options.timers.clearTimeout(timer); timer = null; listeners.clear();},
  };
}
