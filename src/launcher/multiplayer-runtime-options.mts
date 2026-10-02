export interface MultiplayerRuntimeLoadout {
  character: number;
  shot: number;
}

export interface MultiplayerRuntimeOptionConstraints {
  playerCounts: readonly (2 | 3)[];
  difficulties: readonly string[];
  loadouts: readonly MultiplayerRuntimeLoadout[];
}

export interface MultiplayerRuntimeOptionInput {
  url: string;
  player: number | null;
  playerCount: number;
  seed: number;
  difficulty: number;
  inputDelay?: number;
  inputDelayAuto?: boolean;
  predictionReserve?: number;
  adonisMode?: number;
  predictionLimit?: number;
  spectator: boolean;
  spectatorId: string;
  spectatorCount: number;
  iceServers: unknown;
  loadouts: MultiplayerRuntimeLoadout[];
}

export interface MultiplayerRuntimeOptions {
  netplayMode: "lan";
  netplayUrl: string;
  netplayPlayer: number | null;
  netplayPlayerCount: number;
  netplaySeed: number;
  netplayDifficulty: number;
  netplayInputDelay?: number;
  netplayInputDelayAuto?: boolean;
  netplayPredictionReserve?: number;
  netplayAdonisMode?: number;
  netplayPredictionLimit?: number;
  netplaySpectator: boolean;
  netplaySpectatorId: string;
  netplaySpectatorCount: number;
  netplayIceServers: unknown[];
  netplayLoadouts: MultiplayerRuntimeLoadout[];
}

export function buildMultiplayerRuntimeOptions(
  input: MultiplayerRuntimeOptionInput,
  constraints: MultiplayerRuntimeOptionConstraints,
): MultiplayerRuntimeOptions {
  let url: URL;
  try { url = new URL(input.url); }
  catch { throw new Error("Relay WebSocket URL 无效"); }
  if (url.protocol !== "ws:" && url.protocol !== "wss:") {
    throw new Error("Relay URL 必须使用 ws:// 或 wss://");
  }

  const { player, playerCount, seed } = input;
  const spectator = input.spectator === true;
  if (!constraints.playerCounts.includes(playerCount as 2 | 3) || (!spectator &&
      (typeof player !== "number" || !Number.isInteger(player) || player < 0 || player >= playerCount))) {
    throw new Error("LAN 玩家槽位无效");
  }
  if (spectator && !/^[A-Za-z0-9_-]{8,64}$/.test(String(input.spectatorId || ""))) {
    throw new Error("旁观者资格无效");
  }
  if (!Number.isInteger(seed) || seed < 0 || seed > 65535) {
    throw new Error("LAN 同步种子必须在 0–65535 之间");
  }

  const difficultyMax = Math.max(0, constraints.difficulties.length - 1);
  const difficulty = Number(input.difficulty);
  if (!Number.isInteger(difficulty) || difficulty < 0 || difficulty > difficultyMax) {
    throw new Error(`LAN 难度必须在 0–${difficultyMax} 之间`);
  }

  const allowedLoadouts = new Set(constraints.loadouts.map(({ character, shot }) => `${character}:${shot}`));
  if (!allowedLoadouts.size) throw new Error("LAN 机体配置表为空");
  const loadouts = input.loadouts.slice(0, playerCount).map(({ character, shot }, index) => {
    if (!Number.isInteger(character) || character < 0 ||
        !Number.isInteger(shot) || shot < 0 || !allowedLoadouts.has(`${character}:${shot}`)) {
      throw new Error(`P${index + 1} 机体配置无效`);
    }
    return { character, shot };
  });
  if (loadouts.length !== playerCount) throw new Error("LAN 机体配置数量不足");

  const adonisMode = input.adonisMode ?? 0;
  const measuredTitle=/^th09mp-\d{4}$/.test(url.searchParams.get("room") || "");
  if ((input.inputDelayAuto!==undefined && typeof input.inputDelayAuto!=="boolean") ||
      (input.inputDelayAuto && (!measuredTitle || !adonisMode)) ||
      (input.predictionReserve!==undefined && (!measuredTitle || !Number.isInteger(input.predictionReserve) || input.predictionReserve<1 || input.predictionReserve>2)))
    throw new Error("TH09 实测输入时序参数无效");
  if (!Number.isInteger(adonisMode) || adonisMode < 0 || adonisMode > 2 ||
      (adonisMode !== 0 && !/^th0[89]mp-\d{4}$/.test(url.searchParams.get("room") || "")))
    throw new Error("Adonis 实验当前只支持 TH08 / TH09 多人 Runtime");
  if (adonisMode && (!Number.isInteger(input.inputDelay) || input.inputDelay! < 0 || input.inputDelay! > 9))
    throw new Error("Adonis 输入延迟必须为 0–9 帧");
  return {
    netplayMode: "lan",
    netplayUrl: url.href,
    netplayPlayer: player,
    netplayPlayerCount: playerCount,
    netplaySeed: seed,
    netplayDifficulty: difficulty,
    ...(input.inputDelay !== undefined ? {
      netplayInputDelay: Number.isInteger(input.inputDelay) && input.inputDelay >= 0 && input.inputDelay <= (adonisMode ? 9 : 8) ? input.inputDelay : 0,
    } : {}),
    ...(input.adonisMode !== undefined ? { netplayAdonisMode: adonisMode } : {}),
    ...(measuredTitle && adonisMode ? {netplayInputDelayAuto:input.inputDelayAuto??false,netplayPredictionReserve:input.predictionReserve??2} : {}),
    ...(input.predictionLimit !== undefined ? {
      netplayPredictionLimit: Number.isInteger(input.predictionLimit) && input.predictionLimit >= 1 && input.predictionLimit <= 8 ? input.predictionLimit : 8,
    } : {}),
    netplaySpectator: spectator,
    netplaySpectatorId: spectator ? input.spectatorId : "",
    netplaySpectatorCount: Math.max(0, Number(input.spectatorCount) || 0),
    netplayIceServers: Array.isArray(input.iceServers) ? input.iceServers : [],
    netplayLoadouts: loadouts,
  };
}
