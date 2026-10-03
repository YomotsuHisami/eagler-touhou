import { randomUUID } from 'node:crypto';

export function publicControlMode(seat) {
  if (seat.touchEnabled === false) return 'normal';
  if (seat.touchEnabled !== true) return null;
  if (seat.movementMode === 'touch-unlimited') return 'cheat';
  if (seat.movementMode === 'touch') return 'touch';
  return ['joystick', 'joystick-free'].includes(seat.movementMode) ? 'normal' : null;
}

// Discovery never joins a room. Membership is anonymous and browser-scoped;
// it prevents accidental multi-tab seats, not multiple accounts/devices.
export function createRoomDirectory({ rooms, clearSeat, invalidateReady, broadcast, maybeDelete, releaseTransports,
  idleHideMs = 5 * 60_000, idleCloseMs = 30 * 60_000 }) {
  const members = new Map(), clients = new Map(), viewers = new Map(), tracked = new Set();
  let updateTimer;
  const online = socket => socket?.readyState === 1;
  const hasGame = room => [...room.clients.values()].some(online) || [...room.runs.values()].some(run =>
    [...run.clients.values(), ...run.signalClients.values(), ...run.spectatorClients.values()].some(online));
  const ownsGame = (room, clientId) => [...room.runs.values()].some(run => {
    const player = run.lobbyClientIds?.indexOf(clientId) ?? -1;
    return online(run.spectatorClients.get(clientId)) ||
      (player >= 0 && (online(run.clients.get(player)) || online(run.signalClients.get(player))));
  });
  const initial = name => [...String(name || '').trim()][0] || '?';
  const send = (socket, value) => { if (online(socket) && socket.bufferedAmount < 128 * 1024) socket.send(JSON.stringify(value)); };
  function summary(id, room) {
    const match = /^(th\d+mp)-(\d{4,8})$/.exec(id);
    if (!match || !room.multiplayer || room.lobby.visibility === 'private') return null;
    const seats = room.lobby.seats.slice(0, room.lobby.playerCount);
    const occupied = seats.filter(Boolean);
    const connected = occupied.filter(seat => online(room.lobbyClients.get(seat.clientId)));
    if (!connected.length && !hasGame(room)) return null;
    const idle = Date.now() - room.lastActivityAt;
    if (!hasGame(room) && idle > idleHideMs) return null;
    return { product: match[1], code: match[2], phase: room.lobby.phase,
      capacity: room.lobby.playerCount, players: occupied.length, online: connected.length,
      ready: connected.filter(seat => seat.ready && seat.readyVersion === room.lobby.settingsVersion).length,
      difficulty: room.lobby.difficulty, host: initial(seats[0]?.name),
      disableCheatMovement: room.lobby.disableCheatMovement === true,
      spectators: [...room.lobby.spectators.keys()].filter(id => online(room.lobbyClients.get(id))).length,
      initials: seats.map(seat => seat ? initial(seat.name) : null),
      seats: seats.map(seat => seat ? { initial: initial(seat.name),
        controlMode: publicControlMode(seat),
        online: online(room.lobbyClients.get(seat.clientId)),
        ready: !!seat.ready && seat.readyVersion === room.lobby.settingsVersion } : null),
      createdAt: room.createdAt, joinable: room.lobby.phase === 'lobby' && occupied.length < room.lobby.playerCount };
  }
  function snapshot(memberId, product = '') {
    const active = members.get(memberId);
    const activeRoom = active && rooms.get(active.roomId);
    const mine = activeRoom && (online(active.socket) || activeRoom.lobbyDisconnectTimers.has(active.clientId) || ownsGame(activeRoom, active.clientId))
      ? { product: active.roomId.split('-')[0], code: active.roomId.split('-')[1], recoveryToken: active.recoveryToken } : null;
    const entries = [...rooms].map(([id, room]) => summary(id, room)).filter(value => value && (!product || value.product === product))
      .sort((a, b) => Number(b.joinable) - Number(a.joinable) || b.createdAt - a.createdAt);
    return { type: 'directory', version: 1, membershipRecovery: true, product, rooms: entries.slice(0, 200), total: entries.length, mine };
  }
  function publish() {
    updateTimer = undefined;
    for (const [socket, viewer] of viewers) {
      const value = snapshot(viewer.memberId, viewer.product), encoded = JSON.stringify(value);
      if (encoded !== viewer.last && online(socket) && socket.bufferedAmount < 128 * 1024) { send(socket, value); viewer.last = encoded; }
    }
  }
  function changed() { if (!updateTimer) updateTimer = setTimeout(publish, 100); }
  function track(socket) {
    if (tracked.has(socket)) return;
    socket.directoryAlive = true;
    tracked.add(socket);
    socket.on('pong', () => { socket.directoryAlive = true; });
    socket.on('close', () => { tracked.delete(socket); viewers.delete(socket); changed(); });
    socket.on('error', () => {});
  }
  function remove(entry) {
    if (members.get(entry.memberId) === entry) members.delete(entry.memberId);
    if (clients.get(entry.clientId) === entry) clients.delete(entry.clientId);
    const room = rooms.get(entry.roomId);
    if (!room) return;
    const timer = room.lobbyDisconnectTimers.get(entry.clientId);
    if (timer) clearTimeout(timer);
    room.lobbyDisconnectTimers.delete(entry.clientId);
    if (room.lobbyClients.get(entry.clientId) === entry.socket) room.lobbyClients.delete(entry.clientId);
    room.lobby.spectators.delete(entry.clientId);
    if (clearSeat(room, entry.clientId)) invalidateReady(room);
    broadcast(room);
    maybeDelete(entry.roomId, room);
  }
  function admit(socket, roomId, clientId, memberId) {
    const previous = members.get(memberId) || clients.get(clientId);
    if (previous && (previous.roomId !== roomId || previous.clientId !== clientId)) {
      const oldRoom = rooms.get(previous.roomId);
      if (online(previous.socket) || (oldRoom && ownsGame(oldRoom, previous.clientId))) {
        send(socket, { type: 'error', code: 'membership-conflict', error: '你已在另一个房间或标签页中，请先退出原房间。',
          room: { product: previous.roomId.split('-')[0], code: previous.roomId.split('-')[1] } });
        socket.close(4009, 'membership conflict');
        return false;
      }
      remove(previous);
    }
    if (previous && previous.socket !== socket && online(previous.socket)) previous.socket.close(4008, 'session replaced');
    if (previous && members.get(previous.memberId) === previous) members.delete(previous.memberId);
    const entry = { roomId, clientId, memberId, socket, recoveryToken: randomUUID() };
    members.set(memberId, entry); clients.set(clientId, entry);
    track(socket);
    changed();
    return true;
  }
  function connect(socket, memberId) {
    track(socket);
    viewers.set(socket, { memberId, product: '', last: '', lastRequest: 0 });
    send(socket, snapshot(memberId));
    socket.on('message', (data, binary) => {
      const viewer = viewers.get(socket);
      if (!viewer || binary || data.length > 256) { socket.close(1008, 'invalid directory request'); return; }
      let message;
      try { message = JSON.parse(String(data)); } catch { return; }
      if (message?.type === 'release-membership') {
        const entry = members.get(memberId);
        // Compare the observed session, not just the room code: a delayed click
        // must never disconnect a newer session opened by another tab.
        if (memberId && entry && message.recoveryToken === entry.recoveryToken) {
          releaseTransports?.(entry.roomId, entry.clientId);
          remove(entry);
          entry.socket.close(4008, 'membership released');
          changed();
        }
        send(socket, snapshot(memberId, viewer.product));
        return;
      }
      if (message?.type === 'refresh') {
        if (Date.now() - viewer.lastRequest < 150) return;
        viewer.lastRequest = Date.now();
        viewer.product = /^th\d+mp$/.test(message.product) ? message.product : '';
        send(socket, snapshot(memberId, viewer.product));
      }
    });
  }
  function activity(room) { room.lastActivityAt = Date.now(); changed(); }
  function depart(clientId, socket) {
    const entry = clients.get(clientId);
    if (entry?.socket !== socket) return;
    clients.delete(clientId);
    if (members.get(entry.memberId) === entry) members.delete(entry.memberId);
    changed();
  }
  function evict(roomId, clientId) {
    const entry = clients.get(clientId);
    if (!entry || entry.roomId !== roomId) return false;
    releaseTransports?.(roomId, clientId);
    remove(entry);
    entry.socket.close(4010, 'removed by host');
    return true;
  }
  const maintenance = setInterval(() => {
    for (const socket of tracked) {
      if (!online(socket)) continue;
      if (!socket.directoryAlive) { socket.terminate(); continue; }
      socket.directoryAlive = false; socket.ping();
    }
    for (const [id, room] of rooms) {
      if (Date.now() - room.lastActivityAt <= idleCloseMs || hasGame(room)) continue;
      for (const socket of room.lobbyClients.values()) socket.close(4004, 'inactive room');
      for (const timer of room.lobbyDisconnectTimers.values()) clearTimeout(timer);
      room.lobbyDisconnectTimers.clear(); room.lobbyClients.clear();
      room.lobby.seats.fill(null); room.lobby.spectators.clear();
      for (const [runId, run] of room.runs) {
        if (run.routeTimer) clearTimeout(run.routeTimer);
        if (run.spectatorGraceTimer) clearTimeout(run.spectatorGraceTimer);
        room.runs.delete(runId);
      }
      maybeDelete(id, room);
    }
    for (const entry of members.values()) {
      const room = rooms.get(entry.roomId);
      if (!room || (!online(entry.socket) && !room.lobbyDisconnectTimers.has(entry.clientId) && !ownsGame(room, entry.clientId))) remove(entry);
    }
    changed();
  }, 30_000);
  maintenance.unref();
  return { admit, connect, activity, changed, depart, evict, track, close() { clearInterval(maintenance); clearTimeout(updateTimer); } };
}
