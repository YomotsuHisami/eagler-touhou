/**
 * SYNTHETIC DIALOG FIXTURE ONLY. No Runtime, game, package, or WASM is loaded.
 * Build as its own HTML entry; browser execution is for authorized GitHub CI.
 */
import {StrictMode, useLayoutEffect, useRef, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {AnimatedDialog, AnimatedDialogClose} from '../../app/components/AnimatedDialog';
import '../../app/styles.css';

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
  setOpen(value: boolean) {flushSync(() => controls!.open(value));},
  setBusy(value: boolean) {flushSync(() => controls!.busy(value));},
  removeOpener() {flushSync(() => controls!.opener(false));},
  removeFallback() {flushSync(() => controls!.fallback(false));},
  setRestore(value: boolean) {flushSync(() => controls!.restore(value));},
  inspect() {return {...events, requests: [...events.requests]};},
};

declare global {
  interface Window {
    __dialogMotionFixture: {
      setOpen(value: boolean): void;
      setBusy(value: boolean): void;
      removeOpener(): void;
      removeFallback(): void;
      setRestore(value: boolean): void;
      inspect(): {open: number; close: number; requests: boolean[]};
    };
  }
}

createRoot(document.getElementById('root')!).render(<StrictMode><Fixture/></StrictMode>);
