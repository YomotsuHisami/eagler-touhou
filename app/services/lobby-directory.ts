import {PRODUCT_IDS, gameIdForProduct, isMultiplayerProductId, multiplayerConfigForProduct,
  productEnabledForBuild, type MultiplayerProductId} from '../../src/contracts/product-catalog.mts';
import {validateSiteManifest, type SiteManifest} from '../../src/contracts/site-manifest.mts';
import {multiplayerControlMode, validMultiplayerClientId, type MultiplayerIdentityStore} from '../../src/launcher/multiplayer-identity.mts';
import {buildMultiplayerDirectoryRelayUrl} from '../../src/launcher/multiplayer-relay-url.mts';
import type {MultiplayerRoomSessionStore} from '../../src/launcher/multiplayer-room-session.mts';
import {encodeRoomInvite, ROOM_INVITE_KEY} from '../../src/launcher/room-invite.mts';
import type {DecisionStore} from '../models/decisions';
import type {UiMessageKey, UiMessageParams} from '../../src/launcher/i18n.mts';

export type DirectoryConnection = 'loading' | 'live' | 'offline' | 'unsupported' | 'missing';
export type DirectoryFormMode = 'create' | 'join';
export interface DirectorySeat {
  initial: string; ready: boolean; online: boolean; controlMode: ReturnType<typeof multiplayerControlMode>;
}
export interface DirectoryRoom {
  product: MultiplayerProductId; code: string; capacity: 2 | 3; players: number; ready: number;
  difficulty: number; spectators: number; phase: 'lobby' | 'playing'; joinable: boolean;
  seats: readonly (DirectorySeat | null)[]; disableCheatMovement: boolean; challengeMode: boolean;
}
export interface DirectoryMembership {product: MultiplayerProductId; code: string; recoveryToken: string; clientId?: string; retained?: boolean; host?: boolean;}
export interface DirectoryForm {
  mode: DirectoryFormMode; product: MultiplayerProductId | ''; capacity: 2 | 3; difficulty: number;
  code: string; visibility: 'public' | 'private'; disableCheatMovement: boolean; validationMessage: string;
}
export interface DirectorySnapshot {
  products: readonly MultiplayerProductId[];
  selectedProduct: MultiplayerProductId | '';
  rooms: readonly DirectoryRoom[];
  visibleRooms: readonly DirectoryRoom[];
  mine: DirectoryMembership | null;
  recovering: DirectoryMembership | null;
  supportsRecovery: boolean;
  supportsSwitch: boolean;
  switching: boolean;
  supportsCodeLookup: boolean;
  resolvingCode: boolean;
  codeError: string;
  connection: DirectoryConnection;
  connectionInterrupted: boolean;
  loading: boolean;
  initialized: boolean;
  leaving: boolean;
  total: number;
  notice: string;
  form: Readonly<DirectoryForm>;
  siteManifest: SiteManifest | null;
}
export interface DirectorySocket {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: 'message', listener: (event: {data: unknown}) => void): void;
  addEventListener(type: 'close', listener: (event: {code: number}) => void): void;
  addEventListener(type: 'error', listener: () => void): void;
}
export interface LobbyDirectoryOptions {
  /** Separate original-directory 10s manifest request, not the 12s launcher bootstrap. */
  loadSiteManifest(signal: AbortSignal): Promise<unknown>;
  createSocket(url: string): DirectorySocket;
  memberId(): string;
  identity: MultiplayerIdentityStore;
  sessions: MultiplayerRoomSessionStore;
  sessionStorage: Pick<Storage, 'getItem' | 'removeItem'> | null;
  translate(key: UiMessageKey, params?: UiMessageParams): string;
  decisions?: Pick<DecisionStore, 'askDecision'>;
  onMembershipReplaced?(membership: DirectoryMembership): void;
  launcherUrl(): string;
  navigateToRoom(url: string): void;
  selectedProduct?: string;
  /** Router normalizes the directory filter; this service never writes history. */
  onSelectedProductNormalized?(product: MultiplayerProductId): void;
  randomWord?(): number;
  setTimeout?: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>;
  clearTimeout?: (timer: ReturnType<typeof setTimeout>) => void;
}
const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
const bounded = (value: unknown, max: number) => Math.max(0, Math.min(max, Math.trunc(Number(value) || 0)));
export function directoryRoomState(room: DirectoryRoom): 'recruiting' | 'full' | 'playing' {
  return room.phase !== 'lobby' ? 'playing' : room.players >= room.capacity ? 'full' : 'recruiting';
}
/** Source authority: main src/launcher/lobby.mts. No DOM, history, gameplay or
 * new form fields. Starting this owner is explicit; construction performs no I/O. */
