import { createHmac } from 'node:crypto';
import { WebSocket, WebSocketServer } from 'ws';

import { multiplayerConfigForProduct } from '../lib/contracts/product-catalog.mjs';

function multiplayerPolicyForRoomId(roomId) {
  const separator = roomId.indexOf('-');
  if (separator <= 0) return null;
  return multiplayerConfigForProduct(roomId.slice(0, separator));
}

const host = process.env.TH07_RELAY_HOST || '0.0.0.0';
const port = Number.parseInt(process.env.TH07_RELAY_PORT || '18142', 10);
const delayMs = Math.max(0, Number.parseInt(process.env.TH07_RELAY_DELAY_MS || '0', 10) || 0);
const jitterMs = Math.max(0, Number.parseInt(process.env.TH07_RELAY_JITTER_MS || '0', 10) || 0);
const dropEvery = Math.max(0, Number.parseInt(process.env.TH07_RELAY_DROP_EVERY || '0', 10) || 0);
const dropFirstInputPerEdge = process.env.TH07_RELAY_DROP_FIRST_INPUT_PER_EDGE === '1';
const dropInputLatestFrom = Math.max(-1, Number.parseInt(process.env.TH07_RELAY_DROP_INPUT_LATEST_FROM || '-1', 10) || -1);
const dropInputLatestTo = Math.max(-1, Number.parseInt(process.env.TH07_RELAY_DROP_INPUT_LATEST_TO || '-1', 10) || -1);
const routeSkewPlayer = Number.parseInt(process.env.TH07_TEST_ROUTE_SKEW_PLAYER || '-1', 10);
const routeSkewMs = Math.max(0, Number.parseInt(process.env.TH07_TEST_ROUTE_SKEW_MS || '0', 10) || 0);
const rtcTimeoutMs = Math.max(1000, Number.parseInt(
  process.env.TH07_RTC_TIMEOUT_MS || process.env.TH07_DIRECT_TIMEOUT_MS || '4500', 10
) || 4500);
const stunUrls = (process.env.TH07_STUN_URLS || 'stun:stun.cloudflare.com:3478')
  .split(',').map(value => value.trim()).filter(Boolean);
const turnUrls = (process.env.TH07_TURN_URLS || '')
  .split(',').map(value => value.trim()).filter(Boolean);
const turnSharedSecret = process.env.TH07_TURN_SHARED_SECRET || '';
const turnUsername = process.env.TH07_TURN_USERNAME || '';
const turnCredential = process.env.TH07_TURN_CREDENTIAL || '';
const turnTtlSeconds = Math.max(60, Number.parseInt(process.env.TH07_TURN_TTL_SECONDS || '3600', 10) || 3600);
const lobbyReconnectGraceMs = Math.max(100, Number.parseInt(process.env.TH07_LOBBY_RECONNECT_GRACE_MS || '12000', 10) || 12000);
const spectatorConnectGraceMs = Math.max(100, Number.parseInt(
  process.env.TH07_SPECTATOR_CONNECT_GRACE_MS || '60000', 10
) || 60000);
const spectatorMaxBufferedBytes = Math.max(64 * 1024, Number.parseInt(
  process.env.TH07_SPECTATOR_MAX_BUFFERED_BYTES || String(1024 * 1024), 10
) || 1024 * 1024);

for (const url of stunUrls) {
  if (!/^stuns?:/i.test(url)) throw new Error(`invalid TH07_STUN_URLS entry: ${url}`);
}
for (const url of turnUrls) {
  if (!/^turns?:/i.test(url)) throw new Error(`invalid TH07_TURN_URLS entry: ${url}`);
}
if (turnUrls.length && !turnSharedSecret && !(turnUsername && turnCredential)) {
  throw new Error('TH07_TURN_URLS requires TH07_TURN_SHARED_SECRET or both static TURN credentials');
}
if ((turnUsername && !turnCredential) || (!turnUsername && turnCredential)) {
  throw new Error('TH07_TURN_USERNAME and TH07_TURN_CREDENTIAL must be configured together');
}
const rooms = new Map();
const forwardCounters = new Map();
const firstInputDropped = new Set();
const inputLatestDropped = new Set();
const targetedEnvelopeMarker = 0xe7;

