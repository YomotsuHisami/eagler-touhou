/** Synthetic Replay UI and file-port fixture only. No Runtime, persistence,
 * original-game data or WASM; browser execution belongs to authorized CI. */
import {StrictMode, useSyncExternalStore} from 'react';
import {createRoot} from 'react-dom/client';
import {createBrowserRouter, Link, Outlet, useLocation} from 'react-router';
import {RouterProvider} from 'react-router/dom';
import {LocaleProvider} from '../../app/components/LocaleProvider';
import {ReplayManagerView} from '../../app/components/ReplayManager';
import {createReplayController} from '../../app/services/replays.client';
import type {RuntimeFileSession, RuntimeService, RuntimeSnapshot} from '../../app/services/runtime.client';
import type {RuntimeResponseMessage} from '../../src/contracts/runtime-protocol.mts';
import '../../app/styles.css';

let snapshot: RuntimeSnapshot = {phase:'prepared',game:'th06',runtimeVariant:'normal',epoch:1,generationId:null,codeGeneration:null,source:null,
  ready:true,launched:false,firstFrame:false,spectator:false,error:null,saveError:null,saveUnavailable:false,
  closeError:null,fileOperationBusy:false,saveRoot:'/savesth06',scoreFile:'score.dat',configFiles:[],runtimeInfo:{},
  netplayTiming:null,progress:null,frameHealth:null,audioHealth:null,exit:null};
const files = new Map([['replay/th6_01.rpy', [0,128,255]], ['replay/th6_02.rpy', [9]]]);
const listeners = new Set<() => void>(), calls: string[] = [];
let heldRead: {promise: Promise<void>; resolve(): void} | null = null;
function update(patch: Partial<RuntimeSnapshot>) {snapshot = {...snapshot,...patch}; for (const listener of listeners) listener();}
const runtime: Pick<RuntimeService, 'getSnapshot' | 'subscribe' | 'withFileSession' | 'close'> = {
  getSnapshot: () => snapshot,
  subscribe(listener) {listeners.add(listener); return () => {listeners.delete(listener);};},
  async close() {calls.push('close'); throw new Error('Unexpected Runtime close in the Replay manager fixture');},
  async withFileSession(game, operation, options = {}) {
    const readOnly = options.readOnly === true, variant = options.runtimeVariant ?? 'normal';
    const runningRead = readOnly && snapshot.phase === 'running' && snapshot.launched;
    if (snapshot.fileOperationBusy || snapshot.game !== game || snapshot.runtimeVariant !== variant || snapshot.saveRoot !== `/saves${game}` ||
        snapshot.scoreFile !== 'score.dat' || (options.epoch !== undefined && snapshot.epoch !== options.epoch) ||
        (!runningRead && (snapshot.phase !== 'prepared' || snapshot.launched))) throw new Error('Synthetic files unavailable');
    const epoch = snapshot.epoch!;
    function check() {
      const phaseAllowed = snapshot.phase === 'prepared' && !snapshot.launched || readOnly && snapshot.phase === 'running' && snapshot.launched;
      if (snapshot.epoch !== epoch || snapshot.game !== game || snapshot.runtimeVariant !== variant || snapshot.saveRoot !== `/saves${game}` ||
          snapshot.scoreFile !== 'score.dat' || !phaseAllowed || !snapshot.ready || snapshot.saveUnavailable) throw new Error('Synthetic session replaced');
    }
    update({fileOperationBusy:true});
    const access: RuntimeFileSession = {
      epoch,
      async sync() {check(); calls.push('sync');},
      async send(command, payload) {
        check();
        if (readOnly && !['list', 'read'].includes(command)) throw new Error('Read-only Runtime file session');
        calls.push(command);
        let result: Partial<RuntimeResponseMessage>;
        if (command === 'list') result = {files:[...files].map(([path, bytes]) => ({path,size:bytes.length}))};
        else {
          const data = payload as {path:string;bytes?:number[]};
          if (command === 'read') {
            const gate = heldRead; if (gate) await gate.promise; check();
            if (!files.has(data.path)) throw new Error('Synthetic missing file');
            result = {bytes:[...files.get(data.path)!]};
          } else if (command === 'write') {files.set(data.path,[...data.bytes!]); result = {ok:true};}
          else {files.delete(data.path); result = {ok:true};}
        }
        check(); return result as RuntimeResponseMessage;
      },
      async restart() {
        if (readOnly) throw new Error('Read-only Runtime file session cannot restart a Runtime');
        throw new Error('Synthetic Replay fixture cannot restart a Runtime');
      },
    };
    try {return await operation(access);} finally {update({fileOperationBusy:false});}
  },
};
const controller = createReplayController({runtimeService:runtime});
controller.loadProduct('th06');
await controller.refresh('th06');
function ReplayView() {
  const state = useSyncExternalStore(controller.subscribe, () => controller.getSnapshot('th06')!);
  return <ReplayManagerView productId="th06" controller={controller} snapshot={state}/>;
}
function Layout() {
  const location = useLocation();
  return <LocaleProvider><main id="main-content" tabIndex={-1} className="mx-auto max-w-3xl p-5">
    <h1>Synthetic Replay manager fixture, no game execution</h1>
    <nav><Link to="/play/th06/replays?uiLocale=en">Replays</Link> · <Link to="/other?uiLocale=en">Other view</Link></nav>
    <p data-testid="location">{location.pathname}{location.search}</p><Outlet/>
  </main></LocaleProvider>;
}
const router = createBrowserRouter([{element:<Layout/>,children:[
  {path:'/play/th06/replays',element:<ReplayView/>},
  {path:'*',element:<p>Other synthetic view</p>},
]}]);
const fixture = {
  navigate: (path:string) => router.navigate(path),
  holdRead() {if (heldRead) throw new Error('Read already held'); let resolve!: () => void; const promise = new Promise<void>(done => {resolve=done;}); heldRead={promise,resolve};},
  releaseRead() {const gate=heldRead;heldRead=null;gate?.resolve();},
  replaceSession() {update({epoch:(snapshot.epoch ?? 0)+1});},
  externalBusy(value:boolean) {update({fileOperationBusy:value});},
  inspect: () => ({files:Object.fromEntries(files),calls:[...calls],busy:snapshot.fileOperationBusy}),
};
declare global {interface Window {__replayManagerFixture: typeof fixture}}
window.__replayManagerFixture=fixture;
createRoot(document.getElementById('root')!).render(<StrictMode><RouterProvider router={router}/></StrictMode>);
