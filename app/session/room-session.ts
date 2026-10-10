import {createRoomNetwork} from '../../src/launcher/room-network.mts';
import {createMultiplayerQuickChatModel} from '../../src/launcher/multiplayer-quick-chat-model.mts';
import {playQuickChatVoice} from '../../src/launcher/quick-chat-voice.mts';
import {createMultiplayerPreferenceStore} from '../../src/launcher/multiplayer-preferences.mts';
import type {MultiplayerIdentityStore} from '../../src/launcher/multiplayer-identity.mts';
import type {MultiplayerRoomSessionStore} from '../../src/launcher/multiplayer-room-session.mts';
import {createMultiplayerRoom, type MultiplayerRoomPorts} from '../services/multiplayer-room';
import type {GameSettingsModel} from '../models/game-settings';
import type {SitePreferencesModel} from '../models/site-preferences';
import type {RuntimeService} from '../services/runtime';

export interface RoomSessionOptions extends Omit<MultiplayerRoomPorts, 'identity' | 'sessions' | 'preferences' | 'network' | 'quickChat' | 'online' | 'visible'> {
  identity: MultiplayerIdentityStore;
  sessions: MultiplayerRoomSessionStore;
  storage: Storage | null;
  document: Document;
  window: Window;
  settingsModel: GameSettingsModel;
  sitePreferences: SitePreferencesModel;
  runtime(): RuntimeService | null;
  replayViewer(): boolean;
  titleOverlayOpen(): boolean;
}
/** Document-lived room transport, original probe channels and shared quick-chat state.
 * Gameplay remains the existing Runtime; probe metrics never certify its path. */
export function createRoomSession(options: RoomSessionOptions) {
  const {window, document} = options, listeners = new Set<() => void>();
  let revision = 0, disposed = false;
  const quickChat = createMultiplayerQuickChatModel({send: message => {service.sendControl(message);}, voice: playQuickChatVoice, timers: window});
  const changed = () => {if (!disposed) {revision++; for (const listener of listeners) listener();}};
  const probes = createRoomNetwork({send: message => service.sendControl(message), changed});
  const service = createMultiplayerRoom({...options,
    preferences: createMultiplayerPreferenceStore({storage: options.storage}), network: probes,
    quickChat: {receive: message => quickChat.receive(message)},
    online: () => window.navigator.onLine, visible: () => document.visibilityState === 'visible',
  });
  function sync() {
    if (disposed) return;
    const state = service.getSnapshot(), room = state.room, runtime = options.runtime()?.getSnapshot();
    probes.update({localId: state.localClientId,
      peers: (room?.seats ?? []).slice(0, room?.playerCount ?? 0).flatMap(seat => seat && !seat.offline ? [seat.clientId] : []),
      active: room?.synced === true && state.connected && state.seat != null && room.phase === 'lobby' && (!runtime?.launched || options.titleOverlayOpen()),
    });
    quickChat.update({visible: runtime?.launched === true && runtime.runtimeVariant === 'multiplayer' && !options.replayViewer() && !!room,
      room: room ? `${state.product}-${room.code}` : '', serial: state.startSerial, localSeat: state.seat,
      seats: room?.seats ?? [], connected: state.connected, language: options.settingsModel.getSnapshot()?.language ?? '',
      lessMotion: options.sitePreferences.getSnapshot().lessMotion});
    changed();
  }
  let previousControls = options.settingsModel.getSnapshot()?.options;
  const unsubscribeRoom = service.subscribe(sync), unsubscribeSettings = options.settingsModel.subscribe(() => {
    const current = options.settingsModel.getSnapshot()?.options;
    if (previousControls && current && (previousControls.touchEnabled !== current.touchEnabled || previousControls.touchMovementMode !== current.touchMovementMode)) service.movementChanged();
    previousControls = current; sync();
  });
  const unsubscribePreferences = options.sitePreferences.subscribe(sync);
  const pageHide = () => service.pageHide(), pageShow = (event: PageTransitionEvent) => service.pageShow(event.persisted);
  const visible = () => {if (document.visibilityState === 'visible') service.reconnect();};
  const activity = (event: Event) => service.noteActivity(event.isTrusted);
  window.addEventListener('pagehide', pageHide); window.addEventListener('pageshow', pageShow); window.addEventListener('online', service.reconnect);
  document.addEventListener('visibilitychange', visible); document.addEventListener('pointerdown', activity, {passive: true}); document.addEventListener('keydown', activity);
  return {
    service, network: {...probes, subscribe(listener: () => void) {listeners.add(listener); return () => {listeners.delete(listener);};}, getSnapshot: () => revision,
      retry(peer?: string) {probes.retry(peer); sync();}},
    sync,
    quickChat,
    dispose() {
      if (disposed) return;
      quickChat.dispose(); disposed = true;
      unsubscribeRoom(); unsubscribeSettings(); unsubscribePreferences(); service.dispose(); probes.reset(); listeners.clear();
      window.removeEventListener('pagehide', pageHide); window.removeEventListener('pageshow', pageShow); window.removeEventListener('online', service.reconnect);
      document.removeEventListener('visibilitychange', visible); document.removeEventListener('pointerdown', activity); document.removeEventListener('keydown', activity);
    },
  };
}
export type RoomSession = ReturnType<typeof createRoomSession>;
