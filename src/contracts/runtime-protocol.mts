import { HOST_PROTOCOL, isGameId, type GameId } from "./product-catalog.mjs";

export const TOUCH_SENSITIVITY_MIN = 100;
export const TOUCH_SENSITIVITY_MAX = 300;
export const RUNTIME_EPOCH_QUERY_PARAMETER = "runtimeEpoch";

export const RUNTIME_PROTOCOL_COMMANDS = Object.freeze([
  "configure",
  "resources",
  "keyboard",
  "keyboard-clear",
  "touch-controls",
  "touch-cancel",
  "direct-touch",
  "launch",
  "list",
  "read",
  "write",
  "remove",
  "sync",
] as const);

// Optional commands are capability-specific and are not required of every
// Runtime shell. They still share the same envelope and request ownership.
export const RUNTIME_PROTOCOL_OPTIONAL_COMMANDS = Object.freeze([
  "retry-music",
  "thprac-mouse",
  "network-cancel",
] as const);

export const RUNTIME_PROTOCOL_EVENTS = Object.freeze([
  "ready",
  "transfer",
  "first-frame",
  "runtime-info",
  "frame-health",
  "audio-health",
  "exit",
  "error",
] as const);

export const RUNTIME_PROTOCOL_OPTIONAL_EVENTS = Object.freeze([
  "midi-fallback",
  "music-complete",
  "music-error",
  "music-incomplete",
  "notice",
  "player-debug",
  "network-request",
] as const);

export type RuntimeProtocolCommand =
  | (typeof RUNTIME_PROTOCOL_COMMANDS)[number]
  | (typeof RUNTIME_PROTOCOL_OPTIONAL_COMMANDS)[number];

export type RuntimeProtocolEvent =
  | (typeof RUNTIME_PROTOCOL_EVENTS)[number]
  | (typeof RUNTIME_PROTOCOL_OPTIONAL_EVENTS)[number];
export type RuntimeLegacyProtocolEvent = (typeof RUNTIME_PROTOCOL_LEGACY_EVENTS)[number];

export type RuntimeCommandPhase = "ready" | "prelaunch" | "live";
export type RuntimeCommandResponseMode = "required" | "optional";
export type RuntimeCommandRequirement = "required" | "conditional" | "profile-required";
export type RuntimeEventPhase = "initialization" | "live" | "terminal" | "any";
export type RuntimeEventCadence = "once" | "per-launch" | "periodic" | "contextual";
export type RuntimeEventRequirement = "required" | "conditional" | "optional";

export type RuntimeTouchMovementMode = "touch" | "touch-unlimited" | "joystick" | "joystick-free";
export type RuntimeTouchFocusMode = "two-finger" | "hold-button" | "toggle-button";
export type RuntimeOggDecodeMode = "stream" | "full";
export interface RuntimeNetplayLoadout { character: number; shot: number; }
export type RuntimeConfigureOptionRequirement = "required" | "profile-required" | "optional" | "diagnostic";

// Canonical Runtime-owned configuration. Launcher-only preferences such as the
// touch layout editor, magnifier and Restart-button visibility do not belong on
// this wire object. Compatibility aliases are listed separately below.
export interface RuntimeConfigureOptions {
  thpracEnabled?: boolean;
  limitPresentationTo60?: boolean;
  touchEnabled?: boolean;
  touchMovementMode?: RuntimeTouchMovementMode;
  touchSensitivity?: number;
  touchFocusMode?: RuntimeTouchFocusMode;
  doubleTapBombEnabled?: boolean;
  alwaysHitbox?: boolean;
  multiplayerLocalPlayerVisibility?: boolean;
  focusHitboxEnabled?: boolean;
  replayViewer?: boolean;
  multiplayerPreflight?: boolean;
  thpracLocale?: string;
  oggDecodeMode?: RuntimeOggDecodeMode;
  debugHarness?: string | null;
  netplayMode?: "lan";
  netplayUrl?: string;
  netplayPlayer?: number | null;
  netplayPlayerCount?: number;
  netplaySeed?: number;
  netplayDifficulty?: number;
  netplayInputDelay?: number;
  netplayAdonisMode?: number;
  netplayPredictionLimit?: number;
  netplaySpectator?: boolean;
  netplaySpectatorId?: string;
  netplaySpectatorCount?: number;
  netplayIceServers?: unknown[];
  netplayLoadouts?: RuntimeNetplayLoadout[];
}

