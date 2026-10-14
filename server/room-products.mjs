import {multiplayerConfigForProduct, multiplayerInputTimingPolicy} from '../lib/contracts/product-catalog.mjs';
import {roomHostId} from './room-host.mjs';

// Room numbers survive title changes. Old invite addresses remain aliases,
// while gameplay transports always use the currently selected product.
export function createRoomProducts({rooms, rename, invalidateReady}) {
  const aliases = new Map();
  const codeOf = id => /^(th\d+mp)-(\d{4,8})$/.exec(id)?.[2];
  function resolve(id) {
    if (rooms.has(id)) return id;
    const target = aliases.get(id);
    if (target && rooms.has(target)) return target;
    const code = codeOf(id);
    if (!code) return id;
    return [...rooms].find(([key, room]) => room.roomProducts && codeOf(key) === code)?.[0] ?? id;
  }
  function forget(id) {for (const [key, target] of aliases) if (target === id) aliases.delete(key);}
  function collision(id) {
    const code = codeOf(id);
    return code && [...rooms].some(([key]) => codeOf(key) === code);
  }
  const available = room => !room.lobby.retainedHostId && [...room.lobbyClients.values()].every(socket => socket.roomProducts && !socket.roomProductBusy);
  function apply(room, clientId, message) {
    const fail = error => ({error});
    if (roomHostId(room) !== clientId || room.lobby.phase !== 'lobby') return fail('只有房主可以在等待阶段修改作品。');
    if (message.version !== room.lobby.productVersion) return fail('房间状态已变化，请等待同步后重试。');
    if (message.type === 'directory-lock') {
      if (typeof message.locked !== 'boolean') return fail('无效的目录锁定状态。');
      if (room.lobby.directoryLocked !== message.locked) {room.lobby.directoryLocked = message.locked; room.lobby.productVersion++;}
      return {};
    }
    if (room.lobby.directoryLocked) return fail('请先解锁游戏目录。');
    if (!available(room)) return fail('请等待所有玩家关闭设置并使用支持作品切换的前端。');
    const config = typeof message.product === 'string' && /^th\d+mp$/.test(message.product) ? multiplayerConfigForProduct(message.product) : null;
    if (!config || !codeOf(room.id)) return fail('此作品不支持联机。');
    const nextId = `${message.product}-${codeOf(room.id)}`;
    if (nextId === room.id) return {};
    if ([...rooms].some(([id, value]) => value !== room && codeOf(id) === codeOf(room.id))) return fail('该房间号与其他作品的旧房间重复，请重新创建房间。');
    if ([...room.clients.values(), ...[...room.runs.values()].flatMap(run => [...run.clients.values(), ...run.signalClients.values(), ...run.spectatorClients.values()])].some(socket => socket.readyState === 1)) return fail('游戏连接尚未结束，暂时不能切换作品。');
    const previousId = room.id;
    for (const [key, value] of aliases) if (value === previousId) aliases.set(key, nextId);
    aliases.set(previousId, nextId);
    rooms.delete(previousId); rooms.set(nextId, room); room.id = nextId;
    rename(previousId, nextId);
    room.roomProducts = true; room.multiplayer = config;
    const lobby = room.lobby, timing = multiplayerInputTimingPolicy(config);
    lobby.productVersion++;
    lobby.playerCount = config.playerCounts.includes(lobby.playerCount) ? lobby.playerCount : config.playerCounts[0];
    lobby.difficulty = 1; lobby.challengeMode = false; lobby.prankMode = false;
    lobby.inputDelay = 0; lobby.adonisMode = timing.rollback ? 0 : 1;
    lobby.inputDelayAuto = false; lobby.predictionReserve = 2; lobby.timing = null; lobby.predictionLimit = timing.predictionLimit;
    for (let index = 0; index < lobby.seats.length; index++) {
      const seat = lobby.seats[index]; if (!seat) continue;
      if (index >= lobby.playerCount) {lobby.spectators.set(seat.clientId, seat.name); lobby.seats[index] = null;}
      else {seat.loadout = 0; seat.resource = null; if (seat.selectionConfirmed !== undefined) seat.selectionConfirmed = false;}
    }
    for (const run of room.runs.values()) {clearTimeout(run.routeTimer); clearTimeout(run.spectatorGraceTimer);}
    room.runs.clear();
    invalidateReady(room);
    return {changed: true};
  }
  return {resolve, forget, collision, available, apply};
}
