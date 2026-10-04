import {cloneTouchLayout, type TouchLayout, type TouchLayoutOrientation} from '../../src/launcher/touch-layout-model.mts';
import type {LayoutRect} from './touch-layout.client';

export interface RuntimeViewportSession {
  readonly epoch: number;
  readonly touchLayout: TouchLayout | null;
  readonly magnifierEnabled: boolean;
  readonly live: boolean;
  readonly touchCapable: boolean;
}
export interface RuntimeViewportSnapshot {
  readonly epoch: number | null;
  readonly active: boolean;
  readonly scale: number;
  readonly x: number;
  readonly y: number;
  readonly baseX: number;
  readonly orientation: TouchLayoutOrientation;
  readonly pointerCount: number;
  readonly transform: string;
  readonly systemControls: Readonly<LayoutRect> | null;
}
interface Point {x: number; y: number}
interface Pinch {ids: [number, number]; distance: number; scale: number; contentX: number; contentY: number}
export type RuntimePointerSpace = 'host' | 'frame';
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
const validRect = (value: LayoutRect) => [value.left, value.top, value.width, value.height].every(Number.isFinite) && value.width > 0 && value.height > 0;

/** Pure extraction of main game-zoom's 1–3× anchored pinch and pan-clamp math. */
export function createRuntimeViewportStore() {
  let session: RuntimeViewportSession | null = null, suspended = false;
  let host: LayoutRect = {left: 0, top: 0, width: 0, height: 0}, systemControls: LayoutRect | null = null;
  let scale = 1, x = 0, y = 0, pinch: Pinch | null = null;
  const pointers = new Map<number, Point>(), listeners = new Set<() => void>();
  const orientation = (): TouchLayoutOrientation => host.width >= host.height ? 'landscape' : 'portrait';
  const baseX = () => (session?.touchLayout?.profiles[orientation()]?.viewport.x ?? 0) * host.width;
  const active = () => !!session?.live && session.magnifierEnabled && session.touchCapable && !suspended;
  function snapshot(): RuntimeViewportSnapshot {
    return Object.freeze({epoch: session?.epoch ?? null, active: active(), scale, x, y, baseX: baseX(), orientation: orientation(), pointerCount: pointers.size,
      transform: `translate3d(${baseX() + x}px,${y}px,0) scale(${scale})`, systemControls: systemControls ? Object.freeze({...systemControls}) : null});
  }
  let state = snapshot();
  function publish() {const next = snapshot();if (JSON.stringify(next) === JSON.stringify(state)) return;state = next;for (const listener of [...listeners]) listener();}
  function clearGesture() {pointers.clear();pinch = null;}
  function apply(nextScale: number, nextX: number, nextY: number) {
    scale = clamp(nextScale, 1, 3);
    x = host.width ? clamp(nextX, host.width - host.width * scale, 0) : 0;
    y = host.height ? clamp(nextY, host.height - host.height * scale, 0) : 0;
    publish();
  }
  function beginPinch() {
    const entries = [...pointers.entries()].slice(0, 2);
    if (entries.length < 2) {pinch = null;return;}
    const [[first, a], [second, b]] = entries;
    const midX = (a.x + b.x) / 2, midY = (a.y + b.y) / 2;
    pinch = {ids: [first, second], distance: Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)), scale,
      contentX: (midX - baseX() - x) / scale, contentY: (midY - y) / scale};
  }
  function point(space: RuntimePointerSpace, px: number, py: number): Point {
    // Frame events are local to its unscaled CSS viewport. Host events already
    // report visual coordinates; do not apply the transform to them twice.
    return space === 'frame' ? {x: baseX() + x + px * scale, y: y + py * scale}
      : {x: px - host.left, y: py - host.top};
  }
  return Object.freeze({
    getSnapshot: () => state,
    subscribe(listener: () => void) {listeners.add(listener);return () => {listeners.delete(listener);};},
    setSession(next: RuntimeViewportSession | null) {
      if (next?.epoch !== session?.epoch) {scale = 1;x = 0;y = 0;clearGesture();systemControls = null;}
      if (next) {
        const layout = session?.epoch === next.epoch ? session.touchLayout : cloneTouchLayout(next.touchLayout);
        const magnifierEnabled = session?.epoch === next.epoch ? session.magnifierEnabled : next.magnifierEnabled;
        session = {...next, magnifierEnabled, touchLayout: layout};
      } else session = null;
      if (!active()) clearGesture();publish();
    },
    setGeometry(next: LayoutRect) {
      if (!validRect(next)) return false;
      if (JSON.stringify(next) === JSON.stringify(host)) return true;
      host = {...next};clearGesture();apply(scale, x, y);return true;
    },
    setSystemControls(next: LayoutRect | null) {
      if (next && !validRect(next)) return;
      systemControls = next ? {...next} : null;publish();
    },
    suspend(value: boolean) {suspended = value;if (value) clearGesture();publish();},
    beginPointer(space: RuntimePointerSpace, id: number, px: number, py: number, pointerType = 'touch') {
      if (!active() || pointerType === 'mouse' || !Number.isFinite(px) || !Number.isFinite(py) || !validRect(host)) return false;
      pointers.set(id, point(space, px, py));if (pointers.size >= 2) beginPinch();publish();return true;
    },
    movePointer(space: RuntimePointerSpace, id: number, px: number, py: number) {
      if (!active() || !pointers.has(id) || !Number.isFinite(px) || !Number.isFinite(py)) return;
      pointers.set(id, point(space, px, py));
      if (!pinch || !pinch.ids.every(pointer => pointers.has(pointer))) return;
      const a = pointers.get(pinch.ids[0])!, b = pointers.get(pinch.ids[1])!;
      const nextScale = clamp(pinch.scale * Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)) / pinch.distance, 1, 3);
      apply(nextScale, (a.x + b.x) / 2 - baseX() - pinch.contentX * nextScale, (a.y + b.y) / 2 - pinch.contentY * nextScale);
    },
    endPointer(id: number) {if (!pointers.delete(id)) return;pinch = null;if (pointers.size >= 2) beginPinch();publish();},
    cancelGesture() {clearGesture();publish();},
    reset() {clearGesture();apply(1, 0, 0);},
  });
}
export type RuntimeViewportStore = ReturnType<typeof createRuntimeViewportStore>;