/**
 * Semantic classification of every canonical `configure.options` field.
 *
 * This table is intentionally exhaustive: adding a wire field without deciding
 * whether every adapter owes it was one of the main sources of accidental
 * per-title behavior. Launcher-only preferences never appear here. Legacy
 * aliases live in RUNTIME_CONFIGURE_LEGACY_OPTION_KEYS instead.
 */
export const RUNTIME_CONFIGURE_OPTION_BEHAVIOR = Object.freeze({
  thpracEnabled: Object.freeze({ requirement: "optional", capability: "thprac", when: "product declares thprac" }),
  limitPresentationTo60: Object.freeze({ requirement: "required", capability: "presentation-cadence" }),
  touchEnabled: Object.freeze({ requirement: "required", capability: "touch-controls" }),
  touchMovementMode: Object.freeze({ requirement: "required", capability: "touch-controls" }),
  touchSensitivity: Object.freeze({ requirement: "required", capability: "touch-controls" }),
  touchFocusMode: Object.freeze({ requirement: "required", capability: "touch-controls" }),
  doubleTapBombEnabled: Object.freeze({ requirement: "required", capability: "touch-controls" }),
  alwaysHitbox: Object.freeze({ requirement: "required", capability: "always-hitbox" }),
  multiplayerLocalPlayerVisibility: Object.freeze({ requirement: "profile-required", capability: "multiplayer-local-player-visibility", when: "multiplayer" }),
  focusHitboxEnabled: Object.freeze({ requirement: "optional", capability: "focus-hitbox", when: "product declares focus-hitbox" }),
  replayViewer: Object.freeze({ requirement: "profile-required", capability: "multiplayer", when: "multiplayer Replay viewer is launched" }),
  multiplayerPreflight: Object.freeze({ requirement: "profile-required", capability: "multiplayer", when: "multiplayer room checks its Runtime before joining gameplay" }),
  thpracLocale: Object.freeze({ requirement: "profile-required", capability: "thprac", when: "thprac" }),
  oggDecodeMode: Object.freeze({ requirement: "required", capability: "normal-music-ogg" }),
  debugHarness: Object.freeze({ requirement: "diagnostic", capability: "runtime-health-diagnostics", when: "explicit debug/test launch" }),
  netplayMode: Object.freeze({ requirement: "profile-required", capability: "multiplayer", when: "multiplayer" }),
  netplayUrl: Object.freeze({ requirement: "profile-required", capability: "multiplayer", when: "multiplayer" }),
  netplayPlayer: Object.freeze({ requirement: "profile-required", capability: "multiplayer", when: "multiplayer player session" }),
  netplayPlayerCount: Object.freeze({ requirement: "profile-required", capability: "multiplayer", when: "multiplayer" }),
  netplaySeed: Object.freeze({ requirement: "profile-required", capability: "multiplayer", when: "multiplayer player session" }),
  netplayDifficulty: Object.freeze({ requirement: "profile-required", capability: "multiplayer", when: "multiplayer player session" }),
  netplayInputDelay: Object.freeze({ requirement: "profile-required", capability: "multiplayer", when: "TH08 multiplayer player session" }),
  netplayAdonisMode: Object.freeze({ requirement: "diagnostic", capability: "multiplayer", when: "experiment/adonis TH09; 0 rollback, 1 exact-input delay, 2 hybrid; fixed before HELLO" }),
  netplayPredictionLimit: Object.freeze({ requirement: "profile-required", capability: "multiplayer", when: "TH08 multiplayer player session" }),
  netplaySpectator: Object.freeze({ requirement: "profile-required", capability: "multiplayer", when: "multiplayer" }),
  netplaySpectatorId: Object.freeze({ requirement: "profile-required", capability: "multiplayer", when: "multiplayer spectator session" }),
  netplaySpectatorCount: Object.freeze({ requirement: "profile-required", capability: "multiplayer", when: "multiplayer" }),
  netplayIceServers: Object.freeze({ requirement: "profile-required", capability: "multiplayer", when: "multiplayer" }),
  netplayLoadouts: Object.freeze({ requirement: "profile-required", capability: "multiplayer", when: "multiplayer player session" }),
} satisfies Readonly<Record<keyof RuntimeConfigureOptions, Readonly<{
  requirement: RuntimeConfigureOptionRequirement;
  capability: string;
  when?: string;
}>>>);