function iceServersFor(roomId, runId, player) {
  const servers = [];
  if (stunUrls.length) servers.push({ urls: stunUrls });
  if (!turnUrls.length) return servers;
  if (turnSharedSecret) {
    // coturn TURN REST API style ephemeral credentials. The shared secret
    // stays server-side; only the short-lived username/credential is sent to
    // the browser during signaling.
    const expires = Math.floor(Date.now() / 1000) + turnTtlSeconds;
    const username = `${expires}:${roomId}-${runId}-p${player}`;
    const credential = createHmac('sha1', turnSharedSecret).update(username).digest('base64');
    servers.push({ urls: turnUrls, username, credential });
  } else if (turnUsername && turnCredential) {
    // Static credentials are supported for local testing only; production
    // deployments should prefer TH07_TURN_SHARED_SECRET.
    servers.push({ urls: turnUrls, username: turnUsername, credential: turnCredential });
  }
  return servers;
}

function getRoom(id) {
  let room = rooms.get(id);
  if (!room) {
    room = {
      multiplayer: multiplayerPolicyForRoomId(id),
      clients: new Map(),
      lobbyClients: new Map(),
      lobbyDisconnectTimers: new Map(),
      runs: new Map(),
      lobby: {
        playerCount: 2,
        difficulty: 1,
        settingsVersion: 1,
        phase: 'lobby',
        seats: [null, null, null],
        spectators: new Map(),
        startSerial: 0,
      },
    };
    rooms.set(id, room);
  }
  return room;
}

function getRun(room, runId) {
  let run = room.runs.get(runId);
  if (!run) {
    run = {
      clients: new Map(),
      signalClients: new Map(),
      rtcReady: new Set(),
      rtcFailed: false,
      playerCount: 0,
      route: null,
      routeTimer: null,
      admittedSpectators: new Set(),
      claimedSpectators: new Set(),
      spectatorClients: new Map(),
      spectatorHistory: [],
      spectatorGraceTimer: null,
      spectatorAdmissionOpen: false,
    };
    room.runs.set(runId, run);
  }
  return run;
}

function maybeDeleteRun(room, runId, run) {
  if (run.clients.size !== 0 || run.signalClients.size !== 0 || run.spectatorClients.size !== 0) return;
  if (run.routeTimer) clearTimeout(run.routeTimer);
  if (run.spectatorGraceTimer) clearTimeout(run.spectatorGraceTimer);
  room.runs.delete(runId);
  if (String(room.lobby.startSerial) === String(runId)) resetLobbyAfterRun(room);
}

function startSpectatorGrace(roomId, room, runId, run) {
  if (run.spectatorGraceTimer) clearTimeout(run.spectatorGraceTimer);
  run.spectatorAdmissionOpen = true;
  run.spectatorHistory.length = 0;
  run.spectatorGraceTimer = setTimeout(() => {
    run.spectatorGraceTimer = null;
    if (room.runs.get(runId) !== run) return;
    run.spectatorAdmissionOpen = false;
    let expired = 0;
    for (const spectatorId of [...run.admittedSpectators]) {
      if (run.claimedSpectators.has(spectatorId)) continue;
      run.admittedSpectators.delete(spectatorId);
      expired++;
    }
    run.spectatorHistory.length = 0;
    console.log(`SPECTATOR WINDOW CLOSE room=${roomId} run=${runId} expired=${expired}`);
    maybeDeleteRun(room, runId, run);
    maybeDeleteRoom(roomId, room);
  }, spectatorConnectGraceMs);
}

function sendSpectatorPayload(socket, payload, roomId, runId, spectatorId) {
  if (socket.readyState !== WebSocket.OPEN) return false;
  if (Number(socket.bufferedAmount || 0) > spectatorMaxBufferedBytes) {
    console.log(`SPECTATOR SLOW room=${roomId} run=${runId} client=${spectatorId} buffered=${socket.bufferedAmount}`);
    socket.close(1008, 'spectator fell too far behind');
    return false;
  }
  socket.send(payload, { binary: true });
  return true;
}

function maybeDeleteRoom(roomId, room) {
  if (room.clients.size === 0 && room.lobbyClients.size === 0 &&
      room.lobbyDisconnectTimers.size === 0 && room.runs.size === 0)
    rooms.delete(roomId);
}

function removeClient(roomId, runId, player, socket) {
  const room = rooms.get(roomId);
  if (!room) return;
  const run = getRun(room, runId);
  if (run.clients.get(player) === socket)
    run.clients.delete(player);
  maybeDeleteRun(room, runId, run);
  maybeDeleteRoom(roomId, room);
}

