import {noticeEdgeLayout} from '../services/notice-edge-layout';
import {createContext, useContext, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode, type RefObject} from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import {usePlayerSurface} from '../runtime/PlayerToolsSurface';
import {AnimatePresence, MotionConfig, motion, useIsPresent} from 'motion/react';
import {useMotionPreference} from './MotionPreferenceProvider';
import {bindRoomOptionsSwipe} from '../browser/room-options-swipe';

type ContentProps = Dialog.DialogContentProps;
export interface AnimatedDialogProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  /** Actual retained portal lifetime, including its visual exit. */
  onPresenceChange?(present: boolean): void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  /** Resolve these refs at focus time: a navigation may have replaced the opener. */
  initialFocus?: RefObject<HTMLElement | null>;
  returnFocus?: RefObject<HTMLElement | null>;
  onOpenAutoFocus?: ContentProps['onOpenAutoFocus'];
  onCloseAutoFocus?: ContentProps['onCloseAutoFocus'];
  onEscapeKeyDown?: ContentProps['onEscapeKeyDown'];
  onPointerDownOutside?: ContentProps['onPointerDownOutside'];
  onInteractOutside?: ContentProps['onInteractOutside'];
  /** Content sits at this layer; its overlay sits immediately below it. */
  layer?: number;
  /** Reuse the same focus/animation owner for a native-title room surface. */
  /** Main only gave its room game/touch options drawer a close-only swipe. */
  swipeToClose?: 'right';
  swipeCloseKey?: string;
  layout?: 'dialog' | 'fullscreen' | 'library-panel' | 'lobby-dialog' | 'notice-right';
}

const ParentDialogReady = createContext(true);

interface LiveDialog {
  props: AnimatedDialogProps;
  surface: symbol | null;
  mounted: boolean;
}

function canFocus(target: HTMLElement | null | undefined): target is HTMLElement {
  if (!target?.isConnected || target === document.body || target.matches(':disabled') ||
      target.closest('[inert], [hidden], [aria-hidden="true"]')) return false;
  const style = getComputedStyle(target);
  return style.display !== 'none' && style.visibility !== 'hidden' && target.getClientRects().length > 0;
}

function focusFirst(...targets: Array<HTMLElement | null | undefined>) {
  for (const target of targets) {
    if (!canFocus(target)) continue;
    target.focus({preventScroll: true});
    if (document.activeElement === target) return;
  }
}

/**
 * Keep this shell mounted and pass the caller's open state. Do not key it by a
 * location, close intent, or animation phase. The single stable portal reverses
 * in place, retaining its children rather than cloning a second UI/Runtime.
 * Radix owns dismissal/focus; the caller alone owns routing and business state.
 *
 * Integration: motion.dev/docs/radix; radix-ui.com/primitives/docs/guides/animation
 */
export function AnimatedDialog(props: AnimatedDialogProps) {
  const playerSurface = usePlayerSurface(), parentReady = useContext(ParentDialogReady);
  // Exiting elements retain old React props. Mutable *committed* callbacks keep
  // delayed Radix autofocus from applying stale navigation/save decisions.
  const live = useRef<LiveDialog>({props, surface: null, mounted: true});
  useLayoutEffect(() => {live.current.props = props;});
  useLayoutEffect(() => {
    live.current.mounted = true;
    return () => {live.current.mounted = false;};
  }, []);

  // Motion 14 snapshots its configuration on mount. This retained surface uses
  // the live store's explicit duration/travel below, so do not let a stale Motion
  // flag keep suppressing travel after the user restores full motion.
  return <MotionConfig reducedMotion="never"><Dialog.Root open={props.open} onOpenChange={open => {if (live.current.mounted && (open || live.current.props.open)) live.current.props.onOpenChange(open);}}>
    <AnimatePresence mode="sync">
      {props.open && parentReady && (!playerSurface || playerSurface.element) && <Dialog.Portal key="animated-dialog" container={playerSurface?.element ?? undefined} forceMount>
        <DialogSurface {...props} live={live}/>
      </Dialog.Portal>}
    </AnimatePresence>
  </Dialog.Root></MotionConfig>;
}

const panelMedia = '(max-width: 780px)';
const subscribePanelMedia = (changed: () => void) => {
  const media = window.matchMedia(panelMedia); media.addEventListener('change', changed);
  return () => media.removeEventListener('change', changed);
};
const smallPanel = () => window.matchMedia(panelMedia).matches;
const serverPanel = () => false;

