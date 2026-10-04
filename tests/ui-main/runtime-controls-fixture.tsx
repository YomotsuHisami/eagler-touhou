/**
 * SYNTHETIC UI FIXTURE ONLY. This does not prepare or execute a game, WASM,
 * package, protocol peer, or RuntimeProvider. The permanent iframe is empty.
 * Browser execution belongs to the separately authorized GitHub CI gate.
 */
import {StrictMode, useSyncExternalStore} from 'react';
import {createRoot} from 'react-dom/client';
import {createBrowserRouter, Link, Outlet, RouterProvider, useLocation, useSearchParams} from 'react-router';
import {MotionConfig} from 'motion/react';
import {RuntimeControlsForService} from '../../app/runtime/RuntimeControls';
import {GlobalHelpPanel} from '../../app/components/HelpPanel';
import type {RuntimePhase, RuntimeService, RuntimeSnapshot} from '../../app/services/runtime.client';
import '../../app/styles.css';

const empty = (): RuntimeSnapshot => ({phase: 'idle', game: null, epoch: null, generationId: null,
  codeGeneration: null, source: null, ready: false, launched: false, firstFrame: false, spectator: false,
  error: null, saveError: null, saveRoot: null, scoreFile: null, configFiles: [], runtimeInfo: {},
  netplayTiming: null, progress: null, frameHealth: null, audioHealth: null, exit: null});

function syntheticService() {
  let snapshot: RuntimeSnapshot = empty();
  let epoch = 0;
  const listeners = new Set<() => void>();
  let pendingSync: {resolve(): void; reject(error: Error): void} | null = null;
  let closing: Promise<boolean> | null = null;
  let lostSession = false;
  const calls = {close: 0, sync: 0, discard: 0, completed: 0};
  function update(patch: Partial<RuntimeSnapshot>) {
    snapshot = Object.freeze({...snapshot, ...patch});
    listeners.forEach(listener => listener());
  }
  function finish() {
    lostSession = false;
    update(empty());
    if (fake.service === service) document.querySelector<HTMLIFrameElement>('[data-synthetic-runtime-frame]')?.removeAttribute('src');
    calls.completed++;
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
      if (discardUnsaved) {calls.discard++;finish();return Promise.resolve(true);}
      if (lostSession) return Promise.resolve(false);
      if (!snapshot.ready) {finish();return Promise.resolve(true);}
      const phase = snapshot.phase;
      update({phase: 'saving', saveError: null});
      closing = (async () => {
        try {await service.sync();if (lostSession) return false;finish();return true;}
        catch (error) {if (!lostSession) update({phase, saveError: error instanceof Error ? error.message : String(error)});return false;}
        finally {closing = null;}
      })();
      return closing;
    },
    prepare: async () => {throw new Error('Synthetic fixture cannot prepare a game');},
    launch: async () => {throw new Error('Synthetic fixture cannot launch a game');},
    send: async () => {throw new Error('Synthetic fixture has no protocol peer');},
    postInput: () => false,
    getInputContext: () => ({target: null, targetOrigin: location.origin, protocol: 'synthetic-only', game: '', epoch: 0, launched: false, ready: false, spectator: false}),
    getNetworkSnapshot: () => {throw new Error('Synthetic fixture has no Runtime network');},
    cancel: () => {throw new Error('Controls must use close, never cancel');},
    dispose: () => {throw new Error('Controls must not dispose a connected frame');},
    disposeDetachedFrame: () => {throw new Error('Fixture frame must remain mounted');},
  };
  return {service, start(phase: RuntimePhase = 'running') {
    if (pendingSync || closing) throw new Error('Finish the controlled sync before starting another synthetic session');
    lostSession = false;
    // The real service enters configuring only after Runtime ready was received.
    const preparing = phase === 'loading';
    update({...empty(), phase, game: 'th06', epoch: ++epoch, generationId: `synthetic-${epoch}`, source: 'about:blank',
      ready: !preparing, launched: phase === 'running' || phase === 'error', firstFrame: phase === 'running',
      error: phase === 'error' ? 'Synthetic launch timeout' : null});
    const frame = document.querySelector<HTMLIFrameElement>('[data-synthetic-runtime-frame]');
    if (frame) frame.src = 'about:blank';
  }, resolveSync() {
    if (!pendingSync) throw new Error('No synthetic sync is pending');
    const pending = pendingSync;pendingSync = null;pending.resolve();
  }, rejectSync(message = 'Synthetic save failed') {
    if (!pendingSync) throw new Error('No synthetic sync is pending');
    const pending = pendingSync;pendingSync = null;pending.reject(new Error(message));
  }, abnormalExit(message = 'Synthetic native Runtime exited before save completed') {
    lostSession = true;
    update({...empty(), phase: 'error', error: message, saveError: message});
    if (fake.service === service) document.querySelector<HTMLIFrameElement>('[data-synthetic-runtime-frame]')?.removeAttribute('src');
    if (pendingSync) {const pending = pendingSync;pendingSync = null;pending.reject(new Error(message));}
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
  return <MotionConfig reducedMotion="user"><main id="main-content" tabIndex={-1} className="p-8 pt-28">
    <h1 className="text-xl">Synthetic Runtime controls fixture, no game execution</h1>
    <p data-testid="synthetic-phase">{snapshot.phase}</p>
    <RuntimeControlsForService service={owner.service}/>
    <GlobalHelpPanel/>
    <iframe data-synthetic-runtime-frame title="Synthetic empty Runtime frame" src="about:blank" className="h-16 w-32 border border-line"/>
    <Outlet/>
  </main></MotionConfig>;
}
function SyntheticRoute() {
  const location = useLocation();
  const [query] = useSearchParams();
  const helpQuery = new URLSearchParams(query);helpQuery.set('panel', 'help');
  return <section>
    <p data-testid="synthetic-location">{location.pathname}{location.search}{location.hash}</p>
    <nav aria-label="Synthetic navigation" className="flex flex-wrap gap-4 py-4">
      <Link to="/" className="p-3">Synthetic library</Link>
      <Link to="/games/th06" className="p-3">Synthetic TH06</Link>
      <Link to="/games/th07" className="p-3">Synthetic TH07</Link>
      <Link to={{search: helpQuery.toString(), hash: location.hash}} state={{returnTo: location.pathname}} className="p-3">Synthetic help trigger</Link>
    </nav>
  </section>;
}
const router = createBrowserRouter([{element: <FixtureLayout/>, children: [
  {path: '/games/:productId', element: <SyntheticRoute/>},
  {path: '*', element: <SyntheticRoute/>},
]}]);
const fixture = {
  start: (phase?: RuntimePhase) => fake.start(phase),
  resolveSync: () => fake.resolveSync(),
  rejectSync: (message?: string) => fake.rejectSync(message),
  abnormalExit: (message?: string) => fake.abnormalExit(message),
  inspect: () => fake.inspect(),
  replaceOwner() {previousOwner = fake;fake = syntheticService();ownerListeners.forEach(listener => listener());},
  resolvePreviousSync() {if (!previousOwner) throw new Error('No previous synthetic owner');previousOwner.resolveSync();},
  navigate: (to: string | number) => typeof to === 'number' ? router.navigate(to) : router.navigate(to),
};
declare global {interface Window {__runtimeControlsFixture: typeof fixture}}
window.__runtimeControlsFixture = fixture;
const root = document.getElementById('root');
if (!root) throw new Error('Synthetic fixture root is missing');
createRoot(root).render(<StrictMode><RouterProvider router={router}/></StrictMode>);
