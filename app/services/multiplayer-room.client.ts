/** One document-owned room control transport; relay snapshots commit membership.
 * Gameplay still uses the existing Runtime owner through an explicit port. */
import {gameIdForProduct, isMultiplayerProductId, multiplayerConfigForProduct, productEnabledForBuild, type MultiplayerProductId} from '../../src/contracts/product-catalog.mts';
import {HOST_MANIFEST_FILE, validateHostManifest} from '../../src/contracts/host-manifest.mts';
import {parseMeasuredNetplayTiming, resolveAdonisPredictionReserve, type MeasuredNetplayTiming} from '../../src/contracts/netplay-timing.mts';
import {buildMultiplayerGameplayRelayUrl, buildMultiplayerLobbyRelayUrl} from '../../src/launcher/multiplayer-relay-url.mts';
import {normalizeMultiplayerLobbySnapshot, type NormalizedMultiplayerLobbySnapshot, type MultiplayerResourceProgress} from '../../src/launcher/multiplayer-lobby-snapshot.mts';
import {createMultiplayerIdentityStore, multiplayerMemberId, type MultiplayerIdentityStore} from '../../src/launcher/multiplayer-identity.mts';
import {createMultiplayerRoomSessionStore, type MultiplayerRoomSessionStore} from '../../src/launcher/multiplayer-room-session.mts';
import {createMultiplayerPreferenceStore, type MultiplayerPreferenceStore} from '../../src/launcher/multiplayer-preferences.mts';
import {buildMultiplayerRuntimeOptions, type MultiplayerRuntimeOptions} from '../../src/launcher/multiplayer-runtime-options.mts';
import {recommendMultiplayerInputTiming} from '../../src/launcher/multiplayer-input-timing.mts';
import {createRoomNetwork, type ProbeLane, type ProbeMetric} from '../../src/launcher/room-network.mts';

