/**
 * SYNTHETIC UI FIXTURE ONLY. This does not prepare or execute a game, WASM,
 * package, protocol peer, or RuntimeProvider. The permanent iframe is empty.
 * Browser execution belongs to the separately authorized GitHub CI gate.
 */
import {StrictMode, useLayoutEffect, useRef, useState, useSyncExternalStore} from 'react';
import {createRoot} from 'react-dom/client';
import {RouterProvider} from 'react-router/dom';
import {createBrowserRouter, Link, Outlet, useLocation, useNavigation, useNavigationType} from 'react-router';
import {MotionConfig} from 'motion/react';
import {RuntimeControlsForService} from '../../app/runtime/RuntimeControls';
import {GlobalHelpPanel, HelpLink, HelpProvider} from '../../app/components/HelpPanel';
import type {RuntimePhase, RuntimeService, RuntimeSnapshot} from '../../app/services/runtime.client';
import {NavigationDraftProvider, useNavigationDraftGuard} from '../../app/components/NavigationDrafts';
import '../../app/styles.css';

const empty = (): RuntimeSnapshot => ({phase: 'idle', game: null, epoch: null, generationId: null,
  codeGeneration: null, source: null, ready: false, launched: false, firstFrame: false, spectator: false,
  error: null, saveError: null, saveUnavailable: false, closeError: null, fileOperationBusy: false, saveRoot: null, scoreFile: null, configFiles: [], runtimeInfo: {},
  netplayTiming: null, progress: null, frameHealth: null, audioHealth: null, exit: null});

function syntheticService() {
  let snapshot: RuntimeSnapshot = empty();
  let epoch = 0;
  const listeners = new Set<() => void>();
  let pendingSync: {resolve(): void; reject(error: Error): void} | null = null;
  let closing: Promise<boolean> | null = null;
  let lostSession = false;
  let nextCloseError: string | null = null;
  const calls = {close: 0, sync: 0, discard: 0, completed: 0};
  function update(patch: Partial<RuntimeSnapshot>) {
    snapshot = Object.freeze({...snapshot, ...patch});
    listeners.forEach(listener => listener());
  }
  function finish(): boolean {
    if (nextCloseError) {
      const message = nextCloseError;nextCloseError = null;
      update({phase: 'error', closeError: message});return false;
    }
    lostSession = false;
    update(empty());
    calls.completed++;
    return true;
  }
  const service: RuntimeService = {
    getSnapshot: () => snapshot,
    subscribe: listener => {listeners.add(listener);return () => {listeners.delete(listener);};},
    sync: () => {
      calls.sync++;
      if (pendingSync) throw new Error('Synthetic duplicate sync');
      return new Promise<void>((resolve, reject) => {pendingSync = {resolve, reject};});
    },
    close: ({discardUnsaved = false} = {}) => {
      calls.close++;
      if (closing) return closing;
      if (discardUnsaved) {calls.discard++;return Promise.resolve(finish());}
      if (lostSession) return Promise.resolve(false);
      if (!snapshot.ready) return Promise.resolve(finish());
      const phase = snapshot.phase;
      update({phase: 'saving', saveError: null, closeError: null});
      closing = (async () => {
        try {await service.sync();if (lostSession) return false;return finish();}
        catch (error) {if (!lostSession) update({phase, saveError: error instanceof Error ? error.message : String(error)});return false;}
        finally {closing = null;}
      })();
      return closing;
    },
    prepare: async () => {throw new Error('Synthetic fixture cannot prepare a game');},
    launch: async () => {throw new Error('Synthetic fixture cannot launch a game');},
    send: async () => {throw new Error('Synthetic fixture has no protocol peer');},
    withFileSession: async () => {throw new Error('Synthetic fixture has no file session');},
    postInput: () => false,
    extendOggResources: async () => {},
    getMidiEventContext: () => null, getLauncherControlContext: () => null,
    getInputContext: () => ({target: null, targetOrigin: location.origin, protocol: 'synthetic-only', game: '', epoch: 0, launched: false, ready: false, spectator: false}),
    getNetworkSnapshot: () => {throw new Error('Synthetic fixture has no Runtime network');},
    cancel: () => {throw new Error('Controls must use close, never cancel');},
    dispose: () => {throw new Error('Controls must not dispose a connected frame');},
    disposeDetachedFrame: () => {throw new Error('Fixture frame must remain mounted');},
  };
  return {service, start(phase: RuntimePhase = 'running') {
    if (pendingSync || closing) throw new Error('Finish the controlled sync before starting another synthetic session');
    lostSession = false;
    nextCloseError = null;
    // The real service enters configuring only after Runtime ready was received.
    const preparing = phase === 'loading';
    update({...empty(), phase, game: 'th06', epoch: ++epoch, generationId: `synthetic-${epoch}`, source: 'about:blank',
      ready: !preparing, launched: phase === 'running' || phase === 'error', firstFrame: phase === 'running',
      error: phase === 'error' ? 'Synthetic launch timeout' : null});
  }, resolveSync() {
    if (!pendingSync) throw new Error('No synthetic sync is pending');
    const pending = pendingSync;pendingSync = null;pending.resolve();
  }, rejectSync(message = 'Synthetic save failed') {
    if (!pendingSync) throw new Error('No synthetic sync is pending');
    const pending = pendingSync;pendingSync = null;pending.reject(new Error(message));
  }, abnormalExit(message = 'Synthetic native Runtime exited before save completed', retainEpoch = false) {
    lostSession = true;
    update({... (retainEpoch ? snapshot : empty()), phase: 'error', ready: false, launched: false,
      error: message, saveError: message, saveUnavailable: true,
      closeError: retainEpoch ? 'Synthetic terminal frame cleanup failed' : null});
    if (pendingSync) {const pending = pendingSync;pendingSync = null;pending.reject(new Error(message));}
  }, successfulExit(retainEpoch = false) {
    if (pendingSync) throw new Error('Complete the controlled sync before this successful exit');
    update({... (retainEpoch ? snapshot : empty()), phase: retainEpoch ? 'error' : 'exited', ready: false, launched: false,
      saveError: null, saveUnavailable: true, closeError: retainEpoch ? 'Synthetic successful-exit cleanup failed' : null});
  }, failNextClose(message = 'Synthetic frame cleanup failed after sync') {
    nextCloseError = message;
  }, inspect() {return {snapshot, calls: {...calls}, syncPending: pendingSync !== null};}};
}

