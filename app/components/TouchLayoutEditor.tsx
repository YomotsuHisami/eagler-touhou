import type {UiMessageKey} from '../../src/launcher/i18n.mts';
import {useLocale} from './LocaleProvider';
import {useMotionPreference} from './MotionPreferenceProvider';
import {createTouchEditorEntryMotion} from '../services/touch-editor-motion';
import {useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent} from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import {useSearchParams} from 'react-router';
import {gameIdForProduct} from '../../src/contracts/product-catalog.mts';
import {touchMovementUsesJoystick} from '../../src/launcher/game-preferences.mts';
import {functionKeyGames} from '../../src/launcher/touch-function-key.mts';
import {touchLayoutControlNames, touchLayoutScaleMin, touchLayoutScaleMax, type TouchLayoutControlName} from '../../src/launcher/touch-layout-model.mts';
import {useRuntimeSnapshot} from '../runtime/RuntimeHost';
import {usePlayerSurface} from '../runtime/PlayerToolsSurface';
import {exitPlayerFullscreen, requestPlayerFullscreen, type PlayerFullscreenDocument} from '../services/player-tools.client';
import {useNavigationDraftGuard} from './NavigationDrafts';
import type {PreferencesSnapshot, PreferencesStore} from '../services/preferences.client';
import {canEditTouchLayout, type LayoutRect, type TouchLayoutGeometry, type TouchLayoutSnapshot, type TouchLayoutStore} from '../services/touch-layout.client';
import {TouchSettingsFields} from './TouchSettingsFields';
import {TouchControlCopy, touchControlLabelKeys} from './TouchControl';
import {PlayerOrientationControl} from './PlayerOrientationControl';
import {useTouchLayoutStore, useTouchLayoutSnapshot} from './TouchLayoutProvider';
import './touch-layout-editor.css';
import '../runtime/runtime-viewport.css';

