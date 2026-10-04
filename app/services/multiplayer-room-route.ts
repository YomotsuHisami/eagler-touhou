import {isMultiplayerProductId, isGameId, multiplayerProductIdForGame, PRODUCT_GAMES, type MultiplayerProductId} from '../../src/contracts/product-catalog.mts';
export interface MultiplayerRoomRoute {readonly productId: MultiplayerProductId; readonly roomCode: string; readonly search: string}
export function parseMultiplayerRoomRoute(pathname: string, search: string, titleEpoch?: number | null): MultiplayerRoomRoute | null {
  let product = /^\/play\/([^/]+)(?:\/(?:resources|replays|saves))?\/?$/.exec(pathname)?.[1];
  const query = new URLSearchParams(search), code = query.get('mpRoom');
  // A title query alone cannot create membership after reload or Forward.
  // Only the document's validated native request receipt grants this alias.
  if (product && isGameId(product) && titleEpoch != null && query.get('titleRoom') === String(titleEpoch)) {
    const multiplayer = multiplayerProductIdForGame(product);
    const game = PRODUCT_GAMES[product];
    if (multiplayer && 'multiplayer' in game && game.multiplayer.titleRoomEntry) product = multiplayer;
  }
  return product && isMultiplayerProductId(product) && code && /^\d{4,8}$/.test(code) ? Object.freeze({productId: product, roomCode: code, search}) : null;
}
