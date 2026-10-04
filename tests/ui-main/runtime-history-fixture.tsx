/**
 * SYNTHETIC BROWSER OWNER TEST. Real RuntimeService + real browser navigation,
 * with injected in-memory Package/code dependencies and a fake protocol peer.
 * No retail DATA, real Runtime, WASM, IDBFS, service worker or gameplay is used.
 */
import {useEffect, useRef, useState, useSyncExternalStore} from 'react';
import {createRoot} from 'react-dom/client';
import {RouterProvider} from 'react-router/dom';
import {createBrowserRouter, Link, Outlet, useLocation} from 'react-router';
import {HelpProvider} from '../../app/components/HelpPanel';
import {MotionConfig} from 'motion/react';
import {RuntimeControlsForService} from '../../app/runtime/RuntimeControls';
import {createRuntimeService, type RuntimePlan, type RuntimeService} from '../../app/services/runtime.client';
import '../../app/styles.css';

const hostDocument = document;
const hostDocumentId = crypto.randomUUID();
const peerUrl = new URL('/__ui_tests__/runtime-history-peer.html', location.origin);
const generation: RuntimePlan['generation'] = {
  id: 'synthetic-history-package', game: 'th11', descriptor: {
    schema: 'eagler-touhou/package/1', game: 'th11', revision: 'synthetic-r1',
    runtimeRequirement: {protocol: 'eagler-touhou/1', target: 'th11', dataFile: 'game-data'},
    files: {'game-data': {source: 'synthetic.dat', target: '/th11.dat', revision: 'synthetic-r1', bytes: 2}},
    base: {files: ['game-data']}, components: {},
  }, files: {'game-data': {objectId: 'synthetic-memory-only', revision: 'synthetic-r1'}},
};
const noSubscribe = () => () => {};
const noSnapshot = () => null;

function FixtureLayout() {
  const frame = useRef<HTMLIFrameElement>(null);
  const [service, setService] = useState<RuntimeService | null>(null);
  const snapshot = useSyncExternalStore(service?.subscribe ?? noSubscribe, service?.getSnapshot ?? noSnapshot, noSnapshot);
  useEffect(() => {
    const element = frame.current;
    if (!element) throw new Error('Synthetic frame is missing');
    const initialProxy = element.contentWindow;
    const retains: string[] = [], releases: string[] = [], codeExclusions: string[][] = [];
    let rememberedDocument: Document | null = null;
    let pendingPreparation = false;
    let preparationError: string | null = null;
    const owner = createRuntimeService({frame: element, baseUrl: location.origin + '/', dependencies: {
      retainGeneration: async (_game, _generation, {leaseId}) => {retains.push(leaseId);return leaseId;},
      releaseGeneration: async leaseId => {releases.push(leaseId);},
      readData: async () => ({buffer: new Uint8Array([1, 2]).buffer, bytes: 2, fileId: 'game-data'}),
      readResource: async () => {throw new Error('Synthetic fixture has no installed resources');},
      prepareCode: async (_entry, options = {}) => {
        const excluded = [...(options.exclude ?? [])]; codeExclusions.push(excluded);
        const first = 'a'.repeat(64), second = 'b'.repeat(64);
        const entry = new URL(peerUrl);
        if (!excluded.includes(first)) entry.searchParams.set('bootstrapFailure', '1');
        return {url: entry.href, generation: excluded.includes(first) ? second : first, cached: false};
      },
    }});
    const makePlan = ({fallback = false, pauseReady = false}: {fallback?: boolean; pauseReady?: boolean} = {}): RuntimePlan => {
      const entry = new URL(peerUrl);
      if (pauseReady) entry.searchParams.set('pauseReady', '1');
      return {game: 'th11', runtimeVariant: 'normal', generation, entry: entry.href, publishedRuntime: fallback,
        configure: {music: 'none', options: {limitPresentationTo60: true}}};
    };
    const api = {
      prepare: (options?: {fallback?: boolean; pauseReady?: boolean}) => owner.prepare(makePlan(options)),
      beginPausedPreparation() {
        pendingPreparation = true; preparationError = null;
        void owner.prepare(makePlan({pauseReady: true})).catch(error => {
          preparationError = error instanceof Error ? error.message : String(error);
        }).finally(() => {pendingPreparation = false;});
      },
      launch: () => owner.launch(), close: () => owner.close(), cancel: () => owner.cancel(),
      rememberRuntime() {rememberedDocument = element.contentDocument;},
      navigate: (to: string | number) => typeof to === 'number' ? router.navigate(to) : router.navigate(to),
      inspect() {
        let childUrl: string | null = null, childReadyState: string | null = null;
        try {childUrl = element.contentWindow?.location.href ?? null;childReadyState = element.contentDocument?.readyState ?? null;} catch { /* Test reports unexpected cross-origin navigation. */ }
        return {snapshot: owner.getSnapshot(), hostDocumentId, sameHostDocument: document === hostDocument,
          sameFrame: element === document.querySelector('[data-runtime-history-frame]'), sameProxy: element.contentWindow === initialProxy,
          sameChildDocument: rememberedDocument === element.contentDocument, childUrl, childReadyState,
          historyLength: history.length, parentUrl: location.href, retains: [...retains], releases: [...releases],
          codeExclusions: codeExclusions.map(ids => [...ids]), pendingPreparation, preparationError};
      },
    };
    window.__runtimeHistoryFixture = api;
    setService(owner);
    return () => {
      if (element.isConnected === false) owner.disposeDetachedFrame();
      else if (!owner.getSnapshot().ready) owner.dispose();
    };
  }, []);
  return <MotionConfig reducedMotion="user"><HelpProvider><main id="main-content" tabIndex={-1} className="p-8 pt-28">
    <h1>Synthetic Runtime history fixture, no game execution</h1>
    <p data-testid="history-runtime-phase">{snapshot?.phase ?? 'initializing'}</p>
    <RuntimeControlsForService service={service}/>
    <iframe ref={frame} data-runtime-history-frame title="Synthetic Runtime history peer" className="h-24 w-80 border border-line"/>
    <Outlet/>
  </main></HelpProvider></MotionConfig>;
}
function SyntheticRoute() {
  const location = useLocation();
  return <section><p data-testid="history-parent-location">{location.pathname}{location.search}</p>
    <Link to="/games/th06">Synthetic product route</Link></section>;
}
const router = createBrowserRouter([{element: <FixtureLayout/>, children: [{path: '*', element: <SyntheticRoute/>}]}]);
type RuntimeHistoryFixture = {
  prepare(options?: {fallback?: boolean; pauseReady?: boolean}): ReturnType<RuntimeService['prepare']>;
  beginPausedPreparation(): void;
  launch(): ReturnType<RuntimeService['launch']>;
  close(): ReturnType<RuntimeService['close']>;
  cancel(): void;
  rememberRuntime(): void;
  navigate(to: string | number): ReturnType<typeof router.navigate>;
  inspect(): {snapshot: ReturnType<RuntimeService['getSnapshot']>; hostDocumentId: string; sameHostDocument: boolean;
    sameFrame: boolean; sameProxy: boolean; sameChildDocument: boolean; childUrl: string | null; childReadyState: string | null;
    historyLength: number; parentUrl: string; retains: string[]; releases: string[]; codeExclusions: string[][];
    pendingPreparation: boolean; preparationError: string | null};
};
declare global {interface Window {__runtimeHistoryFixture: RuntimeHistoryFixture}}
const root = document.getElementById('root');
if (!root) throw new Error('Synthetic fixture root is missing');
createRoot(root).render(<RouterProvider router={router}/>);
