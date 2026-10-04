import { isIP } from 'node:net';

function normalizeAddress(value) {
  const address = String(value || '').trim().toLowerCase();
  return address.startsWith('::ffff:') && isIP(address.slice(7)) === 4 ? address.slice(7) : address;
}

// Client-supplied identities and Origin headers are not authentication.
// Accept a proxy's client address only from explicitly configured peers.
export function relayClientAddress(request, trustedProxies = new Set()) {
  const peer = normalizeAddress(request.socket.remoteAddress);
  if (trustedProxies.has(peer)) {
    const forwarded = request.headers['x-real-ip'];
    if (typeof forwarded !== 'string' || !isIP(normalizeAddress(forwarded))) return null;
    return normalizeAddress(forwarded);
  }
  return isIP(peer) ? peer : null;
}

export function relayAbuseConfig(env = process.env) {
  const integer = (name, fallback) => {
    const raw = env[`EAGLER_NETPLAY_${name}`];
    if (raw == null) return fallback;
    if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw)) || Number(raw) < 1)
      throw new Error(`invalid EAGLER_NETPLAY_${name}`);
    return Number(raw);
  };
  const trustedProxies = new Set((env.EAGLER_NETPLAY_TRUSTED_PROXIES || '').split(',').filter(Boolean).map(normalizeAddress));
  for (const address of trustedProxies) if (!isIP(address)) throw new Error('EAGLER_NETPLAY_TRUSTED_PROXIES requires exact IP addresses');
  return {
    trustedProxies,
    maxConnectionsPerIp: integer('MAX_CONNECTIONS_PER_IP', 32),
    maxConnections: integer('MAX_CONNECTIONS', 2048),
    attemptsPerMinute: integer('CONNECTIONS_PER_MINUTE', 60),
    maxRoomsPerIp: integer('MAX_ROOMS_PER_IP', 2),
    maxRooms: integer('MAX_ROOMS', 512),
    maxAddresses: integer('MAX_TRACKED_ADDRESSES', 10_000),
  };
}

export function createRelayAbuseGuard({ now = Date.now, ...config } = relayAbuseConfig()) {
  const addresses = new Map(), owners = new Map();
  let connections = 0;
  function entry(address) {
    let state = addresses.get(address);
    if (!state) {
      if (addresses.size >= config.maxAddresses) sweep();
      if (addresses.size >= config.maxAddresses) return null;
      state = { active: 0, rooms: 0, attempts: [] };
      addresses.set(address, state);
    }
    return state;
  }
  function prune(state) {
    const time = now();
    state.attempts = state.attempts.filter(value => time - value < 60_000);
  }
  function sweep() {
    for (const [address, state] of addresses) {
      prune(state);
      if (!state.active && !state.rooms && !state.attempts.length) addresses.delete(address);
    }
  }
  function allowHandshake(address) {
    if (!address) return false;
    const state = entry(address);
    if (!state) return false;
    prune(state);
    if (connections >= config.maxConnections || state.active >= config.maxConnectionsPerIp || state.attempts.length >= config.attemptsPerMinute) return false;
    state.attempts.push(now());
    return true;
  }
  function trackSocket(address, socket) {
    const state = entry(address);
    if (!state || connections >= config.maxConnections || state.active >= config.maxConnectionsPerIp) return false;
    ++state.active; ++connections;
    socket.once('close', () => { --state.active; --connections; });
    return true;
  }
  function canCreateRoom(address) {
    const state = entry(address);
    if (!state) return false;
    prune(state);
    return owners.size < config.maxRooms && state.rooms < config.maxRoomsPerIp;
  }
  function createRoom(id, address) {
    if (owners.has(id)) return true;
    if (!canCreateRoom(address)) return false;
    const state = entry(address);
    ++state.rooms;
    owners.set(id, address);
    return true;
  }
  function releaseRoom(id) {
    const address = owners.get(id);
    if (address === undefined) return;
    --addresses.get(address).rooms;
    owners.delete(id);
  }
  return { allowHandshake, trackSocket, canCreateRoom, createRoom, releaseRoom, sweep };
}