export const RUNTIME_CONFIGURE_OPTION_KEYS = Object.freeze(
  Object.keys(RUNTIME_CONFIGURE_OPTION_BEHAVIOR) as (keyof RuntimeConfigureOptions)[],
);

// Read-only compatibility vocabulary for older hosts/shells. New adapters must
// not implement these names as part of the canonical configure contract.
export const RUNTIME_CONFIGURE_LEGACY_OPTION_KEYS = Object.freeze([
  "unlimitedTouch",
  "touchBombZoneEnabled",
  "th06FocusHitbox",
  "enhanceLocalPlayerVisibility",
  "thpracSession",
] as const);

// Historical configure.music values accepted by older preload shells. The
// current Launcher protocol is OGG / MIDI / none; new adapters must not expose
// WAV as a player-selectable Runtime music mode.
export const RUNTIME_CONFIGURE_LEGACY_MUSIC_MODES = Object.freeze([
  "wav",
] as const);

// These names remain accepted/parsed only so existing Runtimes and historical
// hosts keep working. They are not obligations for a new adapter.
export const RUNTIME_PROTOCOL_LEGACY_EVENTS = Object.freeze([
  "thprac-session",
] as const);

/**
 * Operational semantics for the message vocabulary. `response` describes the
 * request/reply transport boundary; `requirement` separately answers whether a
 * formal adapter must implement the command at all. Do not confuse an optional
 * ACK with an optional feature.
 */
export const RUNTIME_PROTOCOL_COMMAND_BEHAVIOR = Object.freeze({
  configure: Object.freeze({ phase: "prelaunch", response: "required", requirement: "required" }),
  resources: Object.freeze({ phase: "ready", response: "required", requirement: "required" }),
  keyboard: Object.freeze({ phase: "live", response: "optional", requirement: "required" }),
  "keyboard-clear": Object.freeze({ phase: "live", response: "optional", requirement: "required" }),
  "touch-controls": Object.freeze({ phase: "live", response: "optional", requirement: "required" }),
  "touch-cancel": Object.freeze({ phase: "live", response: "optional", requirement: "required" }),
  "direct-touch": Object.freeze({ phase: "live", response: "optional", requirement: "required" }),
  launch: Object.freeze({ phase: "prelaunch", response: "required", requirement: "required" }),
  list: Object.freeze({ phase: "ready", response: "required", requirement: "required" }),
  read: Object.freeze({ phase: "ready", response: "required", requirement: "required" }),
  write: Object.freeze({ phase: "ready", response: "required", requirement: "required" }),
  remove: Object.freeze({ phase: "ready", response: "required", requirement: "required" }),
  sync: Object.freeze({ phase: "ready", response: "required", requirement: "required" }),
  "retry-music": Object.freeze({ phase: "live", response: "required", requirement: "conditional", when: "Runtime-managed music transfer can fail before launch and advertise retry" }),
  "thprac-mouse": Object.freeze({ phase: "live", response: "optional", requirement: "profile-required", when: "thprac capability is declared" }),
  "network-cancel": Object.freeze({ phase: "live", response: "optional", requirement: "conditional", when: "TH09 game-title multiplayer dialog is dismissed" }),
} satisfies Readonly<Record<RuntimeProtocolCommand, Readonly<{
  phase: RuntimeCommandPhase;
  response: RuntimeCommandResponseMode;
  requirement: RuntimeCommandRequirement;
  when?: string;
}>>>);

