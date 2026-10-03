export const multiplayerRoomSessionStorageKey = (product: string): string =>
  `eagler-touhou-${product}-room-v1`;

export interface MultiplayerRoomSessionStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface MultiplayerRoomSessionSnapshot {
  room: {
    visibility?: "public" | "private";
    disableCheatMovement?: boolean;
    code: string;
    playerCount: 2 | 3;
    difficulty: number;
    created: boolean;
  };
  seat: number | null;
  ready: boolean;
  spectatorRequested: boolean;
  roomSettingsOpen: boolean;
}

export interface RestoredMultiplayerRoomSession extends MultiplayerRoomSessionSnapshot {
  product: string;
}

export interface MultiplayerRoomSessionStore {
  save(product: string, snapshot: MultiplayerRoomSessionSnapshot): void;
  load(input: { product: string; roomCode: string; playerCounts: readonly (2 | 3)[]; difficulties: readonly unknown[] }): RestoredMultiplayerRoomSession | null;
  clear(product: string): void;
}

function browserSessionStorage(): MultiplayerRoomSessionStorage | null {
  try { return globalThis.sessionStorage as MultiplayerRoomSessionStorage; }
  catch { return null; }
}

function normalizeMaxDifficulty(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function createMultiplayerRoomSessionStore({
  storage = browserSessionStorage(),
}: { storage?: MultiplayerRoomSessionStorage | null } = {}): MultiplayerRoomSessionStore {
  const save = (product: string, snapshot: MultiplayerRoomSessionSnapshot): void => {
    try {
      storage?.setItem(multiplayerRoomSessionStorageKey(product), JSON.stringify({
        product,
        room: {
          code: snapshot.room.code,
          visibility: snapshot.room.visibility,
          disableCheatMovement: snapshot.room.disableCheatMovement,
          playerCount: snapshot.room.playerCount,
          difficulty: snapshot.room.difficulty,
          created: !!snapshot.room.created,
        },
        seat: snapshot.seat,
        ready: !!snapshot.ready,
        spectatorRequested: !!snapshot.spectatorRequested,
        roomSettingsOpen: !!snapshot.roomSettingsOpen,
      }));
    } catch {}
  };

  const load = ({ product, roomCode, playerCounts, difficulties }: {
    product: string;
    roomCode: string;
    playerCounts: readonly (2 | 3)[];
    difficulties: readonly unknown[];
  }): RestoredMultiplayerRoomSession | null => {
    let parsed: unknown = null;
    try { parsed = JSON.parse(storage?.getItem(multiplayerRoomSessionStorageKey(product)) || "null"); }
    catch { return null; }
    const saved = record(parsed);
    const room = record(saved?.room);
    if (!saved || !room || saved.product !== product || room.code !== roomCode) return null;

    const requestedPlayerCount = Number(room.playerCount);
    const playerCount = playerCounts.includes(requestedPlayerCount as 2 | 3)
      ? requestedPlayerCount as 2 | 3
      : (playerCounts[0] ?? 2);
    const difficulty = Math.max(
      0,
      Math.min(normalizeMaxDifficulty(difficulties.length - 1), Number(room.difficulty) || 0),
    );
    const savedSeat = saved.seat;
    const seat = typeof savedSeat === "number" && Number.isInteger(savedSeat) &&
      savedSeat >= 0 && savedSeat < playerCount
      ? savedSeat
      : null;
    return {
      product,
      room: {
        code: roomCode,
        visibility: room.visibility === "private" ? "private" : "public",
        disableCheatMovement: room.disableCheatMovement === true,
        playerCount,
        difficulty,
        created: !!room.created,
      },
      seat,
      ready: !!saved.ready,
      spectatorRequested: seat == null && !!saved.spectatorRequested,
      roomSettingsOpen: !!saved.roomSettingsOpen,
    };
  };

  const clear = (product: string): void => {
    try { storage?.removeItem(multiplayerRoomSessionStorageKey(product)); } catch {}
  };

  return Object.freeze({ save, load, clear });
}
