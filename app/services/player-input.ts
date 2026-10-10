import {createGameZoomController} from '../../src/launcher/game-zoom.mts';
import {touchLayoutControlMeta, touchLayoutControlNames, type TouchLayoutProfile} from '../../src/launcher/touch-layout-model.mts';
import {effectivePlacement} from '../components/settings/touch-layout-geometry';
import {createPlayerTouch} from './player-touch';
import {createPlayerKeyboard} from './player-keyboard';
import type {BrowserSession} from '../session/browser-session';
import type {Translate} from '../i18n';

/** Main7088–7095/9523–9526: observe actual orientation and safe-zone changes;
 * an explicit successful lock also waits two frames for settled viewport metrics.
 * This is the same binding used below, with injectable browser scheduling. */
export function bindPlayerLayoutUpdates({window, safeZone, applyLayout}: {
  window: Pick<Window, 'addEventListener' | 'removeEventListener' | 'requestAnimationFrame' | 'cancelAnimationFrame' | 'visualViewport' | 'screen'> & {ResizeObserver?: typeof ResizeObserver};
  safeZone: Element;
  applyLayout(): void;
}) {
  let disposed = false;
  const viewport = window.visualViewport, orientation = window.screen.orientation;
  type Pending = {frame: number | null; resolve(value: boolean): void; reject(error: unknown): void};
  const pending = new Set<Pending>();
  const refresh = () => {if (!disposed) applyLayout();};
  window.addEventListener('resize', refresh, {passive: true});
  viewport?.addEventListener('resize', refresh, {passive: true});
  orientation?.addEventListener?.('change', refresh);
  const observer = typeof window.ResizeObserver === 'function' ? new window.ResizeObserver(refresh) : null;
  observer?.observe(safeZone);
  function relayoutAfterOrientation(): Promise<boolean> {
    if (disposed) return Promise.resolve(false);
    return new Promise<boolean>((resolve, reject) => {
      const task: Pending = {frame: null, resolve, reject}; pending.add(task);
      task.frame = window.requestAnimationFrame(() => {
        task.frame = null;
        if (disposed) {pending.delete(task); resolve(false); return;}
        task.frame = window.requestAnimationFrame(() => {
          task.frame = null; pending.delete(task);
          if (disposed) {resolve(false); return;}
          try {applyLayout(); resolve(true);} catch (error) {reject(error);}
        });
      });
    });
  }
  return {
    relayoutAfterOrientation,
    dispose() {
      if (disposed) return; disposed = true;
      window.removeEventListener('resize', refresh); viewport?.removeEventListener('resize', refresh);
      orientation?.removeEventListener?.('change', refresh); observer?.disconnect();
      for (const task of pending) {if (task.frame !== null) window.cancelAnimationFrame(task.frame); task.resolve(false);}
      pending.clear();
    },
  };
}
/** Main2816: shared saved-layout presentation for gameplay and boot preview. */
export function applySavedPlayerTouchLayout(player: HTMLElement, safe: HTMLElement, profile: TouchLayoutProfile | null) {
  const controls = touchLayoutControlNames.map(name => ({name, node: player.querySelector<HTMLElement>(`#${touchLayoutControlMeta[name].id}`)!}));
  if (!profile) {
    player.classList.remove('touch-layout-custom');
    for (const {node} of controls) for (const property of ['--touch-layout-x', '--touch-layout-y', '--touch-layout-scale', 'z-index']) node.style.removeProperty(property);
    return;
  }
  const hostRect = player.getBoundingClientRect(), safeRect = safe.getBoundingClientRect();
  if (!hostRect.width || !hostRect.height || !safeRect.width || !safeRect.height) return;
  player.classList.add('touch-layout-custom');
  for (const {name, node} of controls) {
    const item = profile.controls[name]; if (!item) continue;
    const position = effectivePlacement(node, item, safeRect);
    node.style.setProperty('--touch-layout-x', `${safeRect.left - hostRect.left + position.x * safeRect.width}px`);
    node.style.setProperty('--touch-layout-y', `${safeRect.top - hostRect.top + position.y * safeRect.height}px`);
    node.style.setProperty('--touch-layout-scale', String(item.scale));
    node.style.zIndex = String(31 + (Number.isFinite(item.priority) ? item.priority : touchLayoutControlMeta[name].priority));
  }
}
/** Bounded DOM binding for the permanent player. Input protocol, preferences,
 * native window identity and iframe/save lifetime stay with existing owners. */
