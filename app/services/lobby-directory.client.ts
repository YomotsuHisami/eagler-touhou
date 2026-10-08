/** Read-only room discovery. The existing relay remains the only room authority;
 * creating/joining here produces an intent for the room route, never a room socket.
 */
import {PRODUCT_IDS, gameIdForProduct, isMultiplayerProductId, multiplayerConfigForProduct, productEnabledForBuild, type MultiplayerProductId} from '../../src/contracts/product-catalog.mts';
import {HOST_MANIFEST_FILE, validateHostManifest} from '../../src/contracts/host-manifest.mts';
import {buildMultiplayerDiagnosticRelayUrl, buildMultiplayerDirectoryRelayUrl} from '../../src/launcher/multiplayer-relay-url.mts';
import {createMultiplayerIdentityStore, multiplayerControlMode, multiplayerMemberId, type MultiplayerIdentityStore} from '../../src/launcher/multiplayer-identity.mts';
import {createMultiplayerRoomSessionStore, type MultiplayerRoomSessionStore} from '../../src/launcher/multiplayer-room-session.mts';

export type LobbyConnection = 'idle' | 'loading' | 'live' | 'offline' | 'unsupported' | 'missing';
export interface LobbySeat {readonly initial: string; readonly ready: boolean; readonly online: boolean; readonly controlMode: ReturnType<typeof multiplayerControlMode>}
export interface LobbyRoom {
  readonly product: MultiplayerProductId; readonly code: string; readonly capacity: 2 | 3;
  readonly players: number; readonly ready: number; readonly difficulty: number; readonly spectators: number;
  readonly phase: 'lobby' | 'playing'; readonly joinable: boolean; readonly seats: readonly (LobbySeat | null)[];
  readonly disableCheatMovement: boolean;
  readonly challengeMode: boolean;
}
export interface LobbyMembership {readonly product: MultiplayerProductId; readonly code: string; readonly recoveryToken: string}
export interface LobbyDirectorySnapshot {
  readonly active: boolean; readonly connection: LobbyConnection;
  readonly diagnosticRelayUrl: string | null;
  readonly products: readonly MultiplayerProductId[]; readonly selectedProduct: MultiplayerProductId | '';
  readonly rooms: readonly LobbyRoom[]; readonly loadedProduct: string | null; readonly total: number;
  readonly mine: LobbyMembership | null; readonly supportsRecovery: boolean; readonly recovering: boolean;
  readonly notice: string | null; readonly error: string | null;
}
export interface LobbyRoomIntent {
  readonly productId: MultiplayerProductId; readonly roomCode: string; readonly action: 'create' | 'join'; readonly href: string;
}
export interface LobbyCreateInput {
  productId: MultiplayerProductId; playerCount: 2 | 3; difficulty: number;
  visibility: 'public' | 'private'; disableCheatMovement: boolean; challengeMode?: boolean;
}
export interface LobbySocket {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: 'message', callback: (event: {data: unknown}) => void): void;
  addEventListener(type: 'close', callback: (event: {code: number}) => void): void;
  addEventListener(type: 'error', callback: () => void): void;
}
export interface LobbyDirectoryOptions {
  baseUrl: string; fetchImpl?: typeof fetch; createSocket?: (url: string) => LobbySocket;
  getMemberId?: () => string; identity?: Pick<MultiplayerIdentityStore, 'lobbyClientId'>;
  sessions?: Pick<MultiplayerRoomSessionStore, 'save' | 'clear'>; randomWord?: () => number;
  timers?: {set(callback: () => void, ms: number): unknown; clear(handle: unknown): void};
}
export interface LobbyDirectoryController {
  subscribe(callback: () => void): () => void;
  getSnapshot(): LobbyDirectorySnapshot;
  setActive(active: boolean, product?: string): void;
  refresh(): void; retry(): void; networkChanged(): void;
  releaseMembership(): boolean;
  createRoomIntent(input: LobbyCreateInput): LobbyRoomIntent;
  joinRoomIntent(productId: MultiplayerProductId, code: string, listed?: boolean): LobbyRoomIntent;
  dispose(): void;
}
const record = (value: unknown): Record<string, unknown> | null => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
const bounded = (value: unknown, max: number) => Math.max(0, Math.min(max, Math.trunc(Number(value) || 0)));
const validCode = (value: unknown): value is string => typeof value === 'string' && /^\d{4,8}$/.test(value);
export function parseLobbyRoom(value: unknown, products: readonly MultiplayerProductId[]): LobbyRoom | null {
  const row = record(value);
  if (!row || typeof row.product !== 'string' || !isMultiplayerProductId(row.product) || !products.includes(row.product) || !validCode(row.code)) return null;
  const policy = multiplayerConfigForProduct(row.product)!;
  const capacity = Number(row.capacity) as 2 | 3;
  if (!policy.playerCounts.includes(capacity)) return null;
  const input = Array.isArray(row.seats) ? row.seats : Array.isArray(row.initials) ? row.initials : [];
  const seats = Object.freeze(Array.from({length: capacity}, (_, index): LobbySeat | null => {
    const value = input[index];
    if (value == null) return null;
    const seat = record(value);
    return Object.freeze({initial: [...String(seat?.initial ?? value).replace(/[\u0000-\u001f\u007f]/g, '').trim()][0] || '?',
      ready: seat?.ready === true, online: seat?.online !== false, controlMode: multiplayerControlMode(seat?.controlMode)});
  }));
  return Object.freeze({product: row.product, code: row.code, capacity, seats, players: seats.filter(Boolean).length,
    ready: bounded(row.ready, capacity), spectators: bounded(row.spectators, 999), difficulty: bounded(row.difficulty, policy.difficulties.length - 1),
    phase: row.phase === 'lobby' ? 'lobby' : 'playing', joinable: row.joinable === true, disableCheatMovement: row.disableCheatMovement === true,
    challengeMode: policy.gameplay === 'cooperative' && row.challengeMode === true});
}
export function lobbyRoomState(room: LobbyRoom): 'recruiting' | 'full' | 'playing' {
  return room.phase !== 'lobby' ? 'playing' : room.players >= room.capacity ? 'full' : 'recruiting';
}

