import {
  normalizeMultiplayerDisplayName,
  validMultiplayerClientId,
} from "./multiplayer-identity.mjs";

export interface MultiplayerLobbySeat {
  clientId: string;
  name: string;
  loadout: number;
  ready: boolean;
  offline: boolean;
}

export interface MultiplayerLobbySpectator {
  clientId: string;
  name: string;
}

export interface NormalizedMultiplayerLobbySnapshot {
  playerCount: 2 | 3;
  difficulty: number;
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
  maxDifficulty,
  loadoutCount,
}: {
  localClientId: string;
  maxDifficulty: number;
  loadoutCount: number;
}): NormalizedMultiplayerLobbySnapshot | null {
  const source = record(value);
  if (!source) return null;
  const playerCount: 2 | 3 = Number(source.playerCount) === 3 ? 3 : 2;
  const difficulty = Math.max(
    0,
    Math.min(normalizedNonNegativeLimit(maxDifficulty), Number(source.difficulty) || 0),
  );
  const normalizedLoadoutCount = normalizedNonNegativeLimit(loadoutCount);
  const settingsVersion = Math.max(1, Math.trunc(Number(source.settingsVersion) || 1));
  const phase = source.phase === "starting" || source.phase === "running" ? source.phase : "lobby";

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
    };
  });

  const localSeatIndex = seats.slice(0, playerCount)
    .findIndex(seat => seat?.clientId === localClientId);
  const localSeat = localSeatIndex >= 0 ? localSeatIndex : null;
  const localSpectator = localSeat == null &&
    spectators.some(entry => entry.clientId === localClientId);

  return {
    playerCount,
    difficulty,
    settingsVersion,
    phase,
    spectators,
    spectatorCount,
    seats,
    localSeat,
    localSpectator,
  };
}
