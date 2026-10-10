import {createPortal} from 'react-dom';
import {useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore} from 'react';
import {touchLayoutControlMeta, touchLayoutControlNames, touchLayoutScaleMin, touchLayoutScaleMax, type TouchLayoutControlName} from '../../../src/launcher/touch-layout-model.mts';
import {touchMovementUsesJoystick} from '../../../src/launcher/game-preferences.mts';
import type {GameSettingsModel} from '../../models/game-settings';
import type {TouchLayoutModel, TouchLayoutOrientation} from '../../models/touch-layout';
import {useLocale} from '../../i18n';
import {closeMainSelectMenus} from '../launcher/MainSelect';
import {TouchSettingsFields} from './TouchSettingsFields';
import {TouchControlPreview} from './TouchControlPreview';
import {captureTouchLayoutDefaults, controlElement, effectivePlacement, overlapRatio, visibleTouchControls} from './touch-layout-geometry';
import type {SettingsActions, TouchEditorNativePorts} from './types';

type Gesture = {kind: 'move'; pointer: number; name: TouchLayoutControlName; x: number; y: number}
  | {kind: 'resize'; pointer: number; name: TouchLayoutControlName; anchorX: number; anchorY: number; width: number; height: number; scale: number}
  | {kind: 'panel'; pointer: number; x: number; y: number; left: number; top: number}
  | {kind: 'viewport'; pointer: number; x: number}
  | {kind: 'preview'; pointer: number; x: number; y: number};

export interface TouchLayoutEditorProps {
  playerElement: HTMLElement;
  model: TouchLayoutModel;
  settings: GameSettingsModel;
  actions: SettingsActions;
  native: TouchEditorNativePorts;
  onCloseIntent(): void;
  /** CSS image value from the same product artwork owner used by the cards. */
  previewImage?: string;
  fireEnabled?: boolean;
}

