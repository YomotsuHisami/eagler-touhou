export const touchLayoutStorageKey = "eagler-touhou-touch-layout-v1";
export const touchLayoutVersion = 4;

export const touchLayoutControlMeta = Object.freeze({
  focus: Object.freeze({ id: "touchFocus", title: "低速", titleKey: "touch.focus", priority: 0 }),
  fire: Object.freeze({ id: "touchFire", title: "开火", titleKey: "touch.fire", priority: 1 }),
  bomb: Object.freeze({ id: "touchBomb", title: "Bomb", priority: 2 }),
  joystick: Object.freeze({ id: "touchJoystick", title: "轮盘", titleKey: "touch.movement.joystick", priority: 3 }),
  escape: Object.freeze({ id: "touchEscape", title: "ESC", priority: 4 }),
  thpracInput: Object.freeze({ id: "touchThpracInput", title: "模拟鼠标", titleKey: "touch.mouse", priority: 5 }),
  thpracTab: Object.freeze({ id: "touchThpracTab", title: "Tab", priority: 6 }),
  thpracMenu: Object.freeze({ id: "touchThpracMenu", title: "作弊菜单", titleKey: "touch.cheatMenu", priority: 7 }),
});

export const touchLayoutScaleMin = 0.6;
export const touchLayoutScaleMax = 1.8;
export const touchLayoutOrientations = Object.freeze(["landscape", "portrait"] as const);

export type TouchLayoutControlName = keyof typeof touchLayoutControlMeta;
export type TouchLayoutOrientation = (typeof touchLayoutOrientations)[number];

export interface TouchLayoutControlPlacement {
  x: number;
  y: number;
  scale: number;
  priority: number;
}

export type TouchLayoutControls = Partial<Record<TouchLayoutControlName, TouchLayoutControlPlacement>>;

export interface TouchLayoutProfile {
  controls: TouchLayoutControls;
  viewport: { x: number };
}

export interface TouchLayout {
  version: typeof touchLayoutVersion;
  profiles: Record<TouchLayoutOrientation, TouchLayoutProfile | null>;
}