function sendSignal(socket, payload) {
  if (socket.readyState === WebSocket.OPEN)
    socket.send(JSON.stringify(payload));
}

function broadcastSignal(run, payload) {
  const message = JSON.stringify(payload);
  for (const socket of run.signalClients.values())
    if (socket.readyState === WebSocket.OPEN) socket.send(message);
}

function broadcastRoute(run, payload) {
  const message = JSON.stringify(payload);
  const send = (player, socket) => {
    if (socket.readyState !== WebSocket.OPEN) return;
    if (routeSkewMs > 0 && player === routeSkewPlayer) {
      setTimeout(() => {
        if (socket.readyState === WebSocket.OPEN) socket.send(message);
      }, routeSkewMs);
    } else {
      socket.send(message);
    }
  };
  for (const [player, socket] of run.signalClients) send(player, socket);
  for (const [player, socket] of run.clients) send(player, socket);
}

function chooseRoute(roomId, runId, room, run, route) {
  if (run.route) return;
  run.route = route;
  if (run.routeTimer) {
    clearTimeout(run.routeTimer);
    run.routeTimer = null;
  }
  if (String(room.lobby.startSerial) === String(runId) && room.lobby.phase === 'starting') {
    room.lobby.phase = 'running';
    broadcastLobby(room);
  }
  console.log(`ROUTE room=${roomId} run=${runId} mode=${route}`);
  // Signaling is preferred, but a browser/network can leave one signaling
  // WebSocket stuck in CONNECTING while both gameplay relay sockets are live.
  // Deliver the barrier on both channels so fallback never depends on the
  // unhealthy signaling path it is meant to recover from.
  broadcastRoute(run, { type: 'route', mode: route });
}

function maybeStartRouteTimer(roomId, runId, room, run) {
  const allSignalsPresent = run.signalClients.size >= run.playerCount;
  const allRelaysPresent = run.clients.size >= run.playerCount;
  if (run.route || run.routeTimer || run.playerCount < 2 || (!allSignalsPresent && !allRelaysPresent)) return;
  run.routeTimer = setTimeout(() => {
    run.routeTimer = null;
    run.rtcFailed = true;
    maybeResolveRoute(roomId, runId, room, run);
  }, rtcTimeoutMs);
}

function maybeResolveRoute(roomId, runId, room, run) {
  if (run.route || run.playerCount < 2) return;
  if (run.rtcFailed) {
    // Relay release is a barrier too: do not let the first endpoint begin
    // frame-zero traffic until every expected relay socket and signaling
    // client is already present. Route delivery itself is asynchronous, so
    // clients also buffer relay packets during that tiny propagation window.
    if (run.clients.size === run.playerCount)
      chooseRoute(roomId, runId, room, run, 'relay');
    return;
  }
  if (run.signalClients.size === run.playerCount && run.rtcReady.size === run.playerCount) {
    chooseRoute(roomId, runId, room, run, 'rtc');
    return;
  }
  maybeStartRouteTimer(roomId, runId, room, run);
}

