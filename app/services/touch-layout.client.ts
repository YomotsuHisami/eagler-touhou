import {
  canonicalTouchLayout, cloneTouchLayout, cloneTouchLayoutProfile, emptyTouchLayout,
  loadTouchLayoutFromStorage, normalizeTouchLayoutPriorityOrder, persistTouchLayoutResult,
  touchLayoutControlMeta, touchLayoutControlNames, touchLayoutScaleMax, touchLayoutScaleMin,
  type TouchLayout, type TouchLayoutControlName, type TouchLayoutControlPlacement,
  type TouchLayoutOrientation, type TouchLayoutProfile, type TouchLayoutStorage,
} from '../../src/launcher/touch-layout-model.mts';
import {createTouchLayoutWindowPositionStore, type TouchLayoutWindowPoint} from '../../src/launcher/touch-layout-editor-state.mts';

export interface LayoutRect {left: number; top: number; width: number; height: number}
export interface TouchLayoutGeometry {
  orientation: TouchLayoutOrientation;
  safe: LayoutRect;
  controls: Readonly<Record<TouchLayoutControlName, LayoutRect>>;
  reserved?: LayoutRect;
}
export interface PositionedTouchControl {rect: LayoutRect; scale: number; priority: number}
export interface TouchLayoutSnapshot {
  readonly loaded: boolean;
  readonly saved: TouchLayout | null;
  readonly draft: TouchLayout | null;
  readonly profile: TouchLayoutProfile | null;
  readonly orientation: TouchLayoutOrientation;
  readonly selected: TouchLayoutControlName;
  readonly dirty: boolean;
  readonly persistence: 'local' | 'session';
  readonly workbench: TouchLayoutWindowPoint | null;
  readonly controls: Readonly<Partial<Record<TouchLayoutControlName, PositionedTouchControl>>>;
}
export interface TouchLayoutStore {
  load(): void;
  getSnapshot(): TouchLayoutSnapshot;
  subscribe(listener: () => void): () => void;
  /** Measurements come from the React-owned default controls, never invented coordinates. */
  setGeometry(geometry: TouchLayoutGeometry): void;
  select(name: TouchLayoutControlName): void;
  updateControl(name: TouchLayoutControlName, patch: Partial<TouchLayoutControlPlacement>): void;
  moveControl(name: TouchLayoutControlName, dx: number, dy: number): void;
  bringToFront(name: TouchLayoutControlName): void;
  setViewport(x: number): void;
  resetOrientation(): void;
  setWorkbenchPosition(point: TouchLayoutWindowPoint): void;
  overlappingControls(names: readonly TouchLayoutControlName[]): readonly TouchLayoutControlName[];
  save(): boolean;
  discard(): void;
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
function validRect(rect: LayoutRect) {
  return [rect.left, rect.top, rect.width, rect.height].every(Number.isFinite) && rect.width > 0 && rect.height > 0;
}
export function measuredDefaultTouchProfile(geometry: TouchLayoutGeometry): TouchLayoutProfile {
  if (!validRect(geometry.safe)) throw new Error('触控布局预览尺寸不可用');
  const controls: TouchLayoutProfile['controls'] = {};
  for (const name of touchLayoutControlNames) {
    const rect = geometry.controls[name];
    if (!rect || !validRect(rect)) throw new Error(`触控按钮尺寸不可用：${name}`);
    controls[name] = {
      x: clamp((rect.left + rect.width / 2 - geometry.safe.left) / geometry.safe.width, 0, 1),
      y: clamp((rect.top + rect.height / 2 - geometry.safe.top) / geometry.safe.height, 0, 1),
      scale: 1, priority: touchLayoutControlMeta[name].priority,
    };
  }
  return {controls: normalizeTouchLayoutPriorityOrder(controls), viewport: {x: 0}};
}
/** Same six-pixel inset and half-control bounds used by main's live touch surface. */
export function effectiveTouchPlacement(item: TouchLayoutControlPlacement, size: LayoutRect, safe: LayoutRect) {
  const marginX = Math.min(.48, (size.width * item.scale / 2 + 6) / safe.width);
  const marginY = Math.min(.48, (size.height * item.scale / 2 + 6) / safe.height);
  return {...item, x: clamp(item.x, marginX, 1 - marginX), y: clamp(item.y, marginY, 1 - marginY)};
}
export function touchRectOverlap(a: LayoutRect, b: LayoutRect) {
  const width = Math.max(0, Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left));
  const height = Math.max(0, Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top));
  return width * height / Math.max(1, Math.min(a.width * a.height, b.width * b.height));
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

