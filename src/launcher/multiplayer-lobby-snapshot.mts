import {parseMeasuredNetplayTiming,resolveAdonisPredictionReserve,type MeasuredNetplayTiming} from "../contracts/netplay-timing.mjs";
import { multiplayerInputTimingPolicy, type MultiplayerInputTimingConfig } from "../contracts/product-catalog.mjs";
import {
  normalizeMultiplayerDisplayName,
  multiplayerControlMode,
  validMultiplayerClientId,
} from "./multiplayer-identity.mjs";

export interface MultiplayerLobbySeat {
  clientId: string;
  name: string;
  loadout: number;
  ready: boolean;
  offline: boolean;
  controlMode: ReturnType<typeof multiplayerControlMode>;
  mobileDevice: boolean;
  resource: MultiplayerResourceProgress | null;
}

export interface MultiplayerResourceProgress {
  status: "preparing" | "ready" | "failed" | "cancelled" | "importing";
  stage: "package" | "runtime";
  percent: number | null;
}

export interface MultiplayerLobbySpectator {
  clientId: string;
  name: string;
}

export interface NormalizedMultiplayerLobbySnapshot {
  visibility: "public" | "private";
  disableCheatMovement: boolean;
  challengeMode?: boolean;
  prankMode?: boolean;
  playerCount: 2 | 3;
  difficulty: number;
  inputDelay: number;
  adonisMode?: number;
  inputDelayAuto?: boolean;
  predictionReserve?: number;
  timing?: MeasuredNetplayTiming | null;
  predictionLimit: number;
  settingsVersion: number;
  phase: "lobby" | "starting" | "running";
  spectators: MultiplayerLobbySpectator[];
  spectatorCount: number;
  seats: Array<MultiplayerLobbySeat | null>;
  localSeat: number | null;
  localSpectator: boolean;
}