let fake = syntheticService();
let previousOwner: ReturnType<typeof syntheticService> | null = null;
const ownerListeners = new Set<() => void>();
const subscribeOwner = (listener: () => void) => {ownerListeners.add(listener);return () => {ownerListeners.delete(listener);};};
const getOwner = () => fake;
function FixtureLayout() {
  const owner = useSyncExternalStore(subscribeOwner, getOwner);
  const snapshot = useSyncExternalStore(owner.service.subscribe, owner.service.getSnapshot);
  return <MotionConfig reducedMotion="user"><NavigationDraftProvider><HelpProvider><NavigationObserver/><main id="main-content" tabIndex={-1} className="p-8 pt-28">
    <h1 className="text-xl">Synthetic Runtime controls fixture, no game execution</h1>
    <p data-testid="synthetic-phase">{snapshot.phase}</p>
    <RuntimeControlsForService service={owner.service}/>
    <GlobalHelpPanel/>
    {/* This identity marker never navigates. Reassigning about:blank creates a
        child-only history entry in WebKit and would consume the first Back
        before the top-level Router sees a POP. Runtime navigation is covered
        by the Runtime service lane, not simulated by navigating this marker. */}
    <iframe data-synthetic-runtime-frame data-synthetic-session={snapshot.epoch === null ? 'inactive' : 'active'} title="Synthetic empty Runtime frame" className="h-16 w-32 border border-line"/>
    <Outlet/>
  </main></HelpProvider></NavigationDraftProvider></MotionConfig>;
}
let holdDraftSave = false;
let releaseDraftSave: (() => void) | null = null;
function SyntheticRoute() {
  const location = useLocation();
  const [dirty,setDirty] = useState(false), [failSave,setFailSave] = useState(false);
  useNavigationDraftGuard({label: 'Synthetic draft', shouldBlock: (a,b) => dirty && (a.pathname !== b.pathname || a.search !== b.search),
    save: async () => {if(holdDraftSave){holdDraftSave=false;await new Promise<void>(resolve=>{releaseDraftSave=resolve;});}if(failSave)throw new Error('Synthetic draft storage failed');setDirty(false);}, discard: () => setDirty(false)});
  return <section>
    <button onClick={()=>setDirty(true)}>Edit synthetic draft</button><button onClick={()=>setFailSave(true)}>Fail draft save</button><span data-testid="draft-dirty">{String(dirty)}</span>
    <p data-testid="synthetic-location">{location.pathname}{location.search}{location.hash}</p>
    <nav aria-label="Synthetic navigation" className="flex flex-wrap gap-4 py-4">
      <Link to="/" className="p-3">Synthetic library</Link>
      <Link to="/play/th06" className="p-3">Synthetic TH06</Link>
      <Link to="/play/th07" className="p-3">Synthetic TH07</Link>
      <Link to="/play/th06/resources" className="p-3">Synthetic resources</Link>
      <HelpLink className="p-3">Synthetic help trigger</HelpLink>
    </nav>
  </section>;
}
let holdNextHelp = false;
const heldHelp: Array<() => void> = [];
const navigationRecords: Array<{key: string; search: string; hash: string; pathname: string; pendingKey: string | null; pending: string | null; action: string; state: string}> = [];
function NavigationObserver() {
  const location = useLocation();
  const navigation = useNavigation();
  const action = useNavigationType();
  const previous = useRef<string | null>(null);
  useLayoutEffect(() => {
    // Observe only committed React renders through public hooks. Deduplicate
    // StrictMode effect replay and unrelated synthetic service updates.
    const signature = JSON.stringify([location.key, navigation.location?.key, navigation.state, action]);
    if (previous.current === signature) return;
    previous.current = signature;
    navigationRecords.push({key: location.key, pathname: location.pathname, search: location.search, hash: location.hash,
      pendingKey: navigation.location?.key ?? null, pending: navigation.location?.search ?? null,
      action, state: navigation.state});
  }, [location, navigation, action]);
  return null;
}
const router = createBrowserRouter([{element: <FixtureLayout/>, children: [
  {path: '/play/:productId', element: <SyntheticRoute/>},
  {path: '*', element: <SyntheticRoute/>},
]}], {dataStrategy: async ({request}) => {
  // Public DataMode async strategy reproduces Framework's initial synchronous
  // pending state followed by a non-flushSync final location commit. The old
  // no-strategy fast path cannot expose this Help keyboard readiness gap.
  if (holdNextHelp && new URL(request.url).searchParams.get('panel') === 'help') {
    holdNextHelp = false;
    await new Promise<void>(resolve => {heldHelp.push(resolve);});
  }
  return {};
}});
const fixture = {
  holdNextDraftSave() {holdDraftSave=true;},
  draftSavePending() {return releaseDraftSave !== null;},
  resolveDraftSave() {const resolve=releaseDraftSave;if(!resolve)throw new Error('No draft save pending');releaseDraftSave=null;resolve();},
  start: (phase?: RuntimePhase) => fake.start(phase),
  resolveSync: () => fake.resolveSync(),
  rejectSync: (message?: string) => fake.rejectSync(message),
  abnormalExit: (message?: string, retainEpoch?: boolean) => fake.abnormalExit(message, retainEpoch),
  successfulExit: (retainEpoch?: boolean) => fake.successfulExit(retainEpoch),
  failNextClose: (message?: string) => fake.failNextClose(message),
  inspect: () => fake.inspect(),
  replaceOwner() {previousOwner = fake;fake = syntheticService();ownerListeners.forEach(listener => listener());},
  resolvePreviousSync() {if (!previousOwner) throw new Error('No previous synthetic owner');previousOwner.resolveSync();},
  navigate: (to: string | number) => typeof to === 'number' ? router.navigate(to) : router.navigate(to),
  holdNextHelpNavigation() {holdNextHelp = true;},
  releaseHeldHelpNavigation() {const release = heldHelp.shift();if (!release) throw new Error('No Help navigation is held');release();},
  inspectHelpNavigation() {return {held: heldHelp.length, records: [...navigationRecords]};},
  clearNavigationRecords() {navigationRecords.length = 0;},
};
declare global {interface Window {__runtimeControlsFixture: typeof fixture}}
window.__runtimeControlsFixture = fixture;
const root = document.getElementById('root');
if (!root) throw new Error('Synthetic fixture root is missing');
createRoot(root).render(<StrictMode><RouterProvider router={router}/></StrictMode>);