export function TouchLayoutEditor({playerElement, model, settings, actions, native, onCloseIntent, previewImage, fireEnabled}: TouchLayoutEditorProps) {
  const entryPreviewImage = useRef(previewImage).current;
  const layout = useSyncExternalStore(model.subscribe, model.getSnapshot, model.getSnapshot);
  const state = useSyncExternalStore(settings.subscribe, settings.getSnapshot, settings.getSnapshot);
  const {t} = useLocale();
  const surface = useRef<HTMLElement>(playerElement), panel = useRef<HTMLElement>(null), preview = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null), animation = useRef<Animation | null>(null);
  const [collapsed, setCollapsed] = useState(false), [viewportEditing, setViewportEditing] = useState(false), [orientationPending, setOrientationPending] = useState(false);
  const viewportMode = useRef(false), previousViewportEditing = useRef(false), lifetime = useRef(0);
  const latest = useRef({actions, native, t}); latest.current = {actions, native, t};
  const wheel = state ? touchMovementUsesJoystick(state.options.touchMovementMode) : false;
  function orientation(): TouchLayoutOrientation {
    const host = surface.current!;
    const width = window.visualViewport?.width || document.documentElement.clientWidth || host.clientWidth;
    const height = window.visualViewport?.height || document.documentElement.clientHeight || host.clientHeight;
    return width >= height ? 'landscape' : 'portrait';
  }
  function defaults() {
    return latest.current.native.measureDefaults?.(surface.current!) ?? captureTouchLayoutDefaults(surface.current!, latest.current.t('touch.previewUnavailable'));
  }
  function stopAnimation() {animation.current?.cancel(); animation.current = null;}
  function rememberPanel() {
    const host = surface.current, element = panel.current;
    if (!host || !element || element.hidden) return;
    const h = host.getBoundingClientRect(), p = element.getBoundingClientRect();
    const rangeX = Math.max(0, h.width - p.width - 32), rangeY = Math.max(0, h.height - p.height - 32);
    const left = Math.max(16, Math.min(h.width - p.width - 16, p.left - h.left));
    const top = Math.max(16, Math.min(h.height - p.height - 16, p.top - h.top));
    model.windowPositions.set(model.getSnapshot().orientation, 'editor', {x: rangeX ? (left - 16) / rangeX : .5, y: rangeY ? (top - 16) / rangeY : .5});
  }
  function clampPanel() {
    const host = surface.current, element = panel.current;
    if (!host || !element || element.hidden) return;
    const h = host.getBoundingClientRect(), p = element.getBoundingClientRect();
    element.style.left = `${Math.max(16, Math.min(Math.max(16, h.width - p.width - 16), p.left - h.left))}px`;
    element.style.top = `${Math.max(16, Math.min(Math.max(16, h.height - p.height - 16), p.top - h.top))}px`;
    element.style.transform = 'none';
  }
  function positionPanel() {
    const host = surface.current, element = panel.current;
    if (!host || !element || element.hidden) return;
    model.windowPositions.reload();
    const h = host.getBoundingClientRect(), p = element.getBoundingClientRect();
    const saved = model.windowPositions.get(model.getSnapshot().orientation, 'editor');
    element.style.left = `${saved ? 16 + saved.x * Math.max(0, h.width - p.width - 32) : h.height > h.width ? (h.width - p.width) / 2 : h.width - p.width - 16}px`;
    element.style.top = `${saved ? 16 + saved.y * Math.max(0, h.height - p.height - 32) : Math.min(76, Math.max(16, h.height - p.height - 16))}px`;
    element.style.transform = 'none'; clampPanel();
  }
  function resetPreview() {
    if (!preview.current) return;
    preview.current.classList.remove('active'); preview.current.style.left = '50%'; preview.current.style.top = '50%';
  }
  function endGesture(event?: PointerEvent) {
    const active = gesture.current;
    if (!active || event && event.pointerId !== active.pointer) return;
    gesture.current = null; surface.current?.classList.remove('touch-layout-manipulating');
    if (active.kind === 'panel') rememberPanel();
    if (active.kind === 'preview') resetPreview();
    try {if (surface.current?.hasPointerCapture(active.pointer)) surface.current.releasePointerCapture(active.pointer);} catch {}
  }
  function moveGesture(event: PointerEvent) {
    const active = gesture.current, host = surface.current;
    if (!active || !host || event.pointerId !== active.pointer) return;
    event.preventDefault();
    if (active.kind === 'panel') {
      const element = panel.current!, h = host.getBoundingClientRect(), p = element.getBoundingClientRect();
      active.left = Math.max(16, Math.min(Math.max(16, h.width - p.width - 16), active.left + event.clientX - active.x));
      active.top = Math.max(16, Math.min(Math.max(16, h.height - p.height - 16), active.top + event.clientY - active.y));
      active.x = event.clientX; active.y = event.clientY;
      element.style.left = `${active.left}px`; element.style.top = `${active.top}px`; element.style.transform = 'none'; return;
    }
    if (active.kind === 'viewport') {
      const current = model.getSnapshot(), profile = current.draft?.profiles[current.orientation];
      if (profile) model.setViewport(profile.viewport.x + (event.clientX - active.x) / Math.max(1, host.clientWidth));
      active.x = event.clientX; return;
    }
    if (active.kind === 'preview') {
      const gain = (settings.getSnapshot()?.options.touchSensitivity ?? 150) / 100, rect = host.getBoundingClientRect();
      preview.current!.style.left = `${Math.max(0, Math.min(rect.width, rect.width / 2 + (event.clientX - active.x) * gain))}px`;
      preview.current!.style.top = `${Math.max(0, Math.min(rect.height, rect.height / 2 + (event.clientY - active.y) * gain))}px`; return;
    }
    const current = model.getSnapshot(), item = current.draft?.profiles[current.orientation]?.controls[active.name];
    if (!item) return;
    host.classList.add('touch-layout-manipulating');
    const safe = host.querySelector<HTMLElement>('#touchLayoutSafeZone')!.getBoundingClientRect();
    if (!safe.width || !safe.height) return;
    const next = {...item}, element = controlElement(host, active.name);
    if (active.kind === 'move') {
      next.x += (event.clientX - active.x) / safe.width; next.y += (event.clientY - active.y) / safe.height;
      active.x = event.clientX; active.y = event.clientY;
    } else {
      const vx = event.clientX - active.anchorX, vy = event.clientY - active.anchorY;
      const projection = (vx * active.width + vy * active.height) / (active.width * active.width + active.height * active.height);
      next.scale = Math.max(touchLayoutScaleMin, Math.min(touchLayoutScaleMax, active.scale * Math.max(.05, projection)));
      const factor = next.scale / active.scale;
      next.x = (active.anchorX + active.width * factor / 2 - safe.left) / safe.width;
      next.y = (active.anchorY + active.height * factor / 2 - safe.top) / safe.height;
    }
    const clamped = effectivePlacement(element, next, safe);
    model.updateControl(active.name, {...next, ...clamped});
  }
  const handlers = useRef({moveGesture, endGesture}); handlers.current = {moveGesture, endGesture};
  useEffect(() => {
    const epoch = ++lifetime.current, host = surface.current;
    if (!host) return;
    let enteredFullscreen = false, disposed = false;
    const playerClassExisted = document.body.classList.contains('player-active');
    document.body.classList.add('player-active');
    host.classList.add('touch-layout-preparing');
    const move = (event: PointerEvent) => handlers.current.moveGesture(event);
    const end = (event: PointerEvent) => handlers.current.endGesture(event);
    const cancel = () => handlers.current.endGesture();
    const visibility = () => {if (document.hidden) cancel();};
    const resize = () => {
      if (!model.getSnapshot().isEditing || disposed) return;
      try {
        const previous = model.getSnapshot().orientation, next = orientation();
        model.ensureOrientation(next, defaults());
        if (!viewportMode.current) {
          if (previous !== next) positionPanel();
          else clampPanel();
        }
      } catch (error) {latest.current.actions.reportError(error);}
    };
    document.addEventListener('pointermove', move, {capture: true, passive: false});
    document.addEventListener('pointerup', end, true); document.addEventListener('pointercancel', end, true);
    window.addEventListener('blur', cancel); window.addEventListener('resize', resize);
    window.visualViewport?.addEventListener('resize', resize);
    document.addEventListener('visibilitychange', visibility); document.addEventListener('fullscreenchange', cancel);
    window.screen.orientation?.addEventListener?.('change', resize);
    // Main app.mts9490–9527 also refreshes when the safe area changes without
    // a window resize, and restores a saved panel position only on rotation.
    const safe = host.querySelector<HTMLElement>('#touchLayoutSafeZone');
    const observer = typeof ResizeObserver === 'function' && safe ? new ResizeObserver(resize) : null;
    if (safe) observer?.observe(safe);
    void (async () => {
      try {
        enteredFullscreen = await latest.current.native.enterFullscreen(host);
      } catch (error) {
        if (!disposed) latest.current.actions.feedback(latest.current.t('fullscreen.autoBlocked', {reason: error instanceof Error ? error.message : String(error)}));
      }
      if (disposed) {if (enteredFullscreen && !host.isConnected) await latest.current.native.exitFullscreen().catch(latest.current.actions.reportError); return;}
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      if (disposed || epoch !== lifetime.current) return;
      model.begin(orientation(), defaults(), visibleTouchControls(host));
      positionPanel();
      host.classList.remove('touch-layout-preparing');
      if (!document.body.classList.contains('less-motion') && !matchMedia('(prefers-reduced-motion: reduce)').matches && typeof host.animate === 'function') {
        animation.current = host.animate([{opacity: 0}, {opacity: 1}], {duration: 340, easing: 'cubic-bezier(.2,0,.2,1)'});
        animation.current.onfinish = () => stopAnimation();
      }
      latest.current.actions.feedback('', latest.current.t('touch.editorStatus'));
    })().catch(error => {if (!disposed) {host.classList.remove('touch-layout-preparing'); latest.current.actions.reportError(error);}});
    return () => {
      disposed = true; const retired = ++lifetime.current; rememberPanel(); cancel(); stopAnimation(); host.classList.remove('touch-layout-preparing');
      document.removeEventListener('pointermove', move, true); document.removeEventListener('pointerup', end, true); document.removeEventListener('pointercancel', end, true);
      window.removeEventListener('blur', cancel); window.removeEventListener('resize', resize); window.visualViewport?.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', visibility); document.removeEventListener('fullscreenchange', cancel);
      window.screen.orientation?.removeEventListener?.('change', resize); observer?.disconnect();
      if (!playerClassExisted) document.body.classList.remove('player-active');
      // StrictMode can retire an effect and immediately reuse this DOM node.
      // Release on the completed lifetime only; the native port itself releases
      // owned fullscreen, including fullscreen acquired later by rotation.
      queueMicrotask(() => {if (lifetime.current === retired) void latest.current.native.exitFullscreen().catch(latest.current.actions.reportError);});
      // The root's sole exit owner calls discard only after its decision.
    };
  }, [model, settings]);

  useLayoutEffect(() => {
    const host = surface.current;
    if (!host || !layout.isEditing) return;
    const profile = layout.draft?.profiles[layout.orientation], h = host.getBoundingClientRect();
    const safe = host.querySelector<HTMLElement>('#touchLayoutSafeZone')!.getBoundingClientRect();
    host.classList.toggle('touch-layout-custom', !!profile);
    for (const name of touchLayoutControlNames) {
      const element = controlElement(host, name), item = profile?.controls[name];
      element.classList.toggle('touch-layout-selected', name === layout.selected);
      element.classList.remove('touch-layout-collision');
      if (!item) {element.removeAttribute('style'); continue;}
      const point = effectivePlacement(element, item, safe);
      element.style.setProperty('--touch-layout-x', `${safe.left - h.left + point.x * safe.width}px`);
      element.style.setProperty('--touch-layout-y', `${safe.top - h.top + point.y * safe.height}px`);
      element.style.setProperty('--touch-layout-scale', String(item.scale)); element.style.zIndex = String(31 + item.priority);
    }
    const visible = visibleTouchControls(host), reserved = host.querySelector<HTMLElement>('#touchLayoutReservedZone')!.getBoundingClientRect();
    for (let i = 0; i < visible.length; i++) {
      const a = controlElement(host, visible[i]);
      for (let j = i + 1; j < visible.length; j++) {
        const b = controlElement(host, visible[j]);
        if (overlapRatio(a.getBoundingClientRect(), b.getBoundingClientRect()) >= .28) {a.classList.add('touch-layout-collision'); b.classList.add('touch-layout-collision');}
      }
      if (overlapRatio(a.getBoundingClientRect(), reserved) >= .18) a.classList.add('touch-layout-collision');
    }
    const viewport = host.querySelector<HTMLElement>('#gameViewport')!;
    viewport.style.transform = `translate(${(profile?.viewport.x ?? 0) * host.clientWidth}px, 0px)`;
    model.reconcileVisibleControls(visible);
    if (wheel) {if (gesture.current?.kind === 'preview') endGesture(); resetPreview();}
  }, [layout.revision, state?.revision, model, wheel]);
  useLayoutEffect(() => {
    // Main syncTouchLayoutWorkbench closes detached menus when collapsing or
    // restoring the workbench, including keyboard activation without pointerdown.
    if (!viewportEditing) {
      closeMainSelectMenus();
      if (previousViewportEditing.current) positionPanel();
    }
    clampPanel();
    previousViewportEditing.current = viewportEditing;
  }, [collapsed, viewportEditing]);

  function pointerDown(event: PointerEvent) {
    if (!layout.isEditing || gesture.current || event.pointerType === 'mouse' && event.button !== 0) return;
    const target = event.target as Element, host = surface.current!;
    if (target.closest('#touchLayoutEditorDragHandle')) {
      const h = host.getBoundingClientRect(), p = panel.current!.getBoundingClientRect();
      gesture.current = {kind: 'panel', pointer: event.pointerId, x: event.clientX, y: event.clientY, left: p.left - h.left, top: p.top - h.top};
    } else if (target.closest('#touchViewportDragSurface') && viewportMode.current) {
      gesture.current = {kind: 'viewport', pointer: event.pointerId, x: event.clientX};
    } else if (target.closest('[data-touch-layout-control]') && !viewportMode.current) {
      const element = target.closest<HTMLElement>('[data-touch-layout-control]')!, name = element.dataset.touchLayoutControl as TouchLayoutControlName;
      model.selectControl(name);
      const current = model.getSnapshot(), item = current.draft?.profiles[current.orientation]?.controls[name];
      if (!item) return;
      const rect = element.getBoundingClientRect();
      gesture.current = target.closest('.touch-layout-resize-handle') ? {kind: 'resize', pointer: event.pointerId, name, anchorX: rect.left, anchorY: rect.top, width: Math.max(1, rect.width), height: Math.max(1, rect.height), scale: item.scale}
        : {kind: 'move', pointer: event.pointerId, name, x: event.clientX, y: event.clientY};
    } else if (!viewportMode.current && !wheel && !target.closest('.touch-layout-editor,.touch-layout-settings,button,select,input,.mizuki-select-menu')) {
      gesture.current = {kind: 'preview', pointer: event.pointerId, x: event.clientX, y: event.clientY}; resetPreview(); preview.current!.classList.add('active');
    } else return;
    event.preventDefault(); stopAnimation();
    try {host.setPointerCapture(event.pointerId);} catch {}
  }
  function viewportModeSet(enabled: boolean) {
    if (!model.getSnapshot().isEditing) return;
    if (enabled) rememberPanel();
    endGesture(); resetPreview(); viewportMode.current = enabled; setViewportEditing(enabled);
    actions.feedback('', t(enabled ? 'touch.viewportEditStatus' : 'touch.editorStatus'));
  }
  async function resetOrientation() {
    const epoch = lifetime.current, current = model.getSnapshot().orientation;
    const title = t(current === 'landscape' ? 'touch.landscape' : 'touch.portrait');
    if (!await actions.confirm({message: t('touch.restoreLayoutConfirm', {orientation: title}), confirmText: t('touch.restoreDefault'), tone: 'danger'})) return;
    if (epoch !== lifetime.current || !model.getSnapshot().isEditing || current !== model.getSnapshot().orientation) return;
    model.resetOrientation(); model.ensureOrientation(current, defaults()); actions.feedback(t('touch.restoreLayoutToast', {orientation: title}));
  }
  function save() {
    try {
      rememberPanel(); const result = model.save();
      actions.feedback(t(result.persisted ? 'touch.layoutSaved' : 'touch.layoutSessionOnly'),
        t(result.persisted ? result.value ? 'touch.layoutSavedStatus' : 'touch.layoutDefaultSavedStatus' : 'touch.layoutSessionOnlyStatus'));
    } catch (error) {actions.reportError(error);}
  }
  async function switchOrientation() {
    if (orientationPending || !native.canSwitchOrientation()) return;
    const epoch = lifetime.current, next = layout.orientation === 'landscape' ? 'portrait' : 'landscape';
    setOrientationPending(true); rememberPanel(); endGesture();
    try {
      await native.switchOrientation(next);
      if (epoch !== lifetime.current) return;
      actions.feedback(t('touch.orientationRequested', {orientation: t(next === 'landscape' ? 'touch.landscape' : 'touch.portrait')}));
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      if (epoch !== lifetime.current) return;
      model.ensureOrientation(orientation(), defaults()); positionPanel();
    } catch {if (epoch === lifetime.current) actions.feedback(t('touch.orientationFailed'));}
    finally {if (epoch === lifetime.current) setOrientationPending(false);}
  }
  const pointerHandlers = useRef({pointerDown, endGesture}); pointerHandlers.current = {pointerDown, endGesture};
  useEffect(() => {
    const down = (event: PointerEvent) => pointerHandlers.current.pointerDown(event);
    const lost = (event: PointerEvent) => pointerHandlers.current.endGesture(event);
    playerElement.addEventListener('pointerdown', down);
    playerElement.addEventListener('lostpointercapture', lost);
    return () => {playerElement.removeEventListener('pointerdown', down); playerElement.removeEventListener('lostpointercapture', lost);};
  }, [playerElement]);
  useLayoutEffect(() => {
    playerElement.classList.toggle('touch-joystick-enabled', wheel);
    playerElement.classList.toggle('touch-viewport-edit', viewportEditing);
    if (entryPreviewImage) playerElement.style.setProperty('--touch-preview-image', entryPreviewImage);
    playerElement.style.setProperty('--touch-control-opacity', String((state?.options.touchControlOpacity ?? 100) / 100));
    return () => {playerElement.classList.remove('touch-joystick-enabled', 'touch-viewport-edit', 'touch-layout-custom');
      playerElement.style.removeProperty('--touch-preview-image'); playerElement.style.removeProperty('--touch-control-opacity');};
  }, [playerElement, wheel, viewportEditing, entryPreviewImage, state?.options.touchControlOpacity]);
  if (!state) return null;
  return createPortal(<>
    <div className="touch-layout-safe-zone" id="touchLayoutSafeZone" aria-hidden="true"/>
    <div ref={preview} className="touch-sensitivity-preview" id="touchSensitivityPreview" aria-hidden="true" hidden={wheel || viewportEditing}/>
    <TouchReservedZone/>
    <section ref={panel} className={`touch-layout-editor${collapsed ? ' is-collapsed' : ''}`} id="touchLayoutEditor" role="region" aria-labelledby="touchWorkbenchTitle" hidden={viewportEditing}>
      <header className="touch-workbench-header"><div className="touch-layout-editor-copy" id="touchLayoutEditorDragHandle" title={t('touch.dragWindow')}><span className="touch-workbench-grip" aria-hidden="true">⠿</span><strong id="touchWorkbenchTitle">{t('touch.workbenchTitle')}</strong><em id="touchLayoutOrientation">{t(layout.orientation === 'landscape' ? 'touch.landscape' : 'touch.portrait')}</em></div><button className="touch-workbench-collapse" id="touchLayoutCollapse" type="button" aria-expanded={!collapsed} aria-controls="touchWorkbenchBody" aria-label={t(collapsed ? 'touch.expandPanel' : 'touch.collapsePanel')} onClick={() => {endGesture(); setCollapsed(!collapsed);}}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 14 6-6 6 6"/></svg></button></header>
      <div className="touch-workbench-body" id="touchWorkbenchBody" hidden={collapsed}><div className="touch-workbench-scroll">
        <section id="touchLayoutArrangement" className="touch-layout-arrangement" aria-label={t('touch.layoutTab')}><div className="touch-layout-secondary-actions"><button id="touchLayoutOrientationHelpOpen" type="button" hidden={!native.canSwitchOrientation()} disabled={orientationPending} onClick={() => {void switchOrientation();}}>{t(layout.orientation === 'landscape' ? 'player.switchPortrait' : 'player.switchLandscape')}</button><button id="touchLayoutReset" type="button" disabled={!layout.isEditing} onClick={() => {void resetOrientation().catch(actions.reportError);}}>{t('touch.restoreDirection')}</button></div><p className="touch-workbench-note">{t('touch.profileHint')}</p></section><hr className="touch-workbench-divider"/>
        <TouchSettingsFields model={settings} actions={actions} onAdjustViewport={() => viewportModeSet(true)} onResetViewport={() => {if (!model.getSnapshot().isEditing) return; model.setViewport(0); actions.feedback(t('touch.restoreViewport', {orientation: t(layout.orientation === 'landscape' ? 'touch.landscape' : 'touch.portrait')}));}}/>
      </div><footer className="touch-workbench-footer"><small id="touchLayoutSaveHint">{t('touch.settingsAutoSaveHint')}</small><div className="touch-layout-editor-actions"><button id="touchLayoutExit" type="button" onClick={() => {if (viewportMode.current) viewportModeSet(false); rememberPanel(); onCloseIntent();}}>{t('action.exit')}</button><button id="touchLayoutSave" type="button" disabled={!layout.isEditing} onClick={save}>{t('touch.saveLayout')}</button></div></footer></div>
    </section>
    <div className="touch-viewport-drag-surface" id="touchViewportDragSurface" aria-hidden="true" hidden={!viewportEditing}/><button className="touch-viewport-done" id="touchViewportDone" type="button" hidden={!viewportEditing} onClick={() => viewportModeSet(false)}>{t('touch.adjustDone')}</button>
    <TouchControlPreview settings={state} fireEnabled={fireEnabled} editing/>
  </>, playerElement);
}

