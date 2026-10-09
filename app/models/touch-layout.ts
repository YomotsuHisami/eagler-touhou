import {
  canonicalTouchLayout, cloneTouchLayout, cloneTouchLayoutProfile, emptyTouchLayout, loadTouchLayoutFromStorage,
  normalizeTouchLayoutPriorityOrder, persistTouchLayoutResult, touchLayoutControlMeta,
  touchLayoutControlNames, touchLayoutScaleMax, touchLayoutScaleMin,
  type TouchLayout, type TouchLayoutControlName, type TouchLayoutControlPlacement,
  type TouchLayoutOrientation, type TouchLayoutPersistResult, type TouchLayoutProfile, type TouchLayoutStorage,
} from '../../src/launcher/touch-layout-model.mts';
import {createTouchLayoutWindowPositionStore} from '../../src/launcher/touch-layout-editor-state.mts';
export type {TouchLayoutControlName, TouchLayoutOrientation, TouchLayoutProfile};
export interface TouchLayoutSnapshot {
  isEditing: boolean;
  dirty: boolean;
  saved: TouchLayout | null;
  draft: TouchLayout | null;
  orientation: TouchLayoutOrientation;
  selected: TouchLayoutControlName;
  lastSave: TouchLayoutPersistResult | null;
  revision: number;
}
export interface TouchLayoutModel {
  subscribe(listener: () => void): () => void;
  getSnapshot(): TouchLayoutSnapshot;
  hydrate(): void;
  begin(orientation: TouchLayoutOrientation, defaults: TouchLayoutProfile, visible: readonly TouchLayoutControlName[]): void;
  ensureOrientation(orientation: TouchLayoutOrientation, defaults: TouchLayoutProfile): void;
  selectControl(name: TouchLayoutControlName): void;
  reconcileVisibleControls(visible: readonly TouchLayoutControlName[]): void;
  updateControl(name: TouchLayoutControlName, update: Partial<TouchLayoutControlPlacement>): void;
  setViewport(x: number): void;
  resetOrientation(): void;
  save(): TouchLayoutPersistResult;
  discard(): void;
  windowPositions: ReturnType<typeof createTouchLayoutWindowPositionStore>;
}
/** No navigation, browser measurement, confirmation or native capability owner.
 * The root decides exits; the React editor supplies measured original geometry. */
export function createTouchLayoutModel({storage}: {storage: TouchLayoutStorage | null}): TouchLayoutModel {
  const listeners = new Set<() => void>();
  const windowPositions = createTouchLayoutWindowPositionStore({storage});
  let saved: TouchLayout | null = null, draft: TouchLayout | null = null, editing = false;
  let orientation: TouchLayoutOrientation = 'landscape', selected: TouchLayoutControlName = 'bomb';
  let lastSave: TouchLayoutPersistResult | null = null, revision = 0;
  let snapshot: TouchLayoutSnapshot;
  function publish() {
    snapshot = Object.freeze({isEditing: editing, dirty: editing && JSON.stringify(canonicalTouchLayout(draft)) !== JSON.stringify(saved),
      saved: cloneTouchLayout(saved), draft: cloneTouchLayout(draft), orientation, selected, lastSave, revision: ++revision});
    for (const listener of listeners) listener();
  }
  function ensure(defaults: TouchLayoutProfile) {
    draft ??= emptyTouchLayout();
    const profile = draft.profiles[orientation];
    if (!profile) {draft.profiles[orientation] = cloneTouchLayoutProfile(defaults); return;}
    const missing = touchLayoutControlNames.filter(name => !profile.controls[name]);
    for (const name of missing) {
      const value = defaults.controls[name];
      if (value) profile.controls[name] = {...value};
    }
    normalizeTouchLayoutPriorityOrder(profile.controls);
    // Schema extensions are migration, not a user edit. Mirror only existing
    // saved profiles. A first default profile remains a materialized draft.
    const baseline = saved?.profiles[orientation];
    if (missing.length && baseline) {
      for (const name of missing) if (defaults.controls[name]) baseline.controls[name] = {...defaults.controls[name]!};
      normalizeTouchLayoutPriorityOrder(baseline.controls);
      saved = persistTouchLayoutResult(storage, saved).value;
    }
  }
  function profile() {
    if (!editing || !draft?.profiles[orientation]) throw new Error('touch.draftUnavailable');
    return draft.profiles[orientation]!;
  }
  publish();
  return Object.freeze({
    subscribe(listener: () => void) {listeners.add(listener); return () => {listeners.delete(listener);};},
    getSnapshot: () => snapshot,
    hydrate() {if (editing) return; saved = loadTouchLayoutFromStorage(storage); windowPositions.reload(); publish();},
    begin(next: TouchLayoutOrientation, defaults: TouchLayoutProfile, visible: readonly TouchLayoutControlName[]) {
      if (editing) return;
      orientation = next; editing = true; lastSave = null; draft = cloneTouchLayout(saved) ?? emptyTouchLayout();
      ensure(defaults);
      selected = visible.reduce((best, name) => (profile().controls[name]?.priority ?? touchLayoutControlMeta[name].priority) >
        (profile().controls[best]?.priority ?? touchLayoutControlMeta[best].priority) ? name : best, visible[0] ?? 'bomb');
      publish();
    },
    ensureOrientation(next: TouchLayoutOrientation, defaults: TouchLayoutProfile) {if (!editing) return; orientation = next; ensure(defaults); publish();},
    reconcileVisibleControls(visible: readonly TouchLayoutControlName[]) {
      if (!editing || visible.includes(selected)) return;
      selected = visible.find(name => name !== 'escape') ?? visible[0] ?? selected; publish();
    },
    selectControl(name: TouchLayoutControlName) {
      const item = profile().controls[name]; if (!item) return;
      selected = name;
      item.priority = Math.max(...Object.values(profile().controls).map(value => value?.priority ?? 0)) + 1;
      normalizeTouchLayoutPriorityOrder(profile().controls); publish();
    },
    updateControl(name: TouchLayoutControlName, update: Partial<TouchLayoutControlPlacement>) {
      const item = profile().controls[name]; if (!item) return;
      if (update.x != null) item.x = Math.min(1, Math.max(0, update.x));
      if (update.y != null) item.y = Math.min(1, Math.max(0, update.y));
      if (update.scale != null) item.scale = Math.min(touchLayoutScaleMax, Math.max(touchLayoutScaleMin, update.scale));
      publish();
    },
    setViewport(x: number) {profile().viewport.x = Math.max(-.5, Math.min(.5, x)); publish();},
    resetOrientation() {if (!editing || !draft) return; draft.profiles[orientation] = null; publish();},
    save() {
      if (!editing || !draft) throw new Error('touch.draftUnavailable');
      lastSave = persistTouchLayoutResult(storage, draft);
      // A blocked durable write still commits the session's usable layout.
      saved = lastSave.value; draft = cloneTouchLayout(saved) ?? emptyTouchLayout(); publish(); return lastSave;
    },
    discard() {editing = false; draft = null; lastSave = null; publish();},
    windowPositions,
  });
}
