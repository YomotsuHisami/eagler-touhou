import {quickChatPhrase, type QuickChatPhrase} from '../contracts/multiplayer-quick-chat.mjs';

export interface QuickChatSeat {clientId: string; name: string}
export interface QuickChatContext {
  visible: boolean; room: string; serial: number; localSeat: number | null;
  seats: readonly (QuickChatSeat | null)[]; connected: boolean; language: string; lessMotion?: boolean;
}
export interface QuickChatEntry {readonly id: number; readonly clientId: string; readonly seat: number; readonly name: string; readonly phrase: QuickChatPhrase}
export interface QuickChatSnapshot {
  readonly context: QuickChatContext | null; readonly entries: readonly QuickChatEntry[];
  readonly muted: readonly string[]; readonly pickerOpen: boolean; readonly muteOpen: boolean;
}
interface Ports {
  send(message: Record<string, unknown>): void;
  voice(id: string): void;
  timers: {setTimeout(callback: () => void, delay: number): number; clearTimeout(id: number): void};
}
type ExpiryPresenter = (entry: QuickChatEntry) => Promise<void> | void;
/** One document-lived state/timer owner. Presentation may finish the original
 * expiry fade; geometry, DOM, focus, animation and audio objects stay outside. */
export function createMultiplayerQuickChatModel(ports: Ports) {
  let snapshot: QuickChatSnapshot = {context: null, entries: [], muted: [], pickerOpen: false, muteOpen: false};
  let sequence = 0, disposed = false, presenter: ExpiryPresenter | null = null;
  const listeners = new Set<() => void>(), timers = new Map<QuickChatEntry, number>(), expiring = new Set<QuickChatEntry>();
  function publish(next: QuickChatSnapshot) {snapshot = next; for (const listener of listeners) listener();}
  function cancel(entry: QuickChatEntry) {const timer = timers.get(entry); if (timer !== undefined) ports.timers.clearTimeout(timer); timers.delete(entry); expiring.delete(entry);}
  function remove(entry: QuickChatEntry) {
    if (disposed || !snapshot.entries.includes(entry)) return;
    cancel(entry); publish({...snapshot, entries: snapshot.entries.filter(item => item !== entry)});
  }
  function expire(entry: QuickChatEntry) {
    timers.delete(entry);
    if (disposed || !snapshot.entries.includes(entry)) return;
    expiring.add(entry);
    const pending = presenter?.(entry);
    if (pending) void pending.then(() => remove(entry), () => {});
    else remove(entry);
  }
  function update(next: QuickChatContext) {
    if (disposed) return;
    const previous = snapshot.context;
    const reset = previous?.room !== next.room || previous?.serial !== next.serial;
    const changed = reset || !previous || previous.visible !== next.visible || previous.localSeat !== next.localSeat ||
      previous.connected !== next.connected || previous.language !== next.language || previous.lessMotion !== next.lessMotion ||
      previous.seats.length !== next.seats.length || next.seats.some((seat, index) =>
        seat?.clientId !== previous.seats[index]?.clientId || seat?.name !== previous.seats[index]?.name);
    if (!changed) return;
    if (reset) for (const entry of snapshot.entries) cancel(entry);
    const context = {...next, seats: next.seats.map(seat => seat ? {...seat} : null)};
    publish({...snapshot, context, ...(reset ? {entries: [], muted: [], pickerOpen: false, muteOpen: false} : {})});
  }
  function receive(message: Record<string, unknown>) {
    if (disposed) return;
    const context = snapshot.context, phrase = quickChatPhrase(message.phrase);
    if (!context?.visible || !phrase || message.room !== context.room || message.serial !== context.serial ||
      typeof message.seat !== 'number' || !Number.isInteger(message.seat)) return;
    const seat = context.seats[message.seat];
    if (!seat || message.clientId !== seat.clientId) return;
    const entry: QuickChatEntry = {id: ++sequence, clientId: seat.clientId, seat: message.seat, name: seat.name, phrase};
    if (!snapshot.muted.includes(entry.clientId)) ports.voice(phrase.id);
    const entries = [...snapshot.entries, entry];
    if (entries.length > 50) cancel(entries.shift()!);
    publish({...snapshot, entries});
    if (!disposed && snapshot.entries.includes(entry)) timers.set(entry, ports.timers.setTimeout(() => expire(entry), 3000));
  }
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {listeners.add(listener); return () => {listeners.delete(listener);};},
    update, receive,
    togglePicker() {if (!disposed) publish({...snapshot, pickerOpen: !snapshot.pickerOpen && !snapshot.muteOpen, muteOpen: false});},
    toggleMute() {if (!disposed) publish({...snapshot, muteOpen: !snapshot.muteOpen, pickerOpen: snapshot.muteOpen});},
    toggleMember(clientId: string) {if (!disposed) publish({...snapshot, muted: snapshot.muted.includes(clientId) ? snapshot.muted.filter(id => id !== clientId) : [...snapshot.muted, clientId]});},
    dismiss() {if (!disposed) publish({...snapshot, pickerOpen: false, muteOpen: false});},
    sendPhrase(id: unknown) {
      const context = snapshot.context, phrase = quickChatPhrase(id);
      if (disposed || !phrase || context?.localSeat == null || !context.connected) return;
      ports.voice(phrase.id); ports.send({type: 'quick-chat', phrase: phrase.id, serial: context.serial});
      publish({...snapshot, pickerOpen: false});
    },
    setExpiryPresenter(next: ExpiryPresenter) {
      presenter = next;
      return () => {if (presenter !== next) return; presenter = null; for (const entry of [...expiring]) remove(entry);};
    },
    dispose() {
      if (disposed) return;
      for (const entry of snapshot.entries) cancel(entry);
      disposed = true; presenter = null; publish({...snapshot, entries: [], muted: [], pickerOpen: false, muteOpen: false}); listeners.clear();
    },
  };
}
export type MultiplayerQuickChatModel = ReturnType<typeof createMultiplayerQuickChatModel>;
