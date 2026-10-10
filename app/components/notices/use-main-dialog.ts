import {useCallback, useEffect, useLayoutEffect, useRef} from 'react';

export interface MainDialogProps {
  open: boolean;
  /** Preserve routing/DOM while a non-dialog fullscreen foreground owns input. */
  suspended?: boolean;
  /** Central Router owner consumes the intent; component never writes history. */
  onCloseRequest(): void;
  /** Domain cleanup after an actual user/Router close, not StrictMode disposal. */
  onClosed?(): void;
}
export interface MainDialogAnimation {finished: Promise<unknown>; cancel(): void;}
export type MainDialogMotion = (dialog: HTMLDialogElement, phase: 'enter' | 'exit', fromCurrent: boolean) => MainDialogAnimation | null;
interface MainDialogMotionOptions {motion: MainDialogMotion; immediateClose?: boolean;}
/** One native-dialog lifecycle; existing numeric callers retain their CSS timer.
 * Completion-driven motion is opt-in and never owns presence or navigation.
 * Router Back closes without recursively requesting another history change.
 * The parent dialog is left open when a child native dialog is presented.
 */
export function useMainDialog({open, suspended = false, onCloseRequest, onClosed}: MainDialogProps, timing: number | MainDialogMotionOptions = 220, animationName?: string, returnValue?: string) {
  const duration = typeof timing === 'number' ? timing : null;
  const motion = typeof timing === 'number' ? undefined : timing.motion;
  const immediateClose = typeof timing === 'number' ? false : !!timing.immediateClose;
  const ref = useRef<HTMLDialogElement>(null);
  const animation = useRef<MainDialogAnimation | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const finish = useRef<(() => void) | null>(null);
  const notifyAfterClose = useRef(false);
  const suspendedFocus = useRef<HTMLElement | null>(null);
  const lifetimeOpen = useRef(false);
  const ownedCloseEvents = useRef(0);
  const callback = useRef({open, suspended, onCloseRequest, onClosed}); callback.current = {open, suspended, onCloseRequest, onClosed};
  const closeNative = useCallback((dialog: HTMLDialogElement, value?: string) => {
    if (!dialog.open) return;
    ownedCloseEvents.current++;
    dialog.close(value);
  }, []);
  const clear = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null; finish.current = null; notifyAfterClose.current = false;
    const previous = animation.current; animation.current = null; previous?.cancel();
  }, []);
  const observe = useCallback((active: MainDialogAnimation, completed?: () => void) => {
    const settled = () => {
      if (animation.current !== active) return;
      // Current cancellation also settles the native owner. Owner-triggered
      // cancellation clears this identity first, so stale results do nothing.
      if (completed) completed();
      else {animation.current = null; active.cancel();}
    };
    void Promise.resolve(active.finished).then(settled, settled);
  }, []);
  const close = useCallback((notify: boolean, immediate = false) => {
    const dialog = ref.current;
    if (!dialog?.open) return;
    if (finish.current) {
      // A committed Router Back supersedes an earlier button-close intent.
      if (!notify) notifyAfterClose.current = false;
      // Missing donation artwork closes immediately even during an exit.
      if (immediate) finish.current();
      return;
    }
    notifyAfterClose.current = notify;
    const complete = () => {
      if (finish.current !== complete) return;
      const shouldNotify = notifyAfterClose.current;
      const closingAnimation = animation.current; animation.current = null;
      clear();
      closeNative(dialog, returnValue);
      closingAnimation?.cancel();
      dialog.classList.remove('closing');
      if (lifetimeOpen.current) {lifetimeOpen.current = false; callback.current.onClosed?.();}
      if (shouldNotify) callback.current.onCloseRequest();
    };
    finish.current = complete;
    if (immediate || immediateClose || (duration !== null && duration <= 0) || matchMedia('(prefers-reduced-motion: reduce)').matches) complete();
    else {
      dialog.classList.add('closing');
      if (motion) {
        const next = motion(dialog, 'exit', true), previous = animation.current;
        animation.current = next; previous?.cancel();
        if (next) observe(next, complete); else complete();
      } else timer.current = setTimeout(complete, duration!);
    }
  }, [clear, closeNative, duration, returnValue, immediateClose, motion, observe]);
  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (suspended) {
      if (open) lifetimeOpen.current = true;
      else if (lifetimeOpen.current) {lifetimeOpen.current = false; callback.current.onClosed?.();}
      clear(); dialog.classList.remove('closing');
      if (document.activeElement instanceof HTMLElement && dialog.contains(document.activeElement)) suspendedFocus.current = document.activeElement;
      closeNative(dialog);
    } else if (open) {
      lifetimeOpen.current = true;
      const wasOpen = dialog.open;
      if (motion && !wasOpen) dialog.showModal();
      const opening = motion?.(dialog, 'enter', wasOpen) ?? null;
      clear(); dialog.classList.remove('closing');
      if (!dialog.open) dialog.showModal();
      if (opening) {animation.current = opening; observe(opening);}
      if (suspendedFocus.current?.isConnected && dialog.contains(suspendedFocus.current)) suspendedFocus.current.focus({preventScroll: true});
      suspendedFocus.current = null;
    } else {
      suspendedFocus.current = null;
      if (!dialog.open && lifetimeOpen.current) {lifetimeOpen.current = false; callback.current.onClosed?.();}
      close(false);
    }
  }, [open, suspended, close, closeNative, clear, motion, observe]);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const closed = () => {
      if (ownedCloseEvents.current) {ownedCloseEvents.current--; return;}
      if (dialog.open) return; // A queued event cannot close a newer opening.
      clear(); dialog.classList.remove('closing');
      if (lifetimeOpen.current) {lifetimeOpen.current = false; callback.current.onClosed?.();}
      if (callback.current.open && !callback.current.suspended) callback.current.onCloseRequest();
    };
    dialog.addEventListener('close', closed);
    return () => {
      clear(); dialog.removeEventListener('close', closed);
      // Capture the node before React clears its ref during deletion.
      if (dialog.open) dialog.close();
      ownedCloseEvents.current = 0;
    };
  }, [clear]);
  return {ref, finishPendingClose: () => finish.current?.(), cancelPendingClose: () => {clear(); ref.current?.classList.remove('closing');}, requestClose: () => close(true), requestImmediateClose: () => close(true, true),
    onCancel: (event: {preventDefault(): void}) => {event.preventDefault(); close(true);},
    onClick: (event: {target: EventTarget; currentTarget: EventTarget}) => {if (event.target === event.currentTarget) close(true);},
    onAnimationEnd: (event: {animationName: string}) => {if (animationName && event.animationName === animationName) finish.current?.();},
  };
}