function handleSignalConnection(socket, roomId, runId, player, playerCount) {
  const room = getRoom(roomId);
  const run = getRun(room, runId);
  if (run.playerCount && run.playerCount !== playerCount) {
    socket.close(1008, 'player count mismatch');
    return;
  }
  run.playerCount = playerCount;
  const previous = run.signalClients.get(player);
  if (previous && previous !== socket && previous.readyState === WebSocket.OPEN)
    previous.close(1000, 'signaling reconnected');
  const existingPeers = [...run.signalClients.keys()].filter(peer => peer !== player);
  run.signalClients.set(player, socket);
  sendSignal(socket, {
    type: 'peers', peers: existingPeers, route: run.route,
    iceServers: iceServersFor(roomId, runId, player),
  });
  for (const [peer, target] of run.signalClients) {
    if (peer !== player) sendSignal(target, { type: 'peer-join', player });
  }
  console.log(`SIGNAL JOIN room=${roomId} run=${runId} player=${player} peers=${run.signalClients.size}`);
  maybeResolveRoute(roomId, runId, room, run);

  socket.on('message', (data, isBinary) => {
    if (isBinary) { socket.close(1003, 'signaling expects text'); return; }
    let message;
    try { message = JSON.parse(String(data)); }
    catch { sendSignal(socket, { type: 'error', error: 'invalid signaling message' }); return; }
    if (message.type === 'signal') {
      const to = Number(message.to);
      if (!Number.isInteger(to) || to < 0 || to >= playerCount || to === player) return;
      const target = run.signalClients.get(to);
      if (!target) return;
      sendSignal(target, {
        type: 'signal', from: player,
        description: message.description || null,
        candidate: message.candidate || null,
      });
      return;
    }
    if (message.type === 'rtc-ready') {
      run.rtcReady.add(player);
      maybeResolveRoute(roomId, runId, room, run);
      return;
    }
    if (message.type === 'ice-restart-request' && run.route === 'rtc') {
      const to = Number(message.to);
      if (!Number.isInteger(to) || to < 0 || to >= playerCount || to === player) return;
      const target = run.signalClients.get(to);
      if (target) sendSignal(target, { type: 'ice-restart-request', from: player });
      return;
    }
    if (message.type === 'rtc-failed') {
      run.rtcFailed = true;
      maybeResolveRoute(roomId, runId, room, run);
      return;
    }
  });

  socket.on('close', () => {
    if (run.signalClients.get(player) === socket) {
      run.signalClients.delete(player);
      run.rtcReady.delete(player);
      if (!run.route) {
        run.rtcFailed = true;
        maybeResolveRoute(roomId, runId, room, run);
      }
    }
    console.log(`SIGNAL LEAVE room=${roomId} run=${runId} player=${player}`);
    maybeDeleteRun(room, runId, run);
    maybeDeleteRoom(roomId, room);
  });
}

function lobbySnapshot(room) {
  const spectators = [...room.lobby.spectators.entries()]
    .filter(([clientId]) => room.lobbyClients.has(clientId))
    .map(([clientId, name]) => ({ clientId, name }));
  return {
    playerCount: room.lobby.playerCount,
    difficulty: room.lobby.difficulty,
    settingsVersion: room.lobby.settingsVersion,
    phase: room.lobby.phase,
    startSerial: room.lobby.startSerial,
    spectators,
    spectatorCount: spectators.length,
    seats: room.lobby.seats.map(seat => seat ? {
      clientId: seat.clientId,
      name: seat.name || '',
      loadout: seat.loadout,
      ready: !!seat.ready && seat.readyVersion === room.lobby.settingsVersion,
      readyVersion: Number(seat.readyVersion) || 0,
      offline: !room.lobbyClients.has(seat.clientId),
    } : null),
  };
}

function sendLobby(socket, payload) {
  if (socket.readyState === WebSocket.OPEN)
    socket.send(JSON.stringify(payload));
}

function broadcastLobby(room, payload = null) {
  const message = JSON.stringify(payload || { type: 'state', room: lobbySnapshot(room) });
  for (const socket of room.lobbyClients.values())
    if (socket.readyState === WebSocket.OPEN) socket.send(message);
}

function clearLobbySeat(room, clientId) {
  let changed = false;
  for (let index = 0; index < room.lobby.seats.length; index++) {
    if (room.lobby.seats[index]?.clientId !== clientId) continue;
    room.lobby.seats[index] = null;
    changed = true;
  }
  return changed;
}

function lobbySeatOf(room, clientId) {
  return room.lobby.seats.findIndex(seat => seat?.clientId === clientId);
}

function validLoadout(room, value) {
  const loadoutCount = room.multiplayer?.loadoutCount ?? 6;
  return Number.isInteger(value) && value >= 0 && value < loadoutCount;
}

function normalizeDisplayName(value) {
  return [...String(value || '').replace(/[\u0000-\u001f\u007f]/g, '').trim()].slice(0, 12).join('');
}

function invalidateLobbyReady(room) {
  room.lobby.settingsVersion++;
  for (const seat of room.lobby.seats) {
    if (!seat) continue;
    seat.ready = false;
    seat.readyVersion = 0;
  }
}

function resetLobbyAfterRun(room) {
  if (room.lobby.phase === 'lobby') return;
  room.lobby.phase = 'lobby';
  invalidateLobbyReady(room);
  broadcastLobby(room);
}

