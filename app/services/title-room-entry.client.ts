/** Native title entry is a receipt for ONE existing Runtime epoch. This owner
 * never opens a socket, writes room state, creates a frame or owns navigation. */
import {PRODUCT_GAMES, multiplayerProductIdForGame, type GameId, type MultiplayerProductId} from '../../src/contracts/product-catalog.mts';
import type {RuntimeService} from './runtime.client';
import type {MultiplayerRoomRoute} from './multiplayer-room-route';
import type {RoomLaunchRequest} from './multiplayer-room.client';

export interface TitleRoomSource {readonly epoch: number; readonly game: GameId; readonly productId: MultiplayerProductId}
export interface TitleRoomEntrySnapshot {readonly source: TitleRoomSource | null; readonly retiring: boolean; readonly error: string | null}
export interface TitleRoomEntryOptions {
  runtime: Pick<RuntimeService, 'getSnapshot' | 'subscribe' | 'subscribeEvents' | 'postInput' | 'close'>;
  onRequest(source: TitleRoomSource): void;
  onRetired(request: RoomLaunchRequest): void | Promise<void>;
}
export type TitleRoomEntryController = ReturnType<typeof createTitleRoomEntry>;
export function createTitleRoomEntry(options: TitleRoomEntryOptions) {
  const runtime = options.runtime, listeners = new Set<() => void>();
  let state: TitleRoomEntrySnapshot = Object.freeze({source: null, retiring: false, error: null});
  let route: MultiplayerRoomRoute | null = null, disposed = false;
  function update(patch: Partial<TitleRoomEntrySnapshot>) {if (disposed) return; state = Object.freeze({...state, ...patch}); for (const listener of listeners) listener();}
  function owns(source: TitleRoomSource | null = state.source) {
    const live = runtime.getSnapshot();
    return !!source && live.epoch === source.epoch && live.game === source.game && live.runtimeVariant === 'normal' &&
      live.ready && live.launched && !live.saveUnavailable && live.phase !== 'exited';
  }
  function selected(product: MultiplayerProductId) {return !!state.source && state.source.productId === product && route?.productId === product;}
  function assertRequest(source: TitleRoomSource, request: RoomLaunchRequest, signal: AbortSignal) {
    if (disposed || state.source !== source || signal.aborted || route?.productId !== request.productId || route.roomCode !== request.roomCode) throw new DOMException('Title room entry was superseded', 'AbortError');
  }
  const stopEvents = runtime.subscribeEvents(message => {
    if (disposed || message.event !== 'network-request' || state.source) return;
    const live = runtime.getSnapshot(), productId = live.game && multiplayerProductIdForGame(live.game);
    const game = live.game && PRODUCT_GAMES[live.game];
    if (!productId || !game || !('multiplayer' in game) || !game.multiplayer.titleRoomEntry || live.epoch == null ||
      message.epoch !== live.epoch || message.game !== live.game || live.runtimeVariant !== 'normal' || !live.ready || !live.launched || live.saveUnavailable) return;
    const source = Object.freeze({epoch: live.epoch, game: live.game!, productId});
    update({source, retiring: false, error: null});
    options.onRequest(source);
  });
  const stopRuntime = runtime.subscribe(() => {
    if (state.source && !state.retiring && !owns()) {route = null; update({source: null, error: null});}
  });
  return Object.freeze({
    getSnapshot: () => state,
    subscribe(listener: () => void) {listeners.add(listener); return () => {listeners.delete(listener);};},
    setRoute(next: MultiplayerRoomRoute | null) {route = next;},
    retains(product: MultiplayerProductId) {return !state.retiring && owns() && selected(product);},
    async retire(request: RoomLaunchRequest, signal: AbortSignal) {
      const source = state.source;
      if (!source || !owns(source) || !selected(request.productId) || state.retiring) throw Error('The requested title Runtime is no longer available.');
      assertRequest(source, request, signal);
      update({retiring: true, error: null});
      try {
        // Default close refuses save failures. No discard consent is inferred
        // from creating/joining a room or from the server's start message.
        const closed = await runtime.close();
        assertRequest(source, request, signal);
        const live = runtime.getSnapshot();
        if (!closed || live.epoch != null || live.ready || live.launched || live.saveError || live.closeError) throw Error(live.saveError ?? live.closeError ?? 'Save and close the title Runtime before starting multiplayer.');
        await options.onRetired(request);
        assertRequest(source, request, signal);
        update({source: null, retiring: false, error: null});
      } catch (error) {
        if (state.source === source) update({retiring: false, error: error instanceof Error ? error.message : String(error)});
        throw error;
      }
    },
    dismiss() {
      if (disposed || !state.source) return;
      const resume = !state.retiring && owns();
      route = null;
      update({source: null, retiring: false, error: null});
      if (resume) runtime.postInput('network-cancel', {});
    },
    dispose() {if (disposed) return; disposed = true; stopEvents(); stopRuntime(); listeners.clear(); route = null;},
  });
}
