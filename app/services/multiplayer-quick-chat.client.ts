import {quickChatPhrase, type QuickChatPhrase} from '../../src/contracts/multiplayer-quick-chat.mts';

export interface QuickChatSeat {readonly clientId: string; readonly name: string}
export interface QuickChatContext {
  readonly visible: boolean;
  readonly room: string;
  readonly sessionSerial: number;
  readonly serial: number;
  readonly localSeat: number | null;
  readonly seats: readonly (QuickChatSeat | null)[];
  readonly connected: boolean;
  readonly language: string;
  readonly lessMotion: boolean;
}
export interface QuickChatEvent {
  readonly room: string;
  readonly sessionSerial: number;
  readonly serial: number;
  readonly seat: number;
  readonly clientId: string;
  readonly phrase: QuickChatPhrase;
}
export interface QuickChatEntry {
  readonly id: number;
  readonly clientId: string;
  readonly seat: number;
  readonly name: string;
  readonly phrase: QuickChatPhrase;
  readonly fading: boolean;
}
export interface QuickChatSnapshot {
  readonly context: QuickChatContext | null;
  readonly entries: readonly QuickChatEntry[];
  readonly muted: readonly string[];
  readonly pickerOpen: boolean;
  readonly muteOpen: boolean;
}

const emptySnapshot: QuickChatSnapshot = Object.freeze({context: null, entries: Object.freeze([]), muted: Object.freeze([]), pickerOpen: false, muteOpen: false});
export interface QuickChatTimers {set(callback: () => void, ms: number): unknown; clear(handle: unknown): void}
export interface QuickChatStateOptions {timers?: QuickChatTimers; maxEntries?: number}
export interface QuickChatRuntimeMatchRequest {
  readonly launched: boolean;
  readonly ready: boolean;
  readonly runtimeVariant: string | undefined;
  readonly runtimeEpoch: number | null;
  readonly launcherVariant: string | null | undefined;
  readonly launcherEpoch: number | null;
  readonly launcherGame: string | null;
  readonly expectedGame: string;
  readonly replayViewer: boolean;
  readonly netplayUrl: string | undefined;
  readonly roomId: string;
  readonly serial: number;
}

/** Match the visible chat to the exact live multiplayer Runtime authority. */
export function multiplayerQuickChatRuntimeMatches(request: QuickChatRuntimeMatchRequest): boolean {
  if (!request.launched || !request.ready || request.runtimeVariant !== 'multiplayer' || request.launcherVariant !== 'multiplayer' ||
      request.replayViewer || !Number.isSafeInteger(request.runtimeEpoch) || request.runtimeEpoch! < 1 ||
      request.launcherEpoch !== request.runtimeEpoch || request.launcherGame !== request.expectedGame ||
      !Number.isSafeInteger(request.serial) || request.serial < 1 || !request.netplayUrl) return false;
  try {
    const url = new URL(request.netplayUrl);
    return url.searchParams.get('room') === request.roomId && url.searchParams.get('run') === String(request.serial);
  } catch {return false;}
}