function handleLobbyConnection(socket, roomId, clientId) {
  const room = getRoom(roomId);
  const pendingDisconnect = room.lobbyDisconnectTimers.get(clientId);
  if (pendingDisconnect) {
    clearTimeout(pendingDisconnect);
    room.lobbyDisconnectTimers.delete(clientId);
  }
  const previous = room.lobbyClients.get(clientId);
  if (previous && previous !== socket && previous.readyState === WebSocket.OPEN)
    previous.close(1000, 'lobby reconnected');
  room.lobbyClients.set(clientId, socket);
  console.log(`LOBBY JOIN room=${roomId} client=${clientId} peers=${room.lobbyClients.size}`);
  sendLobby(socket, { type: 'state', room: lobbySnapshot(room) });
  if (pendingDisconnect) broadcastLobby(room);

  socket.on('message', (data, isBinary) => {
    if (isBinary) {
      socket.close(1003, 'lobby expects text frames');
      return;
    }
    let message;
    try { message = JSON.parse(String(data)); }
    catch { sendLobby(socket, { type: 'error', error: 'invalid lobby message' }); return; }

    if (message.type === 'take-seat') {
      if (room.lobby.phase !== 'lobby') {
        sendLobby(socket, { type: 'state', room: lobbySnapshot(room) });
        return;
      }
      const seat = Number(message.seat);
      if (!Number.isInteger(seat) || seat < 0 || seat >= room.lobby.playerCount || !validLoadout(room, Number(message.loadout))) {
        sendLobby(socket, { type: 'error', error: 'invalid seat or loadout' });
        return;
      }
      const occupant = room.lobby.seats[seat];
      if (occupant && occupant.clientId !== clientId) {
        sendLobby(socket, { type: 'error', error: `P${seat + 1} 已被占用` });
        sendLobby(socket, { type: 'state', room: lobbySnapshot(room) });
        return;
      }
      const previousSeat = lobbySeatOf(room, clientId);
      const previousEntry = previousSeat >= 0 ? room.lobby.seats[previousSeat] : null;
      const previousLoadout = previousEntry?.loadout ?? null;
      const changesMatchConfig = previousSeat !== seat || previousLoadout !== Number(message.loadout);
      const preserveReady = !changesMatchConfig && previousEntry?.ready === true &&
        previousEntry.readyVersion === room.lobby.settingsVersion;
      if (changesMatchConfig) invalidateLobbyReady(room);
      clearLobbySeat(room, clientId);
      room.lobby.spectators.delete(clientId);
      const currentRun = room.runs.get(String(room.lobby.startSerial));
      if (currentRun && !currentRun.claimedSpectators.has(clientId))
        currentRun.admittedSpectators.delete(clientId);
      room.lobby.seats[seat] = {
        clientId, name: normalizeDisplayName(message.name), loadout: Number(message.loadout),
        ready: preserveReady, readyVersion: preserveReady ? room.lobby.settingsVersion : 0,
      };
      broadcastLobby(room);
      return;
    }

    if (message.type === 'stand-up') {
      if (room.lobby.phase !== 'lobby') { sendLobby(socket, { type: 'error', error: '本局已经开始' }); return; }
      if (clearLobbySeat(room, clientId)) { invalidateLobbyReady(room); broadcastLobby(room); }
      return;
    }

    if (message.type === 'spectate') {
      const seatChanged = clearLobbySeat(room, clientId);
      const spectatorChanged = !room.lobby.spectators.has(clientId);
      room.lobby.spectators.set(clientId, normalizeDisplayName(message.name));
      if (seatChanged) invalidateLobbyReady(room);
      if (seatChanged || spectatorChanged) broadcastLobby(room);
      if (room.lobby.phase !== 'lobby') {
        sendLobby(socket, { type: 'error', error: '本局已经开始；已保留旁观席，将在下一局生效' });
      }
      return;
    }

    if (message.type === 'leave-spectator') {
      const changed = room.lobby.spectators.delete(clientId);
      if (changed) broadcastLobby(room);
      return;
    }

    if (message.type === 'set-name') {
      const name = normalizeDisplayName(message.name);
      const playerSeat = lobbySeatOf(room, clientId);
      if (playerSeat >= 0) room.lobby.seats[playerSeat].name = name;
      else if (room.lobby.spectators.has(clientId)) room.lobby.spectators.set(clientId, name);
      else { sendLobby(socket, { type: 'error', error: '请先加入玩家席或旁观' }); return; }
      broadcastLobby(room);
      return;
    }

    const seat = lobbySeatOf(room, clientId);
    if (seat < 0) {
      sendLobby(socket, { type: 'error', error: '请先选择 P 位' });
      return;
    }
    const occupant = room.lobby.seats[seat];

    if (room.lobby.phase !== 'lobby' && ['set-loadout', 'set-ready', 'settings'].includes(message.type)) {
      sendLobby(socket, { type: 'error', error: '本局已经开始' });
      return;
    }

    if (message.type === 'set-loadout') {
      const loadout = Number(message.loadout);
      if (!validLoadout(room, loadout)) { sendLobby(socket, { type: 'error', error: 'invalid loadout' }); return; }
      if (occupant.loadout !== loadout) {
        invalidateLobbyReady(room);
        occupant.loadout = loadout;
      }
      broadcastLobby(room);
      return;
    }
    if (message.type === 'set-ready') {
      occupant.ready = !!message.ready;
      occupant.readyVersion = occupant.ready ? room.lobby.settingsVersion : 0;
      broadcastLobby(room);
      return;
    }
    if (message.type === 'settings') {
      if (seat !== 0) { sendLobby(socket, { type: 'error', error: '只有 P1 可以修改房间设置' }); return; }
      const playerCount = Number(message.playerCount) === 3 ? 3 : 2;
      const difficultyMax = room.multiplayer?.difficultyMax ?? 5;
      const difficulty = Math.max(0, Math.min(difficultyMax, Number(message.difficulty) || 0));
      if (room.lobby.playerCount !== playerCount || room.lobby.difficulty !== difficulty) {
        invalidateLobbyReady(room);
        room.lobby.playerCount = playerCount;
        room.lobby.difficulty = difficulty;
        for (let index = playerCount; index < room.lobby.seats.length; index++) room.lobby.seats[index] = null;
      }
      broadcastLobby(room);
      return;
    }
    if (message.type === 'start') {
      if (seat !== 0) { sendLobby(socket, { type: 'error', error: '只有 P1 可以开始游戏' }); return; }
      if (room.lobby.phase !== 'lobby') {
        sendLobby(socket, { type: 'state', room: lobbySnapshot(room) });
        return;
      }
      const activeSeats = room.lobby.seats.slice(0, room.lobby.playerCount);
      if (activeSeats.some(entry => !entry || !room.lobbyClients.has(entry.clientId) ||
          !entry.ready || entry.readyVersion !== room.lobby.settingsVersion)) {
        sendLobby(socket, { type: 'error', error: '仍有玩家未在线、未入座或未对当前设置准备' });
        return;
      }
      room.lobby.phase = 'starting';
      room.lobby.startSerial++;
      const run = getRun(room, String(room.lobby.startSerial));
      const seatedClients = new Set(activeSeats.map(entry => entry.clientId));
      run.playerCount = room.lobby.playerCount;
      run.admittedSpectators = new Set(
        [...room.lobby.spectators.keys()].filter(id => room.lobbyClients.has(id) && !seatedClients.has(id)));
      run.spectatorHistory.length = 0;
      startSpectatorGrace(roomId, room, String(room.lobby.startSerial), run);
      const snapshot = lobbySnapshot(room);
      snapshot.spectatorCount = run.admittedSpectators.size;
      broadcastLobby(room, { type: 'start', serial: room.lobby.startSerial, room: snapshot });
      return;
    }
    sendLobby(socket, { type: 'error', error: 'unknown lobby message' });
  });

  socket.on('close', (code, reason) => {
    if (room.lobbyClients.get(clientId) === socket) {
      room.lobbyClients.delete(clientId);
      const spectatorChanged = room.lobby.spectators.delete(clientId);
      const deliberateLeave = code === 1000 && String(reason || '') === 'leave room';
      if (deliberateLeave) {
        const seatChanged = clearLobbySeat(room, clientId);
        if (seatChanged) invalidateLobbyReady(room);
        if (seatChanged || spectatorChanged) broadcastLobby(room);
      } else if (lobbySeatOf(room, clientId) >= 0) {
        const timer = setTimeout(() => {
          if (room.lobbyDisconnectTimers.get(clientId) !== timer) return;
          room.lobbyDisconnectTimers.delete(clientId);
          if (!room.lobbyClients.has(clientId) && clearLobbySeat(room, clientId)) {
            invalidateLobbyReady(room);
            broadcastLobby(room);
          }
          maybeDeleteRoom(roomId, room);
        }, lobbyReconnectGraceMs);
        room.lobbyDisconnectTimers.set(clientId, timer);
        // Keep the seat visible during a short network transition. Clients can
        // show it as reconnecting instead of presenting an empty room.
        broadcastLobby(room);
      } else if (spectatorChanged) {
        broadcastLobby(room);
      }
    }
    console.log(`LOBBY LEAVE room=${roomId} client=${clientId}`);
    maybeDeleteRoom(roomId, room);
  });
  socket.on('error', error => {
    console.error(`LOBBY SOCKET room=${roomId} client=${clientId} ${error.message}`);
  });
}

