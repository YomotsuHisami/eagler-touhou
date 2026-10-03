/** Real relay-backed multiplayer state. React owns routing and presentation;
 * the existing transport, identity, validation and timing owners stay shared. */
import { PRODUCT_IDS, gameIdForProduct, isMultiplayerProductId, multiplayerConfigForProduct, productEnabledForBuild, type MultiplayerProductId } from '../../src/contracts/product-catalog.mts';
import { validateHostManifest, type HostManifest } from '../../src/contracts/host-manifest.mts';
import { createMultiplayerIdentityStore, multiplayerMemberId, multiplayerControlMode } from '../../src/launcher/multiplayer-identity.mts';
import { createMultiplayerRoomSessionStore } from '../../src/launcher/multiplayer-room-session.mts';
import { createMultiplayerPreferenceStore } from '../../src/launcher/multiplayer-preferences.mts';
import { normalizeMultiplayerLobbySnapshot, type NormalizedMultiplayerLobbySnapshot, type MultiplayerResourceProgress } from '../../src/launcher/multiplayer-lobby-snapshot.mts';
import { buildMultiplayerDirectoryRelayUrl, buildMultiplayerLobbyRelayUrl, buildMultiplayerGameplayRelayUrl } from '../../src/launcher/multiplayer-relay-url.mts';
import { buildMultiplayerRuntimeOptions, type MultiplayerRuntimeOptions } from '../../src/launcher/multiplayer-runtime-options.mts';
import { createRoomNetwork, type ProbeLane, type ProbeMetric } from '../../src/launcher/room-network.mts';
import { recommendMultiplayerInputTiming } from '../../src/launcher/multiplayer-input-timing.mts';

