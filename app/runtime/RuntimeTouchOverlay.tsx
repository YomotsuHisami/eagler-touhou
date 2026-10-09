import {useLocale} from '../components/LocaleProvider';
import {usePlayerHelpOpen} from '../components/HelpPanel';
import type {UiMessageKey} from '../../src/launcher/i18n.mts';
import {useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type RefObject} from 'react';
import {useLocation} from 'react-router';
import {PRODUCT_GAMES} from '../../src/contracts/product-catalog.mts';
import {DEFAULT_GAME_OPTIONS, touchMovementUsesJoystick} from '../../src/launcher/game-preferences.mts';
import {functionKeyGames} from '../../src/launcher/touch-function-key.mts';
import {cloneTouchLayoutProfile, normalizeTouchLayoutPriorityOrder, touchLayoutControlNames, type TouchLayoutControlName} from '../../src/launcher/touch-layout-model.mts';
import {TouchControlCopy, touchControlLabelKeys} from '../components/TouchControl';
import {useRuntimeViewport, useRuntimeViewportSnapshot} from './RuntimeViewport';
import {useRuntimeFrame, useRuntimeService, useRuntimeSnapshot} from './RuntimeHost';
import type {RuntimeLauncherControlContext, RuntimeService} from '../services/runtime.client';
import type {TouchInputAction, TouchInputController, TouchTrainerKey} from '../services/touch-input.client';
import type {LayoutRect, TouchLayoutGeometry} from '../services/touch-layout.client';
import '../components/touch-layout-editor.css';

const subscribeNone = () => () => {}, noSnapshot = () => null;
const rect = (value: DOMRect): LayoutRect => ({left: value.left, top: value.top, width: value.width, height: value.height});
const trainerLabels: Readonly<Record<TouchTrainerKey, UiMessageKey>> = {Tab: 'react.touch.tracker', Backspace: 'touch.cheatMenu', F1: 'touch.invincible', F2: 'touch.infiniteLives', F3: 'touch.infiniteBombs', F4: 'touch.infinitePower', F5: 'touch.timeLock', F6: 'touch.autoBomb', F7: 'touch.enemyBgm', F12: 'touch.advancedMenu'};
const actionFor = (name: TouchLayoutControlName): TouchInputAction | null => name === 'joystick' ? null : name === 'thpracTab' ? 'Tab' : name === 'thpracMenu' ? 'Backspace' : name;

