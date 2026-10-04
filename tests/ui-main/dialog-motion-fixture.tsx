/**
 * SYNTHETIC DIALOG FIXTURE ONLY. No Runtime, game, package, or WASM is loaded.
 * Build as its own HTML entry; browser execution is for authorized GitHub CI.
 */
import {StrictMode, useLayoutEffect, useRef, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {AnimatedDialog, AnimatedDialogClose} from '../../app/components/AnimatedDialog';
import {MotionPreferenceProvider} from '../../app/components/MotionPreferenceProvider';
import {motionPreferenceStore} from '../../app/services/motion-preference.client';
import {isRunningInteriorMotion} from './dialog-motion-observation';
import '../../app/styles.css';

export interface DialogMotionSample {
  at: number;
  sampledAt: number;
  timelineTime: number | null;
  opacity: number;
  y: number;
  native: null | {
    id: number;
    currentTime: number | null;
    startTime: number | null;
    playState: AnimationPlayState;
    pending: boolean;
    duration: number;
    delay: number;
    easing: string;
    keyframes: Array<{opacity: number; offset: number | null; easing: string}>;
  };
}

const animationIds = new WeakMap<Animation, number>();
let nextAnimationId = 0;
const motionFrames: Array<{stage: string; at: number; raf: number | null; sample: DialogMotionSample | null}> = [];
function sampleMotion(): DialogMotionSample | null {
  const node = document.querySelector<HTMLElement>('[data-animated-dialog]');
  if (!node) return null;
  const at = performance.now();
  const style = getComputedStyle(node);
  const opacity = Number(style.opacity);
  const y = style.transform === 'none' ? 0 : new DOMMatrixReadOnly(style.transform).m42;
  const animation = node.getAnimations().find(animation =>
    (animation.effect as KeyframeEffect | null)?.getKeyframes().some(frame => frame.opacity !== undefined));
  let native: DialogMotionSample['native'] = null;
  if (animation) {
    if (!animationIds.has(animation)) animationIds.set(animation, ++nextAnimationId);
    const effect = animation.effect as KeyframeEffect;
    const timing = effect.getTiming();
    native = {id: animationIds.get(animation)!,
      currentTime: typeof animation.currentTime === 'number' ? animation.currentTime : null,
      startTime: typeof animation.startTime === 'number' ? animation.startTime : null,
      playState: animation.playState, pending: animation.pending,
      duration: Number(timing.duration), delay: timing.delay ?? 0, easing: timing.easing ?? 'linear',
      keyframes: effect.getKeyframes().map(frame => ({opacity: Number(frame.opacity), offset: frame.offset, easing: frame.easing ?? 'linear'}))};
  }
  return {at, sampledAt: performance.now(), timelineTime: typeof document.timeline.currentTime === 'number' ? document.timeline.currentTime : null,
    opacity, y, native};
}

function recordMotion(stage: string, raf: number | null = null) {
  const sample = sampleMotion();
  motionFrames.push({stage, at: performance.now(), raf, sample});
  return sample;
}

function observeMotion<T>(stage: string, predicate: (sample: DialogMotionSample) => boolean, onMatch: (sample: DialogMotionSample) => T): Promise<T> {
  const startedAt = performance.now();
  recordMotion(`${stage}:start`);
  return new Promise((resolve, reject) => {
    function tick(raf: number) {
      const sample = recordMotion(stage, raf);
      if (sample && predicate(sample)) {
        // Interrupt in the observing frame itself. Yielding through an await
        // first can miss the remainder of a short animation under runner load.
        try {resolve(onMatch(sample));} catch (error) {reject(error);}
      } else if (performance.now() - startedAt > 4000) {
        reject(new Error(`Dialog stage "${stage}" was not observed; started=${startedAt}; last=${JSON.stringify(sample)}; frames=${motionFrames.length}`));
      } else requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  });
}

const events = {open: 0, close: 0, requests: [] as boolean[]};
let controls: {
  open(value: boolean): void;
  busy(value: boolean): void;
  opener(value: boolean): void;
  fallback(value: boolean): void;
  restore(value: boolean): void;
} | undefined;

function Fixture() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [hasOpener, setHasOpener] = useState(true);
  const [hasFallback, setHasFallback] = useState(true);
  const [restore, setRestore] = useState(true);
  const fallback = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    controls = {open: setOpen, busy: setBusy, opener: setHasOpener, fallback: setHasFallback, restore: setRestore};
    return () => {controls = undefined;};
  }, []);

  return <main id="main-content" tabIndex={-1} className="min-h-svh p-8">
    <h1 className="mb-6 text-xl">Synthetic dialog motion fixture, no game execution</h1>
    {hasOpener && <button id="opener" type="button" onClick={() => setOpen(true)} className="m-2 rounded-xl border border-line p-3">Open dialog</button>}
    <button id="other-opener" type="button" onClick={() => setOpen(true)} className="m-2 rounded-xl border border-line p-3">Other opener</button>
    {hasFallback && <button ref={fallback} id="fallback" type="button" className="m-2 rounded-xl border border-line p-3">Fallback focus</button>}
    <p>This empty iframe is only a sibling identity marker, never a Runtime.</p>
    <iframe title="Synthetic empty frame" data-empty-frame="" src="about:blank" className="h-10 w-24"/>
    <AnimatedDialog open={open} onOpenChange={next => {
      events.requests.push(next);
      if (!busy) setOpen(next);
    }} title="Synthetic dialog" description="A retained synthetic form exercises the reusable dialog shell."
      returnFocus={fallback}
      onOpenAutoFocus={() => {events.open++;}}
      onCloseAutoFocus={event => {events.close++;if (!restore) event.preventDefault();}}
      onEscapeKeyDown={event => {if (busy) event.preventDefault();}}
      onPointerDownOutside={event => {if (busy) event.preventDefault();}}>
      <label className="block">Retained draft <input id="draft" defaultValue="unchanged draft" className="m-2 border border-line p-2"/></label>
      <AnimatedDialogClose className="mt-4 rounded-xl border border-line p-3">Dismiss</AnimatedDialogClose>
    </AnimatedDialog>
  </main>;
}

window.__dialogMotionFixture = {
  setLessMotion(value: boolean) {flushSync(() => motionPreferenceStore.setLessMotion(value));},
  setOpen(value: boolean) {flushSync(() => controls!.open(value));},
  setBusy(value: boolean) {flushSync(() => controls!.busy(value));},
  removeOpener() {flushSync(() => controls!.opener(false));},
  removeFallback() {flushSync(() => controls!.fallback(false));},
  setRestore(value: boolean) {flushSync(() => controls!.restore(value));},
  inspect() {return {...events, requests: [...events.requests]};},
  sampleMotion,
  recordMotion,
  observeMotion,
  isRunningInteriorMotion,
  motionFrames() {return motionFrames;},
};

declare global {
  interface Window {
    __dialogMotionFixture: {
      setLessMotion(value: boolean): void;
      setOpen(value: boolean): void;
      setBusy(value: boolean): void;
      removeOpener(): void;
      removeFallback(): void;
      setRestore(value: boolean): void;
      inspect(): {open: number; close: number; requests: boolean[]};
      sampleMotion(): DialogMotionSample | null;
      recordMotion: typeof recordMotion;
      observeMotion: typeof observeMotion;
      isRunningInteriorMotion: typeof isRunningInteriorMotion;
      motionFrames(): typeof motionFrames;
    };
  }
}

createRoot(document.getElementById('root')!).render(<StrictMode><MotionPreferenceProvider><Fixture/></MotionPreferenceProvider></StrictMode>);