function TouchReservedZone() {
  const {t} = useLocale();
  return <div className="touch-layout-reserved-zone" id="touchLayoutReservedZone" aria-hidden="true"><span className="reserved-tool"><svg className="touch-utility-icon" viewBox="0 -960 960 960" aria-hidden="true" focusable="false"><path d="M200-200h80q17 0 28.5 11.5T320-160q0 17-11.5 28.5T280-120H160q-17 0-28.5-11.5T120-160v-120q0-17 11.5-28.5T160-320q17 0 28.5 11.5T200-280v80Zm560 0v-80q0-17 11.5-28.5T800-320q17 0 28.5 11.5T840-280v120q0 17-11.5 28.5T800-120H680q-17 0-28.5-11.5T640-160q0-17 11.5-28.5T680-200h80ZM200-760v80q0 17-11.5 28.5T160-640q-17 0-28.5-11.5T120-680v-120q0-17 11.5-28.5T160-840h120q17 0 28.5 11.5T320-800q0 17-11.5 28.5T280-760h-80Zm560 0h-80q-17 0-28.5-11.5T640-800q0-17 11.5-28.5T680-840h120q17 0 28.5 11.5T840-800v120q0 17-11.5 28.5T800-640q-17 0-28.5-11.5T760-680v-80Z"/></svg></span><span className="reserved-tool"><svg className="touch-utility-icon" viewBox="0 -960 960 960" aria-hidden="true" focusable="false"><path d="M478-240q21 0 35.5-14.5T528-290q0-21-14.5-35.5T478-340q-21 0-35.5 14.5T428-290q0 21 14.5 35.5T478-240Zm2 160q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Zm0-80q134 0 227-93t93-227q0-134-93-227t-227-93q-134 0-227 93t-93 227q0 134 93 227t227 93Zm0-320Zm4-172q25 0 43.5 16t18.5 40q0 22-13.5 39T502-525q-23 20-40.5 44T444-427q0 14 10.5 23.5T479-394q15 0 25.5-10t13.5-25q4-21 18-37.5t30-31.5q23-22 39.5-48t16.5-58q0-51-41.5-83.5T484-720q-38 0-72.5 16T359-655q-7 12-4.5 25.5T368-609q14 8 29 5t25-17q11-15 27.5-23t34.5-8Z"/></svg></span><span className="reserved-tool"><svg className="touch-utility-icon" viewBox="0 -960 960 960" aria-hidden="true" focusable="false"><path d="M496-182 182-496q-23-23-23-54t23-54l174-174q23-23 54-23t54 23l314 314q23 23 23 54t-23 54L604-182q-23 23-54 23t-54-23Zm54-58 170-170-310-310-170 170 310 310Zm-70-240Zm79-393 77 77q11 11 11 28t-11 28q-11 11-28 11t-28-11L410-910q-12-12-6.5-28t22.5-19q14-2 27-2.5t27-.5q99 0 186.5 37.5t153 103q65.5 65.5 103 153T960-480q0 17-11.5 28.5T920-440q-17 0-28.5-11.5T880-480q0-71-24-136t-66.5-117Q747-785 688-821.5T559-873ZM401-87l-77-77q-11-11-11-28t11-28q11-11 28-11t28 11L550-50q12 12 6.5 28.5T534-3q-14 2-27 2.5T480 0q-99 0-186.5-37.5t-153-103Q75-206 37.5-293.5T0-480q0-17 11.5-28.5T40-520q17 0 28.5 11.5T80-480q0 71 24 136t66.5 117Q213-175 272-138.5T401-87Z"/></svg></span><span className="reserved-tool">{t('action.reset')}</span></div>;
}
