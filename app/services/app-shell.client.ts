import {createAppShellClient, type AppShellClientOptions, type AppShellClientState} from '../../src/launcher/app-shell-client.mts';
import {shouldDeferAppShellReload} from '../../src/launcher/launcher-lifecycle.mts';
import {createUiDeploymentContract} from '../../scripts/ui-deployment-contract.mjs';
import {PRODUCT_GAMES, isGameId, type GameId} from '../../src/contracts/product-catalog.mts';

export interface UiShellActivity {
  runtime?: {epoch?: number | null; ready?: boolean; launched?: boolean; fileOperationBusy?: boolean; saveError?: string | null; phase?: string} | null;
  operation?: unknown; importOperation?: unknown; importReview?: unknown;
  preparing?: boolean; downloading?: boolean; room?: unknown;
  dirtyDrafts?: number; decisionOpen?: boolean; filePickerOpen?: boolean;
}
export function uiShellActivityBlocks(activity: UiShellActivity): boolean {
  const runtime = activity.runtime;
  return shouldDeferAppShellReload({launched: !!runtime?.launched, runtimeReady: !!runtime?.ready,
    runtimeSessionActive: runtime?.epoch != null || !!runtime?.saveError || ['loading','configuring','launching','saving'].includes(runtime?.phase || ''),
    blockingOperation: !!activity.operation || !!activity.importOperation || !!runtime?.fileOperationBusy || !!activity.downloading,
    gameDataAttempt: !!activity.importReview, launchInFlight: !!activity.preparing,
    touchLayoutEditing: (activity.dirtyDrafts || 0) > 0, decisionOpen: !!activity.room || !!activity.decisionOpen || !!activity.filePickerOpen, replayOpen: false});
}
export interface UiPublicationGate {readonly mountPath: string; readonly workerUrl: string; readonly scope: string; readonly artifact: string; readonly artwork: Readonly<Partial<Record<GameId,string>>>; readonly originMigration: Readonly<{mode:'http-to-https'}> | null}
function applicationMount({baseUrl, documentUrl}: {baseUrl: string; documentUrl: string}) {
  const base = new URL(baseUrl), document = new URL(documentUrl);
  if (!['http:','https:'].includes(base.protocol) || base.origin !== document.origin || base.username || base.password || base.search || base.hash ||
    !/^(?:\/[A-Za-z0-9_-]+)*\/$/.test(base.pathname) || !(document.pathname === base.pathname.slice(0,-1) || document.pathname.startsWith(base.pathname))) throw Error('Publication must match this document origin and application mount');
  return base;
}
export function validateUiPublicationGate(value: unknown, options: {baseUrl: string; documentUrl: string}): UiPublicationGate {
  const base=applicationMount(options);
  const record = value as {schema?: unknown; status?: unknown; mountPath?: unknown; worker?: unknown; uiBuild?: {sha256?: unknown}; navigation?: Parameters<typeof createUiDeploymentContract>[0]; artwork?: unknown; originMigration?: {mode?: unknown} | null} | null;
  if (record?.schema !== 'eagler-touhou/ui-publication/1' || record.status !== 'experimental-opt-in' || record.mountPath !== base.pathname || record.worker !== 'app-shell-sw.js' ||
      typeof record.uiBuild?.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(record.uiBuild.sha256)) throw Error('Invalid opt-in UI publication marker');
  if(!record.navigation)throw Error('Publication navigation contract missing');
  const navigation = createUiDeploymentContract(record.navigation);
  if (navigation.mountPath !== base.pathname || navigation.shellPath !== base.pathname + 'index.html') throw Error('Publication navigation mount does not match this document');
  const artwork: Partial<Record<GameId,string>> = {};
  if(record.artwork !== undefined && (!record.artwork || typeof record.artwork!=='object' || Array.isArray(record.artwork)))throw Error('Invalid publication artwork');
  for(const [game,raw] of Object.entries(record.artwork || {})){
    const entry=raw as {path?:unknown;bytes?:unknown;sha256?:unknown};
    const product=isGameId(game)?PRODUCT_GAMES[game]:null;
    if(!isGameId(game) || !product || !('cardArtwork' in product) || !entry || entry.path!==`assets/${product.cardArtwork}` || !Number.isSafeInteger(entry.bytes) || Number(entry.bytes)<=0 || typeof entry.sha256!=='string' || !/^[a-f0-9]{64}$/.test(entry.sha256))throw Error('Publication artwork must use catalog-owned file identities');
    artwork[game]=new URL(entry.path as string,base).href;
  }
  if(record.originMigration!=null && (typeof record.originMigration!=='object' || Array.isArray(record.originMigration) || record.originMigration.mode!=='http-to-https' || Object.keys(record.originMigration).length!==1))throw Error('Unsupported publication origin migration policy');
  const originMigration=record.originMigration==null?null:Object.freeze({mode:'http-to-https' as const});
  return Object.freeze({mountPath: base.pathname, workerUrl: new URL(record.worker,base).href, scope: base.href, artifact: record.uiBuild.sha256,artwork:Object.freeze(artwork),originMigration});
}
type ShellClient = ReturnType<typeof createAppShellClient>;
type Container = NonNullable<AppShellClientOptions['serviceWorker']>;
type Registration = NonNullable<AppShellClientState['registration']>;
export interface UiAppShellSnapshot {
  readonly phase: 'checking' | 'disabled' | 'unsupported' | 'installing' | 'ready' | 'error';
  readonly gate: UiPublicationGate | null; readonly client: Readonly<AppShellClientState> | null;
  readonly deferred: boolean; readonly offlineReady: boolean; readonly error: string | null;
}
export interface UiAppShellOptions {
  baseUrl: string; documentUrl: string; fetchImpl?: typeof fetch; serviceWorker?: Container | null;
  secureContext?: boolean; shouldDefer(): boolean; reload?: () => void;
  createClient?: typeof createAppShellClient; statusTimeoutMs?: number;
  readStatus?: (registration: Registration) => Promise<boolean>;
  clientOptions?: Pick<AppShellClientOptions,'schedule'|'activationRetryMs'|'activationTimeoutMs'|'activationHandoffTimeoutMs'>;
}
function browserWorker(): Container | null {try {return navigator.serviceWorker;} catch {return null;}}
async function verifiedShellStatus(registration: Registration, timeout: number): Promise<boolean> {
  const worker = registration.active;
  if (!worker?.postMessage || worker.state !== 'activated' || typeof MessageChannel === 'undefined') return false;
  return new Promise(resolve => {
    const channel = new MessageChannel();
    const done = (value: boolean) => {clearTimeout(timer);channel.port1.close();channel.port2.close();resolve(value);};
    const timer = setTimeout(()=>done(false),timeout);
    channel.port1.onmessage = event => done(event.data?.ok === true && event.data?.shellReady === true);
    try {worker.postMessage!({type:'GET_APP_SHELL_STATUS'},[channel.port2]);} catch {done(false);}
  });
}
/** Marker validation is the only registration gate. The existing client owns
 * all registration/update/activation/reload behavior; this adapter supplies
 * document ports and never owns navigation, Runtime or persistent storage. */