const buttonClass = 'min-h-11 rounded-xl border border-line px-3 py-2 text-xs hover:bg-nav-hover hover:text-nav-ink disabled:cursor-not-allowed disabled:opacity-50';
export function TouchLayoutEditor({settings, preferences, compact = false}: {settings: PreferencesSnapshot; preferences: PreferencesStore; compact?: boolean}) {
  const {t} = useLocale();
  const store = useTouchLayoutStore(), snapshot = useTouchLayoutSnapshot();
  const [params, setParams] = useSearchParams();
  const entryId = useId();
  const runtime = useRuntimeSnapshot();
  const playerSurface = usePlayerSurface();
  const opener = useRef<HTMLButtonElement>(null);
  const open = params.get('touchLayout') === '1';
  const canEdit = canEditTouchLayout(runtime);
  const fullscreenOwner = useRef<HTMLElement | null>(null), fullscreenRequest = useRef(0);
  const [fullscreenStatus, setFullscreenStatus] = useState<string | null>(null);
  useNavigationDraftGuard({
    label: t('react.touch.layoutName'),
    shouldBlock: (from, to) => !!store?.getSnapshot().dirty && new URLSearchParams(from.search).get('touchLayout') === '1' &&
      (from.pathname !== to.pathname || new URLSearchParams(to.search).get('touchLayout') !== '1'),
    save: () => { if (store && !store.save()) throw new Error(t('react.touch.saveError')); },
    discard: () => store?.discard(),
  });
  function changeOpen(value: boolean) {
    setParams(previous => {
      const next = new URLSearchParams(previous);
      if (value) next.set('touchLayout', '1'); else next.delete('touchLayout');
      return next;
    });
  }
  function requestEditorOpen() {
    const ticket = ++fullscreenRequest.current;
    setFullscreenStatus(null);
    changeOpen(true);
    const target = playerSurface?.element;
    if (!target) return;
    const doc = document as PlayerFullscreenDocument;
    const current = doc.fullscreenElement || doc.webkitFullscreenElement;
    if (current === target) return;
    if (current) {setFullscreenStatus(t('ui.playerTools.fullscreenForeign'));return;}
    void requestPlayerFullscreen(target).then(() => {
      const active = doc.fullscreenElement || doc.webkitFullscreenElement;
      if (ticket !== fullscreenRequest.current) {
        if (active === target) void exitPlayerFullscreen(doc).catch(() => {});
        return;
      }
      if (active === target) fullscreenOwner.current = target;
      else setFullscreenStatus(t('ui.playerTools.fullscreenUnconfirmed'));
    }).catch(error => {
      if (ticket === fullscreenRequest.current) setFullscreenStatus(t('fullscreen.autoBlocked', {reason:error instanceof Error ? error.message : String(error)}));
    });
  }
  function closeEditor() {
    fullscreenRequest.current++;
    changeOpen(false);
  }
  function handleOpenChange(value: boolean) {
    if (value) requestEditorOpen(); else closeEditor();
  }
  useEffect(() => {
    if (!open) return;
    return () => {
      fullscreenRequest.current++;
      const target = fullscreenOwner.current;
      fullscreenOwner.current = null;
      const doc = document as PlayerFullscreenDocument;
      if (target && (doc.fullscreenElement || doc.webkitFullscreenElement) === target) void exitPlayerFullscreen(doc).catch(() => {});
    };
  }, [open]);
  return <>
    {compact ? <div className="game-settings-touch-entry" role="group" aria-labelledby={`${entryId}-label`}>
      <span id={`${entryId}-label`}>{t('settings.touchLayout')}</span>
      <button ref={opener} type="button" className="game-settings-touch-entry-action" aria-label={t('settings.touchLayout')} aria-describedby={`${entryId}-description`} disabled={!store || !canEdit} onClick={requestEditorOpen}><span aria-hidden="true">›</span></button>
      <span id={`${entryId}-description`} className="sr-only">{t('settings.touchLayoutShared')}</span>
    </div> : <section className="my-6 grid gap-3 rounded-2xl border border-line p-4">
      <h2 className="text-base font-bold">{t('touch.layoutTab')}</h2>
      <p className="text-xs leading-relaxed text-muted">{t('react.touch.layoutHint')}</p>
      <button ref={opener} type="button" className={buttonClass} disabled={!store || !canEdit} onClick={requestEditorOpen}>{t('react.touch.editLayout')}</button>
      {!canEdit && <p className="text-xs text-muted">{t('react.touch.runningHint')}</p>}
    </section>}
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Portal container={playerSurface?.element ?? undefined}>
        <Dialog.Overlay className="fixed inset-0 z-[69] bg-black/80"/>
        <Dialog.Content className="touch-editor touch-editor-shell" onPointerDownOutside={event => event.preventDefault()} onCloseAutoFocus={event => {
          if (opener.current?.isConnected) {event.preventDefault();opener.current.focus();}
        }}>
          {store && snapshot && canEdit ? <TouchLayoutCanvas preferences={preferences} settings={settings} store={store} snapshot={snapshot} close={closeEditor} fullscreenStatus={fullscreenStatus}/> : <div className="m-6 grid gap-4">
            <Dialog.Title>{t('touch.layoutTab')}</Dialog.Title><Dialog.Description>{t('react.touch.runningHint')}</Dialog.Description>
            {fullscreenStatus && <p role="status">{fullscreenStatus}</p>}
            <button className={buttonClass} onClick={closeEditor}>{t('action.close')}</button>
          </div>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  </>;
}

const asRect = (rect: DOMRect): LayoutRect => ({left: rect.left, top: rect.top, width: rect.width, height: rect.height});
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
function visibleControls(settings: PreferencesSnapshot) {
  const options = settings.options;
  return touchLayoutControlNames.filter(name =>
    name === 'focus' ? options.touchFocusMode !== 'two-finger' :
    name === 'joystick' ? touchMovementUsesJoystick(options.touchMovementMode) :
    name === 'restart' ? options.restartButtonEnabled :
    name === 'function' ? functionKeyGames.has(gameIdForProduct(settings.productId)) :
    name === 'thpracTab' || name === 'thpracMenu' ? options.thpracTouchControlsEnabled : true);
}

type Gesture = {pointer: number; name: TouchLayoutControlName; x: number; y: number; kind: 'move'} |
  {pointer: number; name: TouchLayoutControlName; kind: 'resize'; left: number; top: number; width: number; height: number; scale: number} |
  {pointer: number; kind: 'viewport'; x: number} | {pointer: number; kind: 'workbench'; x: number; y: number};
function TouchLayoutCanvas({settings, preferences, store, snapshot, close, fullscreenStatus}: {settings: PreferencesSnapshot; preferences: PreferencesStore; store: TouchLayoutStore; snapshot: TouchLayoutSnapshot; close(): void; fullscreenStatus?: string | null}) {
  const {t} = useLocale();
  const playerSurface = usePlayerSurface();
  const id = useId(), root = useRef<HTMLDivElement>(null), safe = useRef<HTMLDivElement>(null), reserved = useRef<HTMLDivElement>(null), workbench = useRef<HTMLDivElement>(null);
  const defaults = useRef(new Map<TouchLayoutControlName, HTMLButtonElement>());
  const gesture = useRef<Gesture | null>(null), captureOwner = useRef<HTMLElement | null>(null);
  const {reducedMotion} = useMotionPreference();
  const [manipulating, setManipulating] = useState(false);
  const entryMotion = useRef<ReturnType<typeof createTouchEditorEntryMotion> | null>(null);
  entryMotion.current ??= createTouchEditorEntryMotion(() => root.current!.animate([{opacity: 0}, {opacity: 1}], {duration: 340, easing: 'cubic-bezier(.2,0,.2,1)'}));
  const [geometry, setGeometry] = useState<TouchLayoutGeometry | null>(null);
  const [error, setError] = useState<string | null>(null), [status, setStatus] = useState<UiMessageKey | null>(null);
  const [collapsed, setCollapsed] = useState(false), [viewportEditing, setViewportEditing] = useState(false);
  const [panelPoint, setPanelPoint] = useState<{x: number; y: number} | null>(null);
  const [preview, setPreview] = useState<{x: number; y: number} | null>(null);
  const previewPointer = useRef<{pointer: number; x: number; y: number; point: {x: number; y: number}} | null>(null);
  const joystick = touchMovementUsesJoystick(settings.options.touchMovementMode);
  const visible = visibleControls(settings);
  const selected = visible.includes(snapshot.selected) ? snapshot.selected : visible[0];
  const sceneReady = !!panelPoint && (!!error || !!geometry && !!snapshot.profile);
  useLayoutEffect(() => {if (sceneReady) entryMotion.current!.ready(reducedMotion);}, [sceneReady, reducedMotion]);
  useLayoutEffect(() => {entryMotion.current!.preferenceChanged(reducedMotion);}, [reducedMotion]);
  useLayoutEffect(() => () => entryMotion.current!.dispose(), []);
  useLayoutEffect(() => {
    function cancelGesture() {
      const current = gesture.current;
      gesture.current = null; previewPointer.current = null; setManipulating(false);
      if (current && captureOwner.current?.hasPointerCapture(current.pointer)) captureOwner.current.releasePointerCapture(current.pointer);
      captureOwner.current = null;
    }
    window.addEventListener('blur', cancelGesture); window.addEventListener('pagehide', cancelGesture);
    return () => {window.removeEventListener('blur', cancelGesture); window.removeEventListener('pagehide', cancelGesture); cancelGesture();};
  }, []);

  useLayoutEffect(() => {
    const host = root.current, zone = safe.current;
    if (!host || !zone) return;
    const measure = () => {
      try {
        const rect = host.getBoundingClientRect();
        const controls = Object.fromEntries(touchLayoutControlNames.map(name => {
          const node = defaults.current.get(name);
          if (!node) throw new Error(t('react.touch.missingControl', {name}));
          return [name, asRect(node.getBoundingClientRect())];
        })) as Record<TouchLayoutControlName, LayoutRect>;
        const next: TouchLayoutGeometry = {orientation: rect.width >= rect.height ? 'landscape' : 'portrait', safe: asRect(zone.getBoundingClientRect()), controls, reserved: reserved.current ? asRect(reserved.current.getBoundingClientRect()) : undefined};
        store.setGeometry(next); setGeometry(next); setError(null);
        gesture.current = null; previewPointer.current = null; setPreview(null); setManipulating(false);
      } catch (reason) {setError(reason instanceof Error ? reason.message : String(reason));}
    };
    measure();
    const observer = new ResizeObserver(measure); observer.observe(host); observer.observe(zone);
    let firstFrame = 0, secondFrame = 0;
    const refreshAfterOrientation = () => {
      const current = gesture.current;
      gesture.current = null; previewPointer.current = null; setPreview(null); setManipulating(false);
      if (current && captureOwner.current?.hasPointerCapture(current.pointer)) captureOwner.current.releasePointerCapture(current.pointer);
      captureOwner.current = null;
      cancelAnimationFrame(firstFrame); cancelAnimationFrame(secondFrame);
      firstFrame = requestAnimationFrame(() => {secondFrame = requestAnimationFrame(measure);});
    };
    const orientation = (screen as Screen & {orientation?: EventTarget}).orientation;
    orientation?.addEventListener('change', refreshAfterOrientation);
    window.addEventListener('resize', refreshAfterOrientation);
    return () => {observer.disconnect();orientation?.removeEventListener('change', refreshAfterOrientation);window.removeEventListener('resize', refreshAfterOrientation);cancelAnimationFrame(firstFrame);cancelAnimationFrame(secondFrame);gesture.current = null;previewPointer.current = null;};
  }, [store, joystick]);

  useEffect(() => {if (snapshot.dirty) setStatus(null);}, [snapshot.dirty]);

  useLayoutEffect(() => {
    const host = root.current?.getBoundingClientRect(), panel = workbench.current?.getBoundingClientRect();
    if (!host || !panel) return;
    const rangeX = Math.max(0, host.width - panel.width - 32), rangeY = Math.max(0, host.height - panel.height - 32);
    const point = snapshot.workbench;
    setPanelPoint(point ? {x: 16 + point.x * rangeX, y: 16 + point.y * rangeY}
      : {x: host.height > host.width ? (host.width - panel.width) / 2 : Math.max(16, host.width - panel.width - 16), y: Math.min(76, 16 + rangeY)});
  }, [snapshot.orientation, snapshot.workbench?.x, snapshot.workbench?.y, geometry?.safe.width, geometry?.safe.height, collapsed]);

  useLayoutEffect(() => {
    const host = root.current, panel = workbench.current;
    if (!host || !panel) return;
    const observer = new ResizeObserver(() => setPanelPoint(point => {
      if (!point) return point;
      const x = clamp(point.x, 16, Math.max(16, host.clientWidth - panel.offsetWidth - 16));
      const y = clamp(point.y, 16, Math.max(16, host.clientHeight - panel.offsetHeight - 16));
      return x === point.x && y === point.y ? point : {x, y};
    }));
    observer.observe(panel);
    return () => observer.disconnect();
  }, []);

  function begin(name: TouchLayoutControlName, event: ReactPointerEvent<HTMLButtonElement>) {
    if (event.button !== 0 || !geometry || !snapshot.profile?.controls[name]) return;
    event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); captureOwner.current = event.currentTarget;
    store.select(name); store.bringToFront(name);
    const rect = event.currentTarget.getBoundingClientRect();
    gesture.current = event.target instanceof Element && !!event.target.closest('[data-resize]')
      ? {pointer: event.pointerId, name, kind: 'resize', left: rect.left, top: rect.top, width: rect.width, height: rect.height, scale: snapshot.profile.controls[name]!.scale}
      : {pointer: event.pointerId, name, kind: 'move', x: event.clientX, y: event.clientY};
  }
  function move(event: ReactPointerEvent) {
    const drag = gesture.current;
    if (!drag || drag.pointer !== event.pointerId || !geometry) return;
    event.preventDefault();
    if (drag.kind === 'move') {
      setManipulating(true);
      store.moveControl(drag.name, event.clientX - drag.x, event.clientY - drag.y); drag.x = event.clientX; drag.y = event.clientY;
    } else if (drag.kind === 'resize') {
      setManipulating(true);
      const projection = ((event.clientX - drag.left) * drag.width + (event.clientY - drag.top) * drag.height) / (drag.width ** 2 + drag.height ** 2);
      const scale = clamp(drag.scale * Math.max(.05, projection), touchLayoutScaleMin, touchLayoutScaleMax), factor = scale / drag.scale;
      store.updateControl(drag.name, {scale, x: (drag.left + drag.width * factor / 2 - geometry.safe.left) / geometry.safe.width, y: (drag.top + drag.height * factor / 2 - geometry.safe.top) / geometry.safe.height});
    } else if (drag.kind === 'viewport') {
      const width = root.current?.clientWidth ?? 1;
      store.setViewport((store.getSnapshot().profile?.viewport.x ?? 0) + (event.clientX - drag.x) / width); drag.x = event.clientX;
    } else {
      const host = root.current, panel = workbench.current;
      const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
      if (host && panel) setPanelPoint(point => ({x: clamp((point?.x ?? 16) + dx, 16, Math.max(16, host.clientWidth - panel.offsetWidth - 16)), y: clamp((point?.y ?? 16) + dy, 16, Math.max(16, host.clientHeight - panel.offsetHeight - 16))}));
      drag.x = event.clientX; drag.y = event.clientY;
    }
  }
  function end(event: ReactPointerEvent) {
    if (gesture.current?.pointer !== event.pointerId) return;
    if (gesture.current.kind === 'workbench' && panelPoint && root.current && workbench.current) {
      const rangeX = Math.max(0, root.current.clientWidth - workbench.current.offsetWidth - 32), rangeY = Math.max(0, root.current.clientHeight - workbench.current.offsetHeight - 32);
      store.setWorkbenchPosition({x: rangeX ? (panelPoint.x - 16) / rangeX : .5, y: rangeY ? (panelPoint.y - 16) / rangeY : .5});
    }
    gesture.current = null; setManipulating(false);
    if (captureOwner.current?.hasPointerCapture(event.pointerId)) captureOwner.current.releasePointerCapture(event.pointerId);
    captureOwner.current = null;
  }
  function editorFullscreen() {
    const target = playerSurface?.element;
    if (!target) return false;
    const doc = document as PlayerFullscreenDocument;
    return (doc.fullscreenElement || doc.webkitFullscreenElement) === target;
  }
  async function enterOrientationFullscreen() {
    const target = playerSurface?.element;
    if (!target) return false;
    const doc = document as PlayerFullscreenDocument;
    const current = doc.fullscreenElement || doc.webkitFullscreenElement;
    if (current === target) return true;
    if (current) return false;
    try {
      await requestPlayerFullscreen(target);
      return (doc.fullscreenElement || doc.webkitFullscreenElement) === target;
    } catch {return false;}
  }
  const collisions = new Set(store.overlappingControls(visible));
  function defaultControl(name: TouchLayoutControlName) {
    return <button key={name} ref={node => {if (node) defaults.current.set(name, node);else defaults.current.delete(name);}} type="button" tabIndex={-1} className={`layout-control layout-${name}`}><TouchControlCopy name={name} game={gameIdForProduct(settings.productId)} focusMode={settings.options.touchFocusMode}/></button>;
  }
  return <div ref={root} data-touch-editor-scene="" data-touch-editor-ready={sceneReady} data-touch-manipulating={manipulating} data-reduced-motion={reducedMotion} data-joystick={joystick} className="touch-editor touch-controls-surface" onPointerMove={move} onPointerUp={end} onPointerCancel={end} onLostPointerCapture={end}>
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-panel/60" style={{transform: `translateX(${(snapshot.profile?.viewport.x ?? 0) * 100}%)`}} aria-hidden="true"><div className="grid aspect-[4/3] h-full max-h-full w-full max-w-[133.333vh] place-items-center border border-line bg-background text-muted">{t('react.touch.viewportPreview')}</div></div>
    <div ref={safe} className="layout-safe"/>
    <div ref={reserved} className="layout-reserved runtime-system-anchor">{t('react.touch.reservedArea')}</div>
    <div className="layout-defaults" aria-hidden="true" inert><div className="layout-hud">{(['focus', 'fire', 'function', 'bomb'] as const).map(defaultControl)}</div>{(['joystick', 'escape', 'restart', 'thpracTab', 'thpracMenu'] as const).map(defaultControl)}</div>
    {!viewportEditing && geometry && snapshot.profile && visible.map(name => {
      const placed = snapshot.controls[name]!;
      return <button key={name} type="button" data-touch-layout-control={name} className={`layout-control layout-${name} layout-placed`} style={{left: placed.rect.left + placed.rect.width / 2, top: placed.rect.top + placed.rect.height / 2, zIndex: 10 + placed.priority, '--layout-scale': placed.scale} as CSSProperties}
        aria-label={t('react.touch.moveControl', {control:t(touchControlLabelKeys[name])})} aria-pressed={selected === name} data-collision={collisions.has(name)} onPointerDown={event => begin(name, event)} onFocus={() => store.select(name)} onKeyDown={event => {
          const step = event.shiftKey ? 10 : 1, delta = {ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step]}[event.key];
          if (delta) {event.preventDefault();store.moveControl(name, delta[0], delta[1]);}
        }}><TouchControlCopy name={name} game={gameIdForProduct(settings.productId)} focusMode={settings.options.touchFocusMode}/><span className="layout-resize" data-resize="" aria-hidden="true">↘</span></button>;
    })}
    <div className="absolute inset-0 z-[1]" aria-hidden="true" onPointerDown={event => {
      if (event.button !== 0) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      if (viewportEditing) gesture.current = {kind: 'viewport', pointer: event.pointerId, x: event.clientX};
      else if (!joystick) {const point = preview ?? {x: event.clientX, y: event.clientY};previewPointer.current = {pointer: event.pointerId, x: event.clientX, y: event.clientY, point};setPreview(point);}
    }} onPointerMove={event => {
      const drag = previewPointer.current;
      if (drag?.pointer !== event.pointerId || joystick || viewportEditing) return;
      const ratio = settings.options.touchSensitivity / 100;
      setPreview({x: clamp(drag.point.x + (event.clientX - drag.x) * ratio, 0, root.current?.clientWidth ?? 0), y: clamp(drag.point.y + (event.clientY - drag.y) * ratio, 0, root.current?.clientHeight ?? 0)});
    }} onPointerUp={() => {previewPointer.current = null;}} onPointerCancel={() => {previewPointer.current = null;}} onLostPointerCapture={() => {previewPointer.current = null;}}/>
    {preview && !joystick && !viewportEditing && <span aria-hidden="true" className="pointer-events-none absolute z-30 text-4xl text-accent" style={{left: preview.x, top: preview.y, transform: 'translate(-50%,-50%)'}}>＋</span>}
    <div ref={workbench} data-touch-workbench="" data-collapsed={collapsed} className="layout-workbench" style={panelPoint ? {left: panelPoint.x, top: panelPoint.y, transform: 'none'} : undefined}>
      <header className="layout-workbench-header">
        <Dialog.Title className="layout-workbench-title" title={t('touch.dragWindow')} onPointerDown={event => {
          if (event.button !== 0) return; event.currentTarget.setPointerCapture(event.pointerId); captureOwner.current = event.currentTarget;
          gesture.current = {kind: 'workbench', pointer: event.pointerId, x: event.clientX, y: event.clientY};
        }}><span className="layout-workbench-grip" aria-hidden="true">⠿</span><span>{t('touch.workbenchTitle')}</span><em>{t(snapshot.orientation === 'landscape' ? 'touch.landscape' : 'touch.portrait')}</em></Dialog.Title>
        <button type="button" data-touch-workbench-collapse="" className="layout-workbench-collapse" aria-label={t(collapsed ? 'touch.expandPanel' : 'touch.collapsePanel')} aria-expanded={!collapsed} aria-controls={`${id}-tools`} onClick={() => setCollapsed(!collapsed)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 14 6-6 6 6"/></svg></button>
      </header>
      <div id={`${id}-tools`} data-touch-workbench-body="" hidden={collapsed} className="layout-workbench-body">
      <div className="layout-workbench-scroll">
      <Dialog.Description className="layout-workbench-description sr-only">{t('react.touch.editHint')}</Dialog.Description>
      {fullscreenStatus && <p role="status" className="text-xs text-muted">{fullscreenStatus}</p>}
      <div className="grid gap-3">
        {error ? <p role="alert" className="text-accent">{error}</p> : <>
          <div role="group" aria-label={t('touch.switchOrientation')} data-touch-orientation-controls={snapshot.orientation} className="grid grid-cols-2 gap-2">
            <PlayerOrientationControl epoch={null} enabled orientation={snapshot.orientation} fullscreen={editorFullscreen()}
              enterFullscreen={enterOrientationFullscreen} showUnavailable className={buttonClass}/>
            <button type="button" className={buttonClass} onClick={() => store.resetOrientation()}>{t('touch.restoreDirection')}</button>
          </div>
          <p className="layout-workbench-profile-hint">{t('touch.profileHint')}</p><hr className="layout-workbench-divider"/>
          <TouchSettingsFields settings={settings} store={preferences} viewportControls={<div className="touch-settings-row">
            <span>{t('touch.viewportPosition')}<small>{t('touch.viewportHint')}</small></span>
            <div className="touch-settings-viewport-actions"><button type="button" onClick={() => setViewportEditing(!viewportEditing)}>{viewportEditing ? t('touch.adjustDone') : t('touch.adjustViewport')}</button><button type="button" onClick={() => store.setViewport(0)}>{t('action.reset')}</button></div>
          </div>}/>
          {collisions.size > 0 && <p role="status" className="text-amber-300">{t('react.touch.overlapWarning')}</p>}
        </>}
      </div>
      </div>
      <footer className="layout-workbench-footer">
        <p role="status">{status ? t(status) : (snapshot.dirty ? t('react.touch.unsaved') : t('react.touch.unchanged'))}</p>
        <div className="layout-workbench-actions"><button type="button" className={buttonClass} onClick={close}>{t('action.exit')}</button><button type="button" data-touch-workbench-save="" className={buttonClass} disabled={!!error || !geometry} onClick={() => setStatus(store.save() ? 'react.touch.saved' : 'react.touch.saveFailed')}>{t('touch.saveLayout')}</button></div>
      </footer>
      </div>
    </div>
  </div>;
}
