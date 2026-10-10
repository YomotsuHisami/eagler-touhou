import {gameIdForProduct, isMultiplayerProductId, multiplayerConfigForProduct,
  type MultiplayerProductId} from '../../src/contracts/product-catalog.mts';
import {multiplayerDisplayInitial, type MultiplayerIdentityStore} from '../../src/launcher/multiplayer-identity.mts';
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
export interface RoomSettingsInput {touchMovementMode: string; touchEnabled: boolean; mobileDevice: boolean; iceServers: unknown;}
export interface RoomPreparationProgress extends MultiplayerResourceProgress {error: string; loaded?: number; total?: number; title?: string;}
export interface RoomOwnerSnapshot {
  product: MultiplayerProductId | null;
  room: Readonly<MultiplayerRoomState> | null;
  epoch: number;
  fromDirectory: boolean;
  connected: boolean;
  directorySupported: boolean;
  controlModesSupported: boolean;
  seat: number | null;
  ready: boolean;
  spectatorRequested: boolean;
  preferredLoadout: number;
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
  let reportedSocket: RoomSocket | null = null, reportedResourceKey = '', lastActivity = 0;
  let state = {fromDirectory: false, connected: false, directorySupported: false, controlModesSupported: false,
    seat: null as number | null, ready: false, spectatorRequested: false, preferredLoadout: 0, displayName: '',
    roomSettingsOpen: false, startSerial: 0, preparation: null as RoomPreparationProgress | null,
    launchBusy: false, checkBusy: false, timingChoice: 'auto' as 'auto' | number, rollbackEnabled: false};
  let snapshot: RoomOwnerSnapshot;
  const policy = () => product ? multiplayerConfigForProduct(product) : null;
  const ownerLocal = () => room?.synced === true && state.seat === 0;
  const current = (value: number) => !disposed && epoch === value && room !== null;
  function persist() {
    if (!product || !room) return;
    ports.sessions.save(product, {room: {code: room.code, playerCount: room.playerCount, difficulty: room.difficulty,
      created: room.created, visibility: room.visibility, disableCheatMovement: room.disableCheatMovement,
      challengeMode: room.challengeMode, prankMode: false}, seat: state.seat, ready: state.ready,
      spectatorRequested: state.spectatorRequested, roomSettingsOpen: state.roomSettingsOpen});
  }
  function publish() {
    const canStart = ownerLocal() && state.connected && state.ready && room?.phase === 'lobby' &&
      Array.isArray(room.seats) && room.seats.slice(0, room.playerCount).every(seat => seat && !seat.offline && seat.ready);
    snapshot = Object.freeze({...state, product, epoch, localClientId: clientId, room: room ? Object.freeze({...room}) : null, canStart: !!canStart,
      preparation: state.preparation ? Object.freeze({...state.preparation}) : null});
    if (!disposed) {persist(); for (const listener of listeners) listener();}
  }
  publish();
  function send(message: Record<string, unknown>): boolean {
    if (!state.connected || socket?.readyState !== 1) return false;
    // Privacy is a wire contract, not merely an avatar presentation choice.
    const payload = typeof message.name === 'string' ? {...message, name: multiplayerDisplayInitial(message.name, '')} : message;
    socket.send(JSON.stringify(payload)); return true;
  }
  function input() {
    const settings = ports.settings();
    return {movementMode: settings.touchMovementMode, touchEnabled: settings.touchEnabled,
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
  function disconnect() {
    ports.network.reset();
    if (reconnectTimer !== null) cancel(reconnectTimer);
    reconnectTimer = null; reconnectAttempt = 0;
    const previous = socket; socket = null; socketRoom = ''; state.connected = false;
    if (previous && previous.readyState < 2) {try {previous.close(1000, 'leave room');} catch {}}
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
    if (!room || state.seat !== 0) return;
    send({type: 'settings', playerCount: room.playerCount, difficulty: room.difficulty,
      visibility: room.visibility || 'public', disableCheatMovement: !!room.disableCheatMovement,
      challengeMode: !!room.challengeMode, prankMode: false});
  }
  function applySnapshot(value: unknown) {
    const config = policy(); if (!room || !config) return;
    const normalized = normalizeMultiplayerLobbySnapshot(value, {localClientId: clientId,
      playerCounts: config.playerCounts, difficulties: config.difficulties, loadouts: config.loadouts});
    if (!normalized) return;
    const movementChanged = !room.disableCheatMovement && normalized.disableCheatMovement;
    Object.assign(room, normalized, {synced: true, connection: 'connected', challengeMode: normalized.challengeMode ?? false,
      prankMode: false, inputDelayAuto: normalized.inputDelayAuto ?? false, predictionReserve: normalized.predictionReserve ?? 2,
      timing: normalized.timing ?? null, adonisMode: normalized.adonisMode ?? 0});
    state.seat = normalized.localSeat;
    if (state.seat != null) {
      const seat = normalized.seats[state.seat]; if (!seat) return;
      state.spectatorRequested = false; state.preferredLoadout = seat.loadout; state.ready = seat.ready;
    } else {
      if (normalized.localSpectator) state.spectatorRequested = true;
      state.ready = false; reportedResourceKey = '';
    }
    publish();
    if (state.preparation) reportProgress(state.preparation);
    if (movementChanged && state.seat != null) void ensureMovementAllowed();
  }
  function connect(reconnecting = false) {
    if (!room || !product || stopped || disposed) return;
    const ownedRoom = room, ownedEpoch = epoch;
    clientId = ports.identity.lobbyClientId(product);
    let relay;
    try {relay = buildMultiplayerLobbyRelayUrl(ports.relayUrl(product), {product, roomCode: room.code, clientId,
      memberId: ports.memberId(), intent, visibility: room.visibility, disableCheatMovement: room.disableCheatMovement,
      challengeMode: room.challengeMode, prankMode: false, playerCount: room.playerCount, difficulty: room.difficulty});}
    catch {return;}
    if (socket && socketRoom === relay.roomId && socket.readyState <= 1) return;
    if (reconnectTimer !== null) cancel(reconnectTimer); reconnectTimer = null;
    if (!reconnecting) reconnectAttempt = 0;
    const previous = socket; socket = null; state.connected = false;
    if (previous && previous.readyState < 2) {try {previous.close(1000, 'replace lobby socket');} catch {}}
    const next = ports.createSocket(relay.url);
    state.directorySupported = false; state.controlModesSupported = false;
    ports.network.reset(reconnecting); socket = next; socketRoom = relay.roomId;
    room.connection = reconnecting ? 'reconnecting' : 'connecting'; publish();
    next.addEventListener('open', () => {
      if (socket !== next || !current(ownedEpoch)) return;
      state.connected = true; reconnectAttempt = 0; ownedRoom.connection = ownedRoom.synced ? 'connected' : 'syncing';
      if (state.seat != null) {
        send({type: 'take-seat', seat: state.seat, loadout: state.preferredLoadout, ready: state.ready, name: state.displayName, ...input()});
        if (state.seat === 0 && !(ownedRoom.disableCheatMovement && ports.settings().touchMovementMode === 'touch-unlimited')) sendSettings();
      } else if (state.spectatorRequested) send({type: 'spectate', name: state.displayName});
      publish();
    });
    next.addEventListener('message', event => {
      if (socket !== next || !current(ownedEpoch)) return;
      let message: Record<string, unknown> | null;
      try {message = record(JSON.parse(String(event.data)));} catch {return;}
      if (!message) return;
      if (message.type === 'room-probe-config' || message.type === 'room-probe') {void ports.network.receive(message); return;}
      if (message.type === 'quick-chat') {ports.quickChat?.receive(message); return;}
      if (message.type === 'state') {
        if (record(message.roomDirectory)?.version === 1) state.directorySupported = true;
        if (record(message.roomDirectory)?.controlModes === true) state.controlModesSupported = true;
        intent = 'join'; ports.routes.settleInvite();
        const probe = record(message.roomProbe);
        if (probe) void ports.network.receive({type: 'room-probe-config', iceServers: probe.iceServers});
        state.startSerial = Math.max(0, Number(record(message.room)?.startSerial) || 0);
        applySnapshot(message.room);
        if (autoSeat) {
          autoSeat = false;
          const empty = room?.seats?.slice(0, room.playerCount).findIndex(seat => !seat) ?? -1;
          if (state.seat == null && empty >= 0) void takeSeat(empty);
        }
      } else if (message.type === 'start') {
        applySnapshot(message.room);
        const serial = Number(message.serial) || 0;
        if (serial > state.startSerial) {
          state.startSerial = serial; publish();
          if (state.seat != null || state.spectatorRequested) void launch();
        }
      } else if (message.type === 'spectator-start') {
        applySnapshot(message.room); state.startSerial = Math.max(state.startSerial, Number(message.serial) || 0); publish();
        if (state.spectatorRequested && !ports.isLaunched()) void launch();
      } else if (message.type === 'error' && message.error) {
        if (message.code === 'movement-policy') {
          const seat = Number(message.seat); if (room) room.disableCheatMovement = true;
          publish();
          void ensureMovementAllowed().then(ok => {if (ok && current(ownedEpoch) && state.seat == null && Number.isInteger(seat)) void takeSeat(seat);});
        } else ports.notify(String(message.error));
      }
    });
    next.addEventListener('close', event => {
      if (socket !== next || !current(ownedEpoch)) return;
      ports.network.reset(true); socket = null; state.connected = false;
      if ([4004, 4007, 4008, 4009, 4010].includes(event.code)) {
        stopped = true;
        const message = ports.translate(event.code === 4004 ? 'lobby.expired' : event.code === 4008 ? 'lobby.replaced' :
          event.code === 4009 ? 'lobby.conflict' : event.code === 4010 ? 'lobby.removed' : 'lobby.gone');
        if (!ports.isLaunched()) leave(message); else publish();
        ports.notify(message); return;
      }
      if (room?.code === ownedRoom.code) {room.connection = 'reconnecting'; scheduleReconnect(ownedRoom.code);}
      publish();
    });
    // Main's room owner retains usable state on error; close/reconnect owns recovery.
    next.addEventListener('error', () => {});
  }
  function resetRoom() {
    ownerController.abort(); ownerController = new AbortController();
    preparation?.controller.abort(); preparation = null; state.preparation = null;
    reportedSocket = null; reportedResourceKey = ''; disconnect();
    if (product) ports.sessions.clear(product);
    epoch++; room = null; state.seat = null; state.ready = false; state.spectatorRequested = false;
    state.roomSettingsOpen = false; state.startSerial = 0; state.launchBusy = false; state.checkBusy = false;
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
    const saved = ports.sessions.load({product: restoredProduct, roomCode: code, playerCounts: config.playerCounts, difficulties: config.difficulties});
    resetRoom(); hydrateProduct(restoredProduct); stopped = false; intent = invite.a || '';
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
    state.timingChoice = 'auto'; state.rollbackEnabled = false;
    ports.routes.restore({product: restoredProduct, code, fromDirectory: state.fromDirectory});
    publish(); connect(); void prepareResources(); return true;
  }
  function enterRoom(nextProduct: MultiplayerProductId, codeInput: string, created: boolean) {
    const code = normalizeRoomCode(codeInput); if (!code || !isMultiplayerProductId(nextProduct)) return;
    resetRoom(); hydrateProduct(nextProduct); stopped = false; intent = created ? 'create' : 'join'; autoSeat = false;
    state.fromDirectory = false; state.timingChoice = 'auto'; state.rollbackEnabled = false;
    room = {code, playerCount: policy()!.playerCounts[0], difficulty: 1, created, seats: null, synced: false, connection: 'connecting'};
    state.seat = created ? 0 : null;
    ports.routes.enter({product: nextProduct, code, created}); publish(); connect(); void prepareResources();
  }
  function leave(message?: string) {
    if (!room || !product) return;
    const destination = {product, fromDirectory: state.fromDirectory, ...(message ? {message} : {})};
    resetRoom(); publish(); ports.routes.leave(destination);
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
  function changeLoadout(delta: number) {
    const count = policy()?.loadouts.length || 0; if (!count || !product) throw new Error(ports.translate('multiplayer.loadoutEmpty'));
    state.preferredLoadout = (normalizePreferredLoadout(state.preferredLoadout, count) + delta + count) % count;
    ports.preferences.persistPreferredLoadout(product, state.preferredLoadout);
    if (state.seat != null) send({type: 'set-loadout', loadout: state.preferredLoadout}); publish();
  }
  async function toggleReady() {
    if (state.seat == null || !state.connected || !room) return;
    const ready = !state.ready, ownedEpoch = epoch;
    if (ready && ['cancelled', 'importing'].includes(state.preparation?.status || '')) return;
    if (ready && !await ensureMovementAllowed()) return;
    if (!current(ownedEpoch) || state.seat == null || room.phase !== 'lobby') return;
    if (send({type: 'set-ready', ready, ...input()})) {state.ready = ready; publish();}
  }
  function setRoomSettings(patch: Partial<Pick<MultiplayerRoomState, 'playerCount' | 'difficulty' | 'visibility' | 'disableCheatMovement' | 'challengeMode'>>) {
    if (!room || !ownerLocal() || !state.connected) return;
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
  function timingRecommendation() {
    const config = policy();
    if (config?.inputTiming?.measuredStartup) return {inputDelay: 0, targetRollbackFrames: state.rollbackEnabled ? 2 : 0, networkFrames: 0, mobileSeats: 0};
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
    if (!ownerLocal() || room?.phase !== 'lobby' || !policy()?.inputTiming?.measuredStartup) return;
    state.rollbackEnabled = enabled; publish();
  }
  function start() {
    if (!snapshot.canStart) return;
    const timing = policy()?.inputTiming;
    if (!timing) {send({type: 'start'}); return;}
    const measured = timing.measuredStartup === true, adonisMode = measured ? state.rollbackEnabled ? 2 : 1 : 0;
    const automatic = measured && state.timingChoice === 'auto';
    const selected = Number(state.timingChoice);
    const inputDelay = automatic ? 0 : Number.isInteger(selected) && selected >= 0 && selected <= (adonisMode ? 9 : 8)
      ? selected : timingRecommendation().inputDelay;
    send({type: 'start', inputDelay, ...(measured ? {adonisMode, inputDelayAuto: automatic, predictionReserve: 2} : {}),
      ...(timing.sendPredictionLimit != null ? {predictionLimit: timing.sendPredictionLimit} : {})});
  }
  function runtimeOptions(): MultiplayerRuntimeOptions {
    if (!room || !product) throw new Error(ports.translate('multiplayer.roomStateInvalid'));
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
      ...(config.inputTiming?.sendPredictionLimit != null ? {predictionLimit: Number(room.predictionLimit) || 8} : {}),
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
  async function removePlayer(index: number) {
    const target = room?.seats?.[index], ownedEpoch = epoch;
    if (!target || index <= 0 || !ownerLocal() || !state.connected || room?.phase !== 'lobby') return;
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
    if (ownerLocal() && !state.spectatorRequested) send({type: 'timing-result', serial: state.startSerial, timing});
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
    restoreInvite, enterRoom, leave, connect, reconnect, sendControl: send,
    resetRoomWithoutNavigation() {resetRoom(); publish();},
    takeSeat, standUp, spectate, leaveSpectator, setDisplayName, changeLoadout, toggleReady, setRoomSettings,
    removePlayer, removeSpectator, start, runtimeOptions, launch, checkGame,
    prepareResources, cancelPreparation, retryPreparation, setImporting, cancelImport, ensureMovementAllowed, movementChanged,
    setTimingChoice, setRollbackEnabled, timingRecommendation, acceptMeasuredTiming, noteActivity,
    setRoomSettingsOpen(open: boolean) {state.roomSettingsOpen = open; publish();},
    pageHide() {ports.network.suspend?.(); disconnect(); publish();},
    pageShow(persisted: boolean) {if (persisted) {reconnect(); publish();}},
    dispose() {
      if (disposed) return;
      // Document teardown must retain the room session for reload, like main's
      // pagehide disconnect. Explicit leave/reset owns session deletion.
      ownerController.abort(); preparation?.controller.abort(); disconnect();
      disposed = true; listeners.clear();
    },
  };
}
export type MultiplayerRoomService = ReturnType<typeof createMultiplayerRoom>;