export function bindPlayerInput({session, document, window, translate: t}: {session: BrowserSession; document: Document; window: Window; translate: Translate}) {
  const attachedRuntime = session.getRuntime();
  if (!attachedRuntime) throw new Error('Runtime frame must be attached before input');
  const runtime = attachedRuntime;
  const element = <T extends HTMLElement = HTMLElement>(id: string) => {const value = document.getElementById(id); if (!value) throw new Error(`Missing original Player element: ${id}`); return value as T;};
  const player = element('player'), frame = element<HTMLIFrameElement>('gameFrame'), viewport = element('gameViewport');
  const toggle = element('gameZoomToggle'), directSurface = element('touchDirectSurface'), safe = element('touchLayoutSafeZone');
  const android = /\bAndroid\b/i.test(window.navigator.userAgent);
  const ios = /iPad|iPhone|iPod/i.test(window.navigator.userAgent) || /Macintosh/i.test(window.navigator.userAgent) && window.navigator.maxTouchPoints > 1;
  const editing = () => session.touchLayout.getSnapshot().isEditing;
  const orientation = () => (window.visualViewport?.width || document.documentElement.clientWidth || player.clientWidth) >= (window.visualViewport?.height || document.documentElement.clientHeight || player.clientHeight) ? 'landscape' : 'portrait';
  const profile = () => session.touchLayout.getSnapshot().saved?.profiles[orientation()] ?? null;
  const zoom = createGameZoomController({player, frame, viewport, toggle, toggleLabel: toggle.querySelector('strong')!, scaleLabel: element('gameZoomScale'), directSurface,
    getBaseOffset: () => ({x: (profile()?.viewport.x ?? 0) * player.clientWidth, y: 0}), getResetLabel: () => t('action.reset'),
    isAvailable: () => !!session.getActiveSettings()?.options.magnifierEnabled && (session.mobile || window.navigator.maxTouchPoints > 0) && runtime.getSnapshot().launched && !editing(), minScale: 1, maxScale: 3});
  const refocus = () => {if (document.activeElement !== frame) frame.focus({preventScroll: true});};
  const touch = createPlayerTouch({runtime, fireState: session.touchFireState, getSettings: session.getActiveSettings, editing, playerOpen: () => session.getSnapshot().playerOpen,
    iosWebKitTouch: ios, refocus, zoom, document, window, elements: {frame, directSurface,
      fire: element('touchFire'), focus: element('touchFocus'), functionKey: element('touchFunction'), escape: element('touchEscape'), bomb: element('touchBomb'), restart: element('touchRestart'),
      joystick: element('touchJoystick'), joystickKnob: element('touchJoystickKnob'), thpracBackspace: element('touchThpracBackspace'), thpracKeys: [...player.querySelectorAll<HTMLElement>('[data-thprac-key]')]}});
  const keyboard = createPlayerKeyboard({runtime, window, document, frame, playerOpen: () => session.getSnapshot().playerOpen, android,
    launcherOwnsTarget: target => target instanceof Element && !!target.closest('input,select,textarea,button,dialog,[role=dialog]'),
    releaseHeldTouchFire: touch.releaseHeldTouchFire, cancelTouchFunction: touch.cancelTouchFunction,
    isPlayerFullscreen: session.nativeTouch.isFullscreen, toggleFullscreen: () => {void session.togglePlayerFullscreen();}});
  let currentNative: ReturnType<typeof runtime.getMidiEventContext> = null, startedEpoch: number | null = null, requestedEpoch: number | null = null;
  function applyLayout() {
    applySavedPlayerTouchLayout(player, safe, profile());
    if (runtime.getSnapshot().launched) zoom.applyTransform();
  }
  const lockCodes = ['Escape','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','KeyZ','KeyX','ShiftLeft','ShiftRight','Enter','Tab','Backspace','F1','F2','F3','F4','F5','F6','F7','KeyU','F12'];
  const nativeKeyboard = (window.navigator as Navigator & {keyboard?: {lock?(codes: string[]): Promise<void>; unlock?(): void}}).keyboard;
  const fullscreen = () => {zoom.cancelGesture(); if (session.nativeTouch.isFullscreen() && runtime.getSnapshot().launched) {void nativeKeyboard?.lock?.(lockCodes).catch(() => {}); if (!(ios && touch.hasDirectPointers())) refocus();} else if (!session.nativeTouch.isFullscreen()) nativeKeyboard?.unlock?.();};
  document.addEventListener('fullscreenchange', fullscreen); document.addEventListener('webkitfullscreenchange', fullscreen);
  function sync() {
    const next = runtime.getMidiEventContext(), snapshot = runtime.getSnapshot();
    if (next?.document !== currentNative?.document || next?.epoch !== currentNative?.epoch) {
      zoom.uninstallInputBridge(); currentNative = next;
      if (next) zoom.bindInputWindow(next.target as Window);
    }
    if (snapshot.phase === 'launching' && snapshot.epoch !== requestedEpoch) {requestedEpoch = snapshot.epoch; keyboard.startFocusRelay();}
    if (snapshot.launched && snapshot.epoch !== startedEpoch) {startedEpoch = snapshot.epoch; zoom.applyTransform(1, 0, 0); touch.syncControls(); keyboard.startFocusRelay(); fullscreen();}
    if (!snapshot.launched) startedEpoch = null; if (!snapshot.ready) requestedEpoch = null;
    zoom.refreshUi();
  }
  const unsubscribe = runtime.subscribe(sync), unsubscribeEvents = runtime.subscribeEvents(message => {if (message.event === 'first-frame' && runtime.getSnapshot().launched) touch.syncControls();});
  const unsubscribeLayout = session.touchLayout.subscribe(applyLayout);
  const reset = (event: Event) => {if (!runtime.getSnapshot().launched) return; event.preventDefault(); event.stopPropagation(); zoom.reset(); refocus();};
  const layoutUpdates = bindPlayerLayoutUpdates({window, safeZone: safe, applyLayout});
  toggle.addEventListener('click', reset);
  sync(); applyLayout();
  return {touch, keyboard, zoom, relayoutAfterOrientation: layoutUpdates.relayoutAfterOrientation, dispose() {layoutUpdates.dispose(); document.removeEventListener('fullscreenchange', fullscreen); document.removeEventListener('webkitfullscreenchange', fullscreen); nativeKeyboard?.unlock?.(); unsubscribe(); unsubscribeEvents(); unsubscribeLayout(); keyboard.dispose(); touch.dispose(); zoom.uninstallInputBridge(); zoom.cancelGesture(); toggle.removeEventListener('click', reset);}};
}