export function createUiAppShell(options: UiAppShellOptions) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis), container = options.serviceWorker === undefined ? browserWorker() : options.serviceWorker;
  let snapshot: UiAppShellSnapshot = Object.freeze({phase:'checking', gate:null, client:null, deferred:false, offlineReady:false, error:null});
  const listeners = new Set<() => void>(), abort = new AbortController();
  let disposed = false, suspended = false, client: ShellClient | null = null, starting: Promise<void> | null = null;
  const blocked = () => disposed || suspended || options.shouldDefer();
  const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
  const publish = (patch: Partial<UiAppShellSnapshot> = {}) => {if(disposed)return;snapshot=Object.freeze({...snapshot,...patch,deferred:blocked()});for(const fn of listeners)fn();};
  function checkedRegistration(value: Registration | null | undefined, gate: UiPublicationGate, strict: boolean): Registration | null {
    if (!value) return null;
    const registration = value as Registration & {scope?: string};
    if (registration.scope !== gate.scope) {if(strict)throw Error('Service Worker scope does not match publication');return null;}
    for(const worker of [registration.active,registration.waiting,registration.installing]) if(worker && (worker as {scriptURL?: string}).scriptURL !== gate.workerUrl) throw Error('Another Service Worker owns the publication scope');
    return registration;
  }
  async function start() {
    if(disposed || suspended || client) return;
    if(starting) return starting;
    starting = (async()=>{
      publish({phase:'checking',error:null});
      const markerUrl = new URL('ui-publication.json',applicationMount(options)).href;
      const response = await fetchImpl(markerUrl,{cache:'no-cache',redirect:'error',signal:abort.signal});
      if(disposed)return;
      if(response.status===404 || response.status===410){publish({phase:'disabled'});return;}
      if(!response.ok)throw Error(`UI publication marker: HTTP ${response.status}`);
      if(response.redirected || response.url && response.url !== markerUrl || !/application\/json/i.test(response.headers.get('content-type') || ''))throw Error('UI publication marker must be same-origin JSON without redirects');
      const text=await response.text();if(text.length>2*1024*1024)throw Error('UI publication marker is too large');
      const gate=validateUiPublicationGate(JSON.parse(text),options);if(disposed || suspended)return;
      publish({gate});
      if(!(options.secureContext ?? globalThis.isSecureContext) || !container){publish({phase:'unsupported',error:'This browser cannot use a secure Service Worker'});return;}
      const existing=await container.getRegistration(gate.scope);if(disposed || suspended)return;
      checkedRegistration(existing,gate,false);
      const guarded: Container = {
        get controller(){return container.controller;},
        async register(url,configuration){if(disposed)throw Error('Document disposed');if(url!==gate.workerUrl || configuration.scope!==gate.scope)throw Error('Registration escaped its publication');return checkedRegistration(await container.register(url,configuration),gate,true)!;},
        async getRegistration(scope){if(scope!==gate.scope)return null;return checkedRegistration(await container.getRegistration(scope),gate,false);},
      };
      publish({phase:'installing'});
      client=(options.createClient ?? createAppShellClient)({...options.clientOptions,serviceWorker:guarded,secureContext:true,workerUrl:gate.workerUrl,scope:gate.scope,
        shouldDeferReload:blocked,reload:options.reload,
        onChange:state=>publish({client:state,error:state.updateCheckFailed?errorText(state.updateError):snapshot.error}),
        logger:{warn:(_message,error)=>publish({error:errorText(error)})}});
      const registration=await client.ready;if(disposed)return;
      if(!registration){publish({phase:'error',error:snapshot.error || 'Service Worker registration is unavailable'});return;}
      const offlineReady=await (options.readStatus ?? (value=>verifiedShellStatus(value,options.statusTimeoutMs ?? 5000)))(registration);
      if(disposed)return;
      publish({phase:offlineReady?'ready':'error',offlineReady,error:offlineReady?snapshot.error:'Offline shell installation is not confirmed; check the connection and retry'});
      if(container.controller?.scriptURL===gate.workerUrl){
        // Existing worker endpoint acknowledges a live client, then safely
        // retains/prunes shell versions using the established rollback policy.
        try {await fetchImpl(new URL('__app-shell-update-status__',gate.scope),{cache:'no-store',signal:abort.signal});} catch { /* Optional acknowledgement never blocks startup. */ }
      }
    })().catch(error=>{if(!disposed)publish({phase:'error',error:errorText(error)});}).finally(()=>{starting=null;});
    return starting;
  }
  function activityChanged(){if(disposed)return;publish();if(!blocked()){client?.maybeReload();void client?.maybeActivateWaiting();}}
  return Object.freeze({getSnapshot:()=>snapshot,subscribe(fn:()=>void){listeners.add(fn);return()=>{listeners.delete(fn);};},start,
    async checkForUpdate(){if(!client){await start();return false;}const ok=await client.checkForUpdate();
      if(ok && !disposed){try{const registration=client.snapshot().registration;
        const offlineReady=!!registration && await (options.readStatus ?? (value=>verifiedShellStatus(value,options.statusTimeoutMs ?? 5000)))(registration);
        publish({phase:offlineReady?'ready':'error',offlineReady,error:offlineReady?null:'Offline shell installation is not confirmed'});
      }catch(error){publish({phase:'error',error:errorText(error)});}}
      activityChanged();return ok;},
    activityChanged,suspend(){suspended=true;publish();},resume(){suspended=false;activityChanged();if(!client)void start();},
    dispose(){if(disposed)return;disposed=true;abort.abort();client?.dispose();listeners.clear();},
  });
}
export type UiAppShell = ReturnType<typeof createUiAppShell>;