function handleSpectatorConnection(socket, roomId, runId, spectatorId, playerCount) {
  const room = rooms.get(roomId);
  const run = room?.runs.get(runId);
  if (!room || !run || run.playerCount !== playerCount ||
      !run.admittedSpectators.has(spectatorId)) {
    socket.close(1008, 'spectator was not admitted within the join window');
    return;
  }
  if (run.claimedSpectators.has(spectatorId)) {
    socket.close(1008, 'spectators cannot reconnect midgame');
    return;
  }
  run.claimedSpectators.add(spectatorId);
  run.spectatorClients.set(spectatorId, socket);
  for (const payload of run.spectatorHistory) {
    if (!sendSpectatorPayload(socket, payload, roomId, runId, spectatorId)) break;
  }
  console.log(`SPECTATOR JOIN room=${roomId} run=${runId} client=${spectatorId}`);
  socket.on('message', () => socket.close(1008, 'spectators are receive-only'));
  socket.on('close', () => {
    if (run.spectatorClients.get(spectatorId) === socket)
      run.spectatorClients.delete(spectatorId);
    console.log(`SPECTATOR LEAVE room=${roomId} run=${runId} client=${spectatorId}`);
    maybeDeleteRun(room, runId, run);
    maybeDeleteRoom(roomId, room);
  });
  socket.on('error', error => {
    console.error(`SPECTATOR SOCKET room=${roomId} run=${runId} client=${spectatorId} ${error.message}`);
  });
}