export function createLobbyDirectory(options: LobbyDirectoryOptions): LobbyDirectoryController {
  const fetchImpl = options.fetchImpl ?? fetch;
  const createSocket = options.createSocket ?? (url => new WebSocket(url));
  const identity = options.identity ?? createMultiplayerIdentityStore();
  const sessions = options.sessions ?? createMultiplayerRoomSessionStore();
  const randomWord = options.randomWord ?? (() => crypto.getRandomValues(new Uint32Array(1))[0]);
  const timers = options.timers ?? {set: (callback: () => void, ms: number) => globalThis.setTimeout(callback, ms), clear: (handle: unknown) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>)};
  const listeners = new Set<() => void>();
  const pending = new Map<string, unknown>();
  let state: LobbyDirectorySnapshot = Object.freeze({active: false, connection: 'idle', diagnosticRelayUrl: null, products: Object.freeze([]), selectedProduct: '', rooms: Object.freeze([]), loadedProduct: null, total: 0, mine: null, supportsRecovery: false, recovering: false, notice: null, error: null});
  let disposed = false, serial = 0, relay = '', memberId = '', retryCount = 0, requestedProduct = '';
  let manifestRequest: AbortController | null = null, socket: LobbySocket | null = null, recovering: LobbyMembership | null = null;
  function update(patch: Partial<LobbyDirectorySnapshot>) {
    if (disposed) return;
    state = Object.freeze({...state, ...patch});
    for (const listener of listeners) listener();
  }
  function clear(name: string) {
    if (pending.has(name)) {timers.clear(pending.get(name)); pending.delete(name);}
  }
  function later(name: string, ms: number, callback: () => void) {
    clear(name);
    const ticket = serial;
    pending.set(name, timers.set(() => {
      pending.delete(name);
      if (!disposed && state.active && ticket === serial) callback();
    }, ms));
  }
  function disconnect() {
    serial++;
    for (const name of pending.keys()) clear(name);
    manifestRequest?.abort(); manifestRequest = null;
    recovering = null;
    const previous = socket; socket = null;
    if (previous && previous.readyState < 2) {try {previous.close(1000, 'leave directory');} catch {}}
  }
  function scheduleReconnect() {
    if (!state.active || disposed || state.connection === 'unsupported') return;
    later('reconnect', Math.min(20_000, 1500 * 2 ** Math.min(retryCount++, 4)), () => relay ? connect() : void boot());
  }
  function fail(error: string, next: LobbyConnection = 'offline') {
    const interruptedRecovery = !!recovering;
    disconnect();
    update({connection: next, recovering: false, error, ...(interruptedRecovery ? {notice: '释放未获确认，请重新检查当前房间。'} : {})});
    scheduleReconnect();
  }
  function requestList() {
    if (!state.active || disposed || !socket || socket.readyState !== 1) return;
    const owner = socket;
    requestedProduct = state.selectedProduct;
    try {owner.send(JSON.stringify({type: 'refresh', product: requestedProduct}));}
    catch {fail('无法刷新房间列表，正在重新连接。'); return;}
    if (!pending.has('reply')) later('reply', 20_000, () => {if (socket === owner) fail('大厅暂未响应，正在重新连接。');});
    clear('list');
    if (state.loadedProduct !== state.selectedProduct) later('list', 3000, requestList);
  }
  function connect() {
    disconnect();
    if (!state.active || disposed || !relay) return;
    update({connection: 'loading', loadedProduct: null, recovering: false, error: null});
    if (!state.active || disposed) return;
    let next: LobbySocket;
    try {
      memberId ||= (options.getMemberId ?? multiplayerMemberId)();
      next = createSocket(buildMultiplayerDirectoryRelayUrl(relay, memberId));
    } catch {fail('联机大厅连接失败，稍后将自动重试。'); return;}
    socket = next;
    let received = false;
    later('handshake', 20_000, () => {if (socket === next && !received) fail('等待大厅响应超时，正在重新连接。');});
    next.addEventListener('message', event => {
      if (disposed || !state.active || socket !== next) return;
      let message: Record<string, unknown> | null;
      try {message = record(JSON.parse(String(event.data)));} catch {return;}
      if (message?.type !== 'directory' || message.version !== 1 || !Array.isArray(message.rooms)) return;
      const first = !received; received = true; retryCount = 0;
      clear('handshake'); clear('reply');
      const active = record(message.mine);
      const mine = active && typeof active.product === 'string' && isMultiplayerProductId(active.product) && validCode(active.code)
        ? Object.freeze({product: active.product, code: active.code, recoveryToken: typeof active.recoveryToken === 'string' ? active.recoveryToken : ''}) : null;
      let notice = state.notice;
      if (recovering && (mine?.recoveryToken !== recovering.recoveryToken || mine?.product !== recovering.product || mine?.code !== recovering.code)) {
        clear('recovery');
        if (!mine) sessions.clear(recovering.product);
        recovering = null; notice = mine ? '房间状态已经变化，请检查当前房间。' : '已释放原房间，可创建或加入新房间。';
      }
      // A late filtered snapshot proves connectivity, but cannot overwrite the
      // newer selection. Refresh replies from the current relay carry product.
      const product = typeof message.product === 'string' ? message.product : first ? '' : requestedProduct;
      const current = product === state.selectedProduct;
      update({connection: 'live', error: null, mine, supportsRecovery: message.membershipRecovery === true, recovering: !!recovering, notice,
        ...(current ? {rooms: Object.freeze(message.rooms.slice(0, 200).map(value => parseLobbyRoom(value, state.products)).filter((room): room is LobbyRoom => !!room && (!product || room.product === product))), loadedProduct: product, total: bounded(message.total, 100000)} : {})});
      if (current) clear('list');
      else if (first || !pending.has('list')) requestList();
    });
    next.addEventListener('close', event => {
      if (disposed || !state.active || socket !== next) return;
      const unsupported = !received && event.code === 1008;
      fail(unsupported ? '此服务器暂不支持联机大厅。' : '大厅连接中断，正在重新连接。', unsupported ? 'unsupported' : received ? 'loading' : 'offline');
    });
    next.addEventListener('error', () => {if (socket === next && state.active && !disposed) fail('联机大厅连接失败，正在重新连接。');});
  }
  async function boot() {
    disconnect();
    if (!state.active || disposed) return;
    const ticket = serial, request = new AbortController(); manifestRequest = request;
    update({connection: 'loading', loadedProduct: null, recovering: false, error: null});
    if (!state.active || disposed || ticket !== serial) return;
    later('manifest', 10_000, () => {if (manifestRequest === request) fail('载入联机服务配置超时。');});
    try {
      const response = await fetchImpl(new URL(HOST_MANIFEST_FILE, options.baseUrl), {cache: 'no-store', signal: request.signal});
      if (!response.ok) throw Error(`服务配置读取失败（${response.status}）`);
      const manifest = validateHostManifest(await response.json());
      if (disposed || !state.active || ticket !== serial || request.signal.aborted) return;
      clear('manifest'); manifestRequest = null;
      const products = Object.freeze(PRODUCT_IDS.filter((product): product is MultiplayerProductId => isMultiplayerProductId(product) && productEnabledForBuild(product, manifest.shared.testBuild) && !!manifest.games[gameIdForProduct(product)]));
      relay = manifest.shared.netplayRelay || '';
      update({products, diagnosticRelayUrl: relay ? buildMultiplayerDiagnosticRelayUrl(relay) : null, selectedProduct: products.includes(state.selectedProduct as MultiplayerProductId) ? state.selectedProduct : products[0] ?? ''});
      if (!relay) {update({connection: 'missing', error: '此站点尚未配置联机服务。'}); return;}
      connect();
    } catch (error) {
      if (disposed || !state.active || ticket !== serial || request.signal.aborted) return;
      fail(error instanceof Error ? error.message : '联机配置载入失败。');
    }
  }
  function retry() {
    if (disposed || !state.active) return;
    retryCount = 0;
    if (relay) connect(); else void boot();
  }
  function assertIntent(productId: MultiplayerProductId) {
    if (disposed || !state.active || state.connection !== 'live') throw Error('请等待大厅连接后再试。');
    if (state.mine || recovering) throw Error('你已在另一个房间或标签页中，请先退出或释放原房间。');
    if (!state.products.includes(productId)) throw Error('此作品在当前站点不可用。');
  }
  function intent(productId: MultiplayerProductId, code: string, create?: LobbyCreateInput): LobbyRoomIntent {
    const action = create ? 'create' : 'join';
    const search = new URLSearchParams({mpRoom: code, room: code, fromLobby: '1', lobbyAction: action});
    identity.lobbyClientId(productId);
    if (create) {
      sessions.save(productId, {room: {code, playerCount: create.playerCount, difficulty: create.difficulty, created: true, visibility: create.visibility, disableCheatMovement: create.disableCheatMovement, challengeMode: create.challengeMode === true}, seat: 0, ready: false, spectatorRequested: false, roomSettingsOpen: false});
      search.set('lobbyPlayers', String(create.playerCount)); search.set('lobbyDifficulty', String(create.difficulty));
      search.set('lobbyVisibility', create.visibility); search.set('lobbyDisableCheatMovement', create.disableCheatMovement ? '1' : '0');
      search.set('lobbyChallengeMode', create.challengeMode ? '1' : '0');
    } else sessions.clear(productId);
    // Router decides when navigation commits; a blocked/cancelled navigation
    // must not strand the directory in a disconnected "leaving" state.
    return Object.freeze({productId, roomCode: code, action, href: `/play/${productId}?${search}`});
  }
  return Object.freeze<LobbyDirectoryController>({
    subscribe(callback) {listeners.add(callback); return () => {listeners.delete(callback);};},
    getSnapshot: () => state,
    setActive(active, product = '') {
      if (disposed) return;
      if (!active) {
        if (state.active) {disconnect(); update({active: false, connection: 'idle', recovering: false, loadedProduct: null});}
        return;
      }
      const selectedProduct = isMultiplayerProductId(product) ? product : state.selectedProduct;
      if (!state.active) {
        update({active: true, selectedProduct, notice: null});
        void boot(); return;
      }
      if (selectedProduct !== state.selectedProduct && state.products.includes(selectedProduct as MultiplayerProductId)) {
        update({selectedProduct, loadedProduct: null});
        later('filter', 180, requestList);
      }
    },
    refresh() {
      if (!state.active || disposed) return;
      if (state.connection !== 'live') retry();
      else {update({loadedProduct: null}); requestList();}
    },
    retry,
    networkChanged() {
      if (!state.active || disposed) return;
      if (socket?.readyState === 1) requestList();
      else if (state.connection !== 'unsupported') retry();
    },
    releaseMembership() {
      const mine = state.mine;
      if (disposed || !state.active || state.connection !== 'live' || !state.supportsRecovery || !mine?.recoveryToken || recovering || socket?.readyState !== 1) return false;
      recovering = mine;
      try {socket.send(JSON.stringify({type: 'release-membership', recoveryToken: mine.recoveryToken}));}
      catch {fail('无法发送释放请求，请重新连接后检查。'); return false;}
      update({recovering: true, notice: null});
      later('recovery', 8000, () => {recovering = null; update({recovering: false, notice: '释放未获确认，请重新检查当前房间。'});});
      return true;
    },
    createRoomIntent(input) {
      assertIntent(input.productId);
      const policy = multiplayerConfigForProduct(input.productId)!;
      if (!policy.playerCounts.includes(input.playerCount) || !Number.isInteger(input.difficulty) || input.difficulty < 0 || input.difficulty >= policy.difficulties.length || !['public', 'private'].includes(input.visibility)) throw Error('房间人数、难度或公开设置无效。');
      let number = 1000 + (randomWord() >>> 0) % 9000;
      for (let attempts = 0; attempts < 9000; attempts++, number = 1000 + (number - 999) % 9000) {
        const code = String(number);
        if (!state.rooms.some(room => room.product === input.productId && room.code === code)) return intent(input.productId, code, input);
      }
      throw Error('暂时没有可用房间号，请刷新后重试。');
    },
    joinRoomIntent(productId, value, listed = false) {
      assertIntent(productId);
      const code = value.trim();
      if (!validCode(code)) throw Error('请输入 4 至 8 位数字房间号。');
      if (listed) {
        const room = state.rooms.find(row => row.product === productId && row.code === code);
        if (state.loadedProduct !== state.selectedProduct || !room?.joinable || lobbyRoomState(room) !== 'recruiting') throw Error('此房间已不能加入，请刷新列表。');
      }
      return intent(productId, code);
    },
    dispose() {if (disposed) return; disconnect(); state = Object.freeze({...state, active: false, connection: 'idle', recovering: false}); disposed = true; listeners.clear();},
  });
}
