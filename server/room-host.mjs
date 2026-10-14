// Seats belong to gameplay; room ownership survives moving between them.
export function roomHostId(room) {
  const current = room.lobby.hostClientId;
  const present = id => room.lobbyClients.has(id) || room.lobbyDisconnectTimers.has(id) || room.lobby.retainedHostId === id;
  if (current && present(current)) return current;
  room.lobby.hostClientId = room.lobby.seats.find(seat => seat && present(seat.clientId))?.clientId
    ?? room.lobbyClients.keys().next().value ?? null;
  return room.lobby.hostClientId;
}
