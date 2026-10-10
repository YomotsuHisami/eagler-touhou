import {postDirectTouch, postTouchCancel, type TouchRuntimeContext, type DirectTouchPoint} from '../../src/launcher/touch-runtime-protocol.mts';
import type {GameZoomPointerInput} from '../../src/launcher/game-zoom.mts';
export interface TouchZoomPort {
  isActive(): boolean;
  beginPointer(input: GameZoomPointerInput): unknown;
  movePointer(input: GameZoomPointerInput): unknown;
  endPointer(input: GameZoomPointerInput): unknown;
}
export function bindPlayerDirectTouch({surface, frame, ios, zoom, context, allowed}: {
  surface: HTMLElement; frame: HTMLElement; ios: boolean; zoom: TouchZoomPort;
  context(): TouchRuntimeContext; allowed(): boolean;
}) {
  const points = new Map<number, DirectTouchPoint>();
  const cleanup: (() => void)[] = [];
  let nextId = -1000000;
  let rect: {left: number; top: number; width: number; height: number} | null = null;
  function on<K extends keyof HTMLElementEventMap>(type: K, listener: (event: HTMLElementEventMap[K]) => void, options?: AddEventListenerOptions) {
    surface.addEventListener(type, listener, options); cleanup.push(() => surface.removeEventListener(type, listener, options));
  }
  const invalidate = () => {rect = null;};
  function point(event: {clientX: number; clientY: number}, force = false) {
    if (force || !rect) {
      const measured = frame.getBoundingClientRect();
      if (!(measured.width > 0) || !(measured.height > 0)) return null;
      rect = {left: measured.left, top: measured.top, width: measured.width, height: measured.height};
    }
    return {x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height};
  }
  const zoomInput = (touch: Touch): GameZoomPointerInput => ({pointerId: touch.identifier, pointerType: 'touch', clientX: touch.clientX, clientY: touch.clientY, currentTarget: surface});
  on('pointerdown', event => {
    if (ios || event.pointerType === 'mouse' || surface.hidden || !allowed() || points.has(event.pointerId)) return;
    const p = point(event, points.size === 0 || zoom.isActive()); if (!p) return;
    event.preventDefault(); const contact = {id: nextId--, ...p}; points.set(event.pointerId, contact);
    try {surface.setPointerCapture(event.pointerId);} catch {}
    if (zoom.isActive()) zoom.beginPointer(event);
    postDirectTouch(context(), 'down', contact);
  });
  on('pointermove', event => {
    if (ios) return; const contact = points.get(event.pointerId); if (!contact) return;
    const p = point(event, zoom.isActive()); if (!p) return;
    event.preventDefault(); Object.assign(contact, p); if (zoom.isActive()) zoom.movePointer(event);
    postDirectTouch(context(), 'move', contact);
  });
  function release(event: PointerEvent) {
    if (ios) return; const contact = points.get(event.pointerId); if (!contact) return;
    event.preventDefault(); const p = Number.isFinite(event.clientX) ? point(event, zoom.isActive()) : null;
    if (p) Object.assign(contact, p); points.delete(event.pointerId);
    if (zoom.isActive()) zoom.endPointer(event); postDirectTouch(context(), 'up', contact); if (!points.size) invalidate();
  }
  on('pointerup', release); on('pointercancel', release); on('lostpointercapture', release);
  on('touchstart', event => {
    if (!ios || surface.hidden || !allowed()) return; event.preventDefault();
    for (const touch of Array.from(event.changedTouches)) {
      if (points.has(touch.identifier)) continue;
      const p = point(touch, points.size === 0 || zoom.isActive()); if (!p) continue;
      const contact = {id: nextId--, ...p}; points.set(touch.identifier, contact);
      if (zoom.isActive()) zoom.beginPointer(zoomInput(touch)); postDirectTouch(context(), 'down', contact);
    }
  }, {passive: false});
  on('touchmove', event => {
    if (!ios) return; event.preventDefault();
    for (const touch of Array.from(event.changedTouches)) {
      const contact = points.get(touch.identifier); if (!contact) continue;
      const p = point(touch, zoom.isActive()); if (!p) continue;
      Object.assign(contact, p); if (zoom.isActive()) zoom.movePointer(zoomInput(touch)); postDirectTouch(context(), 'move', contact);
    }
  }, {passive: false});
  const releaseIos = (event: TouchEvent) => {
    if (!ios) return; event.preventDefault();
    for (const touch of Array.from(event.changedTouches)) {
      const contact = points.get(touch.identifier); if (!contact) continue;
      const p = point(touch, zoom.isActive()); if (p) Object.assign(contact, p);
      points.delete(touch.identifier); if (zoom.isActive()) zoom.endPointer(zoomInput(touch)); postDirectTouch(context(), 'up', contact);
    }
    if (!points.size) invalidate();
  };
  on('touchend', releaseIos, {passive: false}); on('touchcancel', releaseIos, {passive: false});
  function cancel(notify = true) {if (!points.size) return; points.clear(); invalidate(); if (notify) postTouchCancel(context());}
  return {cancel, invalidate, hasPointers: () => points.size > 0, dispose() {cancel(); for (const off of cleanup) off();}};
}
