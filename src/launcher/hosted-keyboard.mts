import type { HostedKeySpec, TouchRuntimeContext } from "./touch-runtime-protocol.mjs";

const codes: Record<string, [string, number]> = {
  KeyZ: ["z", 90], KeyX: ["x", 88], KeyC: ["c", 67], KeyU: ["u", 85], ShiftLeft: ["shift", 16], ShiftRight: ["shift", 16],
  Escape: ["escape", 27], ArrowUp: ["arrowup", 38], ArrowDown: ["arrowdown", 40],
  ArrowLeft: ["arrowleft", 37], ArrowRight: ["arrowright", 39],
  Numpad8: ["arrowup", 38], Numpad2: ["arrowdown", 40], Numpad4: ["arrowleft", 37],
  Numpad6: ["arrowright", 39], Numpad7: ["numpad7", 103], Numpad9: ["numpad9", 105],
  Numpad1: ["numpad1", 97], Numpad3: ["numpad3", 99],
  ControlLeft: ["control", 17], ControlRight: ["control", 17], KeyQ: ["q", 81],
  KeyS: ["s", 83], Home: ["home", 36], Enter: ["enter", 13], NumpadEnter: ["enter", 13],
  KeyD: ["d", 68], KeyR: ["r", 82], Tab: ["tab", 9], Backspace: ["backspace", 8],
  F1: ["f1", 112], F2: ["f2", 113], F3: ["f3", 114], F4: ["f4", 115],
  F5: ["f5", 116], F6: ["f6", 117], F7: ["f7", 118], F12: ["f12", 123],
};
const legacy = new Map(Object.values(codes).map(([key, keyCode]) => [keyCode, key]));
const knownKeys = new Set(Object.values(codes).map(([key]) => key));

export interface HostedKeyboardEvent extends HostedKeySpec {
  type: string;
  repeat?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
}
interface KeyOwner { identity: string; family: string; spec: HostedKeySpec; }
type KeyboardContext = Pick<TouchRuntimeContext, "target" | "game" | "epoch" | "launched" | "spectator">;

function describe(event: HostedKeySpec): KeyOwner | null {
  const code = Object.hasOwn(codes, event.code) ? event.code : "";
  const key = String(event.key || "").toLowerCase().replace(/^esc$/, "escape");
  const family = code ? codes[code]![0] : knownKeys.has(key) ? key : legacy.get(event.keyCode);
  if (!family) return null;
  // A physical modifier side is stronger evidence than a WebView's location.
  const location = code.endsWith("Left") && /^(Shift|Control)/.test(code) ? 1
    : code.endsWith("Right") && /^(Shift|Control)/.test(code) ? 2
    : code.startsWith("Numpad") ? 3 : Number.isInteger(event.location) ? event.location! : 0;
  return { family, identity: code || `${family}:${location}`,
    spec: {code: code || event.code || "", key: event.key || "", keyCode: event.keyCode || 0, location} };
}

// Host protocol ownership: releases carry the original DOWN identity so every
// adapter, including older shells, can retire the owner it actually installed.
export class HostedKeyboard {
  private owners = new Map<string, KeyOwner>();
  private retiredFamilies = new Set<string>();
  private context: KeyboardContext | null = null;

  clear(): void {
    for (const owner of this.owners.values()) this.retiredFamilies.add(owner.family);
    this.owners.clear(); this.context = null;
  }

  forward(event: HostedKeyboardEvent, context: KeyboardContext, launcherOwnsFocus: boolean): HostedKeySpec[] {
    if (this.context?.target !== context.target || this.context?.game !== context.game ||
        this.context?.epoch !== context.epoch) this.clear();
    this.context = context;
    if (!context.launched || !context.target || context.epoch <= 0 || context.spectator) {
      this.clear(); return [];
    }
    const key = describe(event);
    if (!key) return [];
    const exact = this.owners.get(key.identity);
    const candidates = [...this.owners.values()].filter(owner => owner.family === key.family);
    const sameSide = candidates.filter(owner => owner.spec.location === key.spec.location);
    const down = event.type === "keydown";
    if (down) {
      if (launcherOwnsFocus || event.altKey || event.metaKey) return [];
      const existing = exact || (!Object.hasOwn(codes, event.code)
        ? sameSide.length === 1 ? sameSide[0] : !key.spec.location && candidates.length === 1 ? candidates[0] : undefined
        : undefined);
      // A repeat after blur/reset cannot recreate an owner without a fresh DOWN.
      if (event.repeat && !existing) return [];
      if (existing) return [existing.spec];
      this.retiredFamilies.delete(key.family);
      this.owners.set(key.identity, key);
      return [key.spec];
    }
    let released = exact ? [exact] : sameSide;
    if (!released.length) released = candidates.filter(owner => !owner.spec.location && !Object.hasOwn(codes, owner.spec.code));
    if (!released.length && !Object.hasOwn(codes, event.code) && !key.spec.location) released = candidates;
    for (const owner of released) this.owners.delete(owner.identity);
    if (released.length) {
      this.retiredFamilies.add(key.family);
      return released.map(owner => owner.spec);
    }
    // Preserve release-only vendor-keyboard events over the game. Launcher UI
    // and spectators must never create input, even when no DOWN was observed.
    return launcherOwnsFocus || this.retiredFamilies.has(key.family) ? [] : [key.spec];
  }
}