/** Root-lived draft/persistence owner; no framework, browser globals, DOM or Runtime commands. */
export function createTouchLayoutStore({storage = null}: {
  storage?: Pick<TouchLayoutStorage, 'getItem' | 'setItem'> & Partial<Pick<TouchLayoutStorage, 'removeItem'>> | null;
} = {}): TouchLayoutStore {
  let saved: TouchLayout | null = null, draft: TouchLayout | null = null;
  let loaded = false, orientation: TouchLayoutOrientation = 'landscape', selected: TouchLayoutControlName = 'bomb';
  let persistence: TouchLayoutSnapshot['persistence'] = storage ? 'local' : 'session';
  const geometry = new Map<TouchLayoutOrientation, TouchLayoutGeometry>();
  const listeners = new Set<() => void>();
  let windows: ReturnType<typeof createTouchLayoutWindowPositionStore> | null = null;
  const persistenceStorage: TouchLayoutStorage | null = storage ? {
    getItem(key) { try { return storage.getItem(key); } catch (error) { persistence = 'session'; throw error; } },
    setItem: (key, value) => storage.setItem(key, value),
    removeItem(key) { if (!storage.removeItem) throw new Error('Storage cannot remove a layout'); storage.removeItem(key); },
  } : null;

  function profile() {
    const measured = geometry.get(orientation);
    const existing = cloneTouchLayoutProfile(draft?.profiles[orientation]);
    if (!measured) return existing;
    const defaults = measuredDefaultTouchProfile(measured);
    if (!existing) return defaults;
    // Later optional controls inherit measured defaults without moving older
    // placements or creating an unsaved change merely by opening the editor.
    for (const name of touchLayoutControlNames) if (!existing.controls[name]) existing.controls[name] = {...defaults.controls[name]!};
    normalizeTouchLayoutPriorityOrder(existing.controls);
    return existing;
  }
  function snapshot(): TouchLayoutSnapshot {
    const effective = profile(), measured = geometry.get(orientation);
    const controls: Partial<Record<TouchLayoutControlName, PositionedTouchControl>> = {};
    if (effective && measured) for (const name of touchLayoutControlNames) {
      const item = effective.controls[name];
      if (!item) continue;
      const size = measured.controls[name], placed = effectiveTouchPlacement(item, size, measured.safe);
      const width = size.width * placed.scale, height = size.height * placed.scale;
      controls[name] = {rect: {left: measured.safe.left + placed.x * measured.safe.width - width / 2,
        top: measured.safe.top + placed.y * measured.safe.height - height / 2, width, height}, scale: placed.scale, priority: placed.priority};
    }
    return freeze({loaded, saved: cloneTouchLayout(saved), draft: cloneTouchLayout(draft), profile: effective,
      orientation, selected, dirty: JSON.stringify(canonicalTouchLayout(draft)) !== JSON.stringify(saved), persistence,
      workbench: windows?.get(orientation, 'editor') ?? null, controls});
  }
  let current = snapshot();
  function publish() { current = snapshot(); for (const listener of [...listeners]) listener(); }
  function mutate(change: (value: TouchLayoutProfile) => void) {
    if (!loaded || !geometry.has(orientation)) return;
    const value = profile();
    if (!value) return;
    const before = JSON.stringify(value);
    change(value);
    if (JSON.stringify(value) === before) return;
    if (!draft) draft = emptyTouchLayout();
    draft.profiles[orientation] = value;
    publish();
  }
  function updateControl(name: TouchLayoutControlName, patch: Partial<TouchLayoutControlPlacement>) {
    if (!touchLayoutControlNames.includes(name) || Object.values(patch).some(value => !Number.isFinite(value))) return;
    mutate(value => {
      const old = value.controls[name], measured = geometry.get(orientation);
      if (!old || !measured) return;
      const next = {...old, ...patch};
      next.scale = clamp(next.scale, touchLayoutScaleMin, touchLayoutScaleMax);
      value.controls[name] = effectiveTouchPlacement(next, measured.controls[name], measured.safe);
      normalizeTouchLayoutPriorityOrder(value.controls);
    });
  }
  return Object.freeze({
    load() {
      if (loaded) return;
      saved = loadTouchLayoutFromStorage(persistenceStorage); draft = cloneTouchLayout(saved);
      windows = createTouchLayoutWindowPositionStore({storage: persistenceStorage});
      loaded = true; publish();
    },
    getSnapshot: () => current,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    setGeometry(next: TouchLayoutGeometry) {
      measuredDefaultTouchProfile(next);
      if (next.orientation === orientation && JSON.stringify(geometry.get(orientation)) === JSON.stringify(next)) return;
      orientation = next.orientation;
      geometry.set(orientation, freeze(structuredClone(next)));
      publish();
    },
    select(name: TouchLayoutControlName) { if (!touchLayoutControlNames.includes(name) || name === selected) return; selected = name; publish(); },
    updateControl,
    moveControl(name: TouchLayoutControlName, dx: number, dy: number) {
      const measured = geometry.get(orientation), item = profile()?.controls[name];
      if (!measured || !item || !Number.isFinite(dx) || !Number.isFinite(dy)) return;
      updateControl(name, {x: item.x + dx / measured.safe.width, y: item.y + dy / measured.safe.height});
    },
    bringToFront(name: TouchLayoutControlName) {
      const value = profile();
      if (value) updateControl(name, {priority: Math.max(...Object.values(value.controls).map(item => item.priority)) + 1});
    },
    setViewport(x: number) { if (Number.isFinite(x)) mutate(value => { value.viewport.x = clamp(x, -.5, .5); }); },
    resetOrientation() {
      if (!draft?.profiles[orientation]) return;
      draft.profiles[orientation] = null;
      publish();
    },
    setWorkbenchPosition(point: TouchLayoutWindowPoint) {
      if (windows?.set(orientation, 'editor', point)) publish();
    },
    overlappingControls(names: readonly TouchLayoutControlName[]) {
      const overlaps = new Set<TouchLayoutControlName>(), reserved = geometry.get(orientation)?.reserved;
      for (let i = 0; i < names.length; i++) {
        const first = current.controls[names[i]]?.rect;
        if (!first) continue;
        if (reserved && touchRectOverlap(first, reserved) >= .18) overlaps.add(names[i]);
        for (let j = i + 1; j < names.length; j++) {
          const second = current.controls[names[j]]?.rect;
          if (second && touchRectOverlap(first, second) >= .18) {overlaps.add(names[i]);overlaps.add(names[j]);}
        }
      }
      return [...overlaps];
    },
    save() {
      if (!loaded) return false;
      const result = persistTouchLayoutResult(persistenceStorage, draft);
      persistence = result.persisted ? 'local' : 'session';
      // Failed durable writes retain both the draft and the dirty guard. A
      // route-close Save must never become permission to silently lose it.
      if (result.persisted) { saved = result.value; draft = cloneTouchLayout(saved); }
      publish();
      return result.persisted;
    },
    discard() { draft = cloneTouchLayout(saved); publish(); },
  });
}
