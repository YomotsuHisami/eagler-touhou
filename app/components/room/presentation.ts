import {gameIdForProduct, multiplayerConfigForProduct, PRODUCT_GAMES} from '../../../src/contracts/product-catalog.mts';
import type {RoomOwnerSnapshot} from '../../services/multiplayer-room';
import type {Translate} from '../../i18n';
import type {UiMessageKey} from '../../../src/launcher/i18n.mts';
import type {RoomViewContext} from './types';
export function roomPresentation(state: RoomOwnerSnapshot, t: Translate) {
  if (!state.product || !state.room) return null;
  const gameId = gameIdForProduct(state.product), game = PRODUCT_GAMES[gameId], config = multiplayerConfigForProduct(state.product)!;
  const normalize = (value: unknown) => {const count = config.loadouts.length; const index = Number.isInteger(Number(value)) ? Number(value) : 0; return count ? (index % count + count) % count : 0;};
  const loadout = config.loadouts[normalize(state.preferredLoadout)]!;
  const label = (index: unknown) => t(config.loadouts[normalize(index)]!.labelKey as UiMessageKey);
  return {gameId, game, config, normalize, loadout, label, room: state.room, ready: state.room.synced === true && state.connected, owner: state.room.synced === true && state.seat === 0};
}
export function networkMessage(state: RoomOwnerSnapshot, context: RoomViewContext, t: Translate): string {
  const room = state.room;
  if (!room) return '';
  const peers = (room.seats || []).slice(0, room.playerCount).filter((seat, index) => seat && index !== state.seat);
  return !state.connected || !room.synced ? t('multiplayer.reconnecting') : room.phase !== 'lobby' || context.launched && !context.th09NetworkOverlayOpen ? t('room.pausedTest') : state.seat == null ? t('room.seatToTest') : !peers.length ? t('room.waitPeer') : '';
}
export const roomMiB = (bytes: unknown) => `${(Math.max(0, Number(bytes) || 0) / 1048576).toFixed(1)} MiB`;