export type DirectoryConnection = 'idle' | 'loading' | 'live' | 'offline' | 'unsupported' | 'missing';
export interface DirectoryRoom {
  product: MultiplayerProductId; code: string; capacity: 2 | 3; players: number; ready: number;
  difficulty: number; spectators: number; phase: 'lobby' | 'playing'; joinable: boolean; disableCheatMovement: boolean;
  seats: Array<{ initial: string; ready: boolean; online: boolean; controlMode: ReturnType<typeof multiplayerControlMode> } | null>;
}
export interface RoomSnapshot extends NormalizedMultiplayerLobbySnapshot {
  product: MultiplayerProductId; code: string; clientId: string; created: boolean; synced: boolean; generation: number;
  connection: 'connecting' | 'syncing' | 'connected' | 'reconnecting' | 'closed';
}
export interface RoomLaunchHandoff { product: MultiplayerProductId; code: string; runId: number; options: MultiplayerRuntimeOptions }
export interface RoomMovement { movementMode: string; touchEnabled: boolean; mobileDevice: boolean }
export interface RoomSettings { playerCount: 2 | 3; difficulty: number; visibility: 'public' | 'private'; disableCheatMovement: boolean }
export interface RoomServiceSnapshot {
  connection: DirectoryConnection; products: readonly MultiplayerProductId[]; rooms: readonly DirectoryRoom[]; total: number;
  selectedProduct: string; loadedProduct: string | null;
  mine: { product: MultiplayerProductId; code: string; recoveryToken: string } | null;
  recovering: boolean; supportsRecovery: boolean; room: RoomSnapshot | null;
  error: string | null; errorCode: string | null; displayName: string; displayNameLocked: boolean;
  preferredLoadout: number; resource: MultiplayerResourceProgress | null; inputDelay: 'auto' | number;
  launch: RoomLaunchHandoff | null; launchPending: boolean;
  permissions: { owner: boolean; canSettings: boolean; canReady: boolean; canStart: boolean; canKick: boolean; movementAllowed: boolean };
  network: { capabilities: ReturnType<ReturnType<typeof createRoomNetwork>['capabilities']>; peers: Record<string, Record<ProbeLane, ProbeMetric>>; recommendedDelay: number };
}
export interface RoomServiceOptions {
  baseUrl: string;
  onLaunch?: (handoff: RoomLaunchHandoff) => void | Promise<void>;
  getMovement?: () => RoomMovement;
  fetchImpl?: typeof fetch;
  createSocket?: (url: string) => WebSocket;
  persistentStorage?: Storage | null;
  sessionStorage?: Storage | null;
  memberId?: string;
}
const record = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
const bounded = (value: unknown, max: number) => Math.max(0, Math.min(max, Math.trunc(Number(value) || 0)));
const storage = (key: 'localStorage' | 'sessionStorage'): Storage | null => { try { return globalThis[key] ?? null; } catch { return null; } };
const messageFor = (reason: unknown) => reason instanceof Error ? reason.message : String(reason);
function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) freeze(nested);
    Object.freeze(value);
  }
  return value;
}
export function createRoomService(options: RoomServiceOptions) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const createSocket = options.createSocket ?? (url => new WebSocket(url));
  const persistentStorage = options.persistentStorage === undefined ? storage('localStorage') : options.persistentStorage;
  const sessionStorage = options.sessionStorage === undefined ? storage('sessionStorage') : options.sessionStorage;
  const identity = createMultiplayerIdentityStore({ persistentStorage, sessionStorage });
  const sessions = createMultiplayerRoomSessionStore({ storage: sessionStorage });
  const preferences = createMultiplayerPreferenceStore({ storage: persistentStorage });
  const memberId = options.memberId ?? multiplayerMemberId();
  const listeners = new Set<() => void>();
  let disposed = false, relay = '', directorySocket: WebSocket | null = null, roomSocket: WebSocket | null = null;
  let directoryRetry = 0, roomRetry = 0, roomIntent: 'create' | 'join' = 'join', autoSeat = false;
  let desiredSeat: number | null = null, desiredSpectator = false, startSerial = 0, lastLaunchedSerial = -1;
  let directoryTimer: ReturnType<typeof setTimeout> | undefined, handshakeTimer: ReturnType<typeof setTimeout> | undefined;
  let listTimer: ReturnType<typeof setTimeout> | undefined, recoveryTimer: ReturnType<typeof setTimeout> | undefined;
  let roomTimer: ReturnType<typeof setTimeout> | undefined, roomHandshakeTimer: ReturnType<typeof setTimeout> | undefined;
  let booting: Promise<void> | null = null, bootEpoch = 0, entryEpoch = 0, activityAt = 0;
  let reportedResource = '', recoveredToken = '';
  const movement = (): RoomMovement => {
    const value = options.getMovement?.() ?? { movementMode: 'touch', touchEnabled: false, mobileDevice: false };
    // Main advertises any enabled touch control surface as a mobile seat.
    return { ...value, mobileDevice: value.mobileDevice || value.touchEnabled };
  };
  const online = () => typeof navigator === 'undefined' || navigator.onLine !== false;
  let state: RoomServiceSnapshot = freeze({
    connection: 'idle', products: [], rooms: [], total: 0, selectedProduct: '', loadedProduct: null,
    mine: null, recovering: false, supportsRecovery: false, room: null, error: null, errorCode: null,
    displayName: identity.loadDisplayName(), displayNameLocked: identity.displayNameLocked(), preferredLoadout: 0,
    resource: null, inputDelay: 'auto', launch: null, launchPending: false,
    permissions: { owner: false, canSettings: false, canReady: false, canStart: false, canKick: false, movementAllowed: true },
    network: { capabilities: { supported: false, rtcAvailable: false, turnConfigured: false }, peers: {}, recommendedDelay: 0 },
  });
  const send = (message: Record<string, unknown>): boolean => {
    if (!roomSocket || roomSocket.readyState !== 1 || disposed) return false;
    try { roomSocket.send(JSON.stringify(message)); return true; }
    catch (error) { publish({ error: messageFor(error), errorCode: 'send' }); return false; }
  };
  const network = createRoomNetwork({ send, changed: () => { if (!disposed) publish({}); } });
  function publish(patch: Partial<RoomServiceSnapshot>) {
    if (disposed) return;
    const next = { ...state, ...patch };
    const room = next.room;
    const policy = room ? multiplayerConfigForProduct(room.product) : null;
    const active = !!room?.synced && room.connection === 'connected' && room.phase === 'lobby';
    const owner = !!room && room.localSeat === 0;
    const local = room?.localSeat != null ? room.seats[room.localSeat] : null;
    const allowed = !room?.disableCheatMovement || ['touch', 'joystick', 'joystick-free'].includes(movement().movementMode);
    const ready = next.resource?.status === 'ready' && next.resource.stage === 'runtime';
    const occupied = room?.seats.slice(0, room.playerCount) ?? [];
    const peerIds = occupied.flatMap(seat => seat && !seat.offline && seat.clientId !== room?.clientId ? [seat.clientId] : []);
    const phones = occupied.reduce((count, seat, index) => count + (seat && (seat.mobileDevice || (index === room?.localSeat && movement().mobileDevice)) ? 1 : 0), 0);
    const recommendation = recommendMultiplayerInputTiming(phones, network.minimumRtt(peerIds), 0, policy?.inputTiming?.rollbackLimit ?? 8);
    next.permissions = { owner, canSettings: active && owner, canKick: active && owner,
      movementAllowed: allowed, canReady: active && !!local && allowed && ready,
      canStart: active && owner && ready && allowed && occupied.length === room?.playerCount && occupied.every(seat => !!seat?.ready && !seat.offline) };
    next.network = { capabilities: network.capabilities(), recommendedDelay: recommendation.inputDelay,
      peers: Object.fromEntries(peerIds.map(id => [id, Object.fromEntries((['direct', 'turn', 'relay'] as const).map(lane => [lane, { ...network.metric(id, lane) }]))])) as Record<string, Record<ProbeLane, ProbeMetric>> };
    // Never freeze network-owned metrics or mutate a snapshot already read by React.
    state = freeze(next);
    for (const listener of listeners) listener();
  }
  const fail = (text: string, code = 'action'): false => { publish({ error: text, errorCode: code }); return false; };
  const clearError = () => publish({ error: null, errorCode: null });
  function persistRoom() {
    const room = state.room;
    if (!room) return;
    sessions.save(room.product, { room, seat: room.localSeat, ready: room.localSeat != null && !!room.seats[room.localSeat]?.ready,
      spectatorRequested: room.localSpectator, roomSettingsOpen: false });
  }
  function updateProbes() {
    const room = state.room;
    network.update({ localId: room?.clientId ?? '', peers: room?.seats.slice(0, room.playerCount).flatMap(seat => seat && !seat.offline ? [seat.clientId] : []) ?? [],
      active: !!room?.synced && room.connection === 'connected' && room.localSeat != null && room.phase === 'lobby' && !state.launchPending && !state.launch });
  }
  function disconnectDirectory() {
    clearTimeout(directoryTimer); clearTimeout(handshakeTimer); clearTimeout(listTimer); clearTimeout(recoveryTimer);
    const previous = directorySocket; directorySocket = null;
    if (previous && previous.readyState < 2) previous.close(1000, 'leave directory');
  }
  function parseDirectoryRoom(value: unknown): DirectoryRoom | null {
    const row = record(value);
    if (!row || typeof row.product !== 'string' || !isMultiplayerProductId(row.product) || !state.products.includes(row.product) ||
      typeof row.code !== 'string' || !/^\d{4,8}$/.test(row.code)) return null;
    const policy = multiplayerConfigForProduct(row.product)!;
    const capacity = Number(row.capacity) as 2 | 3;
    if (!policy.playerCounts.includes(capacity)) return null;
    const input = Array.isArray(row.seats) ? row.seats : Array.isArray(row.initials) ? row.initials : [];
    const seats = Array.from({ length: capacity }, (_, index) => {
      const value = input[index]; if (value == null) return null;
      const seat = record(value);
      return { initial: [...String(seat?.initial ?? value).replace(/[\u0000-\u001f\u007f]/g, '').trim()][0] || '?',
        ready: seat?.ready === true, online: seat?.online !== false, controlMode: multiplayerControlMode(seat?.controlMode) };
    });
    return { product: row.product, code: row.code, capacity, seats, disableCheatMovement: row.disableCheatMovement === true,
      players: seats.filter(Boolean).length, ready: bounded(row.ready, capacity), spectators: bounded(row.spectators, 999),
      difficulty: bounded(row.difficulty, policy.difficulties.length - 1), phase: row.phase === 'lobby' ? 'lobby' : 'playing', joinable: row.joinable === true };
  }
  function refresh(product = state.selectedProduct) {
    if (product && (!isMultiplayerProductId(product) || !state.products.includes(product))) return fail('该游戏当前没有可用联机服务', 'product');
    if (product !== state.selectedProduct) publish({ selectedProduct: product, loadedProduct: null });
    if (directorySocket?.readyState !== 1) { if (relay) connectDirectory(); return false; }
    try { directorySocket.send(JSON.stringify({ type: 'refresh', product })); }
    catch (error) { return fail(messageFor(error), 'directory-send'); }
    clearTimeout(listTimer);
    if (state.loadedProduct !== product) listTimer = setTimeout(() => { if (directorySocket?.readyState === 1 && state.loadedProduct !== state.selectedProduct) refresh(); }, 3000);
    return true;
  }
  function scheduleDirectoryReconnect() {
    if (disposed || !online()) return;
    clearTimeout(directoryTimer);
    directoryTimer = setTimeout(connectDirectory, Math.min(20_000, 1500 * 2 ** Math.min(directoryRetry++, 4)));
  }
  function connectDirectory() {
    if (disposed) return;
    disconnectDirectory();
    if (!relay) { publish({ connection: 'missing' }); return; }
    if (!online()) { publish({ connection: 'offline' }); return; }
    publish({ connection: 'loading', loadedProduct: null, recovering: false });
    let next: WebSocket;
    try { next = createSocket(buildMultiplayerDirectoryRelayUrl(relay, memberId)); }
    catch (error) { fail(messageFor(error), 'directory'); publish({ connection: 'offline' }); scheduleDirectoryReconnect(); return; }
    directorySocket = next;
    let received = false;
    handshakeTimer = setTimeout(() => {
      if (directorySocket !== next || received) return;
      disconnectDirectory(); publish({ connection: 'offline', error: '联机大厅响应超时，正在重试', errorCode: 'directory-timeout' }); scheduleDirectoryReconnect();
    }, 10000);
    next.addEventListener('message', event => {
      if (disposed || directorySocket !== next) return;
      let data: Record<string, unknown> | null;
      try { data = record(JSON.parse(String(event.data))); } catch { return; }
      if (data?.type === 'error') { fail(String(data.error || '联机大厅请求失败'), String(data.code || 'directory')); return; }
      if (data?.type !== 'directory' || data.version !== 1 || !Array.isArray(data.rooms)) return;
      const first = !received; received = true; directoryRetry = 0; clearTimeout(handshakeTimer);
      const active = record(data.mine);
      const mine = active && typeof active.product === 'string' && isMultiplayerProductId(active.product) && typeof active.code === 'string' && /^\d{4,8}$/.test(active.code)
        ? { product: active.product, code: active.code, recoveryToken: typeof active.recoveryToken === 'string' ? active.recoveryToken : '' } : null;
      const recovered = state.recovering && mine?.recoveryToken !== recoveredToken;
      if (recovered) { clearTimeout(recoveryTimer); if (state.mine && !mine) sessions.clear(state.mine.product); }
      const loadedProduct = typeof data.product === 'string' ? data.product : first ? '' : state.selectedProduct;
      publish({ mine, supportsRecovery: data.membershipRecovery === true, recovering: recovered ? false : state.recovering,
        rooms: data.rooms.slice(0, 200).map(parseDirectoryRoom).filter((room): room is DirectoryRoom => !!room), total: bounded(data.total, 100000),
        loadedProduct, connection: 'live', ...(state.errorCode?.startsWith('directory') ? { error: null, errorCode: null } : {}) });
      if (loadedProduct === state.selectedProduct) clearTimeout(listTimer);
      if (first && state.selectedProduct) refresh();
    });
    next.addEventListener('close', event => {
      if (disposed || directorySocket !== next) return;
      directorySocket = null; clearTimeout(handshakeTimer); clearTimeout(recoveryTimer);
      const unsupported = !received && event.code === 1008;
      publish({ connection: unsupported ? 'unsupported' : received ? 'loading' : 'offline', recovering: false,
        error: unsupported ? '此联机服务器不支持房间大厅' : '大厅连接已中断，正在重新连接', errorCode: 'directory-close' });
      if (!unsupported) scheduleDirectoryReconnect();
    });
    next.addEventListener('error', () => { if (directorySocket === next) fail('大厅网络连接失败', 'directory-network'); });
  }
  function configureManifest(value: HostManifest) {
    const manifest = validateHostManifest(value);
    relay = manifest.shared.netplayRelay ?? '';
    const products = PRODUCT_IDS.filter((product): product is MultiplayerProductId => isMultiplayerProductId(product) && productEnabledForBuild(product, manifest.shared.testBuild) && !!manifest.games[gameIdForProduct(product)]);
    publish({ products, selectedProduct: products.includes(state.selectedProduct as MultiplayerProductId) ? state.selectedProduct : products[0] ?? '', error: null, errorCode: null });
    connectDirectory();
  }
  async function boot() {
    if (disposed) return;
    if (booting) return booting;
    const epoch = ++bootEpoch;
    publish({ connection: 'loading', error: null, errorCode: null });
    booting = (async () => {
      try {
        const response = await fetchImpl(new URL('host-manifest.json', options.baseUrl), { cache: 'no-store', signal: AbortSignal.timeout(10000) });
        if (!response.ok) throw new Error(`联机配置读取失败：HTTP ${response.status}`);
        const manifest = validateHostManifest(await response.json());
        if (!disposed && epoch === bootEpoch) configureManifest(manifest);
      } catch (error) { if (!disposed && epoch === bootEpoch) publish({ connection: 'offline', error: messageFor(error), errorCode: 'manifest' }); }
      finally { if (epoch === bootEpoch) booting = null; }
    })();
    return booting;
  }
  function disconnectRoom(reason = 'leave room') {
    clearTimeout(roomTimer); clearTimeout(roomHandshakeTimer); roomTimer = undefined;
    const previous = roomSocket; roomSocket = null;
    network.reset(); reportedResource = '';
    if (previous && previous.readyState < 2) previous.close(1000, reason);
  }
  function scheduleRoomReconnect() {
    if (disposed || !state.room || !online()) return;
    clearTimeout(roomTimer);
    const delay = Math.min(5000, 650 * 2 ** Math.min(roomRetry++, 3)) + Math.floor(Math.random() * 250);
    roomTimer = setTimeout(() => { roomTimer = undefined; connectRoom(true); }, delay);
  }
  function syncResourceReport() {
    if (!state.room?.synced || state.room.localSeat == null || !state.resource) return;
    const key = JSON.stringify(state.resource);
    if (key !== reportedResource && send({ type: 'resource-progress', ...state.resource })) reportedResource = key;
  }
  function applyRoom(value: unknown): boolean {
    const current = state.room;
    if (!current) return false;
    const policy = multiplayerConfigForProduct(current.product)!;
    const normalized = normalizeMultiplayerLobbySnapshot(value, { localClientId: current.clientId, ...policy });
    if (!normalized) return fail('收到无效的房间状态', 'room-state');
    const room: RoomSnapshot = { ...current, ...normalized, synced: true, connection: 'connected' };
    desiredSeat = room.localSeat; desiredSpectator = room.localSpectator;
    if (room.localSeat == null) reportedResource = '';
    publish({ room }); persistRoom(); updateProbes(); syncResourceReport();
    if (room.disableCheatMovement && room.localSeat != null && !state.permissions.movementAllowed) fail('本房间禁止作弊移动，请选择触屏或摇杆模式后重新准备', 'movement-policy');
    return true;
  }
  async function launchRun(serial: number) {
    const room = state.room;
    if (!room || (!room.localSpectator && room.localSeat == null) || serial <= lastLaunchedSerial) return;
    const epoch = entryEpoch;
    try {
      const policy = multiplayerConfigForProduct(room.product)!;
      const spectator = room.localSeat == null && room.localSpectator;
      const role = spectator ? { spectator: room.clientId } : { player: room.localSeat! };
      const url = buildMultiplayerGameplayRelayUrl(relay, { product: room.product, roomCode: room.code, runId: serial, role });
      const loadouts = room.seats.slice(0, room.playerCount).map(seat => policy.loadouts[seat?.loadout ?? 0]);
      const runtimeOptions = buildMultiplayerRuntimeOptions({ url, player: spectator ? 0 : room.localSeat, playerCount: room.playerCount,
        seed: Number.parseInt(room.code, 10) & 0xffff, difficulty: room.difficulty,
        ...(policy.inputTiming ? { inputDelay: room.inputDelay } : {}),
        ...(policy.inputTiming?.sendPredictionLimit != null ? { predictionLimit: room.predictionLimit } : {}),
        spectator, spectatorId: spectator ? room.clientId : '', spectatorCount: room.spectatorCount,
        iceServers: [{ urls: ['stun:stun.cloudflare.com:3478'] }], loadouts }, policy);
      const handoff = { product: room.product, code: room.code, runId: serial, options: runtimeOptions };
      lastLaunchedSerial = serial;
      publish({ launch: handoff, launchPending: true, error: null, errorCode: null }); network.suspend();
      if (options.onLaunch) await options.onLaunch(handoff);
      if (!disposed && state.launch === handoff) publish({ launchPending: false });
    } catch (error) {
      if (!disposed && entryEpoch === epoch && state.room?.product === room.product && state.room.code === room.code) {
        publish({ launchPending: false, error: messageFor(error), errorCode: 'launch' });
      }
    }
  }
  function connectRoom(reconnecting = false) {
    const room = state.room;
    if (disposed || !room || !relay) return;
    if (!online()) { publish({ room: { ...room, connection: 'reconnecting', synced: false } }); return; }
    if (roomSocket && roomSocket.readyState < 2) return;
    clearTimeout(roomTimer); clearTimeout(roomHandshakeTimer);
    network.reset(reconnecting); reportedResource = '';
    const request = buildMultiplayerLobbyRelayUrl(relay, { product: room.product, roomCode: room.code, clientId: room.clientId,
      memberId, intent: roomIntent, visibility: room.visibility, disableCheatMovement: room.disableCheatMovement, playerCount: room.playerCount, difficulty: room.difficulty });
    let next: WebSocket;
    try { next = createSocket(request.url); }
    catch (error) { fail(messageFor(error), 'room-network'); scheduleRoomReconnect(); return; }
    roomSocket = next;
    publish({ room: { ...room, connection: reconnecting ? 'reconnecting' : 'connecting', synced: false } });
    roomHandshakeTimer = setTimeout(() => {
      if (roomSocket !== next || state.room?.synced) return;
      roomSocket = null; next.close(1000, 'room sync timeout');
      if (state.room) publish({ room: { ...state.room, connection: 'reconnecting', synced: false }, error: '房间同步超时，正在重试', errorCode: 'room-timeout' });
      scheduleRoomReconnect();
    }, 10000);
    next.addEventListener('open', () => {
      if (disposed || roomSocket !== next || !state.room) return;
      roomRetry = 0; publish({ room: { ...state.room, connection: 'syncing' } });
      if (desiredSeat != null) send({ type: 'take-seat', seat: desiredSeat, loadout: state.preferredLoadout, ready: false, name: state.displayName, ...movement() });
      else if (desiredSpectator) send({ type: 'spectate', name: state.displayName });
    });
    next.addEventListener('message', event => {
      if (disposed || roomSocket !== next) return;
      let data: Record<string, unknown> | null;
      try { data = record(JSON.parse(String(event.data))); } catch { return; }
      if (!data) return;
      if (data.type === 'room-probe-config' || data.type === 'room-probe') { void network.receive(data); return; }
      if (data.type === 'state' || data.type === 'start' || data.type === 'spectator-start') {
        const probe = record(data.roomProbe);
        if (probe) void network.receive({ type: 'room-probe-config', iceServers: probe.iceServers });
        if (!applyRoom(data.room)) return;
        clearTimeout(roomHandshakeTimer); roomIntent = 'join';
        if (state.errorCode?.startsWith('room-') && state.errorCode !== 'room-state') clearError();
        if (data.type === 'state') {
          startSerial = Math.max(0, Number(record(data.room)?.startSerial) || 0);
          if (autoSeat && state.room?.phase === 'lobby') {
            autoSeat = false;
            const index = state.room.seats.slice(0, state.room.playerCount).findIndex(seat => !seat);
            if (state.room.localSeat == null && index >= 0) takeSeat(index);
          }
        } else {
          const serial = Math.max(0, Number(data.serial) || 0);
          if (data.type === 'spectator-start' || serial > startSerial) { startSerial = Math.max(startSerial, serial); void launchRun(serial); }
        }
        return;
      }
      if (data.type === 'error') fail(String(data.error || '房间请求失败'), String(data.code || 'relay'));
    });
    next.addEventListener('close', event => {
      if (disposed || roomSocket !== next) return;
      roomSocket = null; clearTimeout(roomHandshakeTimer); network.reset(true);
      const fatal: Record<number, string> = { 4004: '房间已过期', 4007: '房间不存在或房间号已被使用', 4008: '已在另一个标签页加入房间', 4009: '你已经在另一个房间中', 4010: '你已被移出房间' };
      const current = state.room;
      if (fatal[event.code]) {
        if (current) sessions.clear(current.product);
        publish({ room: current ? { ...current, connection: 'closed', synced: false } : null, error: fatal[event.code], errorCode: String(event.code), launchPending: false }); return;
      }
      if (current) publish({ room: { ...current, connection: 'reconnecting', synced: false }, error: '房间连接中断，正在重连', errorCode: 'room-close' });
      scheduleRoomReconnect();
    });
    next.addEventListener('error', () => { if (roomSocket === next) fail('房间网络连接失败', 'room-network'); });
  }
  async function enter(product: MultiplayerProductId, code: string, created: boolean, settings?: Partial<RoomSettings>, spectator = false, restore = false): Promise<string | null> {
    const epoch = ++entryEpoch;
    if (!relay) await boot();
    if (disposed || epoch !== entryEpoch) return null;
    if (!isMultiplayerProductId(product) || !state.products.includes(product) || !relay) { fail('该游戏当前没有可用联机服务', 'product'); return null; }
    if (!/^\d{4,8}$/.test(code)) { fail('房间号应为 4–8 位数字', 'code'); return null; }
    if (state.room && state.room.connection !== 'closed') {
      if (state.room.product === product && state.room.code === code) return code;
      fail('请先离开当前房间', 'membership'); return null;
    }
    if (state.mine && (state.mine.product !== product || state.mine.code !== code)) { fail('你已经在另一个房间中，请先返回或释放该房间', 'membership'); return null; }
    const policy = multiplayerConfigForProduct(product)!;
    const saved = restore ? sessions.load({ product, roomCode: code, ...policy }) : null;
    const playerCount = settings?.playerCount ?? saved?.room.playerCount ?? policy.playerCounts[0];
    const difficulty = settings?.difficulty ?? saved?.room.difficulty ?? Math.min(1, policy.difficulties.length - 1);
    if (!policy.playerCounts.includes(playerCount) || !Number.isInteger(difficulty) || difficulty < 0 || difficulty >= policy.difficulties.length) { fail('游戏人数或难度无效', 'settings'); return null; }
    disconnectRoom();
    desiredSeat = saved?.seat ?? (created ? 0 : null); desiredSpectator = spectator || !!saved?.spectatorRequested;
    autoSeat = !created && !desiredSpectator && desiredSeat == null;
    roomIntent = created ? 'create' : 'join'; startSerial = 0; lastLaunchedSerial = -1; roomRetry = 0;
    const room: RoomSnapshot = { product, code, generation: epoch, clientId: identity.lobbyClientId(product), created: created || !!saved?.room.created,
      playerCount, difficulty, visibility: settings?.visibility ?? saved?.room.visibility ?? 'public', disableCheatMovement: settings?.disableCheatMovement ?? saved?.room.disableCheatMovement ?? false,
      inputDelay: 0, predictionLimit: 8, settingsVersion: 1, phase: 'lobby', spectators: [], spectatorCount: 0,
      seats: [null, null, null], localSeat: null, localSpectator: false, synced: false, connection: 'connecting' };
    publish({ room, resource: null, launch: null, launchPending: false, inputDelay: 'auto', error: null, errorCode: null,
      preferredLoadout: preferences.load({ product, multiplayer: true, maxLoadout: policy.loadouts.length }).preferredLoadout ?? 0 });
    connectRoom(); return code;
  }
  async function create(input: { product: MultiplayerProductId } & Partial<RoomSettings>) {
    if (!relay) await boot();
    if (state.connection !== 'live') { fail('请等待大厅连接完成后再创建房间', 'directory'); return null; }
    if (state.mine) { fail('你已经在房间中，请先离开当前房间', 'membership'); return null; }
    const random = new Uint32Array(1); crypto.getRandomValues(random);
    let code = String(1000 + random[0] % 9000);
    for (let attempts = 0; attempts < 9000 && state.rooms.some(room => room.product === input.product && room.code === code); attempts++) code = String(1000 + (Number(code) - 999) % 9000);
    return enter(input.product, code, true, input);
  }
  function leave() {
    ++entryEpoch;
    const room = state.room;
    disconnectRoom(); if (room) sessions.clear(room.product);
    desiredSeat = null; desiredSpectator = false; autoSeat = false; startSerial = 0; lastLaunchedSerial = -1;
    publish({ room: null, resource: null, launch: null, launchPending: false, error: null, errorCode: null });
    refresh();
  }
  function activeRoom(owner = false) {
    const room = state.room;
    if (!room?.synced || room.connection !== 'connected' || room.phase !== 'lobby') { fail('请等待房间连接完成，或等待本局结束', 'not-ready'); return null; }
    if (owner && room.localSeat !== 0) { fail('只有 P1 房主可以执行此操作', 'owner'); return null; }
    return room;
  }
  function takeSeat(index: number) {
    const room = activeRoom(); if (!room) return false;
    if (!Number.isInteger(index) || index < 0 || index >= room.playerCount || room.seats[index]) return fail('该玩家席位当前不可用', 'seat');
    if (!state.permissions.movementAllowed) return fail('本房间禁止作弊移动，请先调整移动模式', 'movement-policy');
    return send({ type: 'take-seat', seat: index, loadout: state.preferredLoadout, ready: false, name: state.displayName, ...movement() });
  }
  function setReady(ready: boolean) {
    const room = activeRoom(); if (!room || room.localSeat == null) return false;
    if (ready && !state.permissions.canReady) return fail(state.permissions.movementAllowed ? '游戏资源尚未验证就绪，请先完成资源检查' : '请先调整移动模式', state.permissions.movementAllowed ? 'resources' : 'movement-policy');
    return send({ type: 'set-ready', ready, ...movement() });
  }
  function setLoadout(loadout: number) {
    const room = activeRoom(); if (!room) return false;
    const policy = multiplayerConfigForProduct(room.product)!;
    if (!Number.isInteger(loadout) || loadout < 0 || loadout >= policy.loadouts.length) return fail('该机体配置不存在', 'loadout');
    preferences.persistPreferredLoadout(room.product, loadout); publish({ preferredLoadout: loadout });
    return room.localSeat == null || send({ type: 'set-loadout', loadout });
  }
  function setSettings(patch: Partial<RoomSettings>) {
    const room = activeRoom(true); if (!room) return false;
    const policy = multiplayerConfigForProduct(room.product)!;
    const next = { playerCount: room.playerCount, difficulty: room.difficulty, visibility: room.visibility, disableCheatMovement: room.disableCheatMovement, ...patch };
    if (!policy.playerCounts.includes(next.playerCount) || !Number.isInteger(next.difficulty) || next.difficulty < 0 || next.difficulty >= policy.difficulties.length || !['public', 'private'].includes(next.visibility)) return fail('无效的房间设置', 'settings');
    return send({ type: 'settings', ...next });
  }
  function kick(clientId: string) {
    const room = activeRoom(true); if (!room) return false;
    if (clientId === room.clientId) return fail('不能移除自己', 'kick');
    const index = room.seats.slice(0, room.playerCount).findIndex(seat => seat?.clientId === clientId);
    if (index > 0) return send({ type: 'remove-player', seat: index, clientId });
    if (room.spectators.some(entry => entry.clientId === clientId)) return send({ type: 'remove-spectator', clientId });
    return fail('该玩家已不在房间中', 'kick');
  }
  function setInputDelay(value: number | 'auto') {
    if (!activeRoom(true)) return false;
    if (value !== 'auto' && (!Number.isInteger(value) || value < 0 || value > 8)) return fail('输入延迟应为 0–8 帧', 'input-delay');
    publish({ inputDelay: value }); return true;
  }
  function requestStart() {
    const room = activeRoom(true); if (!room) return false;
    if (!state.permissions.canStart) return fail('请等待所有玩家连接并准备，且本机资源检查完成', 'not-ready');
    const timing = multiplayerConfigForProduct(room.product)!.inputTiming;
    const inputDelay = state.inputDelay === 'auto' ? state.network.recommendedDelay : state.inputDelay;
    return send({ type: 'start', ...(timing ? { inputDelay, ...(timing.sendPredictionLimit != null ? { predictionLimit: timing.sendPredictionLimit } : {}) } : {}) });
  }
  /** Caller must report the actual resource service result for this room/product. */
  function reportResources(progress: MultiplayerResourceProgress, product = state.room?.product, code = state.room?.code, generation = state.room?.generation) {
    if (!state.room || state.room.product !== product || state.room.code !== code || state.room.generation !== generation) return false;
    if (!['preparing', 'ready', 'failed', 'cancelled', 'importing'].includes(progress.status) || !['package', 'runtime'].includes(progress.stage) ||
      (progress.percent != null && (!Number.isFinite(progress.percent) || progress.percent < 0 || progress.percent > 100))) return fail('资源进度无效', 'resources');
    publish({ resource: { ...progress, percent: progress.status === 'ready' ? 100 : progress.percent } }); syncResourceReport();
    if (progress.status !== 'ready' && state.room.localSeat != null && state.room.seats[state.room.localSeat]?.ready) send({ type: 'set-ready', ready: false, ...movement() });
    return true;
  }
  function setDisplayName(value: string) {
    const result = identity.storeDisplayNameOnce(value, state.displayName);
    if (!result.stored) return fail(state.displayNameLocked ? '昵称已经确定，不能再次修改' : '请输入有效昵称', 'name');
    publish({ displayName: result.name, displayNameLocked: true });
    if (state.room && (state.room.localSeat != null || state.room.localSpectator)) send({ type: 'set-name', name: result.name });
    return true;
  }
  function releaseMembership() {
    if (!state.supportsRecovery || !state.mine?.recoveryToken || state.recovering || directorySocket?.readyState !== 1) return fail('当前无法释放房间，请重试连接', 'recovery');
    recoveredToken = state.mine.recoveryToken;
    try { directorySocket.send(JSON.stringify({ type: 'release-membership', recoveryToken: recoveredToken })); }
    catch (error) { return fail(messageFor(error), 'recovery'); }
    publish({ recovering: true });
    recoveryTimer = setTimeout(() => { publish({ recovering: false }); fail('释放房间超时，请刷新后重试', 'recovery'); }, 8000);
    return true;
  }
  function syncMovement() {
    publish({});
    const room = state.room;
    if (room?.synced && room.phase === 'lobby' && room.localSeat != null) return send({ type: 'movement', ...movement() });
    return false;
  }
  function notifyActivity() {
    if (Date.now() - activityAt < 30_000 || !state.room) return;
    if (send({ type: 'activity' })) activityAt = Date.now();
  }
  const onOffline = () => {
    disconnectDirectory(); disconnectRoom('network offline');
    publish({ connection: 'offline', ...(state.room ? { room: { ...state.room, synced: false, connection: 'reconnecting' as const } } : {}) });
  };
  const onOnline = () => { if (relay) { connectDirectory(); if (state.room && state.room.connection !== 'closed') connectRoom(true); } };
  const onVisibility = () => { if (typeof document !== 'undefined' && document.visibilityState === 'visible') { if (directorySocket?.readyState === 1) refresh(); else if (state.connection !== 'unsupported') connectDirectory(); if (state.room?.connection === 'reconnecting') connectRoom(true); } };
  if (typeof window !== 'undefined') { window.addEventListener('online', onOnline); window.addEventListener('offline', onOffline); }
  if (typeof document !== 'undefined') { document.addEventListener('visibilitychange', onVisibility); document.addEventListener('pointerdown', notifyActivity, true); document.addEventListener('keydown', notifyActivity, true); }
  return {
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    getSnapshot: () => state, getServerSnapshot: () => state,
    boot, configureManifest, connectDirectory, refresh, create,
    join: (product: MultiplayerProductId, code: string, input: { spectator?: boolean } = {}) => enter(product, code.trim(), false, undefined, input.spectator),
    restore: (product: MultiplayerProductId, code: string) => enter(product, code.trim(), false, undefined, false, true),
    leave, takeSeat,
    standUp() { const room = activeRoom(); return !!room && room.localSeat != null && send({ type: 'stand-up' }); },
    spectate() { const room = state.room; return !!room?.synced && send({ type: 'spectate', name: state.displayName }); },
    leaveSpectator() { return !!state.room?.localSpectator && send({ type: 'leave-spectator' }); },
    setReady, setLoadout, setSettings, setInputDelay, kick, setDisplayName, reportResources, requestStart, syncMovement,
    releaseMembership, clearError, notifyActivity,
    finishRun() { publish({ launch: null, launchPending: false }); updateProbes(); },
    retryLaunch() { if (!state.room || !state.launch) return false; const serial = state.launch.runId; lastLaunchedSerial = serial - 1; void launchRun(serial); return true; },
    retry() { if (!relay) return boot(); if (state.room && state.room.connection !== 'closed') { disconnectRoom('retry connection'); connectRoom(true); } connectDirectory(); },
    retryNetwork(peerId?: string) { network.retry(peerId); updateProbes(); publish({}); },
    dispose() {
      if (disposed) return;
      ++entryEpoch; ++bootEpoch; disconnectDirectory(); disconnectRoom('page closed'); disposed = true; listeners.clear();
      if (typeof window !== 'undefined') { window.removeEventListener('online', onOnline); window.removeEventListener('offline', onOffline); }
      if (typeof document !== 'undefined') { document.removeEventListener('visibilitychange', onVisibility); document.removeEventListener('pointerdown', notifyActivity, true); document.removeEventListener('keydown', notifyActivity, true); }
    },
  };
}
export type RoomService = ReturnType<typeof createRoomService>;