/** Session-fenced transient chat state. It owns no Runtime, room transport, or game clock. */
export function createMultiplayerQuickChatState({timers = {
  set: (callback, ms) => globalThis.setTimeout(callback, ms),
  clear: handle => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
}, maxEntries = 50}: QuickChatStateOptions = {}) {
  if (!Number.isSafeInteger(maxEntries) || maxEntries < 1) throw new Error('Quick chat entry limit must be a positive integer');
  let snapshot = emptySnapshot, nextId = 0, disposed = false;
  const listeners = new Set<() => void>();
  const expiry = new Map<number, unknown>();
  const muted = new Set<string>();

  function publish(patch: Partial<QuickChatSnapshot>) {
    if (disposed) return;
    snapshot = Object.freeze({...snapshot, ...patch,
      entries: patch.entries ? Object.freeze([...patch.entries]) : snapshot.entries,
      muted: patch.muted ? Object.freeze([...patch.muted]) : snapshot.muted});
    listeners.forEach(listener => listener());
  }
  function clearEntries() {
    for (const timer of expiry.values()) timers.clear(timer);
    expiry.clear();
    publish({entries: Object.freeze([])});
  }
  function remove(id: number) {
    const timer = expiry.get(id);
    if (timer !== undefined) {timers.clear(timer); expiry.delete(id);}
    const entries = snapshot.entries.filter(entry => entry.id !== id);
    if (entries.length !== snapshot.entries.length) publish({entries});
  }
  function expire(id: number) {
    expiry.delete(id);
    const entry = snapshot.entries.find(item => item.id === id);
    if (!entry) return;
    if (!snapshot.context?.lessMotion && snapshot.context?.visible) {
      publish({entries: snapshot.entries.map(item => item.id === id ? Object.freeze({...item, fading: true}) : item)});
      expiry.set(id, timers.set(() => remove(id), 280));
    } else remove(id);
  }
  function update(next: QuickChatContext) {
    if (disposed) return;
    const previous = snapshot.context;
    const seats = Object.freeze(next.seats.map(seat => seat ? Object.freeze({clientId: seat.clientId, name: seat.name}) : null));
    const context = Object.freeze({...next, seats});
    if (previous && (previous.room !== context.room || previous.serial !== context.serial || previous.sessionSerial !== context.sessionSerial)) {
      clearEntries(); muted.clear();
      publish({muted: [], pickerOpen: false, muteOpen: false});
    }
    publish({context});
  }
  function receive(event: QuickChatEvent): boolean {
    const context = snapshot.context, phrase = quickChatPhrase(event.phrase?.id);
    if (disposed || !context?.visible || !phrase || event.room !== context.room || event.sessionSerial !== context.sessionSerial ||
        !Number.isSafeInteger(event.sessionSerial) || event.sessionSerial < 1 ||
        !Number.isSafeInteger(context.serial) || context.serial < 1 || !Number.isSafeInteger(event.serial) ||
        event.serial !== context.serial || !Number.isSafeInteger(event.seat) || event.seat < 0) return false;
    const seat = context.seats[event.seat];
    if (!seat || seat.clientId !== event.clientId) return false;
    const entry: QuickChatEntry = Object.freeze({id: ++nextId, clientId: seat.clientId, seat: event.seat, name: seat.name, phrase, fading: false});
    const entries = [...snapshot.entries, entry];
    while (entries.length > maxEntries) {
      const removed = entries.shift()!;
      const timer = expiry.get(removed.id);
      if (timer !== undefined) timers.clear(timer);
      expiry.delete(removed.id);
    }
    publish({entries});
    expiry.set(entry.id, timers.set(() => expire(entry.id), 3000));
    return true;
  }
  function setMuted(clientId: string, value: boolean) {
    if (!snapshot.context?.seats.some(seat => seat?.clientId === clientId) || clientId === snapshot.context.seats[snapshot.context.localSeat ?? -1]?.clientId) return;
    if (value) muted.add(clientId); else muted.delete(clientId);
    publish({muted: [...muted]});
  }
  return Object.freeze({
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {listeners.add(listener); return () => listeners.delete(listener);},
    update,
    receive,
    togglePicker() {
      if (!snapshot.context?.connected) return;
      const open = !snapshot.pickerOpen && !snapshot.muteOpen;
      publish({pickerOpen: open, muteOpen: false});
    },
    toggleMute() {const open = !snapshot.muteOpen; publish({muteOpen: open, pickerOpen: open});},
    close() {publish({pickerOpen: false, muteOpen: false});},
    setMuted,
    send(phraseId: string, sendPhrase: (id: string) => boolean): boolean {
      const context = snapshot.context;
      if (!context?.visible || !context.connected || context.localSeat == null || !quickChatPhrase(phraseId)) return false;
      const sent = sendPhrase(phraseId);
      if (sent) publish({pickerOpen: false, muteOpen: false});
      return sent;
    },
    visibleEntries: () => snapshot.entries.filter(entry => !muted.has(entry.clientId)),
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const timer of expiry.values()) timers.clear(timer);
      expiry.clear(); listeners.clear(); muted.clear(); snapshot = emptySnapshot;
    },
  });
}