/**
 * Delivery semantics for Runtime events. This answers the adapter question
 * that a vocabulary-only list cannot answer: when must an event be emitted?
 *
 * `required` means every formal adapter implements and emits the event at the
 * stated lifecycle boundary. `conditional` means every adapter implements the
 * event when that condition occurs. `optional` is diagnostic/profile surface
 * that a Runtime may omit unless another capability contract requires it.
 */
export const RUNTIME_PROTOCOL_EVENT_BEHAVIOR = Object.freeze({
  ready: Object.freeze({ phase: "initialization", cadence: "once", requirement: "required" }),
  transfer: Object.freeze({ phase: "any", cadence: "contextual", requirement: "conditional" }),
  "first-frame": Object.freeze({ phase: "live", cadence: "per-launch", requirement: "required" }),
  "runtime-info": Object.freeze({ phase: "live", cadence: "per-launch", requirement: "required" }),
  "frame-health": Object.freeze({ phase: "live", cadence: "periodic", requirement: "required" }),
  "audio-health": Object.freeze({ phase: "live", cadence: "periodic", requirement: "required" }),
  exit: Object.freeze({ phase: "terminal", cadence: "contextual", requirement: "required" }),
  error: Object.freeze({ phase: "terminal", cadence: "contextual", requirement: "required" }),
  "midi-fallback": Object.freeze({ phase: "live", cadence: "contextual", requirement: "conditional" }),
  "music-complete": Object.freeze({ phase: "live", cadence: "contextual", requirement: "conditional" }),
  "music-error": Object.freeze({ phase: "live", cadence: "contextual", requirement: "conditional" }),
  "music-incomplete": Object.freeze({ phase: "live", cadence: "contextual", requirement: "conditional" }),
  notice: Object.freeze({ phase: "any", cadence: "contextual", requirement: "optional" }),
  "player-debug": Object.freeze({ phase: "live", cadence: "periodic", requirement: "optional" }),
  "network-request": Object.freeze({ phase: "live", cadence: "contextual", requirement: "conditional" }),
} satisfies Readonly<Record<RuntimeProtocolEvent, Readonly<{
  phase: RuntimeEventPhase;
  cadence: RuntimeEventCadence;
  requirement: RuntimeEventRequirement;
}>>>);

export interface RuntimeCommandPayloads {
  configure: {
    music: "ogg" | "midi" | "none";
    language?: string;
    resources?: unknown[];
    runtimeResources?: unknown[];
    sharedResources?: unknown[];
    runtimePack?: unknown;
    options?: RuntimeConfigureOptions;
    [key: string]: unknown;
  };
  resources: { resources: unknown[] };
  keyboard: { down: boolean; code: string };
  "keyboard-clear": Record<string, never>;
  "touch-controls": {
    fireEnabled: boolean;
    focusEnabled: boolean;
    bombSerial: number;
    escapeSerial: number;
    joystickX: number;
    joystickY: number;
    touchSensitivity: number;
  };
  "touch-cancel": Record<string, never>;
  "direct-touch": { type: "down" | "move" | "up"; id: number; x: number; y: number };
  launch: Record<string, never>;
  list: Record<string, never>;
  read: { path: string };
  write: { path: string; bytes: number[] };
  remove: { path: string };
  sync: Record<string, never>;
  "retry-music": Record<string, never>;
  "thprac-mouse": { type: "move" | "down" | "up"; x: number; y: number };
  "network-cancel": Record<string, never>;
}

/**
 * Browser-visible event payloads consumed by the Launcher. `ready` proves that
 * the shell/storage/DATA bridge is command-ready; it is deliberately separate
 * from `first-frame`, which proves that a launched game has actually presented.
 * Extra fields are permitted for diagnostics and forward compatibility, but a
 * Runtime should prefer an existing event over inventing another event name.
 */