function DialogSurface({title, description, children, layer = 50, layout = 'dialog', swipeToClose, swipeCloseKey, live}: AnimatedDialogProps & {live: RefObject<LiveDialog>}) {
  const present = useIsPresent();
  const [childrenReady, setChildrenReady] = useState(false);
  // Keep live preference changes subscribed during exit too: the same retained
  // surface owns interruption, focus and the combined user/system preference.
  const {reducedMotion} = useMotionPreference();
  const mobilePanel = useSyncExternalStore(subscribePanelMedia, smallPanel, serverPanel);
  const panel = layout === 'library-panel', lobby = layout === 'lobby-dialog', notice = layout === 'notice-right';
  const surface = useRef(Symbol('dialog-surface'));
  const content = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!notice || !content.current) return;
    const element=content.current;
    const fit=()=>{const overlay=element.previousElementSibling;const extent=overlay instanceof HTMLElement && overlay.hasAttribute('data-dialog-overlay')?overlay.getBoundingClientRect().right:document.documentElement.clientWidth;const geometry=noticeEdgeLayout(window.innerWidth,extent);element.style.right=`${geometry.right}px`;element.style.width=`${geometry.width}px`;};
    fit();window.addEventListener('resize',fit);
    return()=>{window.removeEventListener('resize',fit);element.style.removeProperty('right');element.style.removeProperty('width');};
  },[notice]);
  const opener = useRef<HTMLElement | null>(null);
  const lastFocused = useRef<HTMLElement | null>(null);
  const wasPresent = useRef(present);
  const transition = {duration: reducedMotion ? 0 : notice ? .26 : panel ? .48 : .18, ease: [.22, .8, .22, 1] as const};
  const closed = {opacity: notice ? .7 : 0, x: reducedMotion ? 0 : notice ? '100%' : !panel || mobilePanel ? 0 : 36, y: reducedMotion || notice ? 0 : panel ? mobilePanel ? 40 : 0 : 12, scale: reducedMotion || !panel ? 1 : mobilePanel ? .98 : .97};

  useLayoutEffect(() => {live.current.surface = surface.current;}, [live]);
  useEffect(() => {
    // Radix hideOthers and layer insertion must commit before a descendant
    // modal mounts. Otherwise a late parent hides its already-mounted child.
    setChildrenReady(true);
    live.current.props.onPresenceChange?.(true);
    return () => {if (live.current.surface === surface.current) live.current.props.onPresenceChange?.(false);};
  }, [live]);
  const ownsDismissal = () => present && live.current.mounted && live.current.props.open && live.current.surface === surface.current;
  useEffect(() => {
    if (!present || swipeToClose !== 'right') return;
    return bindRoomOptionsSwipe({element: () => content.current,
      current: () => live.current.mounted && live.current.props.open && live.current.props.swipeToClose === 'right' && live.current.props.swipeCloseKey === swipeCloseKey && live.current.surface === surface.current,
      close: () => live.current.props.onOpenChange(false)});
  }, [present, swipeToClose, swipeCloseKey, live]);

  function captureOpener() {
    const active = document.activeElement;
    // Radix may already have hidden siblings from AT. Capture the actual opener
    // before autofocus, then validate it again after the modal has unmounted.
    if (active instanceof HTMLElement && active !== document.body && active.isConnected && !content.current?.contains(active)) {
      opener.current = active;
    }
  }

  function openAutoFocus(event: Event) {
    if (!live.current.props.open) {event.preventDefault();return;}
    captureOpener();
    live.current.props.onOpenAutoFocus?.(event);
    if (!event.defaultPrevented && canFocus(live.current.props.initialFocus?.current)) {
      event.preventDefault();
      focusFirst(live.current.props.initialFocus?.current, content.current);
    }
  }

  useEffect(() => {
    if (!present) {
      const active = document.activeElement;
      // The exiting surface is inert and absent from the accessibility tree.
      // Do not leave keyboard focus inside it until the visual exit completes.
      if (active instanceof HTMLElement && content.current?.contains(active)) active.blur();
    } else if (!wasPresent.current) {
      // A reversal reuses the same FocusScope, so Radix's mount autofocus does
      // not run again. Restore focus inside without remounting or restarting it.
      const event = new Event('animated-dialog.openAutoFocus', {cancelable: true});
      openAutoFocus(event);
      if (!event.defaultPrevented) focusFirst(lastFocused.current, content.current);
    }
    wasPresent.current = present;
  }, [present]);

  function closeAutoFocus(event: Event) {
    const current = live.current;
    // Radix schedules this after unmount. A newly opened surface, StrictMode
    // replay, or newer focus destination must not be overwritten by that timer.
    const active = document.activeElement;
    const oldSurface = event.target;
    const stale = !current.mounted || current.props.open || current.surface !== surface.current ||
      (oldSurface instanceof HTMLElement && oldSurface.isConnected);
    const focusMoved = active instanceof HTMLElement && active !== document.body &&
      active !== document.documentElement && active.isConnected &&
      !(oldSurface instanceof HTMLElement && oldSurface.contains(active));
    if (!stale && !focusMoved) {
      current.props.onCloseAutoFocus?.(event);
      if (!event.defaultPrevented) focusFirst(opener.current, current.props.returnFocus?.current, document.getElementById('main-content'));
    }
    event.preventDefault();
  }

  return <>
    <Dialog.Overlay forceMount asChild>
      <motion.div data-dialog-overlay="" aria-hidden="true" inert={!present}
        initial={{opacity: 0}} animate={{opacity: 1}} exit={{opacity: 0}} transition={transition}
        className={`fixed inset-0 ${notice ? 'bg-transparent' : panel ? 'bg-[#0d0d0c85]' : lobby ? 'bg-[#100e0cb8]' : 'bg-black/60'}`} style={{zIndex: layer - 1, pointerEvents: present ? 'auto' : 'none'}}/>
    </Dialog.Overlay>
    <Dialog.Content forceMount asChild onOpenAutoFocus={openAutoFocus} onCloseAutoFocus={closeAutoFocus}
      onEscapeKeyDown={event => {
        if (!ownsDismissal()) event.preventDefault();
        else live.current.props.onEscapeKeyDown?.(event);
      }}
      onPointerDownOutside={event => {
        if (!ownsDismissal()) event.preventDefault();
        else live.current.props.onPointerDownOutside?.(event);
      }}
      onInteractOutside={event => {
        if (!ownsDismissal()) event.preventDefault();
        else live.current.props.onInteractOutside?.(event);
      }}>
      <motion.div ref={content} data-animated-dialog="" data-dialog-layout={layout} data-swipe-to-close={swipeToClose} data-presence={present ? 'present' : 'exiting'} data-reduced-motion={reducedMotion}
        inert={!present} aria-hidden={!present || undefined} aria-modal={present ? true : undefined}
        initial={closed} animate={{opacity: 1, x: 0, y: 0, scale: 1}} exit={closed} transition={transition}
        onFocusCapture={event => {if (present) lastFocused.current = event.target;}}
        className={notice ? 'notice-right-panel' : panel ? 'library-panel' : lobby ? 'fixed inset-x-4 top-1/2 mx-auto max-h-[calc(100dvh-40px)] max-w-[440px] -translate-y-1/2 overflow-y-auto rounded-[26px] bg-[#20211e] p-7 text-[#f4eee8] shadow-[0_24px_90px_#0006] max-[820px]:p-6' : layout === 'fullscreen' ? 'fixed inset-0 overflow-y-auto overscroll-contain bg-panel text-paper' : 'fixed inset-x-4 top-1/2 mx-auto max-h-[calc(100svh-32px)] max-w-lg -translate-y-1/2 overflow-y-auto rounded-3xl border border-line bg-panel p-6 text-paper shadow-menu'}
        style={{zIndex: layer, pointerEvents: present ? 'auto' : 'none'}}>
        <Dialog.Title className={panel || layout === 'fullscreen' ? 'sr-only' : lobby ? 'text-2xl font-bold' : 'text-xl font-bold'}>{title}</Dialog.Title>
        {description != null && <Dialog.Description className="my-4 text-sm leading-relaxed text-nav">{description}</Dialog.Description>}
        <ParentDialogReady.Provider value={childrenReady}>{children}</ParentDialogReady.Provider>
      </motion.div>
    </Dialog.Content>
  </>;
}

export const AnimatedDialogClose = Dialog.Close;