function normalizedNonNegativeLimit(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function normalizeMultiplayerLobbySnapshot(value: unknown, {
  localClientId,
  playerCounts,
  difficulties,
  loadouts,
  inputTiming,
}: {
  localClientId: string;
  playerCounts: readonly (2 | 3)[];
  difficulties: readonly unknown[];
  loadouts: readonly unknown[];
  inputTiming?: Readonly<MultiplayerInputTimingConfig>;
}): NormalizedMultiplayerLobbySnapshot | null {
  const source = record(value);
  if (!source) return null;
  const policy = multiplayerInputTimingPolicy({ inputTiming });
  const phase = source.phase === "starting" || source.phase === "running" ? source.phase : "lobby";
  const requestedPlayerCount = Number(source.playerCount);
  if (!playerCounts.includes(requestedPlayerCount as 2 | 3)) return null;
  const playerCount = requestedPlayerCount as 2 | 3;
  const difficulty = Math.max(
    0,
    Math.min(Math.max(0, difficulties.length - 1), Number(source.difficulty) || 0),
  );
  const adonisMode = source.adonisMode === undefined ? 0 : Number(source.adonisMode);
  if(source.inputDelayAuto!==undefined && typeof source.inputDelayAuto!=="boolean")return null;
  if(source.inputDelayAuto && !adonisMode)return null;
  const predictionReserve=source.predictionReserve??2;
  if(typeof predictionReserve!=="number" || !Number.isInteger(predictionReserve) || predictionReserve<1 || predictionReserve>2)return null;
  const timing=source.timing==null?null:parseMeasuredNetplayTiming(source.timing);
  if(source.timing!=null&&!timing)return null;
  if (!Number.isInteger(adonisMode) || adonisMode < 0 || adonisMode > 2) return null;
  if (!policy.rollback && (adonisMode === 2 || (phase !== "lobby" && adonisMode !== 1))) return null;
  const rawDelay = Number(source.inputDelay);
  const delayLimit = adonisMode ? inputTiming ? policy.manualDelayLimit : 9 : 8;
  if (adonisMode && (!Number.isInteger(rawDelay) || rawDelay < 0 || rawDelay > delayLimit)) return null;
  const inputDelay = Number.isInteger(rawDelay) && rawDelay >= 0 && rawDelay <= delayLimit ? rawDelay : 0;
  if(timing && (timing.adonisMode!==adonisMode || timing.inputDelay!==inputDelay ||
     timing.automatic!==(source.inputDelayAuto??false) || timing.predictionReserve!==(adonisMode===2?resolveAdonisPredictionReserve(timing.fullDelay,predictionReserve,timing.automatic):0)))return null;
  const rawLimit = Number(source.predictionLimit);
  if (!policy.rollback && source.predictionLimit !== undefined && source.predictionLimit !== 0) return null;
  const predictionLimit = !policy.rollback ? 0 : Number.isInteger(rawLimit) && rawLimit >= 1 && rawLimit <= 8 ? rawLimit : 8;
  const normalizedLoadoutCount = normalizedNonNegativeLimit(loadouts.length);
  const settingsVersion = Math.max(1, Math.trunc(Number(source.settingsVersion) || 1));

  const spectators: MultiplayerLobbySpectator[] = Array.isArray(source.spectators)
    ? source.spectators.flatMap(entry => {
        const item = record(entry);
        const clientId = String(item?.clientId || "");
        if (!validMultiplayerClientId(clientId)) return [];
        return [{ clientId, name: normalizeMultiplayerDisplayName(item?.name || "") }];
      })
    : [];

  const rawSpectatorCount = Number(source.spectatorCount);
  const spectatorCount = Number.isFinite(rawSpectatorCount) && rawSpectatorCount >= 0
    ? Math.max(spectators.length, Math.trunc(rawSpectatorCount))
    : spectators.length;

  const rawSeats = Array.isArray(source.seats) ? source.seats : [];
  const seats = Array.from({ length: 3 }, (_, index): MultiplayerLobbySeat | null => {
    const seat = record(rawSeats[index]);
    if (!seat) return null;
    const clientId = String(seat.clientId || "");
    const loadout = Number(seat.loadout);
    if (!validMultiplayerClientId(clientId) || !Number.isInteger(loadout) ||
        loadout < 0 || loadout >= normalizedLoadoutCount) return null;
    return {
      clientId,
      name: normalizeMultiplayerDisplayName(seat.name || ""),
      loadout,
      ready: !!seat.ready,
      offline: !!seat.offline,
      controlMode: multiplayerControlMode(seat.controlMode),
      mobileDevice: seat.mobileDevice === true,
      resource: normalizeResourceProgress(seat.resource),
    };
  });

  const localSeatIndex = seats.slice(0, playerCount)
    .findIndex(seat => seat?.clientId === localClientId);
  const localSeat = localSeatIndex >= 0 ? localSeatIndex : null;
  const localSpectator = localSeat == null &&
    spectators.some(entry => entry.clientId === localClientId);

  return {
    playerCount,
    visibility: source.visibility === "private" ? "private" : "public",
    disableCheatMovement: source.disableCheatMovement === true,
    ...(source.challengeMode!==undefined?{challengeMode:source.challengeMode===true}:{}),
    ...(source.prankMode!==undefined?{prankMode:false}:{}),
    difficulty,
    inputDelay,
    ...(source.adonisMode !== undefined ? { adonisMode } : {}),
    ...(source.inputDelayAuto!==undefined?{inputDelayAuto:source.inputDelayAuto as boolean}:{}),
    ...(source.predictionReserve!==undefined?{predictionReserve}:{}),
    ...(source.timing!==undefined?{timing}:{}),
    predictionLimit,
    settingsVersion,
    phase,
    spectators,
    spectatorCount,
    seats,
    localSeat,
    localSpectator,
  };
}

function normalizeResourceProgress(value: unknown): MultiplayerResourceProgress | null {
  const source = record(value);
  if (!source || !["preparing", "ready", "failed", "cancelled", "importing"].includes(String(source.status)) ||
      (source.stage !== "package" && source.stage !== "runtime")) return null;
  const percent = source.percent === null ? null : Number(source.percent);
  return {
    status: source.status as MultiplayerResourceProgress["status"],
    stage: source.stage,
    percent: percent !== null && Number.isFinite(percent) && percent >= 0 && percent <= 100 ? Math.round(percent) : null,
  };
}