export interface RuntimeEventPayloads {
  ready: { saveRoot?: string };
  transfer: { mode?: string; loaded?: number; total?: number; failed?: number; path?: string; [key: string]: unknown };
  "first-frame": Record<string, never>;
  "runtime-info": { renderer?: string; architecture?: string; version?: string; [key: string]: unknown };
  "frame-health": { fps?: number; maxGapMs?: number; frameMs?: number; [key: string]: unknown };
  exit: { code?: number; status?: string; [key: string]: unknown };
  error: { message?: unknown; error?: unknown; [key: string]: unknown };
  "audio-health": { queuedMs?: number; minQueuedMs?: number; backend?: string; underruns?: number; robust?: boolean; [key: string]: unknown };
  "midi-fallback": Record<string, unknown>;
  "music-complete": { mode?: string; loaded?: number; total?: number; [key: string]: unknown };
  "music-error": { failed?: number; [key: string]: unknown };
  "music-incomplete": { failed?: number; [key: string]: unknown };
  notice: { message?: string; [key: string]: unknown };
  "player-debug": Record<string, unknown>;
  "network-request": Record<string, never>;
}

export interface RuntimeProtocolEnvelope {
  protocol: typeof HOST_PROTOCOL;
  game: GameId;
  epoch: number;
}

export type RuntimeCommandMessage<C extends RuntimeProtocolCommand = RuntimeProtocolCommand> =
  RuntimeProtocolEnvelope & { command: C; request?: string } & RuntimeCommandPayloads[C];

export interface RuntimeSuccessResponse extends RuntimeProtocolEnvelope {
  request: string;
  ok: true;
  [key: string]: unknown;
}

export interface RuntimeFailureResponse extends RuntimeProtocolEnvelope {
  request: string;
  ok: false;
  error?: unknown;
  errno?: unknown;
  [key: string]: unknown;
}

export type RuntimeResponseMessage = RuntimeSuccessResponse | RuntimeFailureResponse;

export type RuntimeEventMessage<E extends RuntimeProtocolEvent = RuntimeProtocolEvent> =
  E extends RuntimeProtocolEvent
    ? RuntimeProtocolEnvelope & { event: E } & RuntimeEventPayloads[E]
    : never;

export type RuntimeLegacyEventMessage =
  RuntimeProtocolEnvelope & { event: RuntimeLegacyProtocolEvent } & Record<string, unknown>;

export type RuntimeInboundMessage = RuntimeEventMessage | RuntimeLegacyEventMessage | RuntimeResponseMessage;

export function isRuntimeResponseMessage(value: RuntimeInboundMessage): value is RuntimeResponseMessage {
  return "request" in value && typeof value.request === "string" && "ok" in value && typeof value.ok === "boolean";
}

type UnknownRecord = Record<string, unknown>;

const runtimeEvents = new Set<string>([
  ...RUNTIME_PROTOCOL_EVENTS,
  ...RUNTIME_PROTOCOL_OPTIONAL_EVENTS,
]);
const legacyRuntimeEvents = new Set<string>(RUNTIME_PROTOCOL_LEGACY_EVENTS);

function isRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function isRuntimeProtocolEpoch(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

export function parseRuntimeInboundMessage(
  value: unknown,
  expectedGame: GameId,
  expectedEpoch?: number,
): RuntimeInboundMessage | null {
  if (!isRecord(value) || value.protocol !== HOST_PROTOCOL || value.game !== expectedGame || !isGameId(expectedGame) ||
      !isRuntimeProtocolEpoch(value.epoch) ||
      (expectedEpoch !== undefined && value.epoch !== expectedEpoch)) {
    return null;
  }
  if (typeof value.event === "string" && runtimeEvents.has(value.event)) {
    return value as RuntimeEventMessage;
  }
  if (typeof value.event === "string" && legacyRuntimeEvents.has(value.event)) {
    return value as RuntimeLegacyEventMessage;
  }
  if (typeof value.request === "string" && typeof value.ok === "boolean") {
    return value as RuntimeResponseMessage;
  }
  return null;
}
