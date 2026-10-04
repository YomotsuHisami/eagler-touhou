import {isMultiplayerProductId, type MultiplayerProductId} from '../../src/contracts/product-catalog.mts';
export interface MultiplayerRoomRoute {readonly productId: MultiplayerProductId; readonly roomCode: string; readonly search: string}
export function parseMultiplayerRoomRoute(pathname: string, search: string): MultiplayerRoomRoute | null {
  const product = /^\/play\/([^/]+)(?:\/(?:resources|replays|saves))?\/?$/.exec(pathname)?.[1];
  const query = new URLSearchParams(search), code = query.get('mpRoom');
  return product && isMultiplayerProductId(product) && code && /^\d{4,8}$/.test(code) ? Object.freeze({productId: product, roomCode: code, search}) : null;
}
