import type {
  GameId,
  ProductId,
} from "../contracts/product-catalog.mjs";
import type { InstalledPackageGeneration } from "../contracts/package-read-models.mjs";
import type { RuntimeResponseMessage } from "../contracts/runtime-protocol.mjs";
import type { GameOptions, MusicMode } from "./game-preferences.mjs";
import type { NormalizedMultiplayerLobbySnapshot } from "./multiplayer-lobby-snapshot.mjs";

export type RuntimeVariant = "normal" | "multiplayer";
export type TransferMode = "" | "runtime" | "base" | "ogg" | "language";
export type TransferKind = "" | "game" | "music" | "language";
export type MultiplayerConnectionState = "connecting" | "reconnecting" | "syncing" | "connected";

export interface PendingRuntimeRequest {
  resolve(message: RuntimeResponseMessage): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

export interface MultiplayerLoadout {
  character: number;
  shot: number;
}

export interface LauncherNetplayState {
  url: string;
  player: number | null;
  playerCount: 2 | 3;
  seed: number;
  difficulty: number;
  iceServers: RTCIceServer[];
  loadouts: MultiplayerLoadout[];
  spectator: boolean;
  spectatorId: string;
  spectatorCount: number;
}

export interface LauncherState {
  game: GameId;
  product: ProductId;
  hasSelection: boolean;
  music: MusicMode;
  musicPreference: MusicMode;
  musicPreferenceExplicit: boolean;
  ready: boolean;
  launched: boolean;
  replayViewer: boolean;
  request: number;
  pending: Map<string, PendingRuntimeRequest>;
  source: string;
  sourceIdentity: string;
  mobileOpen: boolean;
  options: GameOptions;
  language: string;
  lessMotion: boolean;
  runtimeVariant: RuntimeVariant;
  netplay: LauncherNetplayState;
}

export interface MultiplayerRoomState {
  code: string;
  playerCount: 2 | 3;
  difficulty: number;
  settingsVersion?: number;
  phase?: "lobby" | "starting" | "running";
  created: boolean;
  connection?: MultiplayerConnectionState;
  seats?: NormalizedMultiplayerLobbySnapshot["seats"] | null;
  spectators?: NormalizedMultiplayerLobbySnapshot["spectators"];
  spectatorCount?: number;
  synced?: boolean;
  [key: string]: unknown;
}

export interface MultiplayerUiState {
  room: MultiplayerRoomState | null;
  seat: number | null;
  ready: boolean;
  folds: { settings: boolean; online: boolean };
  mobileOpen: boolean;
  roomSettingsOpen: boolean;
  preferredLoadout: number;
  spectatorRequested: boolean;
  displayName: string;
}

export interface RuntimeModuleCapability {
  eaglerOptions?: Record<string, unknown>;
  FS?: RuntimeFileSystemCapability;
  callMain?(args?: string[]): unknown;
  [key: string]: unknown;
}

export interface RuntimeFileSystemCapability {
  analyzePath?(path: string): unknown;
  mkdirTree(path: string): void;
  writeFile(path: string, data: Uint8Array, options?: { canOwn?: boolean }): void;
  [key: string]: unknown;
}

export type RuntimeWindow = Window & {
  Module?: RuntimeModuleCapability;
  FS?: RuntimeFileSystemCapability;
  touhouMusicMode?: string;
};

export interface BootWatchdog {
  mark(label: string): void;
  ready?(): void;
}

export interface MidiSynth {
  send(bytes: readonly number[]): void;
  reset(): void;
  getAudioContext(): AudioContext;
}

export interface MidiSynthConstructor {
  new(options: { quality: number; useReverb: number; voices: number }): MidiSynth;
}

export type LauncherWindow = Window & {
  __eaglerBoot?: BootWatchdog;
  __eaglerPrepareManagedRuntimeDataV1?: ManagedRuntimeDataProvider;
  webkitAudioContext?: typeof AudioContext;
  WebAudioTinySynth?: MidiSynthConstructor;
  fflate?: {
    unzipSync(bytes: Uint8Array, options?: {
      filter?: (file: { name: string; size: number; originalSize: number; compression: number }) => boolean;
    }): Record<string, Uint8Array>;
    zipSync(entries: Record<string, Uint8Array>, options?: { level?: number }): Uint8Array;
  };
};

export type LauncherNavigator = Navigator & {
  userAgentData?: { mobile?: boolean; platform?: string };
  brave?: unknown;
  keyboard?: {
    lock?(keys?: string[]): Promise<void>;
    unlock?(): void;
  };
};

export type LauncherDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?(): Promise<void> | void;
};

export type LauncherFullscreenElement = HTMLElement & {
  webkitRequestFullscreen?(): Promise<void> | void;
};

export interface ManagedRuntimeDataRequest {
  game: GameId;
  generation: string;
}

export type ManagedRuntimeDataProvider = (
  request: ManagedRuntimeDataRequest,
) => Promise<{ buffer: ArrayBuffer; bytes: number; fileId: string }>;

export interface PackageSnapshotState {
  active: InstalledPackageGeneration | null;
  byGame: Map<GameId, InstalledPackageGeneration>;
}

export interface RuntimeDiagnosticState {
  fps: number | null;
  maxGapMs: number | null;
  frameHealthAt: number | null;
  queuedMs: number | null;
  minQueuedMs: number | null;
  backend: "" | "worklet" | "script";
  underruns: number;
  robust: boolean | null;
  renderer: string;
  childVisibility: string;
  childHasFocus: boolean | null;
  childActiveTag: string;
  directTouches: number;
  hostRafHz: number | null;
  hostRafAt: number | null;
  childRafHz: number | null;
  childRafAt: number | null;
}

export interface TransferPresentation {
  kind?: TransferKind;
  mode?: TransferMode;
  title?: string;
  label?: string;
  loaded?: number;
  total?: number;
  speed?: number;
  phase?: string;
  statusText?: string;
  indeterminate?: boolean;
  failed?: boolean;
  completed?: boolean;
  files?: unknown[] | number;
}