export interface TouchLayoutStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const touchLayoutControlNames = Object.freeze(Object.keys(touchLayoutControlMeta) as TouchLayoutControlName[]);
const optionalLegacyControls = new Set<TouchLayoutControlName>([
  "joystick",
  "thpracInput",
  "thpracTab",
  "thpracMenu",
]);
const thpracNames = new Set<TouchLayoutControlName>(["thpracInput", "thpracTab", "thpracMenu"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object";
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function normalizeTouchLayoutPriorityOrder(controls: TouchLayoutControls): TouchLayoutControls {
  const ordered = (Object.entries(controls) as [TouchLayoutControlName, TouchLayoutControlPlacement][])
    .sort(([aName, a], [bName, b]) => {
      const aPriority = Number.isFinite(a.priority) ? a.priority : touchLayoutControlMeta[aName].priority;
      const bPriority = Number.isFinite(b.priority) ? b.priority : touchLayoutControlMeta[bName].priority;
      return aPriority - bPriority || touchLayoutControlMeta[aName].priority - touchLayoutControlMeta[bName].priority;
    });

  // Backspace is authoritative only inside the optional thprac touch-key set.
  // Swap thprac entries among their existing slots; never promote the set over
  // Bomb/ESC/joystick or any other ordinary touch control.
  const thpracSlots = ordered.flatMap(([name], index) => thpracNames.has(name) ? [index] : []);
  const menuIndex = ordered.findIndex(([name]) => name === "thpracMenu");
  const highestThpracSlot = thpracSlots.at(-1);
  if (menuIndex >= 0 && highestThpracSlot != null && menuIndex !== highestThpracSlot) {
    [ordered[menuIndex], ordered[highestThpracSlot]] = [ordered[highestThpracSlot], ordered[menuIndex]];
  }
  ordered.forEach(([, item], index) => { item.priority = index; });
  return controls;
}

function normalizeTouchLayoutProfile(profile: unknown): TouchLayoutProfile | null | undefined {
  if (profile == null) return null;
  if (!isRecord(profile)) return undefined;
  const rawControls = isRecord(profile.controls) ? profile.controls : {};
  const controls: TouchLayoutControls = {};

  for (const name of touchLayoutControlNames) {
    const rawItem = rawControls[name];
    // Older saved layouts predate later optional controls. Keep them valid and
    // let the editor fill each missing control from its current default
    // geometry without disturbing the user's remembered positions.
    if (!rawItem && optionalLegacyControls.has(name)) continue;
    if (!isRecord(rawItem)) return undefined;
    const x = rawItem.x;
    const y = rawItem.y;
    const scale = rawItem.scale;
    const priority = rawItem.priority;
    if (!finiteNumber(x) || !finiteNumber(y) || !finiteNumber(scale) ||
        (priority != null && !finiteNumber(priority)) ||
        x < 0 || x > 1 || y < 0 || y > 1 ||
        scale < touchLayoutScaleMin || scale > touchLayoutScaleMax) return undefined;
    controls[name] = {
      x,
      y,
      scale,
      priority: finiteNumber(priority) ? priority : touchLayoutControlMeta[name].priority,
    };
  }

  const rawViewport = profile.viewport == null ? { x: 0 } : profile.viewport;
  if (!isRecord(rawViewport) || !finiteNumber(rawViewport.x) || rawViewport.x < -0.5 || rawViewport.x > 0.5) {
    return undefined;
  }
  return { controls: normalizeTouchLayoutPriorityOrder(controls), viewport: { x: rawViewport.x } };
}

export function cloneTouchLayoutProfile(profile: TouchLayoutProfile | null | undefined): TouchLayoutProfile | null {
  if (!profile) return null;
  return {
    controls: Object.fromEntries(
      (Object.entries(profile.controls) as [TouchLayoutControlName, TouchLayoutControlPlacement][])
        .map(([name, item]) => [name, { ...item }]),
    ) as TouchLayoutControls,
    viewport: { ...profile.viewport },
  };
}

export function normalizeTouchLayout(value: unknown): TouchLayout | null {
  if (!isRecord(value)) return null;

  // The editor was never publicly released with v1, but accepting the local
  // development shape costs almost nothing and prevents a surprising reset.
  if (value.version === 1) {
    const migrated = normalizeTouchLayoutProfile({ controls: value.controls });
    if (!migrated) return null;
    return {
      version: touchLayoutVersion,
      profiles: {
        landscape: cloneTouchLayoutProfile(migrated),
        portrait: cloneTouchLayoutProfile(migrated),
      },
    };
  }

  if (![2, 3, touchLayoutVersion].includes(Number(value.version)) || !isRecord(value.profiles)) return null;
  const profiles = {} as Record<TouchLayoutOrientation, TouchLayoutProfile | null>;
  for (const orientation of touchLayoutOrientations) {
    const profile = normalizeTouchLayoutProfile(value.profiles[orientation] ?? null);
    if (profile === undefined) return null;
    profiles[orientation] = profile;
  }
  return { version: touchLayoutVersion, profiles };
}

export function canonicalTouchLayout(value: unknown): TouchLayout | null {
  const normalized = normalizeTouchLayout(value);
  return normalized && touchLayoutOrientations.some(orientation => normalized.profiles[orientation])
    ? normalized
    : null;
}

export function loadTouchLayoutFromStorage(storage: TouchLayoutStorage | null): TouchLayout | null {
  if (!storage) return null;
  try {
    return canonicalTouchLayout(JSON.parse(storage.getItem(touchLayoutStorageKey) || "null"));
  } catch {
    return null;
  }
}

export interface TouchLayoutPersistResult {
  value: TouchLayout | null;
  persisted: boolean;
  error: unknown | null;
}

export function persistTouchLayoutResult(
  storage: TouchLayoutStorage | null,
  value: unknown,
): TouchLayoutPersistResult {
  const canonical = canonicalTouchLayout(value);
  if (!storage) return { value: canonical, persisted: false, error: new Error("browser storage unavailable") };
  try {
    if (canonical) storage.setItem(touchLayoutStorageKey, JSON.stringify(canonical));
    else storage.removeItem(touchLayoutStorageKey);
    return { value: canonical, persisted: true, error: null };
  } catch (error) {
    return { value: canonical, persisted: false, error };
  }
}

export function persistTouchLayoutToStorage(
  storage: TouchLayoutStorage | null,
  value: unknown,
): TouchLayout | null {
  return persistTouchLayoutResult(storage, value).value;
}

export function cloneTouchLayout(layout: TouchLayout | null | undefined): TouchLayout | null {
  if (!layout) return null;
  return {
    version: touchLayoutVersion,
    profiles: Object.fromEntries(
      touchLayoutOrientations.map(orientation => [orientation, cloneTouchLayoutProfile(layout.profiles[orientation])]),
    ) as Record<TouchLayoutOrientation, TouchLayoutProfile | null>,
  };
}

export function emptyTouchLayout(): TouchLayout {
  return {
    version: touchLayoutVersion,
    profiles: { landscape: null, portrait: null },
  };
}
