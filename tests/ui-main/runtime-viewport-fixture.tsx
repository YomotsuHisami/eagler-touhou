/** SYNTHETIC DOM ONLY: one empty iframe, no game files, WASM, Package data or real protocol peer. */
import {StrictMode, useLayoutEffect, useRef, useSyncExternalStore} from 'react';
import {createRoot} from 'react-dom/client';
import {createBrowserRouter} from 'react-router';
import {RouterProvider} from 'react-router/dom';
import {MotionConfig} from 'motion/react';
import {RuntimeViewport, RuntimeViewportProvider, useRuntimeViewport} from '../../app/runtime/RuntimeViewport';
import {RuntimeTouchOverlayForContext} from '../../app/runtime/RuntimeTouchOverlay';
import {RuntimeControlsForService} from '../../app/runtime/RuntimeControls';
import {GlobalHelpPanel, HelpProvider} from '../../app/components/HelpPanel';
import {NavigationDraftProvider} from '../../app/components/NavigationDrafts';
import type {RuntimeLauncherControlContext, RuntimeService, RuntimeSnapshot} from '../../app/services/runtime.client';
import type {TouchLayout} from '../../src/launcher/touch-layout-model.mts';
import '../../app/styles.css';

let epoch = 1;
let context: RuntimeLauncherControlContext = Object.freeze<RuntimeLauncherControlContext>({epoch, game: 'th06', runtimeVariant: 'normal',
  options: {touchEnabled: true, touchMovementMode: 'touch', touchSensitivity: 150, touchFocusMode: 'hold-button'},
  launcherControls: {restartButtonEnabled: true, thpracTouchControlsEnabled: false, magnifierEnabled: true, touchLayout: null}});
let snapshot: RuntimeSnapshot = Object.freeze({phase: 'running', game: 'th06', runtimeVariant: 'normal', epoch, generationId: 'synthetic', codeGeneration: null,
  source: 'about:blank', ready: true, launched: true, firstFrame: true, spectator: false, error: null, saveError: null, saveUnavailable: false, closeError: null,
  fileOperationBusy: false, saveRoot: null, scoreFile: null, configFiles: [], runtimeInfo: {}, netplayTiming: null, progress: null, frameHealth: null, audioHealth: null, exit: null});
const listeners = new Set<() => void>();
const unavailable = () => {throw new Error('Synthetic viewport fixture cannot perform real Runtime operations');};
const service: RuntimeService = {
  getSnapshot: () => snapshot, subscribe: callback => {listeners.add(callback);return () => {listeners.delete(callback);};},
  getLauncherControlContext: () => context,
  getInputContext: () => ({target: null, targetOrigin: location.origin, protocol: 'synthetic-only', game: 'th06', epoch, ready: true, launched: true, spectator: false}),
  getMidiEventContext: () => null, postInput: () => true,
  close: async () => false, sync: async () => {},
  prepare: unavailable, launch: unavailable, send: unavailable, withFileSession: unavailable, getNetworkSnapshot: unavailable,
  cancel: unavailable, dispose: unavailable, disposeDetachedFrame: unavailable, extendOggResources: unavailable,
};
let stableFrame: HTMLIFrameElement | null = null, stableDocument: Document | null = null;
function Probe({frame}: {frame: React.RefObject<HTMLIFrameElement | null>}) {
  const viewport = useRuntimeViewport();
  useLayoutEffect(() => {
    if (!viewport || !frame.current) return;
    stableFrame ??= frame.current;stableDocument ??= frame.current.contentDocument;
    window.__viewportFixture = {
      inspect() {const box = frame.current!.getBoundingClientRect();return {model: viewport.getSnapshot(), frame: {left: box.left, top: box.top, width: box.width, height: box.height}, sameFrame: frame.current === stableFrame, sameDocument: frame.current?.contentDocument === stableDocument};},
      start(layout) {epoch++;context = Object.freeze({...context, epoch, launcherControls: {...context.launcherControls, touchLayout: structuredClone(layout)}});snapshot = Object.freeze({...snapshot, epoch});for (const notify of listeners) notify();},
      pointer(space, phase, id, x, y) {
        if (space === 'frame') {
          const target = frame.current?.contentWindow;if (!target) throw new Error('No synthetic frame');
          target.dispatchEvent(new PointerEvent(`pointer${phase}`, {pointerId: id, clientX: x, clientY: y, pointerType: 'touch'}));
        } else if (phase === 'down') viewport.beginPointer('host', id, x, y);
        else if (phase === 'move') viewport.movePointer('host', id, x, y);
        else viewport.endPointer(id);
      },
      reset: () => viewport.reset(),
    };
  }, [frame, viewport]);
  return null;
}
function Fixture() {
  const frame = useRef<HTMLIFrameElement>(null);
  const state = useSyncExternalStore(service.subscribe, service.getSnapshot);
  return <MotionConfig reducedMotion="user"><NavigationDraftProvider><HelpProvider><RuntimeViewportProvider service={service} frame={frame}>
    <Probe frame={frame}/><RuntimeControlsForService service={service}/><GlobalHelpPanel/>
    <RuntimeTouchOverlayForContext service={service} frame={frame} context={context}/>
    <RuntimeViewport frame={frame} visible={state.launched}/>
  </RuntimeViewportProvider></HelpProvider></NavigationDraftProvider></MotionConfig>;
}
const router = createBrowserRouter([{path: '*', element: <Fixture/>}]);
createRoot(document.getElementById('root')!).render(<StrictMode><RouterProvider router={router}/></StrictMode>);

declare global {
  interface Window {__viewportFixture: {
    inspect(): {model: import('../../app/services/runtime-viewport').RuntimeViewportSnapshot; frame: {left: number; top: number; width: number; height: number}; sameFrame: boolean; sameDocument: boolean};
    start(layout: TouchLayout | null): void;
    pointer(space: 'host' | 'frame', phase: 'down' | 'move' | 'up', id: number, x: number, y: number): void;
    reset(): void;
  }}
}
