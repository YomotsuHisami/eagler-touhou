// Resource limits belong to the shared relay, independent of game identity.
// Current input packets carry at most 32 samples; 16 KiB leaves ample headroom.
export const RELAY_LIMITS = Object.freeze({
  messageBytes: 64 * 1024,
  gameplayBytes: 16 * 1024,
  controlBytes: 32 * 1024,
  bufferedBytes: 256 * 1024,
  delayedMessages: 1024,
  historyBytes: 1024 * 1024,
  historyFrames: 8192,
});

export function createRelayMessageGate({ maxBytes, messagesPerSecond, bytesPerSecond, now = () => performance.now() }) {
  let messages = messagesPerSecond * 2, bytes = bytesPerSecond * 2, last = now();
  return size => {
    if (!Number.isSafeInteger(size) || size < 0 || size > maxBytes)
      return { code: 1009, reason: 'relay message too large' };
    const time = now(), elapsed = Math.max(0, time - last) / 1000;
    last = time;
    messages = Math.min(messagesPerSecond * 2, messages + elapsed * messagesPerSecond);
    bytes = Math.min(bytesPerSecond * 2, bytes + elapsed * bytesPerSecond);
    if (messages < 1 || bytes < size) return { code: 1008, reason: 'relay message rate exceeded' };
    --messages; bytes -= size;
    return null;
  };
}

export function acceptRelayMessage(socket, data, gate) {
  if (socket.readyState !== 1) return false;
  const failure = gate(typeof data === 'string' ? Buffer.byteLength(data) : data.byteLength);
  if (!failure) return true;
  socket.close(failure.code, failure.reason);
  return false;
}

// JSON objects must not reach Number/String coercion through attacker-supplied
// valueOf/toString properties. Structured SDP/ICE/timing have their own owners.
const numericFields = ['to', 'seat', 'loadout', 'percent', 'playerCount', 'difficulty', 'inputDelay', 'adonisMode', 'predictionLimit'];
export function validRelayControlMessage(message) {
  if (!message || typeof message !== 'object' || Array.isArray(message) || typeof message.type !== 'string') return false;
  for (const field of numericFields) {
    const value = message[field];
    if (value != null && typeof value !== 'number' && typeof value !== 'string') return false;
  }
  for (const field of ['name', 'product'])
    if (message[field] != null && typeof message[field] !== 'string') return false;
  return true;
}

// Pending fault-injection timers count against the same recipient budget as ws
// bufferedAmount. Closing a socket cancels timers and releases their payloads.
export function createBoundedRelaySender({ schedule = setTimeout, cancel = clearTimeout } = {}) {
  const pending = new WeakMap();
  function stateFor(socket) {
    let state = pending.get(socket);
    if (!state) {
      state = { bytes: 0, timers: new Map() };
      pending.set(socket, state);
      socket.once('close', () => {
        for (const timer of state.timers.keys()) cancel(timer);
        state.timers.clear(); state.bytes = 0;
      });
    }
    return state;
  }
  function send(socket, payload, { binary = false, delayMs = 0, maxBufferedBytes = RELAY_LIMITS.bufferedBytes } = {}) {
    if (socket.readyState !== 1) return false;
    const state = stateFor(socket);
    // Include framing/timer overhead even for empty payloads.
    const size = (typeof payload === 'string' ? Buffer.byteLength(payload) : payload.byteLength) + 16;
    if (Number(socket.bufferedAmount || 0) + state.bytes + size > maxBufferedBytes ||
        delayMs > 0 && state.timers.size >= RELAY_LIMITS.delayedMessages) {
      socket.terminate();
      return false;
    }
    // ws can retain the payload until the kernel accepts it. Never retain a
    // small view into a much larger inbound TCP buffer in either send lane.
    let retained = payload;
    if (typeof payload !== 'string') {
      retained = Buffer.allocUnsafeSlow(payload.byteLength);
      retained.set(new Uint8Array(payload.buffer ?? payload, payload.byteOffset ?? 0, payload.byteLength));
    }
    if (delayMs > 0) {
      state.bytes += size;
      const timer = schedule(() => {
        if (!state.timers.delete(timer)) return;
        state.bytes -= size;
        send(socket, retained, { binary, maxBufferedBytes });
      }, delayMs);
      state.timers.set(timer, size);
    } else socket.send(retained, { binary });
    return true;
  }
  return send;
}

export function normalizeRelaySignal(message) {
  if (!message || typeof message !== 'object' || Array.isArray(message)) return null;
  let description = null, candidate = null;
  const value = message.description;
  if (value != null) {
    if (!value || Array.isArray(value) || !['offer', 'answer'].includes(value.type) ||
        typeof value.sdp !== 'string' || Buffer.byteLength(value.sdp) > 16 * 1024) return null;
    description = { type: value.type, sdp: value.sdp };
  }
  const ice = message.candidate;
  if (ice != null) {
    if (!ice || Array.isArray(ice) || typeof ice.candidate !== 'string' || Buffer.byteLength(ice.candidate) > 2048 ||
        !(ice.sdpMid == null || typeof ice.sdpMid === 'string' && ice.sdpMid.length <= 32) ||
        !(ice.sdpMLineIndex == null || Number.isInteger(ice.sdpMLineIndex) && ice.sdpMLineIndex >= 0 && ice.sdpMLineIndex <= 8) ||
        !(ice.usernameFragment == null || typeof ice.usernameFragment === 'string' && ice.usernameFragment.length <= 256)) return null;
    candidate = { candidate: ice.candidate, sdpMid: ice.sdpMid ?? null, sdpMLineIndex: ice.sdpMLineIndex ?? null };
    if (ice.usernameFragment != null) candidate.usernameFragment = ice.usernameFragment;
  }
  return description || candidate ? { description, candidate } : null;
}

export function clearSpectatorHistory(run) {
  run.spectatorHistory.length = 0;
  run.spectatorHistoryBytes = 0;
}

export function stopSpectatorStream(run) {
  if (run.spectatorStopped) return;
  run.spectatorStopped = true;
  run.spectatorAdmissionOpen = false;
  if (run.spectatorGraceTimer) clearTimeout(run.spectatorGraceTimer);
  run.spectatorGraceTimer = null;
  clearSpectatorHistory(run);
  run.admittedSpectators.clear();
  for (const socket of run.spectatorClients.values())
    socket.close(1011, 'spectator stream stopped; players continue');
}

export function hasPendingSpectators(run) {
  for (const id of run.admittedSpectators) if (!run.claimedSpectators.has(id)) return true;
  return false;
}

export function appendSpectatorHistory(run, payload, limits = RELAY_LIMITS) {
  if (run.spectatorStopped) return false;
  if (run.spectatorHistory.length >= limits.historyFrames ||
      (run.spectatorHistoryBytes || 0) + payload.length > limits.historyBytes) {
    // Dropping old frames would make a new spectator start from incomplete
    // history. Stop this optional stream explicitly while players continue.
    stopSpectatorStream(run);
    return false;
  }
  // Own an exact-sized allocation: a tiny view must not retain a large inbound
  // TCP buffer or pooled allocation for the whole spectator admission window.
  const retained = Buffer.allocUnsafeSlow(payload.length);
  payload.copy(retained);
  run.spectatorHistory.push(retained);
  run.spectatorHistoryBytes = (run.spectatorHistoryBytes || 0) + retained.length;
  return true;
}