export function createLobbyDirectory(options: LobbyDirectoryOptions) {
  const listeners = new Set<() => void>();
  const later = options.setTimeout ?? ((callback, delay) => setTimeout(callback, delay));
  const cancel = options.clearTimeout ?? (timer => clearTimeout(timer));
  type Timer = ReturnType<typeof setTimeout> | null;
  let reconnectTimer: Timer = null, handshakeTimer: Timer = null, filterTimer: Timer = null;
  let listTimer: Timer = null, directoryReplyTimer: Timer = null, recoveryTimer: Timer = null;
  let socket: DirectorySocket | null = null;
  let allProductsRequested = false;
  let relay = '', requestedProduct = '', loadedProduct: string | null = null;
  let retryCount = 0, bootRunning = false, disposed = false;
  let bootController: AbortController | null = null;
  let bootGeneration = 0;
  let pendingEntry: {owner: object | undefined; run(): void} | null = null;
  let joinGeneration = 0, switchSequence = 0;
  let switchRequest: {id:number; mine:DirectoryMembership; product:MultiplayerProductId; code:string; timer:Timer} | null = null;
  let lookupSequence = 0;
  let codeRequest: {id:number; code:string; timer:Timer} | null = null;
  const initialProduct = isMultiplayerProductId(options.selectedProduct || '') ? options.selectedProduct as MultiplayerProductId : '';
  let snapshot: DirectorySnapshot = Object.freeze({products: [], selectedProduct: initialProduct,
    rooms: [], visibleRooms: [], mine: null, recovering: null, supportsRecovery: false, supportsSwitch: false, switching: false,
    supportsCodeLookup: false, resolvingCode: false, codeError: '',
    connection: 'loading', connectionInterrupted: false, loading: true, initialized: false, leaving: false,
    total: 0, notice: '', siteManifest: null,
    form: Object.freeze({mode: 'create', product: '', capacity: 2, difficulty: 1, code: '',
      visibility: 'public', disableCheatMovement: false, validationMessage: ''}),
  });
  function publish(patch: Partial<DirectorySnapshot> = {}) {
    if (disposed) return;
    const next = {...snapshot, ...patch};
    if (next.connection === 'live') next.connectionInterrupted = false;
    else if (next.connection !== 'loading') next.connectionInterrupted = true;
    next.loading = next.connection === 'loading' || (next.connection === 'live' && loadedProduct !== next.selectedProduct);
    next.visibleRooms = next.loading ? [] : next.rooms.filter(room => !next.selectedProduct || room.product === next.selectedProduct);
    snapshot = Object.freeze(next);
    for (const listener of listeners) listener();
  }
  function notice(key: UiMessageKey) {publish({notice: options.translate(key)});}
  function returnMessage() {
    try {
      const message = options.sessionStorage?.getItem('eagler-lobby-message');
      if (message) {publish({notice: message}); options.sessionStorage?.removeItem('eagler-lobby-message');}
    } catch {}
  }
  function clear(timer: Timer) {if (timer !== null) cancel(timer);}
  function clearSwitch() {if (switchRequest) clear(switchRequest.timer); switchRequest = null; joinGeneration++; publish({switching:false});}
  function disconnect() {
    clearCodeLookup();
    clearSwitch();
    clear(reconnectTimer); clear(handshakeTimer); clear(listTimer); clear(directoryReplyTimer); clear(recoveryTimer);
    reconnectTimer = handshakeTimer = listTimer = directoryReplyTimer = recoveryTimer = null;
    const previous = socket; socket = null;
    if (snapshot.recovering) publish({recovering: null});
    if (previous && previous.readyState < 2) previous.close(1000, 'leave directory');
  }
  function scheduleReconnect() {
    if (disposed || snapshot.leaving) return;
    clear(reconnectTimer);
    reconnectTimer = later(() => {reconnectTimer = null; if (relay) connect(); else void initialize();},
      Math.min(20000, 1500 * 2 ** Math.min(retryCount++, 4)));
  }
  function refresh() {
    if (disposed || socket?.readyState !== 1) return;
    requestedProduct = snapshot.selectedProduct;
    socket.send(JSON.stringify({type: 'refresh', product: snapshot.selectedProduct}));
    if (directoryReplyTimer === null) {
      const requestedSocket = socket;
      directoryReplyTimer = later(() => {
        if (socket !== requestedSocket) return;
        publish({connection: 'offline'}); disconnect(); scheduleReconnect();
      }, 20000);
    }
    clear(listTimer); listTimer = null;
    if (loadedProduct !== snapshot.selectedProduct) listTimer = later(() => {
      listTimer = null;
      if (socket?.readyState === 1 && loadedProduct !== snapshot.selectedProduct) refresh();
    }, 3000);
  }
  function parseRoom(value: unknown): DirectoryRoom | null {
    const row = record(value);
    if (!row || typeof row.product !== 'string' || !isMultiplayerProductId(row.product) ||
        !snapshot.products.includes(row.product) || typeof row.code !== 'string' || !/^\d{4,8}$/.test(row.code)) return null;
    const policy = multiplayerConfigForProduct(row.product)!;
    const capacity = Number(row.capacity) as 2 | 3;
    if (!policy.playerCounts.includes(capacity)) return null;
    const input = Array.isArray(row.seats) ? row.seats : Array.isArray(row.initials) ? row.initials : [];
    const seats = Array.from({length: capacity}, (_, index): DirectorySeat | null => {
      const value = input[index]; if (value == null) return null;
      const seat = record(value);
      const initial = [...String(seat?.initial ?? value).replace(/[\u0000-\u001f\u007f]/g, '').trim()][0] || '?';
      return Object.freeze({initial, ready: seat?.ready === true, online: seat?.online !== false,
        controlMode: multiplayerControlMode(seat?.controlMode)});
    });
    return Object.freeze({product: row.product, code: row.code, capacity, seats: Object.freeze(seats),
      disableCheatMovement: row.disableCheatMovement === true, challengeMode: row.challengeMode === true,
      players: seats.filter(Boolean).length, ready: bounded(row.ready, capacity), spectators: bounded(row.spectators, 999),
      difficulty: bounded(row.difficulty, policy.difficulties.length - 1), phase: row.phase === 'lobby' ? 'lobby' : 'playing', joinable: row.joinable === true});
  }
  function connect() {
    disconnect();
    if (!relay || disposed || snapshot.leaving) return;
    loadedProduct = null; requestedProduct = '';
    publish({connection: 'loading'});
    let next: DirectorySocket;
    try {next = options.createSocket(buildMultiplayerDirectoryRelayUrl(relay, options.memberId()));}
    catch {publish({connection: 'offline'}); scheduleReconnect(); return;}
    socket = next;
    let received = false;
    handshakeTimer = later(() => {
      if (socket !== next || received) return;
      publish({connection: 'offline'}); disconnect(); scheduleReconnect();
    }, 20000);
    next.addEventListener('message', event => {
      if (disposed || socket !== next) return;
      let message: Record<string, unknown> | null;
      try {message = record(JSON.parse(String(event.data)));} catch {return;}
      if (message?.type === 'room-lookup-result') {
        const request = codeRequest;
        if (!request || message.requestId !== request.id || message.code !== request.code) return;
        clearCodeLookup();
        const product = message.product;
        if (message.ok !== true || typeof product !== 'string' || !isMultiplayerProductId(product) || !snapshot.products.includes(product)) {
          const key = message.reason === 'not-found' ? 'workspace.roomCodeMissing' : message.reason === 'ambiguous' ? 'workspace.roomCodeAmbiguous' :
            message.reason === 'unavailable' ? 'workspace.roomCodeUnavailable' : 'workspace.roomCodeFailed';
          publish({codeError:options.translate(key)}); return;
        }
        void requestJoin(product,request.code,false); return;
      }
      if (message?.type === 'room-switch-result') {
        const request = switchRequest;
        if (!request || message.requestId !== request.id) return;
        clearSwitch();
        if (message.ok !== true || message.product !== request.product || message.code !== request.code) {
          notice(message.reason === 'membership-changed' ? 'workspace.roomSwitchChanged' : message.reason === 'target-unavailable' ? 'workspace.roomSwitchUnavailable' : 'workspace.roomSwitchFailed');
          refresh(); return;
        }
        options.onMembershipReplaced?.(request.mine);
        options.sessions.clear(request.mine.product);
        publish({mine:null,notice:''});
        enterRoom(request.product,request.code,false); return;
      }
      if (message?.type !== 'directory' || message.version !== 1 || !Array.isArray(message.rooms)) return;
      const first = !received; received = true; retryCount = 0;
      clear(handshakeTimer); handshakeTimer = null;
      clear(directoryReplyTimer); directoryReplyTimer = null;
      const active = record(message.mine);
      const mine: DirectoryMembership | null = active && typeof active.product === 'string' &&
        isMultiplayerProductId(active.product) && typeof active.code === 'string' && /^\d{4,8}$/.test(active.code)
        ? {product: active.product, code: active.code, recoveryToken: typeof active.recoveryToken === 'string' ? active.recoveryToken : '', ...(validMultiplayerClientId(active.clientId) ? {clientId:active.clientId} : {}), ...(typeof active.retained === 'boolean' ? {retained:active.retained} : {}), ...(typeof active.host === 'boolean' ? {host:active.host} : {})} : null;
      let recovering = snapshot.recovering, noticeText = snapshot.notice;
      if (recovering && mine?.recoveryToken !== recovering.recoveryToken) {
        clear(recoveryTimer); recoveryTimer = null;
        if (!mine) options.sessions.clear(recovering.product);
        recovering = null;
        noticeText = options.translate(mine ? 'lobby.releaseChanged' : 'lobby.released');
      }
      const rooms = message.rooms.slice(0, 200).map(parseRoom).filter((room): room is DirectoryRoom => room !== null);
      loadedProduct = typeof message.product === 'string' ? message.product : first ? '' : requestedProduct;
      if (loadedProduct === snapshot.selectedProduct) {clear(listTimer); listTimer = null;}
      publish({mine, recovering, notice: noticeText, supportsRecovery: message.membershipRecovery === true, supportsSwitch: message.roomSwitch === 1, supportsCodeLookup: message.roomLookup === 1,
        rooms: Object.freeze(rooms), total: bounded(message.total, 100000), connection: 'live'});
      if (first && snapshot.selectedProduct) refresh();
    });
    next.addEventListener('close', event => {
      if (disposed || socket !== next) return;
      if (codeRequest) publish({codeError:options.translate('workspace.roomCodeFailed')});
      clearCodeLookup();
      if (snapshot.switching) notice('workspace.roomSwitchFailed');
      clearSwitch(); socket = null;
      const hadRecovery = snapshot.recovering !== null;
      clear(recoveryTimer); recoveryTimer = null; clear(handshakeTimer); handshakeTimer = null;
      const unsupported = !received && event.code === 1008;
      publish({recovering: null, ...(hadRecovery ? {notice: options.translate('lobby.releaseFailed')} : {}),
        connection: unsupported ? 'unsupported' : received ? 'loading' : 'offline'});
      if (!unsupported) scheduleReconnect();
    });
    next.addEventListener('error', () => {
      if (disposed || socket !== next) return;
      if (codeRequest) publish({codeError:options.translate('workspace.roomCodeFailed')});
      publish({connection: 'offline'}); disconnect(); scheduleReconnect();
    });
  }
  function retry() {
    if (disposed || snapshot.leaving) return;
    retryCount = 0; clear(reconnectTimer); reconnectTimer = null;
    if (relay) connect(); else void initialize();
  }
  function formDefaults(product: MultiplayerProductId | '') {
    const policy = product ? multiplayerConfigForProduct(product) : null;
    return {product, capacity: policy?.playerCounts[0] ?? 2, difficulty: 1} as const;
  }
  async function initialize() {
    if (bootRunning || disposed || snapshot.leaving) return;
    bootRunning = true;
    const generation = ++bootGeneration;
    const controller = new AbortController(); bootController = controller;
    publish({connection: 'loading'});
    if (!snapshot.initialized) returnMessage();
    let deadline: Timer = null;
    let abortLoad: (() => void) | null = null;
    try {
      const manifest = validateSiteManifest(await Promise.race([
        options.loadSiteManifest(controller.signal),
        new Promise<never>((_, reject) => {
          abortLoad = () => reject(new Error('directory manifest aborted'));
          controller.signal.addEventListener('abort', abortLoad, {once: true});
        }),
        new Promise<never>((_, reject) => {deadline = later(() => {controller.abort(); reject(new Error('directory manifest timeout'));}, 10000);}),
      ]));
      if (disposed || generation !== bootGeneration || snapshot.leaving) return;
      const products = PRODUCT_IDS.filter((product): product is MultiplayerProductId => isMultiplayerProductId(product) &&
        productEnabledForBuild(product, manifest.shared.testBuild) && !!manifest.games[gameIdForProduct(product)]);
      const selectedProduct = allProductsRequested ? '' : products.includes(snapshot.selectedProduct as MultiplayerProductId) ? snapshot.selectedProduct : products[0] || '';
      relay = manifest.shared.netplayRelay || '';
      publish({products: Object.freeze(products), selectedProduct, siteManifest: manifest,
        form: Object.freeze({...snapshot.form, ...formDefaults(products[0] || '')})});
      if (selectedProduct) options.onSelectedProductNormalized?.(selectedProduct);
      if (!relay) publish({connection: 'missing'}); else connect();
    } catch {
      if (!disposed && generation === bootGeneration && !snapshot.leaving) {publish({connection: 'offline'}); scheduleReconnect();}
    } finally {
      clear(deadline);
      if (abortLoad) controller.signal.removeEventListener('abort', abortLoad);
      if (generation === bootGeneration) {
        bootRunning = false; bootController = null;
        if (!disposed) publish({initialized: true});
      }
    }
  }
  function selectProduct(product: string) {
    if (product !== '' && (!isMultiplayerProductId(product) ||
        ((snapshot.initialized || snapshot.products.length > 0) && !snapshot.products.includes(product)))) return;
    if (snapshot.selectedProduct === product && allProductsRequested === (product === '')) return;
    allProductsRequested = product === '';
    // A room return can supply its filter before this view's first manifest.
    // Keep that request for initialize() to validate against the loaded catalog.
    loadedProduct = null;
    publish({selectedProduct: product});
    clear(filterTimer); filterTimer = later(() => {filterTimer = null; refresh();}, 180);
  }
  function prepareForm(mode: DirectoryFormMode): boolean {
    if (snapshot.connection !== 'live' || snapshot.leaving || snapshot.switching || snapshot.resolvingCode || !snapshot.products.length) return false;
    if (snapshot.mine && mode === 'create') {notice('lobby.conflict'); return false;}
    pendingEntry = null;
    const product = snapshot.selectedProduct || snapshot.form.product || snapshot.products[0];
    publish({form: Object.freeze({...snapshot.form, ...formDefaults(product), mode, validationMessage: ''})});
    return true;
  }
  function restoreFormMode(mode: DirectoryFormMode) {
    if (snapshot.form.mode !== mode) publish({form: Object.freeze({...snapshot.form, mode, validationMessage: ''})});
  }
  function updateForm(patch: Partial<Pick<DirectoryForm, 'product' | 'capacity' | 'difficulty' | 'code' | 'visibility' | 'disableCheatMovement'>>) {
    const next = {...snapshot.form};
    if (patch.product !== undefined && isMultiplayerProductId(patch.product) && snapshot.products.includes(patch.product)) Object.assign(next, formDefaults(patch.product));
    const policy = next.product ? multiplayerConfigForProduct(next.product) : null;
    if (patch.capacity !== undefined && policy?.playerCounts.includes(patch.capacity)) next.capacity = patch.capacity;
    if (patch.difficulty !== undefined && Number.isInteger(patch.difficulty) && patch.difficulty >= 0 && patch.difficulty < (policy?.difficulties.length ?? 0)) next.difficulty = patch.difficulty;
    if (patch.code !== undefined) {next.code = patch.code; next.validationMessage = '';}
    if (patch.visibility === 'public' || patch.visibility === 'private') {next.visibility = patch.visibility; next.validationMessage = '';}
    if (patch.disableCheatMovement !== undefined) next.disableCheatMovement = patch.disableCheatMovement;
    publish({form: Object.freeze(next)});
  }
  function enterRoom(product: MultiplayerProductId, code: string, created: boolean, playerCount?: 2 | 3,
    difficulty = 1, visibility: 'public' | 'private' = 'public', disableCheatMovement = false) {
    if (disposed || snapshot.leaving || snapshot.connection !== 'live') return;
    if (snapshot.mine) {notice('lobby.conflict'); return;}
    const policy = multiplayerConfigForProduct(product)!;
    options.identity.lobbyClientId(product);
    if (created) options.sessions.save(product, {room: {code, playerCount: playerCount || policy.playerCounts[0],
      difficulty, created: true, visibility, disableCheatMovement}, seat: 0, ready: false, spectatorRequested: false, roomSettingsOpen: false});
    else options.sessions.clear(product);
    const url = new URL(options.launcherUrl());
    url.searchParams.set(ROOM_INVITE_KEY, encodeRoomInvite({g: product, r: code, f: true, a: created ? 'create' : 'join',
      ...(created ? {p: playerCount || policy.playerCounts[0], d: difficulty, v: visibility, c: disableCheatMovement} : {})}));
    publish({leaving: true}); disconnect(); options.navigateToRoom(url.href);
  }
  function newRoomCode(product: MultiplayerProductId) {
    const word = options.randomWord ? options.randomWord() : crypto.getRandomValues(new Uint32Array(1))[0];
    let code = String(1000 + word % 9000);
    while (snapshot.rooms.some(room => room.product === product && room.code === code)) code = String(1000 + (Number(code) - 999) % 9000);
    return code;
  }
  /** Redesign's selected-game action creates immediately with fresh defaults.
   * The all-games directory still needs a product chooser. No dialog receipt
   * is used, so an old form cannot commit this action a second time. */
  function createRoom(): boolean {
    const product = snapshot.selectedProduct;
    if (disposed || snapshot.leaving || snapshot.switching || snapshot.resolvingCode || snapshot.connection !== 'live' || !isMultiplayerProductId(product) || !snapshot.products.includes(product)) return false;
    if (snapshot.mine) {notice('lobby.conflict'); return false;}
    pendingEntry = null;
    const defaults = formDefaults(product);
    enterRoom(product, newRoomCode(product), true, defaults.capacity, defaults.difficulty);
    return true;
  }
  function submitForm(owner?: object): 'close' | 'invalid-code' | 'unavailable' {
    const form = snapshot.form;
    if (!isMultiplayerProductId(form.product) || !snapshot.products.includes(form.product) || snapshot.mine && form.mode === 'create' || snapshot.connection !== 'live' || snapshot.leaving || snapshot.switching) return 'unavailable';
    let code = form.code.trim();
    if (form.mode === 'join' && !/^\d{4,8}$/.test(code)) {
      publish({form: Object.freeze({...form, validationMessage: options.translate('lobby.invalidCode')})});
      return 'invalid-code';
    }
    const created = form.mode === 'create';
    if (created) code = newRoomCode(form.product);
    const product = form.product;
    pendingEntry = {owner, run: () => {if (created) enterRoom(product, code, true, form.capacity, form.difficulty, form.visibility, form.disableCheatMovement); else void requestJoin(product,code,false);}};
    return 'close';
  }
  function formDidClose(owner?: object, commit = true) {
    // A retired dialog may clean up after another form submitted. Only its
    // own receipt can consume or discard the single pending entry.
    if (pendingEntry?.owner !== owner) return;
    const action = pendingEntry; pendingEntry = null;
    if (commit) action?.run();
  }
  async function requestJoin(product: MultiplayerProductId, code: string, listed: boolean) {
    if (disposed || snapshot.leaving || snapshot.switching || snapshot.resolvingCode || snapshot.recovering || snapshot.connection !== 'live') return;
    const canJoin = () => !listed || snapshot.rooms.some(room => room.product === product && room.code === code && room.joinable && directoryRoomState(room) === 'recruiting');
    const mine = snapshot.mine;
    if (mine?.product === product && mine.code === code) {returnToRoom(); return;}
    if (!canJoin()) return;
    if (!mine) {enterRoom(product,code,false); return;}
    if (!snapshot.supportsSwitch || !mine.recoveryToken || !options.decisions) {notice('workspace.roomSwitchUnsupported'); return;}
    const generation = ++joinGeneration, ownedSocket = socket;
    publish({switching:true});
    const choice = await options.decisions.askDecision({title:options.translate('lobby.joinRoom'),
      message:options.translate(mine.host === false ? 'workspace.leaveRoomConfirm' : 'workspace.switchRoomConfirm'),
      confirmText:options.translate('workspace.continueJoin'),tone:'danger'});
    if (disposed || generation !== joinGeneration) return;
    publish({switching:false});
    if (choice !== 'confirm') return;
    if (socket !== ownedSocket || socket?.readyState !== 1 || snapshot.connection !== 'live' || snapshot.mine?.recoveryToken !== mine.recoveryToken) {notice('workspace.roomSwitchChanged'); return;}
    if (!canJoin()) {notice('workspace.roomSwitchUnavailable'); return;}
    const id = ++switchSequence;
    const timer = later(() => {clearSwitch(); notice('workspace.roomSwitchFailed'); refresh();},8000);
    switchRequest = {id,mine,product,code,timer}; publish({switching:true,notice:''});
    socket.send(JSON.stringify({type:'switch-room',requestId:id,recoveryToken:mine.recoveryToken,product,code,dissolve:mine.host !== false}));
  }
  function joinRoom(product: MultiplayerProductId, code: string) {return requestJoin(product,code,true);}
  function clearCodeLookup() {clear(codeRequest?.timer ?? null); codeRequest = null; if (snapshot.resolvingCode) publish({resolvingCode:false});}
  function cancelCodeJoin() {clearCodeLookup(); if (snapshot.codeError) publish({codeError:''});}
  function joinByCode(input: string) {
    if (disposed || snapshot.leaving || snapshot.switching || snapshot.resolvingCode || snapshot.recovering || snapshot.connection !== 'live') return;
    const code = input.trim();
    if (!/^\d{4,8}$/.test(code)) {publish({codeError:options.translate('lobby.invalidCode')}); return;}
    if (!snapshot.supportsCodeLookup || socket?.readyState !== 1) {publish({codeError:options.translate('workspace.roomCodeUnsupported')}); return;}
    const id = ++lookupSequence;
    codeRequest = {id,code,timer:later(() => {clearCodeLookup(); publish({codeError:options.translate('workspace.roomCodeFailed')});},8000)};
    publish({resolvingCode:true,codeError:''});
    socket.send(JSON.stringify({type:'resolve-room',requestId:id,code}));
  }
  function returnToRoom(): boolean {
    const mine = snapshot.mine;
    if (!mine || disposed || snapshot.leaving || snapshot.switching || snapshot.resolvingCode || snapshot.recovering || snapshot.connection !== 'live') return false;
    // mine is private to this browser member. Reuse its existing room identity,
    // including another tab's retained seat; never create or clear a session.
    if (mine.clientId) options.identity.adoptLobbyClientId?.(mine.product, mine.clientId);
    const url = new URL(options.launcherUrl());
    url.searchParams.set(ROOM_INVITE_KEY, encodeRoomInvite({g:mine.product,r:mine.code,f:true,a:'join'}));
    pendingEntry = null; publish({leaving:true}); disconnect(); options.navigateToRoom(url.href);
    return true;
  }
  function releaseMembership() {
    if (!snapshot.supportsRecovery || !snapshot.mine?.recoveryToken || snapshot.recovering || socket?.readyState !== 1) return;
    const recovering = {...snapshot.mine};
    publish({recovering});
    socket.send(JSON.stringify({type: 'release-membership', recoveryToken: recovering.recoveryToken}));
    recoveryTimer = later(() => {recoveryTimer = null; publish({recovering: null}); notice('lobby.releaseFailed');}, 8000);
  }
  function refreshRooms() {if (snapshot.connection === 'live') {loadedProduct = null; publish(); refresh();} else retry();}
  function pageHide() {
    publish({leaving: true}); clear(filterTimer); filterTimer = null; disconnect();
    bootGeneration++; bootController?.abort(); bootController = null; bootRunning = false; pendingEntry = null;
  }
  function resumeView() {
    if (disposed) return;
    if (snapshot.leaving) {publish({leaving: false}); returnMessage(); retry();}
    else if (!snapshot.initialized) void initialize();
  }
  function pageShow(persisted: boolean) {if (persisted) {publish({leaving: false}); returnMessage(); retry();}}
  function offline() {if (!snapshot.leaving) {if (socket?.readyState === 1) refresh(); else retry();}}
  function visibilityChanged(visible: boolean) {
    if (!visible || snapshot.leaving) return;
    if (socket?.readyState === 1) refresh(); else if (snapshot.connection !== 'unsupported') retry();
  }
  return {
    subscribe(listener: () => void) {listeners.add(listener); return () => {listeners.delete(listener);};},
    getSnapshot: () => snapshot,
    initialize, selectProduct, createRoom, prepareForm, restoreFormMode, updateForm, submitForm, formDidClose, joinRoom, joinByCode, cancelCodeJoin,
    returnToRoom, releaseMembership, refreshRooms, retry, resumeView, pageHide, pageShow, offline, visibilityChanged,
    online: retry, networkChanged: retry,
    dispose() {if (disposed) return; pageHide(); disposed = true; listeners.clear();},
  };
}
export type LobbyDirectoryService = ReturnType<typeof createLobbyDirectory>;
