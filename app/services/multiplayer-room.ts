import {PRODUCT_IDS, gameIdForProduct, isMultiplayerProductId, multiplayerConfigForProduct, multiplayerInputTimingPolicy,
  type MultiplayerProductId} from '../../src/contracts/product-catalog.mts';
import {multiplayerDisplayInitial, type MultiplayerIdentityStore, type MultiplayerDeviceType} from '../../src/launcher/multiplayer-identity.mts';
import {normalizeMultiplayerLobbySnapshot, type MultiplayerResourceProgress} from '../../src/launcher/multiplayer-lobby-snapshot.mts';
import {normalizePreferredLoadout, type MultiplayerPreferenceStore} from '../../src/launcher/multiplayer-preferences.mts';
import type {MultiplayerRoomSessionStore} from '../../src/launcher/multiplayer-room-session.mts';
import {buildMultiplayerLobbyRelayUrl, buildMultiplayerGameplayRelayUrl} from '../../src/launcher/multiplayer-relay-url.mts';
import {buildMultiplayerRuntimeOptions, type MultiplayerRuntimeOptions} from '../../src/launcher/multiplayer-runtime-options.mts';
import {recommendMultiplayerInputTiming} from '../../src/launcher/multiplayer-input-timing.mts';
import {parseMeasuredNetplayTiming, resolveAdonisPredictionReserve} from '../../src/contracts/netplay-timing.mts';
import {resolveRoomInvite, normalizeRoomCode} from '../../src/launcher/route-state.mts';
import type {MultiplayerRoomState} from '../../src/launcher/app-types.mts';
import type {UiMessageKey, UiMessageParams} from '../../src/launcher/i18n.mts';
import type {DecisionStore} from '../models/decisions';
import type {DirectorySocket} from './lobby-directory';
import {errorText} from './error-text';

export type RoomSocket = DirectorySocket & {addEventListener(type: 'open', listener: () => void): void;};
export interface RoomSettingsInput {touchMovementMode: string; touchEnabled: boolean; mobileDevice: boolean; deviceType?: MultiplayerDeviceType; iceServers: unknown;}
export interface RoomPreparationProgress extends MultiplayerResourceProgress {error: string; loaded?: number; total?: number; title?: string;}
export interface RoomOwnerSnapshot {
  product: MultiplayerProductId | null;
  room: Readonly<MultiplayerRoomState> | null;
  epoch: number;
  fromDirectory: boolean;
  connected: boolean;
  directorySupported: boolean;
  controlModesSupported: boolean;
  productSwitchSupported: boolean;
  roomCardsSupported: boolean;
  selectionStateSupported: boolean;
  selectionConfirmed: boolean;
  editingStateSupported: boolean;
  editingSettings: boolean;
  parked: boolean;
  retentionSupported: boolean;
  retentionPending: boolean;
  localDeviceType: MultiplayerDeviceType;
  productPending: boolean;
  canSwitchProduct: boolean;
  seat: number | null;
  ready: boolean;
  spectatorRequested: boolean;
  preferredLoadout: number;
  loadoutPending: boolean;
  displayName: string;
  roomSettingsOpen: boolean;
  startSerial: number;
  preparation: Readonly<RoomPreparationProgress> | null;
  launchBusy: boolean;
  checkBusy: boolean;
  timingChoice: 'auto' | number;
  rollbackEnabled: boolean;
  canStart: boolean;
  localClientId: string;
}
export interface RoomOperationContext {
  product: MultiplayerProductId;
  roomCode: string;
  epoch: number;
  signal: AbortSignal;
  isCurrent(): boolean;
}
export interface RoomLaunchContext extends RoomOperationContext {
  runtimeOptions: MultiplayerRuntimeOptions;
  snapshot: RoomOwnerSnapshot;
}
export interface MultiplayerRoomPorts {
  identity: MultiplayerIdentityStore;
  sessions: MultiplayerRoomSessionStore;
  preferences: MultiplayerPreferenceStore;
  memberId(): string;
  createSocket(url: string): RoomSocket;
  relayUrl(product: MultiplayerProductId): string;
  settings(): RoomSettingsInput;
  setMovementMode(mode: 'touch' | 'joystick'): void;
  decisions: DecisionStore;
  translate(key: UiMessageKey, params?: UiMessageParams): string;
  notify(message: string, duration?: number): void;
  /** Main's real install-only/worker-aware preparation. Never reports synthetic ready. */
  prepareResources(context: RoomOperationContext, report: (progress: RoomPreparationProgress) => void): Promise<void>;
  preparationFailed(error: unknown, context: RoomOperationContext): void;
  beginManualImport(context: RoomOperationContext): void;
  /** Main app6830 clears manual install-only recovery before an accepted retry. */
  beforePreparationRetry?(): void;
  /** Own input warnings, TH09 title handoff, fullscreen, first-frame/path gate and error continuation. */
  launch(context: RoomLaunchContext): Promise<void>;
  /** Real multiplayer Runtime, omitNetplay, first frame, then return to room without save RPC. */
  checkGame(context: RoomOperationContext): Promise<void>;
  operationFailed(error: unknown, kind: 'launch' | 'check', context: RoomOperationContext): void | Promise<void>;
  isLaunched(): boolean;
  canLaunchFromTitle?(): boolean;
  routes: {
    restore(input: {product: MultiplayerProductId; code: string; fromDirectory: boolean}): void;
    enter(input: {product: MultiplayerProductId; code: string; created: boolean}): void;
    settleInvite(): void;
    switchProduct?(input: {product: MultiplayerProductId; code: string; fromDirectory: boolean}): void;
    leave(input: {product: MultiplayerProductId; fromDirectory: boolean; message?: string}): void;
  };
  network: {reset(reconnecting?: boolean): void; receive(message: Record<string, unknown>): unknown;
    minimumRtt(clientIds: string[]): number | null; suspend?(): void;};
  quickChat?: {receive(message: Record<string, unknown>): void;};
  online?(): boolean;
  visible?(): boolean;
  now?(): number;
  random?(): number;
  setTimeout?: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>;
  clearTimeout?: (timer: ReturnType<typeof setTimeout>) => void;
}
const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;

/** Extracted business ownership from main app.mts440–780,974–1091,6796–6849,
 * 7552–7940. Native/Router ports retain their original owners; no DOM/history. */
