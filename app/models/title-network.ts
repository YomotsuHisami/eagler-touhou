import {PRODUCT_GAMES, multiplayerProductIdForGame, isMultiplayerProductId, type GameId, type ProductId} from '../../src/contracts/product-catalog.mts';
import {normalizeRoomCode} from '../../src/launcher/route-state.mts';
import {errorText} from '../services/error-text';
export interface TitleNetworkSnapshot {open: boolean; room: boolean; code: string; focusRequest: number}
export interface TitleNetworkOptions {
  context(): {game: GameId; product: ProductId; launched: boolean; relayUrl: string};
  translate(key: string): string;
  toast(message: string): void;
  sendNetworkCancel(): Promise<unknown>;
  enterRoom(product: ProductId, code: string, created: boolean): void;
  /** Reset lobby session, restore ordinary product/variant and sole Router URL. */
  leaveRoom(): void;
  randomValues(array: Uint32Array): Uint32Array;
}
/** Main app869–926/6642–6652. This owns only the title-network overlay. The
 * session keeps its ordinary Runtime alive until real room launch sync/reset. */
export function createTitleNetwork(options: TitleNetworkOptions) {
  const listeners = new Set<() => void>();
  let disposed = false, snapshot: Readonly<TitleNetworkSnapshot> = Object.freeze({open: false, room: false, code: '', focusRequest: 0});
  function publish(patch: Partial<TitleNetworkSnapshot>) {if (disposed) return; snapshot = Object.freeze({...snapshot, ...patch}); for (const listener of listeners) listener();}
  function close(resume: boolean) {
    if (!snapshot.open || disposed) return;
    publish({open: false, room: false});
    if (resume && options.context().launched) void options.sendNetworkCancel().catch(error => {if (!disposed) options.toast(errorText(error));});
  }
  function enter(code: string, created: boolean) {
    const state = options.context();
    if (!snapshot.open || !state.launched || disposed) return;
    const product = multiplayerProductIdForGame(state.game); if (!product) return;
    publish({room: true}); options.enterRoom(product, code, created);
  }
  return {
    getSnapshot: () => snapshot, subscribe(listener: () => void) {listeners.add(listener); return () => {listeners.delete(listener);};},
    open() {
      const state = options.context();
      const game = PRODUCT_GAMES[state.game];
      if (disposed || isMultiplayerProductId(state.product) || !state.launched || !('multiplayer' in game) || !game.multiplayer.titleRoomEntry) return;
      if (!state.relayUrl) {options.toast(options.translate('multiplayer.serviceMissing')); void options.sendNetworkCancel().catch(() => {}); return;}
      publish({open: true, room: false, code: '', focusRequest: snapshot.focusRequest + 1});
    },
    setCode(value: string) {publish({code: normalizeRoomCode(value)});},
    create() {if (disposed) return; const value = options.randomValues(new Uint32Array(1)); enter(String(1000 + (value[0] ?? 0) % 9000), true);},
    join() {if (disposed) return; const code = normalizeRoomCode(snapshot.code); if (!code) {options.toast(options.translate('status.enterRoomCode')); return;} enter(code, false);},
    close,
    leave() {if (!snapshot.open || disposed) return; options.leaveRoom(); close(true);},
    dispose() {disposed = true; listeners.clear();},
  };
}
export type TitleNetworkModel = ReturnType<typeof createTitleNetwork>;