const server = new WebSocketServer({ host, port, perMessageDeflate: false });

server.on('connection', (socket, request) => {
  const url = new URL(request.url || '/', `ws://${request.headers.host || 'localhost'}`);
  const roomId = url.searchParams.get('room') || '';
  const runId = url.searchParams.get('run') || '0';
  const lobbyClient = url.searchParams.get('lobby') || '';
  if (/^[A-Za-z0-9_-]{1,64}$/.test(roomId) && /^[A-Za-z0-9_-]{8,64}$/.test(lobbyClient)) {
    handleLobbyConnection(socket, roomId, lobbyClient);
    return;
  }
  const spectator = url.searchParams.get('spectator') || '';
  const spectatorPlayerCount = Number.parseInt(url.searchParams.get('players') || '2', 10);
  if (spectator) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(roomId) || !/^[A-Za-z0-9_-]{1,64}$/.test(runId) ||
        !/^[A-Za-z0-9_-]{8,64}$/.test(spectator) || ![2, 3].includes(spectatorPlayerCount)) {
      socket.close(1008, 'invalid spectator');
      return;
    }
    handleSpectatorConnection(socket, roomId, runId, spectator, spectatorPlayerCount);
    return;
  }
  const player = Number.parseInt(url.searchParams.get('player') || '-1', 10);
  const playerCount = Number.parseInt(url.searchParams.get('players') || '2', 10);
  const signaling = url.searchParams.get('signal') === '1';
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(roomId) || !/^[A-Za-z0-9_-]{1,64}$/.test(runId) ||
      !Number.isInteger(player) || player < 0 || player > 2 || ![2, 3].includes(playerCount)) {
    socket.close(1008, 'invalid room or player');
    return;
  }

  if (signaling) {
    handleSignalConnection(socket, roomId, runId, player, playerCount);
    return;
  }

  const room = getRoom(roomId);
  const run = getRun(room, runId);
  if (run.clients.has(player)) {
    socket.close(1008, 'player slot already occupied');
    return;
  }
  run.clients.set(player, socket);
  console.log(`JOIN room=${roomId} run=${runId} player=${player} peers=${run.clients.size}`);
  maybeResolveRoute(roomId, runId, room, run);

  socket.on('message', (data, isBinary) => {
    if (!isBinary) {
      socket.close(1003, 'binary frames only');
      return;
    }
    const incoming = Buffer.from(data);
    if (incoming.length >= 2 && incoming[0] === 0xe8) {
      if (player !== 0 || (!run.spectatorAdmissionOpen && run.spectatorClients.size === 0)) return;
      const payload = Buffer.from(incoming.subarray(1));
      const streamPlayers = payload[6];
      if ((streamPlayers !== 2 && streamPlayers !== 3) ||
          payload.length !== 24 + streamPlayers * 12 ||
          payload[0] !== 0x45 || (payload[1] !== 0x36 && payload[1] !== 0x37) || payload[2] !== 0x4e ||
          payload[3] !== 0x50 || payload[4] !== 4 || payload[5] !== 3 ||
          payload[7] !== 0 || streamPlayers !== run.playerCount) return;
      if (run.spectatorAdmissionOpen)
        run.spectatorHistory.push(payload);
      for (const [spectatorId, target] of run.spectatorClients)
        sendSpectatorPayload(target, payload, roomId, runId, spectatorId);
      return;
    }
    let requestedPeer = null;
    let forwardedPayload = incoming;
    if (incoming.length >= 2 && incoming[0] === targetedEnvelopeMarker) {
      requestedPeer = incoming[1];
      forwardedPayload = incoming.subarray(2);
      if (!Number.isInteger(requestedPeer) || requestedPeer < 0 ||
          requestedPeer >= playerCount || requestedPeer === player) {
        socket.close(1008, 'invalid relay target');
        return;
      }
    }
    for (const [peer, target] of run.clients) {
      if (peer === player || target.readyState !== WebSocket.OPEN) continue;
      if (requestedPeer != null && peer !== requestedPeer) continue;
      const key = `${roomId}:${runId}:${player}->${peer}`;
      const sequence = (forwardCounters.get(key) || 0) + 1;
      forwardCounters.set(key, sequence);
      const looksLikeNetplayInput = forwardedPayload.length >= 6 &&
        forwardedPayload[0] === 0x45 && forwardedPayload[2] === 0x4e &&
        forwardedPayload[3] === 0x50 && forwardedPayload[5] === 1;
      if (dropFirstInputPerEdge && looksLikeNetplayInput && !firstInputDropped.has(key)) {
        firstInputDropped.add(key);
        continue;
      }
      if (looksLikeNetplayInput && dropInputLatestFrom >= 0 && dropInputLatestTo >= dropInputLatestFrom &&
          forwardedPayload.length >= 28) {
        const latestFrame = forwardedPayload.readUInt32LE(24);
        if (latestFrame >= dropInputLatestFrom && latestFrame <= dropInputLatestTo) {
          const frameDropKey = `${key}:${latestFrame}`;
          if (!inputLatestDropped.has(frameDropKey)) {
            inputLatestDropped.add(frameDropKey);
            continue;
          }
        }
      }
      if (dropEvery > 0 && sequence % dropEvery === 0)
        continue;
      const spread = jitterMs > 0 ? ((sequence * 17) % (jitterMs * 2 + 1)) - jitterMs : 0;
      const wait = Math.max(0, delayMs + spread);
      const payload = Buffer.from(forwardedPayload);
      if (wait === 0) {
        target.send(payload, { binary: true });
      } else {
        setTimeout(() => {
          if (target.readyState === WebSocket.OPEN)
            target.send(payload, { binary: true });
        }, wait);
      }
    }
  });

  socket.on('close', () => {
    removeClient(roomId, runId, player, socket);
    console.log(`LEAVE room=${roomId} run=${runId} player=${player}`);
  });
  socket.on('error', error => {
    console.error(`SOCKET room=${roomId} player=${player} ${error.message}`);
  });
});

server.on('listening', () => {
  const dropRange = dropInputLatestFrom >= 0 && dropInputLatestTo >= dropInputLatestFrom
    ? `${dropInputLatestFrom}-${dropInputLatestTo}` : 'off';
  console.log(`TH07 LAN relay listening ws://${host}:${port} delay=${delayMs} jitter=${jitterMs} dropEvery=${dropEvery} dropFirstInput=${dropFirstInputPerEdge ? 1 : 0} dropInputLatest=${dropRange}`);
});

server.on('error', error => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