/** Input is tied to the immutable prepared epoch, never the currently edited form. */
export default function RuntimeTouchOverlay() {
  const service = useRuntimeService(), frame = useRuntimeFrame(), runtime = useRuntimeSnapshot();
  const context = service?.getLauncherControlContext();
  if (!service || !frame || !context || !runtime?.launched || !runtime.ready || runtime.spectator || context.options.touchEnabled !== true) return null;
  return <RuntimeTouchOverlayForContext service={service} frame={frame} context={context}/>;
}
/** Synthetic DOM fixtures may inject an empty frame and a non-network Runtime port. */
export function RuntimeTouchOverlayForContext({service, frame, context}: {service: RuntimeService; frame: RefObject<HTMLIFrameElement | null>; context: RuntimeLauncherControlContext}) {
  return <TouchEpoch key={context.epoch} service={service} frame={frame} context={context}/>;
}
function TouchEpoch({service, frame, context}: {service: RuntimeService; frame: RefObject<HTMLIFrameElement | null>; context: RuntimeLauncherControlContext}) {
  const {t} = useLocale();
  const viewport = useRuntimeViewport(), viewportSnapshot = useRuntimeViewportSnapshot();
  const root = useRef<HTMLDivElement>(null), safe = useRef<HTMLDivElement>(null), direct = useRef<HTMLDivElement>(null);
  const defaults = useRef(new Map<TouchLayoutControlName, HTMLButtonElement>()), controls = useRef(new Map<string, HTMLButtonElement>());
  const [owner, setOwner] = useState<TouchInputController | null>(null);
  const [layoutModel, setLayoutModel] = useState<typeof import('../services/touch-layout.client') | null>(null);
  const [geometry, setGeometry] = useState<TouchLayoutGeometry | null>(null), [trainerOpen, setTrainerOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const location = useLocation();
  const helpOpen = usePlayerHelpOpen();
  const [platform] = useState(() => {
    const ios = /iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/i.test(navigator.userAgent));
    return {ios, direct: ios || /\bAndroid\b/i.test(navigator.userAgent)};
  });
  const snapshot = useSyncExternalStore(owner?.subscribe ?? subscribeNone, owner?.getSnapshot ?? noSnapshot, noSnapshot);
  const options = {...DEFAULT_GAME_OPTIONS, ...context.options}, joystick = touchMovementUsesJoystick(options.touchMovementMode);
  const visible = touchLayoutControlNames.filter(name => name === 'focus' ? options.touchFocusMode !== 'two-finger'
    : name === 'joystick' ? joystick : name === 'restart' ? context.launcherControls.restartButtonEnabled
      : name === 'function' ? functionKeyGames.has(context.game)
        : name === 'thpracTab' || name === 'thpracMenu' ? context.launcherControls.thpracTouchControlsEnabled : true);

  useEffect(() => {
    let active = true, controller: TouchInputController | null = null;
    void Promise.all([import('../services/touch-input.client'), import('../services/touch-layout.client')]).then(([input, layout]) => {
      if (!active) return;
      controller = input.createTouchInputController(context, {
        current: () => service.getInputContext(), post: (command, payload) => service.postInput(command, payload),
        schedule: (callback, ms) => window.setTimeout(callback, ms), cancel: timer => window.clearTimeout(timer as number),
        requestFrame: callback => requestAnimationFrame(callback), cancelFrame: token => cancelAnimationFrame(token as number),
      });
      setLayoutModel(layout);setOwner(controller);controller.start();
    }).catch(reason => {if (active) setError(reason instanceof Error ? reason.message : String(reason));});
    return () => {active = false;controller?.dispose();};
  }, [service, context]);

  useLayoutEffect(() => {
    if (!owner || !layoutModel || !root.current || !safe.current) return;
    const measure = () => {
      if (!root.current || !safe.current) return;
      try {
        const host = root.current.getBoundingClientRect();
        const measured: TouchLayoutGeometry = {orientation: host.width >= host.height ? 'landscape' : 'portrait', safe: rect(safe.current.getBoundingClientRect()),
          controls: Object.fromEntries(touchLayoutControlNames.map(name => [name, rect(defaults.current.get(name)!.getBoundingClientRect())])) as Record<TouchLayoutControlName, LayoutRect>};
        measured.defaults = measured.controls;
        measured.controls = {...measured.controls, bomb: {...measured.controls.bomb, width: measured.controls.bomb.width / 1.5, height: measured.controls.bomb.height / 1.5}};
        layoutModel.measuredDefaultTouchProfile(measured);setGeometry(measured);
        if (frame.current) owner.updateFrameRect(rect(frame.current.getBoundingClientRect()));
      } catch (reason) {setError(reason instanceof Error ? reason.message : String(reason));}
    };
    measure();const observer = new ResizeObserver(measure);observer.observe(root.current);
    if (frame.current) observer.observe(frame.current);
    let firstFrame = 0, secondFrame = 0;
    const refreshAfterOrientation = () => {
      owner.cancel();
      cancelAnimationFrame(firstFrame);cancelAnimationFrame(secondFrame);
      firstFrame = requestAnimationFrame(() => {secondFrame = requestAnimationFrame(measure);});
    };
    const orientation = (screen as Screen & {orientation?: EventTarget}).orientation;
    orientation?.addEventListener('change', refreshAfterOrientation);
    window.addEventListener('resize', refreshAfterOrientation);
    window.visualViewport?.addEventListener('resize', measure);
    return () => {observer.disconnect();orientation?.removeEventListener('change', refreshAfterOrientation);window.removeEventListener('resize', refreshAfterOrientation);window.visualViewport?.removeEventListener('resize', measure);cancelAnimationFrame(firstFrame);cancelAnimationFrame(secondFrame);};
  }, [owner, layoutModel, frame]);

  useEffect(() => {
    if (!owner) return;
    const params = new URLSearchParams(location.search);
    const focus = () => {
      const target = document.activeElement;
      const foreignDialog = target instanceof Element && !!target.closest('[role="dialog"],dialog,input,select,textarea,[contenteditable]') && !root.current?.contains(target);
      owner.suspend(helpOpen || params.get('panel') === 'help' || params.get('touchLayout') === '1' || foreignDialog);
    };
    const hidden = () => {if (document.visibilityState === 'hidden') owner.cancel();};
    const blur = () => queueMicrotask(() => {if (!document.hasFocus()) owner.cancel();});
    focus();document.addEventListener('focusin', focus);document.addEventListener('visibilitychange', hidden);window.addEventListener('blur', blur);
    return () => {document.removeEventListener('focusin', focus);document.removeEventListener('visibilitychange', hidden);window.removeEventListener('blur', blur);};
  }, [owner, location.search, helpOpen]);

  useEffect(() => {
    const target = frame.current?.contentWindow;
    if (!target || !context.launcherControls.thpracTouchControlsEnabled) return;
    const menu = (event: Event) => {
      if (service.getLauncherControlContext()?.epoch !== context.epoch) return;
      const detail: unknown = (event as CustomEvent).detail;
      setTrainerOpen(!!detail && typeof detail === 'object' && 'open' in detail && detail.open === true);
    };
    try {target.addEventListener('eagler-thprac-menu', menu);} catch {return;}
    return () => {try {target.removeEventListener('eagler-thprac-menu', menu);} catch { /* The old document is gone. */ }};
  }, [frame, service, context]);

  function refocus() {
    // Moving focus while iOS owns a direct TouchEvent gesture may terminate it.
    if (platform.ios && owner?.getSnapshot().directCount) return;
    if (frame.current && document.activeElement !== frame.current) frame.current.focus({preventScroll: true});
  }
  function invoke(action: () => void) {try {action();} catch (reason) {setError(reason instanceof Error ? reason.message : String(reason));}}
  function refreshTransformedRect() {
    if (viewport?.getSnapshot().active && frame.current) owner?.updateFrameRect(rect(frame.current.getBoundingClientRect()));
  }
  function directDown(id: number, x: number, y: number) {
    const target = frame.current;
    const accepted = !!target && !!owner?.directDown(id, x, y, rect(target.getBoundingClientRect()));
    if (accepted) viewport?.beginPointer('host', id, x, y);
    return accepted;
  }
  function directMove(id: number, x: number, y: number) {
    refreshTransformedRect();owner?.directMove(id, x, y);viewport?.movePointer('host', id, x, y);
  }
  function directUp(id: number, x: number, y: number) {
    refreshTransformedRect();owner?.directUp(id, x, y);viewport?.endPointer(id);
  }
  useLayoutEffect(() => {
    if (frame.current) owner?.updateFrameRect(rect(frame.current.getBoundingClientRect()));
  }, [owner, frame, viewportSnapshot?.transform]);


  // React's delegated TouchEvents can be passive on mobile. Main's iOS path
  // requires native passive:false listeners to suppress compatibility clicks
  // and keep simultaneous movement/HUD contacts in one host document.
  useEffect(() => {
    if (!owner || !platform.ios) return;
    const removals: Array<() => void> = [];
    function bind(element: HTMLElement, phase: 'touchstart' | 'touchmove' | 'touchend' | 'touchcancel', handler: (event: TouchEvent) => void) {
      element.addEventListener(phase, handler, {passive: false});removals.push(() => element.removeEventListener(phase, handler));
    }
    for (const [name, element] of controls.current) {
      if (name === 'joystick') continue;
      const action = name as TouchInputAction;
      bind(element, 'touchstart', event => {event.preventDefault();invoke(() => {for (const contact of Array.from(event.changedTouches)) owner.down(action, contact.identifier);refocus();});});
      for (const phase of ['touchend', 'touchcancel'] as const) bind(element, phase, event => {event.preventDefault();invoke(() => {for (const contact of Array.from(event.changedTouches)) owner.up(action, contact.identifier, phase === 'touchcancel');});});
    }
    if (direct.current && platform.direct && !joystick) {
      bind(direct.current, 'touchstart', event => {event.preventDefault();invoke(() => {for (const contact of Array.from(event.changedTouches)) directDown(contact.identifier, contact.clientX, contact.clientY);});});
      bind(direct.current, 'touchmove', event => {event.preventDefault();invoke(() => {for (const contact of Array.from(event.changedTouches)) directMove(contact.identifier, contact.clientX, contact.clientY);});});
      for (const phase of ['touchend', 'touchcancel'] as const) bind(direct.current, phase, event => {event.preventDefault();invoke(() => {for (const contact of Array.from(event.changedTouches)) directUp(contact.identifier, contact.clientX, contact.clientY);});});
    }
    return () => {for (const remove of removals) remove();};
  }, [owner, platform.ios, platform.direct, joystick, !!geometry, trainerOpen]);

  function actionProps(action: TouchInputAction) {
    const held = action === 'focus' && options.touchFocusMode === 'hold-button' || action === 'fire' && PRODUCT_GAMES[context.game].touchFire.mode === 'held-key';
    return {
      onPointerDown(event: React.PointerEvent<HTMLButtonElement>) {
        if (platform.ios || event.button !== 0) return;event.preventDefault();
        invoke(() => {if (owner?.down(action, event.pointerId)) {event.currentTarget.setPointerCapture(event.pointerId);refocus();}});
      },
      onPointerUp(event: React.PointerEvent<HTMLButtonElement>) {if (!platform.ios) {event.preventDefault();invoke(() => owner?.up(action, event.pointerId));}},
      onPointerCancel(event: React.PointerEvent<HTMLButtonElement>) {if (!platform.ios) invoke(() => owner?.up(action, event.pointerId, true));},
      onLostPointerCapture(event: React.PointerEvent<HTMLButtonElement>) {if (!platform.ios) invoke(() => owner?.up(action, event.pointerId, true));},
      onKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {if (held && [' ', 'Enter'].includes(event.key)) {event.preventDefault();if (!event.repeat) invoke(() => owner?.down(action, -2));}},
      onKeyUp(event: React.KeyboardEvent<HTMLButtonElement>) {if (held && [' ', 'Enter'].includes(event.key)) {event.preventDefault();invoke(() => owner?.up(action, -2));}},
      onBlur() {if (held) invoke(() => owner?.up(action, -2, true));},
      onClick(event: React.MouseEvent<HTMLButtonElement>) {if (!held && event.detail === 0) invoke(() => {owner?.activate(action);refocus();});},
    };
  }
  const measuredDefaults = geometry && layoutModel?.measuredDefaultTouchProfile(geometry);
  const profile = geometry ? cloneTouchLayoutProfile(context.launcherControls.touchLayout?.profiles[geometry.orientation]) ?? measuredDefaults : null;
  if (profile && measuredDefaults) {
    for (const name of touchLayoutControlNames) if (!profile.controls[name]) profile.controls[name] = {...measuredDefaults.controls[name]!};
    normalizeTouchLayoutPriorityOrder(profile.controls);
  }
  function defaultControl(name: TouchLayoutControlName) {
    return <button key={name} ref={node => {if (node) defaults.current.set(name, node);else defaults.current.delete(name);}} tabIndex={-1} type="button" className={`layout-control layout-${name}`}><TouchControlCopy name={name} game={context.game} focusMode={options.touchFocusMode}/></button>;
  }
  return <div ref={root} className="touch-runtime touch-controls-surface" data-joystick={joystick} aria-label={t('react.touch.runtimeAria')}
    style={{'--touch-control-opacity': (context.launcherControls.touchControlOpacity ?? 100) / 100} as CSSProperties}>
    <div ref={safe} className="layout-safe" style={{borderColor: 'transparent'}}/>
    <div className="layout-defaults" aria-hidden="true" inert><div className="layout-hud">{(['focus', 'fire', 'function', 'bomb'] as const).map(defaultControl)}</div>{(['joystick', 'escape', 'restart', 'thpracTab', 'thpracMenu'] as const).map(defaultControl)}</div>
    {platform.direct && !joystick && <div ref={direct} className="pointer-events-auto absolute inset-0 touch-none" aria-hidden="true"
      onPointerDown={event => {if (platform.ios || event.pointerType === 'mouse') return;event.preventDefault();invoke(() => {if (directDown(event.pointerId, event.clientX, event.clientY)) event.currentTarget.setPointerCapture(event.pointerId);});}}
      onPointerMove={event => {if (!platform.ios) invoke(() => directMove(event.pointerId, event.clientX, event.clientY));}}
      onPointerUp={event => {if (!platform.ios) invoke(() => directUp(event.pointerId, event.clientX, event.clientY));}}
      onPointerCancel={event => {if (!platform.ios) invoke(() => directUp(event.pointerId, event.clientX, event.clientY));}}
      onLostPointerCapture={event => {if (!platform.ios) invoke(() => directUp(event.pointerId, event.clientX, event.clientY));}}/>}
    {profile && geometry && layoutModel && owner && visible.map(name => {
      const item = profile.controls[name]!, placed = layoutModel.effectiveTouchPlacement(item, geometry.controls[name], geometry.safe);
      const style = {left: geometry.safe.left + placed.x * geometry.safe.width, top: geometry.safe.top + placed.y * geometry.safe.height,
        zIndex: 10 + placed.priority, '--layout-scale': placed.scale,
        ...(name === 'joystick' ? {'--stick-x': `${snapshot?.joystickVisual.x ?? 0}px`, '--stick-y': `${snapshot?.joystickVisual.y ?? 0}px`} : {})} as CSSProperties;
      const action = actionFor(name);
      const pressed = name === 'fire' ? PRODUCT_GAMES[context.game].touchFire.mode === 'held-key' ? snapshot?.heldFire : snapshot?.fireEnabled : name === 'focus' ? snapshot?.focusEnabled : name === 'function' ? snapshot?.functionPressed : undefined;
      return <button key={name} ref={node => {const key = action ?? name;if (node) controls.current.set(key, node);else controls.current.delete(key);}} type="button" className={`layout-control layout-${name} layout-placed`} style={style} aria-label={t(touchControlLabelKeys[name])} aria-pressed={pressed}
        {...(action ? actionProps(action) : {
          onPointerDown(event: React.PointerEvent<HTMLButtonElement>) {if (event.button !== 0) return;event.preventDefault();invoke(() => {if (owner.joystickDown(event.pointerId, event.clientX, event.clientY, rect(event.currentTarget.getBoundingClientRect()))) event.currentTarget.setPointerCapture(event.pointerId);});},
          onPointerMove(event: React.PointerEvent<HTMLButtonElement>) {invoke(() => owner.joystickMove(event.pointerId, event.clientX, event.clientY, rect(event.currentTarget.getBoundingClientRect())));},
          onPointerUp(event: React.PointerEvent<HTMLButtonElement>) {invoke(() => owner.joystickUp(event.pointerId));},
          onPointerCancel(event: React.PointerEvent<HTMLButtonElement>) {invoke(() => owner.joystickUp(event.pointerId));},
          onLostPointerCapture(event: React.PointerEvent<HTMLButtonElement>) {invoke(() => owner.joystickUp(event.pointerId));},
        })}><TouchControlCopy name={name} game={context.game} focusMode={options.touchFocusMode}/></button>;
    })}
    {trainerOpen && context.launcherControls.thpracTouchControlsEnabled && <div className="pointer-events-auto absolute top-1/2 right-3 z-40 grid max-h-[45vh] grid-cols-2 gap-1 overflow-auto rounded-xl bg-panel/95 p-2" aria-label={t('react.touch.trainerAria')}>
      {(['F12', 'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7'] as const).map(action => <button key={action} ref={node => {if (node) controls.current.set(action, node);else controls.current.delete(action);}} type="button" className="min-h-11 rounded-lg bg-background px-2 py-1 text-xs text-paper" {...actionProps(action)}>{action} {t(trainerLabels[action])}</button>)}
    </div>}
    {error && <p role="alert" className="pointer-events-auto absolute bottom-4 left-1/2 z-50 max-w-sm -translate-x-1/2 rounded-xl bg-panel p-3 text-xs text-accent">{t('react.touch.runtimeError', {reason:error})}</p>}
  </div>;
}