export function createMultiplayerRoom(ports: MultiplayerRoomPorts) {
  const listeners = new Set<() => void>();
  const later = ports.setTimeout ?? ((callback, delay) => setTimeout(callback, delay));
  const cancel = ports.clearTimeout ?? (timer => clearTimeout(timer));
  let room: MultiplayerRoomState | null = null;
  let product: MultiplayerProductId | null = null;
  let socket: RoomSocket | null = null, socketRoom = '', clientId = '';
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null, reconnectAttempt = 0;
  let stopped = false, disposed = false, epoch = 0, intent: '' | 'create' | 'join' = '', autoSeat = false;
  let ownerController = new AbortController();
  let preparation: {epoch: number; controller: AbortController; task: Promise<void>} | null = null;
  let movementDecision: Promise<boolean> | null = null;
  let pendingLoadout: {socket: RoomSocket | null; seat: number; index: number; selectionConfirmed?: boolean} | null = null;
  let reportedSocket: RoomSocket | null = null, reportedResourceKey = '', lastActivity = 0;
  let reportedEditing: {socket: RoomSocket; seat: number; value: boolean} | null = null;
  let productRequest: {version: number; timer: ReturnType<typeof setTimeout>} | null = null;
  let productBusy = false;
  let reportedProductBusy: boolean | null = null;
  let restoredMembership = false;
  let retentionRequest: {kind:'park'|'dissolve'; timer:ReturnType<typeof setTimeout>} | null = null;
  let dissolveDecision = false;
  let state = {fromDirectory: false, connected: false, directorySupported: false, controlModesSupported: false,
    productSwitchSupported: false, roomCardsSupported: false, selectionStateSupported: false, selectionConfirmed: false, editingStateSupported: false, editingSettings: false, parked: false, retentionSupported: false,
    seat: null as number | null, ready: false, spectatorRequested: false, preferredLoadout: 0, displayName: '',
    roomSettingsOpen: false, startSerial: 0, preparation: null as RoomPreparationProgress | null,
    launchBusy: false, checkBusy: false, timingChoice: 'auto' as 'auto' | number, rollbackEnabled: false};
  let snapshot: RoomOwnerSnapshot;
  const policy = () => product ? multiplayerConfigForProduct(product) : null;
  const ownerLocal = () => room?.synced === true && (room.hostClientId === undefined ? state.seat === 0 : room.hostClientId === clientId);
  const current = (value: number) => !disposed && epoch === value && room !== null;
  function persist() {
    if (!product || !room) return;
    ports.sessions.save(product, {room: {code: room.code, playerCount: room.playerCount, difficulty: room.difficulty,
      ...(state.productSwitchSupported ? {roomProducts:true} : {}),
      created: room.created, visibility: room.visibility, disableCheatMovement: room.disableCheatMovement,
      challengeMode: room.challengeMode, prankMode: false}, seat: state.seat, ready: state.ready,
      spectatorRequested: state.spectatorRequested, roomSettingsOpen: state.roomSettingsOpen});
  }
  function publish() {
    const canStart = !state.editingSettings && !state.parked && !room?.retainedHostId && !retentionRequest && !pendingLoadout && !productRequest && ownerLocal() && state.connected && state.ready && (!state.roomCardsSupported || state.preparation?.status === 'ready') && room?.phase === 'lobby' &&
      Array.isArray(room.seats) && room.seats.slice(0, room.playerCount).every(seat => seat && !seat.offline && seat.ready);
    snapshot = Object.freeze({...state, localDeviceType: ports.settings().deviceType ?? (ports.settings().mobileDevice ? 'phone' : 'desktop'), loadoutPending: !!pendingLoadout, product, epoch, localClientId: clientId, room: room ? Object.freeze({...room}) : null, canStart: !!canStart,
      retentionPending: !!retentionRequest, productPending: !!productRequest, canSwitchProduct: !state.parked && !retentionRequest && ownerLocal() && state.connected && room?.phase === 'lobby' && state.productSwitchSupported && room.directoryLocked === false && room.productSwitchAvailable !== false && !productRequest && !productBusy && !pendingLoadout && !state.launchBusy && !state.checkBusy && !ports.isLaunched(),
      preparation: state.preparation ? Object.freeze({...state.preparation}) : null});
    if (!disposed) {
      persist();
      if (state.productSwitchSupported && state.connected) {
        const busy = state.parked || !!retentionRequest || productBusy || state.launchBusy || state.checkBusy || ports.isLaunched();
        if (busy !== reportedProductBusy && send({type:'product-busy', busy})) reportedProductBusy = busy;
      }
      if (state.editingStateSupported && socket && state.connected && state.seat !== null && room?.phase === 'lobby' &&
          (reportedEditing?.socket !== socket || reportedEditing.seat !== state.seat || reportedEditing.value !== state.editingSettings) &&
          send({type:'editing-settings', editing:state.editingSettings})) {
        reportedEditing = {socket,seat:state.seat,value:state.editingSettings};
      }
      for (const listener of listeners) listener();
    }
  }
  publish();
  function send(message: Record<string, unknown>): boolean {
    if (!state.connected || socket?.readyState !== 1) return false;
    // Privacy is a wire contract, not merely an avatar presentation choice.
    const content = state.productSwitchSupported ? {...message, productVersion: room?.productVersion ?? 1} : message;
    const payload = typeof content.name === 'string' ? {...content, name: multiplayerDisplayInitial(content.name, '')} : content;
    socket.send(JSON.stringify(payload)); return true;
  }
  function input() {
    const settings = ports.settings();
    return {movementMode: settings.touchMovementMode, touchEnabled: settings.touchEnabled,
      deviceType: settings.deviceType ?? (settings.mobileDevice ? 'phone' : 'desktop'),
      mobileDevice: settings.mobileDevice || settings.touchEnabled};
  }
  function context(signal = ownerController.signal): RoomOperationContext {
    if (!room || !product) throw new Error(ports.translate('multiplayer.roomStateInvalid'));
    const ownedEpoch = epoch;
    return {product, roomCode: room.code, epoch: ownedEpoch, signal, isCurrent: () => current(ownedEpoch) && !signal.aborted};
  }
  function reportProgress(progress: RoomPreparationProgress) {
    state.preparation = {...progress};
    if (state.seat != null && state.connected) {
      const percent = progress.status === 'ready' ? 100 : progress.status === 'preparing' && progress.stage === 'package' && progress.total
        ? Math.min(100, Math.floor((progress.loaded || 0) / progress.total * 20) * 5) : null;
      const wire = {status: progress.status, stage: progress.stage, percent};
      const key = JSON.stringify(wire);
      if ((socket !== reportedSocket || key !== reportedResourceKey) && send({type: 'resource-progress', ...wire})) {
        reportedSocket = socket; reportedResourceKey = key;
      }
    }
    publish();
  }
  function prepareResources(): Promise<void> {
    if (!room || !product || disposed) return Promise.resolve();
    if (preparation?.epoch === epoch) return preparation.task;
    const controller = new AbortController(), owned = context(controller.signal);
    const taskOwner = {epoch, controller, task: Promise.resolve()}; preparation = taskOwner;
    reportedResourceKey = '';
    reportProgress({status: 'preparing', stage: 'package', percent: null, error: ''});
    taskOwner.task = Promise.resolve().then(() => ports.prepareResources(owned, progress => {if (owned.isCurrent()) reportProgress(progress);}))
      .then(() => {if (owned.isCurrent()) reportProgress({status: 'ready', stage: 'runtime', percent: 100, error: ''});})
      .catch(error => {
        if (!owned.isCurrent()) return;
        reportProgress({status: 'failed', stage: state.preparation?.stage || 'package', percent: null, error: errorText(error)});
        ports.preparationFailed(error, owned);
      });
    return taskOwner.task;
  }
  function disconnect(reason = 'leave room') {
    clearRetentionRequest();
    pendingLoadout = null;
    ports.network.reset();
    if (reconnectTimer !== null) cancel(reconnectTimer);
    reconnectTimer = null; reconnectAttempt = 0;
    const previous = socket; socket = null; socketRoom = ''; state.connected = false;
    if (previous && previous.readyState < 2) {try {previous.close(1000, reason);} catch {}}
  }
  function scheduleReconnect(code: string) {
    if (reconnectTimer !== null || !room || room.code !== code || stopped || disposed || ports.online?.() === false) return;
    const attempt = reconnectAttempt++;
    reconnectTimer = later(() => {
      reconnectTimer = null;
      if (room?.code === code && !state.connected) connect(true);
    }, Math.min(5000, 650 * 2 ** Math.min(attempt, 3)) + Math.floor((ports.random?.() ?? Math.random()) * 250));
  }
  function sendSettings() {
    if (!room || !ownerLocal()) return;
    send({type: 'settings', playerCount: room.playerCount, difficulty: room.difficulty,
      visibility: room.visibility || 'public', disableCheatMovement: !!room.disableCheatMovement,
      challengeMode: !!room.challengeMode, prankMode: false});
  }
  function applySnapshot(value: unknown) {
    const raw = record(value);
    const nextProduct = state.productSwitchSupported && typeof raw?.product === 'string' && isMultiplayerProductId(raw.product) ? raw.product : product;
    const config = nextProduct ? multiplayerConfigForProduct(nextProduct) : null; if (!room || !config) return;
    if (typeof raw?.productVersion === 'number' && raw.productVersion < (room.productVersion ?? 1)) return;
    const normalized = normalizeMultiplayerLobbySnapshot(value, {localClientId: clientId,
      playerCounts: config.playerCounts, difficulties: config.difficulties, loadouts: config.loadouts, inputTiming: config.inputTiming});
    if (!normalized) return;
    if (normalized.productVersion !== room.productVersion) reportedResourceKey = '';
    const switched = !!nextProduct && nextProduct !== product;
    const previousSeat = state.seat;
    if (nextProduct && switched) {
      if (normalized.phase !== 'lobby') return;
      ownerController.abort(); ownerController = new AbortController();
      preparation?.controller.abort(); preparation = null; state.preparation = null;
      if (product) ports.sessions.clear(product);
      epoch++; pendingLoadout = null; reportedResourceKey = ''; reportedSocket = null;
      hydrateProduct(nextProduct); ports.identity.adoptLobbyClientId?.(nextProduct, clientId);
      socketRoom = `${nextProduct}-${room.code}`;
      state.ready = false; state.checkBusy = false; state.launchBusy = false;
      state.rollbackEnabled = multiplayerInputTimingPolicy(config).rollback; state.timingChoice = 'auto';
    }
    if (productRequest && normalized.productVersion !== undefined && normalized.productVersion > productRequest.version) {
      cancel(productRequest.timer); productRequest = null;
    }
    const movementChanged = !room.disableCheatMovement && normalized.disableCheatMovement;
    Object.assign(room, normalized, {synced: true, connection: 'connected', challengeMode: normalized.challengeMode ?? false,
      prankMode: false, inputDelayAuto: normalized.inputDelayAuto ?? false, predictionReserve: normalized.predictionReserve ?? 2,
      timing: normalized.timing ?? null, adonisMode: normalized.adonisMode ?? 0});
    state.seat = normalized.localSeat;
    if (state.seat != null) {
      const seat = normalized.seats[state.seat]; if (!seat) return;
      if (pendingLoadout && (pendingLoadout.socket !== socket || pendingLoadout.seat !== state.seat || pendingLoadout.index === seat.loadout && (pendingLoadout.selectionConfirmed === undefined || seat.selectionConfirmed === pendingLoadout.selectionConfirmed))) pendingLoadout = null;
      state.spectatorRequested = false;
      if (!pendingLoadout) state.preferredLoadout = seat.loadout;
      state.ready = !pendingLoadout && seat.ready;
      if (!pendingLoadout && state.selectionStateSupported) state.selectionConfirmed = seat.selectionConfirmed === true || seat.ready;
      else if (switched || previousSeat !== state.seat) state.selectionConfirmed = false;
    } else {
      pendingLoadout = null;
      if (normalized.localSpectator) state.spectatorRequested = true;
      state.ready = false; state.selectionConfirmed = false; reportedResourceKey = '';
    }
    if (retentionRequest?.kind === 'park' && room.retainedHostId === clientId && product) {
      clearRetentionRequest(); state.parked = true; publish();
      ports.routes.leave({product, fromDirectory:true});
    } else publish();
    if (switched && product) {
      ports.routes.switchProduct?.({product, code:room.code, fromDirectory:state.fromDirectory});
      if (previousSeat != null && previousSeat >= normalized.playerCount && normalized.localSpectator) ports.notify(ports.translate('room.switchedToSpectator', {count:normalized.playerCount}));
      void prepareResources();
    }
    else if (state.preparation) reportProgress(state.preparation);
    if (movementChanged && state.seat != null) void ensureMovementAllowed();
  }
  function connect(reconnecting = false) {
    if (!room || !product || stopped || disposed) return;
    const ownedRoom = room;
    let firstState = true;
    const resume = reconnecting || restoredMembership ? {seat:state.seat, spectator:state.spectatorRequested} : null;
    clientId = ports.identity.lobbyClientId(product);
    let relay;
    try {relay = buildMultiplayerLobbyRelayUrl(ports.relayUrl(product), {product, roomCode: room.code, clientId,
      memberId: ports.memberId(), intent, visibility: room.visibility, disableCheatMovement: room.disableCheatMovement,
      challengeMode: room.challengeMode, prankMode: false, playerCount: room.playerCount, difficulty: room.difficulty, roomProducts: true, roomCards: true});}
    catch {return;}
    if (socket && socketRoom === relay.roomId && socket.readyState <= 1) return;
    if (reconnectTimer !== null) cancel(reconnectTimer); reconnectTimer = null;
    if (!reconnecting) reconnectAttempt = 0;
    const previous = socket; socket = null; state.connected = false;
    if (previous && previous.readyState < 2) {try {previous.close(1000, 'replace lobby socket');} catch {}}
    const next = ports.createSocket(relay.url);
    state.directorySupported = false; state.controlModesSupported = false;
    state.productSwitchSupported = false; state.roomCardsSupported = false; state.selectionStateSupported = false; state.editingStateSupported = false; state.retentionSupported = false;
    reportedProductBusy = null;
    ports.network.reset(reconnecting); socket = next; socketRoom = relay.roomId;
    room.connection = reconnecting ? 'reconnecting' : 'connecting'; publish();
    next.addEventListener('open', () => {
      if (socket !== next || room !== ownedRoom || disposed) return;
      state.connected = true; reconnectAttempt = 0; ownedRoom.connection = ownedRoom.synced ? 'connected' : 'syncing';
      if (state.seat != null) {
        send({type: 'take-seat', seat: state.seat, loadout: state.preferredLoadout, ready: state.ready, name: state.displayName, ...input()});
        if (ownerLocal() && !(ownedRoom.disableCheatMovement && ports.settings().touchMovementMode === 'touch-unlimited')) sendSettings();
      } else if (state.spectatorRequested) send({type: 'spectate', name: state.displayName});
      publish();
    });
    next.addEventListener('message', event => {
      if (socket !== next || room !== ownedRoom || disposed) return;
      let message: Record<string, unknown> | null;
      try {message = record(JSON.parse(String(event.data)));} catch {return;}
      if (!message) return;
      if (message.type === 'room-probe-config' || message.type === 'room-probe') {void ports.network.receive(message); return;}
      if (message.type === 'quick-chat') {ports.quickChat?.receive(message); return;}
      if (message.type === 'state') {
        if (record(message.roomDirectory)?.version === 1) state.directorySupported = true;
        if (record(message.roomDirectory)?.controlModes === true) state.controlModesSupported = true;
        if (record(message.roomDirectory)?.roomCards === 1) state.roomCardsSupported = true;
        if (record(message.roomDirectory)?.selectionState === 1) state.selectionStateSupported = true;
        if (record(message.roomDirectory)?.editingState === 1) state.editingStateSupported = true;
        if (record(message.roomDirectory)?.roomRetention === 1) state.retentionSupported = true;
        if (record(message.roomDirectory)?.roomProducts === 1 && !state.productSwitchSupported) {
          state.productSwitchSupported = true;
        }
        intent = 'join'; ports.routes.settleInvite();
        const probe = record(message.roomProbe);
        if (probe) void ports.network.receive({type: 'room-probe-config', iceServers: probe.iceServers});
        state.startSerial = Math.max(0, Number(record(message.room)?.startSerial) || 0);
        applySnapshot(message.room);
        if (firstState && state.productSwitchSupported && resume && room && state.seat == null && !state.spectatorRequested && room.phase === 'lobby') {
          if (resume.spectator || resume.seat != null && resume.seat >= room.playerCount) {state.spectatorRequested = true; send({type:'spectate',name:state.displayName}); publish();}
          else if (resume.seat != null && !room.seats?.[resume.seat]) void takeSeat(resume.seat);
        }
        firstState = false; restoredMembership = false;
        if (autoSeat) {
          autoSeat = false;
          const empty = room?.seats?.slice(0, room.playerCount).findIndex(seat => !seat) ?? -1;
          if (state.seat == null && empty >= 0) void takeSeat(empty);
        }
        if (room?.retainedHostId === clientId && !state.parked && !retentionRequest) send({type:'resume-room'});
      } else if (message.type === 'start') {
        applySnapshot(message.room);
        const serial = Number(message.serial) || 0;
        if (serial > state.startSerial) {
          state.startSerial = serial; publish();
          if (!state.parked && (state.seat != null || state.spectatorRequested)) void launch();
        }
      } else if (message.type === 'spectator-start') {
        applySnapshot(message.room); state.startSerial = Math.max(state.startSerial, Number(message.serial) || 0); publish();
        if (!state.parked && state.spectatorRequested && !ports.isLaunched()) void launch();
      } else if (message.type === 'error' && message.error) {
        if (message.code === 'room-retention') {clearRetentionRequest(); publish();}
        if (message.code === 'room-product' && productRequest) {cancel(productRequest.timer); productRequest = null; publish();}
        if (message.code === 'movement-policy') {
          const seat = Number(message.seat); if (room) room.disableCheatMovement = true;
          publish();
          const decisionEpoch = epoch;
          void ensureMovementAllowed().then(ok => {if (ok && current(decisionEpoch) && state.seat == null && Number.isInteger(seat)) void takeSeat(seat);});
        } else ports.notify(String(message.error));
      }
    });
    next.addEventListener('close', event => {
      if (socket !== next || room !== ownedRoom || disposed) return;
      ports.network.reset(true); socket = null; state.connected = false;
      if (productRequest) cancel(productRequest.timer); productRequest = null;
      clearRetentionRequest();
      if ([4004, 4007, 4008, 4009, 4010, 4011].includes(event.code)) {
        stopped = true;
        const message = ports.translate(event.code === 4011 ? 'room.dissolved' : event.code === 4004 ? 'lobby.expired' : event.code === 4008 ? 'lobby.replaced' :
          event.code === 4009 ? 'lobby.conflict' : event.code === 4010 ? 'lobby.removed' : 'lobby.gone');
        // Main750–769: departure owns destination feedback; a live Runtime
        // retains the room and gets its explanation here instead.
        if (!ports.isLaunched()) {leave(message); return;}
        publish();
        ports.notify(message); return;
      }
      if (room?.code === ownedRoom.code) {room.connection = 'reconnecting'; scheduleReconnect(ownedRoom.code);}
      publish();
    });
    // Main's room owner retains usable state on error; close/reconnect owns recovery.
    next.addEventListener('error', () => {});
  }
  function resetRoom() {
    clearRetentionRequest(); state.parked = false;
    restoredMembership = false;
    if (productRequest) cancel(productRequest.timer); productRequest = null; productBusy = false;
    ownerController.abort(); ownerController = new AbortController();
    preparation?.controller.abort(); preparation = null; state.preparation = null;
    reportedSocket = null; reportedResourceKey = ''; disconnect();
    if (product) ports.sessions.clear(product);
    epoch++; room = null; state.seat = null; state.ready = false; state.selectionConfirmed = false; state.spectatorRequested = false;
    state.roomSettingsOpen = false; state.startSerial = 0; state.launchBusy = false; state.checkBusy = false;
    state.editingSettings = false; reportedEditing = null;
  }
  function hydrateProduct(next: MultiplayerProductId) {
    product = next;
    const preferred = ports.preferences.load({product: next, multiplayer: true, maxLoadout: policy()!.loadouts.length});
    state.preferredLoadout = preferred.preferredLoadout ?? 0;
    state.displayName = ports.identity.loadDisplayName();
  }
  function restoreInvite(source: string | URL, selectedProduct?: MultiplayerProductId): boolean {
    const invite = resolveRoomInvite(source);
    const code = normalizeRoomCode(invite?.r);
    if (!invite || !code || (!selectedProduct && !isMultiplayerProductId(invite.g))) return false;
    const restoredProduct = selectedProduct ?? invite.g;
    if (!isMultiplayerProductId(restoredProduct)) return false;
    if (room && product === restoredProduct && room.code === code) return true;
    // Read the saved room before retiring a previous lifetime.
    const config = multiplayerConfigForProduct(restoredProduct)!;
    let saved = ports.sessions.load({product: restoredProduct, roomCode: code, playerCounts: config.playerCounts, difficulties: config.difficulties});
    // A v1 switchable room has one logical number. Its old invite may still
    // name the previous title, while only the latest per-title record remains.
    if (!saved) for (const candidate of PRODUCT_IDS) {
      if (!isMultiplayerProductId(candidate)) continue;
      const rules = multiplayerConfigForProduct(candidate)!;
      const other = ports.sessions.load({product:candidate,roomCode:code,playerCounts:rules.playerCounts,difficulties:rules.difficulties});
      if (other?.room.roomProducts) {saved = other; break;}
    }
    resetRoom(); hydrateProduct(restoredProduct); stopped = false; intent = invite.a || '';
    restoredMembership = !!saved;
    state.fromDirectory = invite.f === true; autoSeat = state.fromDirectory && intent === 'join';
    const created = state.fromDirectory && intent === 'create';
    const requestedCount = invite.p;
    room = {code, playerCount: saved?.room.playerCount ?? (created && config.playerCounts.includes(requestedCount as 2 | 3) ? requestedCount as 2 | 3 : config.playerCounts[0]),
      difficulty: saved?.room.difficulty ?? (created ? Math.max(0, Math.min(config.difficulties.length - 1, Math.trunc(invite.d ?? 0))) : 1),
      created: created || !!saved?.room.created, visibility: saved?.room.visibility ?? (invite.v === 'private' ? 'private' : 'public'),
      disableCheatMovement: saved?.room.disableCheatMovement ?? invite.c === true,
      challengeMode: saved?.room.challengeMode ?? false, prankMode: false, seats: null, synced: false, connection: 'connecting'};
    state.seat = saved?.seat ?? (created ? 0 : null); state.ready = !!saved?.ready;
    state.spectatorRequested = !!saved?.spectatorRequested; state.roomSettingsOpen = !!saved?.roomSettingsOpen;
    state.timingChoice = 'auto'; state.rollbackEnabled = multiplayerInputTimingPolicy(config).rollback;
    ports.routes.restore({product: restoredProduct, code, fromDirectory: state.fromDirectory});
    publish(); connect(); void prepareResources(); return true;
  }
  function enterRoom(nextProduct: MultiplayerProductId, codeInput: string, created: boolean) {
    const code = normalizeRoomCode(codeInput); if (!code || !isMultiplayerProductId(nextProduct)) return;
    resetRoom(); hydrateProduct(nextProduct); stopped = false; intent = created ? 'create' : 'join'; autoSeat = false;
    state.fromDirectory = false; state.timingChoice = 'auto'; state.rollbackEnabled = multiplayerInputTimingPolicy(policy()).rollback;
    room = {code, playerCount: policy()!.playerCounts[0], difficulty: 1, created, seats: null, synced: false, connection: 'connecting'};
    state.seat = created ? 0 : null;
    ports.routes.enter({product: nextProduct, code, created}); publish(); connect(); void prepareResources();
  }
  function leave(message?: string) {
    if (!room || !product) return;
    const destination = {product, fromDirectory: state.fromDirectory, ...(message ? {message} : {})};
    const parked = state.parked;
    resetRoom(); publish();
    if (parked) {if (message) ports.notify(message);} else ports.routes.leave(destination);
  }
  function clearRetentionRequest() {
    if (retentionRequest) cancel(retentionRequest.timer);
    retentionRequest = null;
  }
  function requestRetention(kind:'park'|'dissolve') {
    if (!room || !product || !state.connected || !ownerLocal() || room.phase !== 'lobby' || retentionRequest || productRequest || state.launchBusy || state.checkBusy || ports.isLaunched()) return;
    const timer = later(() => {retentionRequest = null; publish(); ports.notify(ports.translate('room.retentionFailed'));}, 8000);
    retentionRequest = {kind,timer};
    if (!send({type:kind === 'park' ? 'park-room' : 'dissolve-room'})) clearRetentionRequest();
    publish();
  }
  function returnToLobby() {
    if (!room || !product || retentionRequest) return;
    if (!ownerLocal() || room.phase !== 'lobby') {leave(); return;}
    if (state.retentionSupported) {requestRetention('park'); return;}
    // Main's browser membership works while this document keeps its socket.
    // New relays additionally retain it across directory reloads/closed tabs.
    if (state.ready) send({type:'set-ready',ready:false,...input()});
    state.ready = false; state.parked = true; publish();
    ports.routes.leave({product,fromDirectory:true});
  }
  function resumeRoom() {
    if (!room) return;
    state.parked = false;
    if (state.retentionSupported && room.retainedHostId === clientId) send({type:'resume-room'});
    publish();
  }
  async function dissolveRoom(commit: (action:()=>void)=>void|Promise<void> = action=>action()) {
    if (dissolveDecision || !room || !state.retentionSupported || !ownerLocal() || !state.connected || room.phase !== 'lobby' || retentionRequest || productRequest || state.launchBusy || state.checkBusy || ports.isLaunched()) return;
    const ownedEpoch = epoch, code = room.code;
    dissolveDecision = true;
    try {
      const choice = await ports.decisions.askDecision({title:ports.translate('room.dissolve'), message:ports.translate('room.dissolveConfirm',{code}), confirmText:ports.translate('room.dissolve'), tone:'danger'});
      if (choice !== 'confirm' || !current(ownedEpoch) || room?.code !== code || !ownerLocal()) return;
      await commit(() => {if (current(ownedEpoch) && room?.code === code) requestRetention('dissolve');});
    } finally {dissolveDecision = false;}
  }
  function ensureMovementAllowed(): Promise<boolean> {
    if (!room?.disableCheatMovement || ports.settings().touchMovementMode !== 'touch-unlimited') return Promise.resolve(true);
    if (movementDecision) return movementDecision;
    const ownedEpoch = epoch;
    movementDecision = ports.decisions.askDecision({title: ports.translate('room.movementRequired'), message: ports.translate('room.movementRequiredHint'),
      confirmText: ports.translate('room.useTouch'), secondaryText: ports.translate('room.useJoystick'), cancelText: ports.translate('action.cancel')})
      .then(choice => {if (choice === 'cancel' || !current(ownedEpoch)) return false; ports.setMovementMode(choice === 'secondary' ? 'joystick' : 'touch'); return true;})
      .finally(() => {movementDecision = null;});
    return movementDecision;
  }
  async function takeSeat(index: number) {
    if (!room?.synced || !state.connected || !Number.isInteger(index) || index < 0 || index >= room.playerCount || index === state.seat || room.seats?.[index]) return;
    const ownedEpoch = epoch;
    if (!await ensureMovementAllowed() || !current(ownedEpoch) || room.phase !== 'lobby' || room.seats?.[index]) return;
    send({type: 'take-seat', seat: index, loadout: state.preferredLoadout, ready: state.ready, name: state.displayName, ...input()});
  }
  function standUp() {
    if (!room?.synced || !state.connected || state.seat == null || !send({type: 'stand-up'})) return;
    state.seat = null; state.ready = false; state.spectatorRequested = false; publish();
  }
  function spectate() {
    if (!room?.synced || !state.connected || state.spectatorRequested || !send({type: 'spectate', name: state.displayName})) return;
    state.seat = null; state.ready = false; state.spectatorRequested = true; publish();
  }
  function leaveSpectator() {
    if (!room?.synced || !state.connected || !state.spectatorRequested || !send({type: 'leave-spectator'})) return;
    state.spectatorRequested = false; publish();
  }
  function setDisplayName(value: string) {
    const previous = state.displayName, result = ports.identity.updateDisplayName(value, previous);
    if (result.updated) state.displayName = result.name;
    if (result.updated && result.name !== previous && state.connected && room?.synced && (state.seat != null || state.spectatorRequested)) send({type: 'set-name', name: result.name});
    publish(); return result.name;
  }
  function changeLoadout(delta: number, selectionConfirmed?: boolean) {
    if (productRequest || state.parked || retentionRequest) return;
    if (state.seat != null && room?.phase !== 'lobby') return;
    const count = policy()?.loadouts.length || 0; if (!count || !product) throw new Error(ports.translate('multiplayer.loadoutEmpty'));
    state.preferredLoadout = (normalizePreferredLoadout(state.preferredLoadout, count) + delta + count) % count;
    ports.preferences.persistPreferredLoadout(product, state.preferredLoadout);
    state.selectionConfirmed = selectionConfirmed === true;
    const confirmation = state.selectionStateSupported && selectionConfirmed !== undefined ? {selectionConfirmed} : {};
    if (state.seat != null && send({type: 'set-loadout', loadout: state.preferredLoadout, ...confirmation})) {
      pendingLoadout = {socket, seat: state.seat, index: state.preferredLoadout, ...confirmation}; state.ready = false;
    }
    publish();
  }
  async function toggleReady() {
    if (state.editingSettings) return;
    if (state.seat == null || !state.connected || !room || pendingLoadout || productRequest || state.parked || retentionRequest) return;
    const ready = !state.ready, ownedEpoch = epoch;
    if (ready && (state.roomCardsSupported ? state.preparation?.status !== 'ready' : ['cancelled', 'importing'].includes(state.preparation?.status || ''))) return;
    if (ready && !await ensureMovementAllowed()) return;
    if (!current(ownedEpoch) || state.seat == null || room.phase !== 'lobby' || pendingLoadout || ready && state.roomCardsSupported && state.preparation?.status !== 'ready') return;
    if (send({type: 'set-ready', ready, ...input()})) {state.ready = ready; publish();}
  }
  function setRoomSettings(patch: Partial<Pick<MultiplayerRoomState, 'playerCount' | 'difficulty' | 'visibility' | 'disableCheatMovement' | 'challengeMode'>>) {
    if (!room || !ownerLocal() || !state.connected || productRequest) return;
    // Main count/difficulty selects have no phase guard; rule/visibility
    // buttons are lobby-only. Keep that action distinction in this owner.
    if (room.phase !== 'lobby' && (patch.visibility !== undefined || patch.disableCheatMovement !== undefined || patch.challengeMode !== undefined)) return;
    const config = policy()!;
    const playerCount = patch.playerCount && config.playerCounts.includes(patch.playerCount) ? patch.playerCount : room.playerCount;
    const difficulty = patch.difficulty === undefined ? room.difficulty : Math.max(0, Math.min(config.difficulties.length - 1, Math.trunc(Number(patch.difficulty) || 0)));
    // Count/difficulty inputs update their displayed selection immediately in main.
    if (patch.playerCount !== undefined) {room.playerCount = playerCount; if (state.seat != null && state.seat >= playerCount) state.seat = null;}
    if (patch.difficulty !== undefined) room.difficulty = difficulty;
    send({type: 'settings', playerCount, difficulty, visibility: patch.visibility ?? room.visibility ?? 'public',
      disableCheatMovement: patch.disableCheatMovement ?? !!room.disableCheatMovement,
      challengeMode: patch.challengeMode ?? !!room.challengeMode, prankMode: false}); publish();
  }
  function requestRoomProduct(message: Record<string, unknown>): boolean {
    if (!room || !ownerLocal() || !state.connected || room.phase !== 'lobby' || !state.productSwitchSupported || productRequest || productBusy || state.checkBusy || state.launchBusy || ports.isLaunched()) return false;
    const version = room.productVersion ?? 1;
    if (!send({...message, version})) return false;
    const timer = later(() => {productRequest = null; publish(); ports.notify(ports.translate('room.switchTimeout'));}, 8000);
    productRequest = {version, timer}; publish(); return true;
  }
  function setDirectoryLocked(locked: boolean): boolean {
    if (!room || (room.directoryLocked !== false) === locked) return false;
    return requestRoomProduct({type:'directory-lock', locked});
  }
  function switchProduct(next: MultiplayerProductId): boolean {
    if (!snapshot.canSwitchProduct || next === product || !isMultiplayerProductId(next)) return false;
    return requestRoomProduct({type:'set-product', product:next});
  }
  function setRoomProductBusy(busy: boolean) {
    if (productBusy === busy) return;
    productBusy = busy; if (state.productSwitchSupported) publish();
  }
  function timingRecommendation() {
    const config = policy();
    if (config?.inputTiming?.measuredStartup) return {inputDelay: 0, targetRollbackFrames: multiplayerInputTimingPolicy(config).rollback && state.rollbackEnabled ? config.inputTiming.rollbackLimit : 0, networkFrames: 0, mobileSeats: 0};
    const seats = room?.seats?.slice(0, room.playerCount) || [];
    const settings = ports.settings();
    const phones = seats.reduce((count, seat, index) => count + (seat && (seat.mobileDevice || (index === state.seat && (settings.mobileDevice || settings.touchEnabled))) ? 1 : 0), 0);
    const peers = seats.flatMap(seat => seat && seat.clientId !== clientId && !seat.offline ? [seat.clientId] : []);
    return recommendMultiplayerInputTiming(phones, ports.network.minimumRtt(peers), 0, config?.inputTiming?.rollbackLimit ?? 8);
  }
  function setTimingChoice(value: 'auto' | number) {
    if (!ownerLocal() || room?.phase !== 'lobby') return;
    const max = policy()?.inputTiming?.manualDelayLimit ?? 8;
    if (value !== 'auto' && (!Number.isInteger(value) || value < 0 || value > max)) return;
    state.timingChoice = value; publish();
  }
  function setRollbackEnabled(enabled: boolean) {
    if (!ownerLocal() || room?.phase !== 'lobby' || !policy()?.inputTiming?.measuredStartup || !multiplayerInputTimingPolicy(policy()).rollback) return;
    state.rollbackEnabled = enabled; publish();
  }
  function start() {
    if (!snapshot.canStart) return;
    const timing = policy()?.inputTiming;
    if (!timing) {send({type: 'start'}); return;}
    const timingPolicy = multiplayerInputTimingPolicy(policy());
    const rollback = timingPolicy.rollback && state.rollbackEnabled;
    const measured = timingPolicy.measuredStartup, adonisMode = measured ? rollback ? 0 : 1 : 0;
    const automatic = !rollback && measured && state.timingChoice === 'auto';
    const selected = Number(state.timingChoice);
    const inputDelay = rollback || automatic ? 0 : Number.isInteger(selected) && selected >= 0 && selected <= (adonisMode ? timingPolicy.manualDelayLimit : 8)
      ? selected : timingRecommendation().inputDelay;
    send({type: 'start', inputDelay, ...(measured ? {adonisMode, inputDelayAuto: automatic, predictionReserve: 2} : {}),
      ...(!timingPolicy.rollback || timing.sendPredictionLimit != null ? {predictionLimit: timingPolicy.predictionLimit} : {})});
  }
  function runtimeOptions(): MultiplayerRuntimeOptions {
    if (!room || !product || pendingLoadout) throw new Error(ports.translate('multiplayer.roomStateInvalid'));
    const config = policy()!, spectator = state.seat == null && state.spectatorRequested;
    if (!spectator && (state.seat == null || state.seat < 0 || state.seat >= room.playerCount)) throw new Error(ports.translate('multiplayer.roomStateInvalid'));
    const url = buildMultiplayerGameplayRelayUrl(ports.relayUrl(product), {product, roomCode: room.code,
      runId: state.startSerial, role: spectator ? {spectator: clientId} : {player: state.seat!}, memberId: ports.memberId()});
    const seen = new Set<number>();
    const primary = config.loadouts.flatMap((loadout, index) => {
      if (seen.has(loadout.character)) return []; seen.add(loadout.character); return [index];
    });
    const defaults = primary.length ? primary : [0];
    const loadouts = Array.from({length: 3}, (_, index) => {
      const choice = room!.seats?.[index]?.loadout ?? defaults[index % defaults.length] ?? 0;
      const loadout = config.loadouts[normalizePreferredLoadout(choice, config.loadouts.length)] ?? config.loadouts[0];
      if (!loadout) throw new Error(ports.translate('multiplayer.loadoutEmpty'));
      return {character: loadout.character, shot: loadout.shot};
    });
    return buildMultiplayerRuntimeOptions({url, player: spectator ? 0 : state.seat, playerCount: room.playerCount,
      seed: Number.parseInt(room.code, 10) & 0xffff, difficulty: Math.max(0, Math.min(config.difficulties.length - 1, room.difficulty)),
      ...(config.inputTiming ? {inputDelay: Number(room.inputDelay) || 0} : {}),
      ...(config.inputTiming?.measuredStartup ? {inputDelayAuto: room.inputDelayAuto ?? false,
        predictionReserve: room.predictionReserve ?? 2, adonisMode: Number(room.adonisMode) || 0} : {}),
      ...(!multiplayerInputTimingPolicy(config).rollback || config.inputTiming?.sendPredictionLimit != null ? {predictionLimit: room.predictionLimit ?? multiplayerInputTimingPolicy(config).predictionLimit} : {}),
      spectator, spectatorId: spectator ? clientId : '',
      spectatorCount: Math.max(0, Number(room.spectatorCount) || 0),
      ...(config.gameplay === 'cooperative' ? {challengeMode: room.challengeMode === true} : {}),
      iceServers: ports.settings().iceServers, loadouts}, config);
  }
  async function launch() {
    if (!room || !product || state.launchBusy || (ports.isLaunched() && !ports.canLaunchFromTitle?.())) return;
    const owned = context(); state.launchBusy = true; publish();
    try {
      await prepareResources();
      if (!owned.isCurrent() || ['cancelled', 'importing'].includes(state.preparation?.status || '')) return;
      if (state.seat != null && !await ensureMovementAllowed()) return;
      if (!owned.isCurrent()) return;
      await ports.launch({...owned, runtimeOptions: runtimeOptions(), snapshot});
    } catch (error) {if (owned.isCurrent()) await ports.operationFailed(error, 'launch', owned);}
    finally {if (owned.isCurrent()) {state.launchBusy = false; publish();}}
  }
  async function checkGame() {
    if (!room || (room.phase && room.phase !== 'lobby') || state.seat == null || state.ready || state.checkBusy || state.launchBusy || ports.isLaunched()) return;
    const owned = context(); state.checkBusy = true; state.launchBusy = true; publish();
    try {
      await prepareResources();
      if (!owned.isCurrent() || ['cancelled', 'importing'].includes(state.preparation?.status || '')) return;
      await ports.checkGame(owned);
      if (owned.isCurrent()) ports.notify(ports.translate('multiplayer.checkGamePassed'));
    } catch (error) {
      if (owned.isCurrent()) {
        await ports.operationFailed(error, 'check', owned);
        if (owned.isCurrent()) ports.notify(ports.translate('multiplayer.checkGameFailed', {reason: errorText(error)}), 4000);
      }
    } finally {if (owned.isCurrent()) {state.checkBusy = false; state.launchBusy = false; publish();}}
  }
  function cancelPreparation() {
    if (!preparation || preparation.epoch !== epoch || state.preparation?.status !== 'preparing' || state.preparation.stage !== 'package') return;
    preparation.controller.abort();
    reportProgress({...state.preparation, status: 'cancelled'});
    if (state.ready) {send({type: 'set-ready', ready: false, ...input()}); state.ready = false; publish();}
    ports.beginManualImport(context());
  }
  function retryPreparation() {
    if (!room || !['cancelled', 'failed'].includes(state.preparation?.status || '')) return;
    ports.beforePreparationRetry?.();
    preparation = null; void prepareResources();
  }
  function cancelImport() {
    // Main app9720–9723: failed import returns this existing preparation to
    // cancelled. It neither opens another dialog nor sends a new ready intent.
    if (!room || state.preparation?.status !== 'importing') return;
    reportProgress({...state.preparation, status: 'cancelled'});
  }
  function setImporting(importing: boolean) {
    if (!room || !state.preparation) return;
    if (importing) reportProgress({...state.preparation, status: 'importing'});
    else {preparation = null; void prepareResources();}
  }
  function removeEmptySeat(index: number) {
    if (!room || !state.roomCardsSupported || !ownerLocal() || !state.connected || room.phase !== 'lobby' || productRequest ||
        room.playerCount !== 3 || !Number.isInteger(index) || index < 0 || index >= 3 || room.seats?.[index]) return;
    send({type:'remove-seat', seat:index, settingsVersion:room.settingsVersion});
  }
  async function removePlayer(index: number) {
    const target = room?.seats?.[index], ownedEpoch = epoch;
    if (!target || target.clientId === clientId || !ownerLocal() || !state.connected || productRequest || room?.phase !== 'lobby') return;
    if (!await ports.decisions.askConfirmation({message: ports.translate('room.removePlayerConfirm', {seat: index + 1}),
      confirmText: ports.translate('room.removePlayer', {seat: index + 1}), tone: 'danger'})) return;
    if (current(ownedEpoch) && ownerLocal() && state.connected && room?.phase === 'lobby' && room.seats?.[index]?.clientId === target.clientId)
      send({type: 'remove-player', seat: index, clientId: target.clientId});
  }
  async function removeSpectator(targetClientId: string) {
    const ownedEpoch = epoch;
    if (!ownerLocal() || !state.connected || room?.phase !== 'lobby' || targetClientId === clientId || !room.spectators?.some(entry => entry.clientId === targetClientId)) return;
    if (!await ports.decisions.askConfirmation({message: ports.translate('room.removeSpectatorConfirm'),
      confirmText: ports.translate('room.removeSpectator'), tone: 'danger'})) return;
    if (current(ownedEpoch) && ownerLocal() && state.connected && room?.phase === 'lobby' && room.spectators?.some(entry => entry.clientId === targetClientId))
      send({type: 'remove-spectator', clientId: targetClientId});
  }
  function acceptMeasuredTiming(value: unknown) {
    const timing = parseMeasuredNetplayTiming(value);
    if (!timing || !room || !policy()?.inputTiming?.measuredStartup || timing.adonisMode !== room.adonisMode ||
        timing.automatic !== (room.inputDelayAuto ?? false) ||
        timing.predictionReserve !== (timing.adonisMode === 2 ? resolveAdonisPredictionReserve(timing.fullDelay, room.predictionReserve ?? 2, timing.automatic) : 0) ||
        (!timing.automatic && timing.inputDelay !== room.inputDelay)) return;
    if (room.timing && (['inputDelay', 'fullDelay', 'predictionReserve', 'rttP95Us', 'samples', 'lost', 'adonisMode', 'automatic'] as const)
      .some(key => room!.timing![key] !== timing[key])) return;
    room.inputDelay = timing.inputDelay; room.timing = timing;
    // Native timing is committed by gameplay P1, independently of room admin.
    if (state.seat === 0 && !state.spectatorRequested) send({type: 'timing-result', serial: state.startSerial, timing});
    publish();
  }
  function movementChanged() {
    if ((state.controlModesSupported || room?.disableCheatMovement) && room?.phase === 'lobby' && state.seat != null) {
      send({type: 'movement', ...input()}); void ensureMovementAllowed();
    }
  }
  function reconnect() {
    if (!room || state.connected || stopped || disposed) return;
    if (reconnectTimer !== null) cancel(reconnectTimer); reconnectTimer = null; connect(true);
  }
  function noteActivity(trusted: boolean) {
    const now = ports.now?.() ?? Date.now();
    if (!trusted || !state.directorySupported || ports.visible?.() === false || !room || now - lastActivity < 15000) return;
    lastActivity = now; send({type: 'activity'});
  }
  return {
    subscribe(listener: () => void) {listeners.add(listener); return () => {listeners.delete(listener);};},
    getSnapshot: () => snapshot,
    restoreInvite, enterRoom, leave, returnToLobby, resumeRoom, dissolveRoom, connect, reconnect, sendControl: send,
    resetRoomWithoutNavigation() {resetRoom(); publish();},
    takeSeat, standUp, spectate, leaveSpectator, setDisplayName, changeLoadout, toggleReady, setRoomSettings,
    setDirectoryLocked, switchProduct, setRoomProductBusy,
    removePlayer, removeEmptySeat, removeSpectator, start, runtimeOptions, launch, checkGame,
    prepareResources, cancelPreparation, retryPreparation, setImporting, cancelImport, ensureMovementAllowed, movementChanged,
    setTimingChoice, setRollbackEnabled, timingRecommendation, acceptMeasuredTiming, noteActivity,
    setRoomSettingsOpen(open: boolean) {state.roomSettingsOpen = open; publish();},
    setEditingSettings(open: boolean) {
      if (state.editingSettings === open) return;
      state.editingSettings = open;
      if (open && state.ready && room?.phase === 'lobby') {send({type:'set-ready',ready:false,...input()});state.ready = false;}
      publish();
    },
    pageHide() {ports.network.suspend?.(); disconnect('page suspended'); publish();},
    pageShow(persisted: boolean) {if (persisted) {reconnect(); publish();}},
    dispose() {
      if (disposed) return;
      // Document teardown must retain the room session for reload, like main's
      // pagehide disconnect. Explicit leave/reset owns session deletion.
      ownerController.abort(); preparation?.controller.abort(); disconnect('page suspended');
      disposed = true; listeners.clear();
    },
  };
}
export type MultiplayerRoomService = ReturnType<typeof createMultiplayerRoom>;