import type {MultiplayerRoomRoute} from './multiplayer-room-route';
export {parseMultiplayerRoomRoute} from './multiplayer-room-route';
export type {MultiplayerRoomRoute} from './multiplayer-room-route';
export interface RoomInputSettings {movementMode: 'touch' | 'touch-unlimited' | 'joystick' | 'joystick-free'; touchEnabled: boolean; mobileDevice: boolean}
export interface RoomTimingChoice {readonly inputDelay: number | 'auto'; readonly rollback: boolean}
export interface RoomLaunchRequest {readonly productId: MultiplayerProductId; readonly roomCode: string; readonly serial: number; readonly options: MultiplayerRuntimeOptions}
export interface MultiplayerRoomRuntimePort {
  prepare(productId: MultiplayerProductId, signal: AbortSignal, progress: (value: MultiplayerResourceProgress) => void): Promise<void>;
  launch(request: RoomLaunchRequest, signal: AbortSignal): Promise<void>;
}
export interface RoomNetworkPeer {readonly clientId: string; readonly seat: number; readonly metrics: Readonly<Record<ProbeLane, ProbeMetric>>}
export interface MultiplayerRoomSnapshot {
  readonly route: MultiplayerRoomRoute | null;
  readonly connection: 'idle' | 'loading' | 'connecting' | 'connected' | 'reconnecting' | 'unavailable';
  readonly room: Readonly<NormalizedMultiplayerLobbySnapshot> | null;
  readonly clientId: string; readonly displayName: string; readonly nameLocked: boolean; readonly preferredLoadout: number;
  readonly input: Readonly<RoomInputSettings>; readonly timingChoice: RoomTimingChoice;
  readonly startSerial: number; readonly consumedIntent: boolean; readonly directorySupported: boolean; readonly controlModesSupported: boolean;
  readonly preparation: Readonly<MultiplayerResourceProgress> | null;
  readonly runtimeAvailable: boolean; readonly launch: 'idle' | 'starting' | 'running' | 'failed';
  readonly measuredTiming: MeasuredNetplayTiming | null; readonly peers: readonly RoomNetworkPeer[];
  readonly networkCapabilities: ReturnType<ReturnType<typeof createRoomNetwork>['capabilities']>;
  readonly pendingAction: string | null; readonly error: string | null; readonly notice: string | null;
}
export interface RoomSocket {
  readonly readyState: number; send(data: string): void; close(code?: number, reason?: string): void;
  addEventListener(type: 'open', callback: () => void): void;
  addEventListener(type: 'message', callback: (event: {data: unknown}) => void): void;
  addEventListener(type: 'close', callback: (event: {code: number}) => void): void;
  addEventListener(type: 'error', callback: () => void): void;
}
export interface MultiplayerRoomOptions {
  baseUrl: string; fetchImpl?: typeof fetch; createSocket?: (url: string) => RoomSocket;
  identity?: MultiplayerIdentityStore; sessions?: MultiplayerRoomSessionStore; preferences?: MultiplayerPreferenceStore;
  getMemberId?: () => string; runtime?: MultiplayerRoomRuntimePort;
  createNetwork?: typeof createRoomNetwork;
  timers?: {set(callback: () => void, ms: number): unknown; clear(handle: unknown): void};
  random?: () => number; now?: () => number;
}
export interface MultiplayerRoomController {
  subscribe(listener: () => void): () => void; getSnapshot(): MultiplayerRoomSnapshot;
  setRoute(route: MultiplayerRoomRoute | null): void; setInput(input: RoomInputSettings): void;
  setRuntimePort(port: MultiplayerRoomRuntimePort | undefined): void;
  retry(): void; noteActivity(): void; leave(): void; dispose(): void;
  setDisplayName(name: string): void; takeSeat(index: number): void; standUp(): void; spectate(): void; leaveSpectator(): void;
  setLoadout(index: number): void; setReady(ready: boolean): void;
  setRoomSettings(settings: {playerCount: 2 | 3; difficulty: number; visibility: 'public' | 'private'; disableCheatMovement: boolean}): void;
  removePlayer(seat: number, clientId: string): void; removeSpectator(clientId: string): void;
  setTimingChoice(choice: RoomTimingChoice): void; start(): void;
  prepare(): Promise<void>; cancelPreparation(): void; invalidatePreparation(): void; acceptMeasuredTiming(value: unknown, serial: number): boolean;
  retryNetwork(clientId?: string): void; runtimeExited(serial: number): void;
}
const record = (value: unknown): Record<string, unknown> | null => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
const terminalMessage: Record<number, string> = {4004: '房间因长时间无活动已关闭。', 4007: '房间已关闭或房间号已被使用，请返回大厅。', 4008: '此房间连接已被其他会话替换或释放。', 4009: '你已在另一个房间或标签页中，请先退出原房间。', 4010: '你已被房主移出房间。'};
const freezeRoom = (room: NormalizedMultiplayerLobbySnapshot): Readonly<NormalizedMultiplayerLobbySnapshot> => {
  for (const seat of room.seats) {if (seat?.resource) Object.freeze(seat.resource); if (seat) Object.freeze(seat);}
  room.spectators.forEach(Object.freeze); Object.freeze(room.seats); Object.freeze(room.spectators);
  if (room.timing) Object.freeze(room.timing);
  return Object.freeze(room);
};
export function createMultiplayerRoom(options: MultiplayerRoomOptions): MultiplayerRoomController {
  const identity = options.identity ?? createMultiplayerIdentityStore(), sessions = options.sessions ?? createMultiplayerRoomSessionStore();
  const preferences = options.preferences ?? createMultiplayerPreferenceStore();
  const fetchImpl = options.fetchImpl ?? fetch, makeSocket = options.createSocket ?? (url => new WebSocket(url));
  const timers = options.timers ?? {set: (callback: () => void, ms: number) => globalThis.setTimeout(callback, ms), clear: (handle: unknown) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>)};
  const random = options.random ?? Math.random, now = options.now ?? Date.now;
  const listeners = new Set<() => void>(), pending = new Map<string, unknown>();
  let runtime = options.runtime, disposed = false, epoch = 0, connectionSerial = 0, retries = 0, lastActivity = 0;
  let socket: RoomSocket | null = null, hostRequest: AbortController | null = null, preparationRequest: AbortController | null = null, launchRequest: AbortController | null = null;
  let prepareTask: Promise<void> | null = null, relay = '', memberId = '', intent: 'create' | 'join' = 'join';
  let requestedSeat: number | null = null, restoreSpectator = false, autoSeat = false;
  let creation = {playerCount: 2 as 2 | 3, difficulty: 1, visibility: 'public' as 'public' | 'private', disableCheatMovement: false};
  let state: MultiplayerRoomSnapshot = Object.freeze({route: null, connection: 'idle', room: null, clientId: '', displayName: '', nameLocked: false, preferredLoadout: 0,
    input: Object.freeze({movementMode: 'joystick', touchEnabled: false, mobileDevice: false}), timingChoice: Object.freeze({inputDelay: 'auto', rollback: false}),
    startSerial: 0, consumedIntent: false, directorySupported: false, controlModesSupported: false, preparation: null, runtimeAvailable: !!runtime,
    launch: 'idle', measuredTiming: null, peers: Object.freeze([]), networkCapabilities: {supported: false, rtcAvailable: false, turnConfigured: false}, pendingAction: null, error: null, notice: null});
  function update(patch: Partial<MultiplayerRoomSnapshot>) {if (disposed) return; state = Object.freeze({...state, ...patch}); for (const listener of listeners) listener();}
  const network = (options.createNetwork ?? createRoomNetwork)({send, changed: () => {
    if (disposed || !state.route) return;
    const peers = (state.room?.seats.slice(0, state.room.playerCount) ?? []).flatMap((seat, index) => seat && seat.clientId !== state.clientId ? [Object.freeze({clientId: seat.clientId, seat: index,
      metrics: Object.freeze({direct: network.metric(seat.clientId, 'direct'), turn: network.metric(seat.clientId, 'turn'), relay: network.metric(seat.clientId, 'relay')})})] : []);
    update({peers: Object.freeze(peers), networkCapabilities: network.capabilities()});
  }});
  function clear(name: string) {if (pending.has(name)) {timers.clear(pending.get(name)); pending.delete(name);}}
  function later(name: string, delay: number, callback: () => void) {
    clear(name); const ticket = epoch;
    pending.set(name, timers.set(() => {pending.delete(name); if (!disposed && state.route && ticket === epoch) callback();}, delay));
  }
  function closeTransport(reason: string, preserveMinimum = false) {
    connectionSerial++;
    for (const name of ['reconnect', 'handshake', 'action']) clear(name);
    const previous = socket; socket = null;
    network.reset(preserveMinimum);
    if (previous && previous.readyState < 2) {try {previous.close(1000, reason);} catch {}}
  }
  function persist() {
    const route = state.route, room = state.room; if (!route || !room) return;
    sessions.save(route.productId, {room: {code: route.roomCode, playerCount: room.playerCount, difficulty: room.difficulty, visibility: room.visibility, disableCheatMovement: room.disableCheatMovement, created: false},
      seat: room.localSeat, ready: room.localSeat != null && !!room.seats[room.localSeat]?.ready, spectatorRequested: room.localSpectator, roomSettingsOpen: false});
  }
  function reset(clearSession: boolean, reason: string) {
    const route = state.route; epoch++;
    for (const name of pending.keys()) clear(name);
    hostRequest?.abort(); hostRequest = null; preparationRequest?.abort(); preparationRequest = null; prepareTask = null;
    launchRequest?.abort(); launchRequest = null;
    closeTransport(reason); retries = 0; relay = ''; requestedSeat = null; restoreSpectator = false; autoSeat = false;
    if (clearSession && route) sessions.clear(route.productId);
  }
  function send(message: Record<string, unknown>): boolean {
    if (disposed || !state.route || !socket || socket.readyState !== 1) return false;
    try {socket.send(JSON.stringify(message)); return true;}
    catch {transportFailed('房间连接已中断，正在重新连接。'); return false;}
  }
  function syncNetwork() {
    const room = state.room;
    network.update({localId: state.clientId, peers: room?.seats.slice(0, room.playerCount).filter(seat => seat && !seat.offline).map(seat => seat!.clientId) ?? [],
      active: state.connection === 'connected' && room?.localSeat != null && room.phase === 'lobby' && state.launch !== 'running'});
    update({networkCapabilities: network.capabilities()});
  }
  function transportFailed(message: string, terminal = false) {
    if (disposed || !state.route) return;
    closeTransport('reconnect room', true);
    update({connection: terminal ? 'unavailable' : 'reconnecting', pendingAction: null, error: message});
    if (!terminal) later('reconnect', Math.min(5000, 650 * 2 ** Math.min(retries++, 3)) + Math.floor(random() * 250), () => relay ? connect() : void boot());
  }
  function action(message: Record<string, unknown>) {
    if (!send(message)) throw Error('房间尚未连接，请稍后重试。');
    update({pendingAction: String(message.type), error: null});
    later('action', 8000, () => update({pendingAction: null, error: '服务器尚未确认该操作，请检查最新房间状态。'}));
  }
  function connected(lobbyOnly = true) {
    if (disposed || state.connection !== 'connected' || !state.route || !state.room) throw Error('请等待服务器同步房间。');
    if (lobbyOnly && state.room.phase !== 'lobby') throw Error('本局已开始，请等待返回房间后操作。');
    return state.room;
  }
  function seated() {const room = connected(); if (room.localSeat == null) throw Error('请先选择玩家席位。'); return room;}
  function host() {const room = seated(); if (room.localSeat !== 0) throw Error('只有 P1 房主可以执行此操作。'); return room;}
  function movementAllowed(room: Readonly<NormalizedMultiplayerLobbySnapshot>) {
    if (room.disableCheatMovement && state.input.movementMode === 'touch-unlimited') throw Error('此房间禁用无限移动，请先在触屏设置中切换为普通触摸或轮盘。');
  }
  function movement() {return {movementMode: state.input.movementMode, touchEnabled: state.input.touchEnabled, mobileDevice: state.input.mobileDevice || state.input.touchEnabled};}
  function takeSeat(index: number) {
    const room = connected(); movementAllowed(room);
    if (!Number.isInteger(index) || index < 0 || index >= room.playerCount) throw Error('玩家席位无效。');
    if (room.seats[index] && room.seats[index]?.clientId !== state.clientId) throw Error('此席位已经有人，请选择空位。');
    if (room.localSeat === index) return;
    action({type: 'take-seat', seat: index, loadout: state.preferredLoadout, name: state.displayName, ...movement()});
  }
  function reportProgress(value: MultiplayerResourceProgress) {
    if (!state.route || disposed) return;
    update({preparation: Object.freeze({...value})});
    if (state.room?.localSeat != null) send({type: 'resource-progress', ...value});
  }
  function connect() {
    closeTransport('replace lobby socket', true);
    if (disposed || !state.route || !relay) return;
    const route = state.route, connection = connectionSerial, ticket = epoch;
    const reconnecting = state.consumedIntent;
    update({connection: reconnecting ? 'reconnecting' : 'connecting', pendingAction: null, error: null});
    if (disposed || !state.route || ticket !== epoch) return;
    let next: RoomSocket;
    try {
      next = makeSocket(buildMultiplayerLobbyRelayUrl(relay, {product: route.productId, roomCode: route.roomCode, clientId: state.clientId, memberId,
        intent, ...creation}).url);
    } catch (error) {transportFailed(error instanceof Error ? error.message : '无法连接房间。'); return;}
    socket = next;
    const current = () => !disposed && state.route?.productId === route.productId && state.route.roomCode === route.roomCode && socket === next && connectionSerial === connection && epoch === ticket;
    let firstState = true;
    later('handshake', 20_000, () => {if (current()) transportFailed('等待房间状态超时，正在重连。');});
    next.addEventListener('open', () => {if (current()) update({connection: reconnecting ? 'reconnecting' : 'connecting'});});
    next.addEventListener('message', event => {
      if (!current()) return;
      let message: Record<string, unknown> | null; try {message = record(JSON.parse(String(event.data)));} catch {return;}
      if (!message) return;
      if (message.type === 'room-probe' || message.type === 'room-probe-config') {void network.receive(message); return;}
      if (message.type === 'error') {update({error: typeof message.error === 'string' ? message.error : '房间操作失败。', pendingAction: null}); clear('action'); return;}
      if (!['state', 'start', 'spectator-start'].includes(String(message.type))) return;
      if (message.type !== 'state') {
        const eventSerial = Number(message.serial);
        if (!Number.isSafeInteger(eventSerial) || eventSerial < 1 || eventSerial < state.startSerial || message.type === 'start' && eventSerial === state.startSerial) return;
      }
      const policy = multiplayerConfigForProduct(route.productId)!;
      const normalized = normalizeMultiplayerLobbySnapshot(message.room, {localClientId: state.clientId, playerCounts: policy.playerCounts, difficulties: policy.difficulties, loadouts: policy.loadouts});
      if (!normalized) return;
      clear('handshake'); clear('action'); retries = 0;
      const serverSerial = Number(record(message.room)?.startSerial);
      const returnedToLobby = normalized.phase === 'lobby' && state.room?.phase !== 'lobby';
      const startSerial = message.type === 'state' && firstState && Number.isInteger(serverSerial) && serverSerial >= 0 ? serverSerial : state.startSerial;
      intent = 'join';
      update({connection: 'connected', room: freezeRoom(normalized), consumedIntent: true, startSerial, pendingAction: null, error: null,
        ...(returnedToLobby ? {launch: 'idle' as const, measuredTiming: null} : {}),
        directorySupported: state.directorySupported || record(message.roomDirectory)?.version === 1, controlModesSupported: state.controlModesSupported || record(message.roomDirectory)?.controlModes === true,
        ...(normalized.localSeat != null ? {preferredLoadout: normalized.seats[normalized.localSeat]!.loadout} : {})});
      const probe = record(message.roomProbe); if (probe) void network.receive({type: 'room-probe-config', iceServers: probe.iceServers});
      if (firstState) {
        firstState = false;
        if (normalized.localSeat == null && !normalized.localSpectator && normalized.phase === 'lobby') {
          const requested = requestedSeat;
          const empty = autoSeat ? normalized.seats.slice(0, normalized.playerCount).findIndex(seat => !seat) : -1;
          requestedSeat = null; autoSeat = false;
          try {
            if (requested != null && requested < normalized.playerCount && !normalized.seats[requested]) takeSeat(requested);
            else if (empty >= 0) takeSeat(empty);
            else if (restoreSpectator) action({type: 'spectate', name: state.displayName});
          } catch (error) {update({error: error instanceof Error ? error.message : String(error)});}
        }
        restoreSpectator = false;
      }
      if (normalized.localSeat != null && state.preparation) send({type: 'resource-progress', ...state.preparation});
      persist(); syncNetwork();
      if (message.type === 'start' || message.type === 'spectator-start') {
        const serial = Number(message.serial);
        if (Number.isInteger(serial) && (serial > state.startSerial || message.type === 'spectator-start' && serial === state.startSerial && normalized.localSpectator)) {
          update({startSerial: serial, measuredTiming: null});
          if (normalized.localSeat != null || normalized.localSpectator) void launch(serial);
        }
      }
    });
    next.addEventListener('close', event => {if (current()) transportFailed(terminalMessage[event.code] ?? '房间连接中断，正在重新连接。', event.code in terminalMessage);});
    next.addEventListener('error', () => {if (current()) transportFailed('房间连接失败，正在重新连接。');});
  }
  async function boot() {
    hostRequest?.abort(); clear('host');
    if (!state.route || disposed) return;
    const route = state.route, ticket = epoch, request = new AbortController(); hostRequest = request;
    update({connection: 'loading', error: null});
    if (disposed || ticket !== epoch) return;
    later('host', 10_000, () => {if (hostRequest === request) {request.abort(); hostRequest = null; transportFailed('读取联机服务配置超时。');}});
    try {
      const response = await fetchImpl(new URL(HOST_MANIFEST_FILE, options.baseUrl), {cache: 'no-store', signal: request.signal});
      if (!response.ok) throw Error(`读取联机服务配置失败（${response.status}）`);
      const manifest = validateHostManifest(await response.json());
      if (disposed || request.signal.aborted || ticket !== epoch || hostRequest !== request) return;
      clear('host'); hostRequest = null;
      if (!productEnabledForBuild(route.productId, manifest.shared.testBuild) || !manifest.games[gameIdForProduct(route.productId)]) throw Error('此作品在当前站点不可用。');
      relay = manifest.shared.netplayRelay ?? '';
      if (!relay) {update({connection: 'unavailable', error: '此站点尚未配置联机服务。'}); return;}
      connect();
    } catch (error) {
      if (disposed || request.signal.aborted || ticket !== epoch) return;
      clear('host'); transportFailed(error instanceof Error ? error.message : '无法读取联机配置。');
    }
  }
  async function prepare() {
    if (prepareTask) return prepareTask;
    if (!state.route || disposed) throw Error('请先加入房间。');
    if (!runtime) throw Error('多人 Runtime 资源准备与启动尚未接入。');
    if (state.preparation?.status === 'ready') return;
    const route = state.route, ticket = epoch, port = runtime, request = new AbortController(); preparationRequest = request;
    reportProgress({status: 'preparing', stage: 'package', percent: null});
    const current = () => !disposed && ticket === epoch && preparationRequest === request && !request.signal.aborted;
    const task = Promise.resolve().then(() => {if (current()) return port.prepare(route.productId, request.signal, value => {if (current()) reportProgress(value);});}).then(() => {
      if (current()) reportProgress({status: 'ready', stage: 'runtime', percent: 100});
    }).catch(error => {
      if (current()) {reportProgress({status: 'failed', stage: state.preparation?.stage ?? 'package', percent: null}); update({error: error instanceof Error ? error.message : String(error)});}
    }).finally(() => {if (preparationRequest === request) {preparationRequest = null; prepareTask = null;}});
    prepareTask = task; return task;
  }
  async function launch(serial: number) {
    if (state.launch === 'starting' || state.launch === 'running') return;
    if (!runtime) {update({launch: 'failed', error: '服务器已开始本局，但当前界面尚未连接多人 Runtime 启动器。'}); return;}
    const route = state.route, room = state.room;
    if (!route || !room || room.phase === 'lobby') return;
    const ticket = epoch, port = runtime, request = new AbortController(); launchRequest?.abort(); launchRequest = request;
    update({launch: 'starting', error: null});
    try {
      await prepare();
      if (disposed || ticket !== epoch || request.signal.aborted || state.startSerial !== serial) return;
      if (state.preparation?.status !== 'ready') throw Error('联机资源尚未准备完成。');
      const policy = multiplayerConfigForProduct(route.productId)!, spectator = room.localSeat == null && room.localSpectator;
      if (!spectator) movementAllowed(room);
      const url = buildMultiplayerGameplayRelayUrl(relay, {product: route.productId, roomCode: route.roomCode, runId: serial,
        role: spectator ? {spectator: state.clientId} : {player: room.localSeat!}});
      const runtimeOptions = buildMultiplayerRuntimeOptions({url, player: spectator ? null : room.localSeat, playerCount: room.playerCount,
        seed: Number.parseInt(route.roomCode, 10) & 0xffff, difficulty: room.difficulty, inputDelay: room.inputDelay, inputDelayAuto: room.inputDelayAuto,
        predictionReserve: policy.inputTiming?.measuredStartup ? room.predictionReserve : undefined, adonisMode: room.adonisMode, predictionLimit: room.predictionLimit,
        spectator, spectatorId: state.clientId, spectatorCount: room.spectatorCount, iceServers: [],
        loadouts: room.seats.slice(0, room.playerCount).map(seat => {const loadout = seat && policy.loadouts[seat.loadout]; if (!loadout) throw Error('服务器未提供完整的玩家机体配置。'); return {character: loadout.character, shot: loadout.shot};}),
      }, policy);
      await port.launch({productId: route.productId, roomCode: route.roomCode, serial, options: runtimeOptions}, request.signal);
      if (!disposed && ticket === epoch && !request.signal.aborted && state.startSerial === serial) update({launch: 'running'});
    } catch (error) {if (!disposed && ticket === epoch && !request.signal.aborted) update({launch: 'failed', error: error instanceof Error ? error.message : String(error)});}
    finally {if (launchRequest === request) launchRequest = null;}
  }
  return Object.freeze<MultiplayerRoomController>({
    subscribe(listener) {listeners.add(listener); return () => {listeners.delete(listener);};}, getSnapshot: () => state,
    setRoute(route) {
      if (disposed) return;
      if (route?.productId === state.route?.productId && route?.roomCode === state.route?.roomCode) return;
      reset(true, 'leave room');
      if (!route) {update({route: null, room: null, connection: 'idle', peers: Object.freeze([]), pendingAction: null, preparation: null, launch: 'idle'}); return;}
      const policy = multiplayerConfigForProduct(route.productId)!;
      const query = new URLSearchParams(route.search), created = query.get('fromLobby') === '1' && query.get('lobbyAction') === 'create';
      const saved = sessions.load({product: route.productId, roomCode: route.roomCode, playerCounts: policy.playerCounts, difficulties: policy.difficulties});
      const requestedCount = Number(query.get('lobbyPlayers')) as 2 | 3;
      creation = {playerCount: saved?.room.playerCount ?? (created && policy.playerCounts.includes(requestedCount) ? requestedCount : policy.playerCounts[0]),
        difficulty: saved?.room.difficulty ?? (created ? Math.max(0, Math.min(policy.difficulties.length - 1, Math.trunc(Number(query.get('lobbyDifficulty')) || 0))) : Math.min(1, policy.difficulties.length - 1)),
        visibility: saved?.room.visibility ?? (query.get('lobbyVisibility') === 'private' ? 'private' : 'public'),
        disableCheatMovement: saved?.room.disableCheatMovement ?? query.get('lobbyDisableCheatMovement') === '1'};
      intent = created ? 'create' : 'join'; requestedSeat = saved?.seat ?? (created ? 0 : null); restoreSpectator = saved?.spectatorRequested ?? false;
      autoSeat = !saved && query.get('fromLobby') === '1' && !created;
      memberId ||= (options.getMemberId ?? multiplayerMemberId)();
      const savedPrefs = preferences.load({product: route.productId, multiplayer: true, maxLoadout: policy.loadouts.length});
      const displayName = identity.loadDisplayName();
      update({route, connection: 'loading', room: null, clientId: identity.lobbyClientId(route.productId), displayName, nameLocked: identity.displayNameLocked(displayName),
        preferredLoadout: savedPrefs.preferredLoadout ?? 0, timingChoice: Object.freeze({inputDelay: 'auto', rollback: false}), startSerial: 0, consumedIntent: false,
        directorySupported: false, controlModesSupported: false, peers: Object.freeze([]), preparation: null, launch: 'idle', measuredTiming: null, pendingAction: null, error: null, notice: null});
      void boot();
    },
    setInput(input) {
      if (disposed || !['touch', 'touch-unlimited', 'joystick', 'joystick-free'].includes(input.movementMode)) return;
      if (JSON.stringify(state.input) === JSON.stringify(input)) return;
      update({input: Object.freeze({...input})});
      if (state.connection === 'connected' && state.room?.localSeat != null && state.room.phase === 'lobby') send({type: 'movement', ...movement()});
    },
    setRuntimePort(port) {
      if (disposed || runtime === port) return;
      preparationRequest?.abort(); preparationRequest = null; prepareTask = null;
      launchRequest?.abort(); launchRequest = null;
      if (state.room?.localSeat != null && state.room.phase === 'lobby' && state.room.seats[state.room.localSeat]?.ready) send({type: 'set-ready', ready: false, ...movement()});
      runtime = port; update({runtimeAvailable: !!port, preparation: null});
    },
    retry() {if (disposed || !state.route) return; retries = 0; if (relay) connect(); else void boot();},
    noteActivity() {if (!state.directorySupported || now() - lastActivity < 15_000) return; if (send({type: 'activity'})) lastActivity = now();},
    leave() {if (disposed) return; reset(true, 'leave room'); update({route: null, room: null, connection: 'idle', preparation: null, launch: 'idle', peers: Object.freeze([]), pendingAction: null});},
    dispose() {if (disposed) return; persist(); reset(false, 'suspend room'); disposed = true; listeners.clear();},
    setDisplayName(name) {
      if (disposed || !state.route) throw Error('请先加入房间。');
      if (identity.displayNameLocked(state.displayName)) throw Error('联机昵称设置后不能更改。');
      const result = identity.storeDisplayNameOnce(name, state.displayName);
      if (!result.stored || !result.name) throw Error('请输入有效的联机昵称。');
      update({displayName: result.name, nameLocked: true});
      if (state.room?.localSeat != null || state.room?.localSpectator) action({type: 'set-name', name: result.name});
    },
    takeSeat, standUp() {seated(); action({type: 'stand-up'});},
    spectate() {const room = connected(false); if (room.localSpectator) return; action({type: 'spectate', name: state.displayName});},
    leaveSpectator() {const room = connected(false); if (!room.localSpectator) return; action({type: 'leave-spectator'});},
    setLoadout(index) {
      const room = connected(), policy = multiplayerConfigForProduct(state.route!.productId)!;
      if (!Number.isInteger(index) || index < 0 || index >= policy.loadouts.length) throw Error('机体配置无效。');
      preferences.persistPreferredLoadout(state.route!.productId, index);
      if (room.localSeat != null) action({type: 'set-loadout', loadout: index});
      else update({preferredLoadout: index});
    },
    setReady(ready) {
      const room = seated();
      if (ready) {movementAllowed(room); if (!runtime || state.preparation?.status !== 'ready') throw Error('请先完成多人资源准备，再确认准备。');}
      action({type: 'set-ready', ready, ...movement()});
    },
    setRoomSettings(settings) {
      host(); const policy = multiplayerConfigForProduct(state.route!.productId)!;
      if (!policy.playerCounts.includes(settings.playerCount) || !Number.isInteger(settings.difficulty) || settings.difficulty < 0 || settings.difficulty >= policy.difficulties.length || !['public', 'private'].includes(settings.visibility)) throw Error('房间设置无效。');
      action({type: 'settings', ...settings});
    },
    removePlayer(index, clientId) {const room = host(); if (!Number.isInteger(index) || index < 1 || index >= room.playerCount || room.seats[index]?.clientId !== clientId) throw Error('玩家席位已变化，请重新检查。'); action({type: 'remove-player', seat: index, clientId});},
    removeSpectator(clientId) {const room = host(); if (!room.spectators.some(item => item.clientId === clientId)) throw Error('观战列表已变化，请重新检查。'); action({type: 'remove-spectator', clientId});},
    setTimingChoice(choice) {
      host(); const policy = multiplayerConfigForProduct(state.route!.productId)!;
      if (!policy.inputTiming) throw Error('此作品不支持手动房间输入时序。');
      const measured = policy.inputTiming.measuredStartup === true;
      if (typeof choice.rollback !== 'boolean' || choice.rollback && !measured || choice.inputDelay !== 'auto' && (!Number.isInteger(choice.inputDelay) || choice.inputDelay < 0 || choice.inputDelay > (measured ? 9 : 8))) throw Error('输入时序设置无效。');
      update({timingChoice: Object.freeze({...choice})});
    },
    start() {
      const room = host(); movementAllowed(room);
      if (!runtime || state.preparation?.status !== 'ready') throw Error('多人 Runtime 尚未准备完成。');
      if (room.seats.slice(0, room.playerCount).some(seat => !seat || seat.offline || !seat.ready)) throw Error('所有玩家入座、在线并准备后才能开始。');
      const policy = multiplayerConfigForProduct(state.route!.productId)!;
      const timing = policy.inputTiming;
      if (!timing) {action({type: 'start'}); return;}
      const measured = timing.measuredStartup === true, choice = state.timingChoice;
      const mobileSeats = room.seats.slice(0, room.playerCount).filter(seat => seat?.mobileDevice).length;
      const peers = room.seats.slice(0, room.playerCount).flatMap(seat => seat && seat.clientId !== state.clientId && !seat.offline ? [seat.clientId] : []);
      const inputDelay = choice.inputDelay === 'auto' ? measured ? 0 : recommendMultiplayerInputTiming(mobileSeats, network.minimumRtt(peers), 0, timing.rollbackLimit).inputDelay : choice.inputDelay;
      action({type: 'start', inputDelay, ...(measured ? {adonisMode: choice.rollback ? 2 : 1, inputDelayAuto: choice.inputDelay === 'auto', predictionReserve: 2} : {}),
        ...(timing.sendPredictionLimit != null ? {predictionLimit: timing.sendPredictionLimit} : {})});
    },
    prepare,
    invalidatePreparation() {
      if (disposed) return;
      preparationRequest?.abort(); preparationRequest = null; prepareTask = null;
      if (state.room?.localSeat != null && state.room.phase === 'lobby' && state.room.seats[state.room.localSeat]?.ready) send({type: 'set-ready', ready: false, ...movement()});
      update({preparation: null});
    },
    cancelPreparation() {
      if (!preparationRequest) return;
      preparationRequest.abort(); preparationRequest = null; prepareTask = null;
      if (state.room?.localSeat != null) send({type: 'set-ready', ready: false, ...movement()});
      reportProgress({status: 'cancelled', stage: state.preparation?.stage ?? 'package', percent: null});
    },
    acceptMeasuredTiming(value, serial) {
      const room = state.room, timing = parseMeasuredNetplayTiming(value);
      if (!timing || !room || !state.route || serial !== state.startSerial || room.phase === 'lobby' || !multiplayerConfigForProduct(state.route.productId)?.inputTiming?.measuredStartup ||
        timing.adonisMode !== room.adonisMode || timing.automatic !== (room.inputDelayAuto ?? false) ||
        timing.predictionReserve !== (timing.adonisMode === 2 ? resolveAdonisPredictionReserve(timing.fullDelay, room.predictionReserve ?? 2, timing.automatic) : 0) ||
        !timing.automatic && timing.inputDelay !== room.inputDelay || state.measuredTiming && JSON.stringify(state.measuredTiming) !== JSON.stringify(timing)) return false;
      update({measuredTiming: Object.freeze(timing)});
      if (room.localSeat === 0 && timing.route !== 'spectator') send({type: 'timing-result', serial, timing});
      return true;
    },
    runtimeExited(serial) {if (!disposed && serial === state.startSerial) {update({launch: 'idle'}); syncNetwork();}},
    retryNetwork(clientId) {connected(); network.retry(clientId); syncNetwork();},
  });
}
