import { QUICK_CHAT_ROWS, quickChatPhrase, type QuickChatPhrase } from "../contracts/multiplayer-quick-chat.mjs";
import { playQuickChatVoice } from "./quick-chat-voice.mjs";
import type { UiMessageKey } from "./i18n.mjs";

interface Seat { clientId: string; name: string }
interface Context {
  visible: boolean; room: string; serial: number; localSeat: number | null;
  seats: readonly (Seat | null)[]; connected: boolean; language: string; lessMotion?: boolean;
}
interface Entry { clientId: string; seat: number; name: string; phrase: QuickChatPhrase }

export class MultiplayerQuickChat {
  private context: Context | null = null;
  private entries: Entry[] = [];
  private readonly rows = new Map<Entry, HTMLParagraphElement>();
  private readonly expiryTimers = new Map<Entry, number>();
  private readonly fades = new Map<Entry, Animation>();
  private readonly moves = new Map<HTMLParagraphElement, Animation>();
  private muted = new Set<string>();
  private pickerOpen = false;
  private muteOpen = false;
  private readonly root = document.createElement("section");
  private readonly log = document.createElement("div");
  private readonly picker = document.createElement("div");
  private readonly muteList = document.createElement("div");
  private readonly prompt = document.createElement("button");
  private readonly muteButton = document.createElement("button");
  private readonly text: (key: UiMessageKey) => string;
  private readonly send: (message: Record<string, unknown>) => void;

  constructor(parent: HTMLElement, text: (key: UiMessageKey) => string,
    send: (message: Record<string, unknown>) => void) {
    this.text = text; this.send = send;
    this.root.className = "mp-quick-chat"; this.root.hidden = true;
    this.root.setAttribute("aria-label", text("chat.players"));
    this.log.className = "mp-quick-chat-log"; this.log.setAttribute("role", "log");
    this.log.setAttribute("aria-live", "polite");
    this.picker.className = "mp-quick-chat-picker";
    this.muteList.className = "mp-quick-chat-picker";
    this.prompt.type = this.muteButton.type = "button";
    this.prompt.className = "mp-quick-chat-prompt";
    this.muteButton.className = "mp-quick-chat-mute";
    this.prompt.addEventListener("click", () => {
      this.pickerOpen = !this.pickerOpen && !this.muteOpen; this.muteOpen = false; this.render();
    });
    this.muteButton.addEventListener("click", () => {
      this.muteOpen = !this.muteOpen; this.pickerOpen = !this.muteOpen; this.render();
    });
    this.root.addEventListener("keydown", event => {
      event.stopPropagation();
      if(event.key === "Escape") { this.pickerOpen = this.muteOpen = false; this.render(); }
    });
    // Keep the running iframe's focus and other fingers' input owners. Cancelling
    // focus transfer still permits clicks and native vertical touch scrolling.
    for (const name of ["pointerdown", "mousedown"] as const)
      this.root.addEventListener(name, event => event.preventDefault(), { capture: true });
    for(const name of ["keyup", "pointerdown", "pointermove", "pointerup", "pointercancel", "touchstart", "touchmove", "touchend", "touchcancel"])
      this.root.addEventListener(name, event => event.stopPropagation());
    this.root.append(this.prompt, this.picker, this.muteList, this.log);
    parent.append(this.root);
  }

  update(next: Context): void {
    const previous = this.context;
    const reset = previous?.room !== next.room || previous?.serial !== next.serial;
    const changed = reset || !previous || previous.visible !== next.visible ||
      previous.localSeat !== next.localSeat || previous.connected !== next.connected ||
      previous.language !== next.language || previous.lessMotion !== next.lessMotion ||
      previous.seats.length !== next.seats.length || next.seats.some((seat, index) =>
        seat?.clientId !== previous.seats[index]?.clientId || seat?.name !== previous.seats[index]?.name);
    if(reset) {
      this.clearEntries(); this.muted.clear(); this.pickerOpen = this.muteOpen = false;
    }
    this.context = {...next, seats: next.seats.map(seat => seat ? {...seat} : null)};
    this.root.hidden = !next.visible;
    if(changed) this.render();
  }

  receive(message: Record<string, unknown>): void {
    const ctx = this.context, phrase = quickChatPhrase(message.phrase);
    if(!ctx?.visible || !phrase || message.room !== ctx.room || message.serial !== ctx.serial ||
      typeof message.seat !== "number" || !Number.isInteger(message.seat)) return;
    const seat = ctx.seats[message.seat];
    if(!seat || message.clientId !== seat.clientId) return;
    const entry = {clientId: seat.clientId, seat: message.seat, name: seat.name, phrase};
    if (!this.muted.has(seat.clientId)) playQuickChatVoice(phrase.id);
    this.entries.push(entry);
    if(this.entries.length > 50) this.removeEntry(this.entries[0]!);
    this.renderLog();
    this.expiryTimers.set(entry, window.setTimeout(() => this.expireEntry(entry), 3000));
  }

  private label(phrase: QuickChatPhrase): string { return this.context?.language === "en" ? phrase.en : phrase.zh; }
  private animationDuration(duration: number): number {
    return this.context?.lessMotion || matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : duration;
  }
  private clearEntries(): void {
    for(const timer of this.expiryTimers.values()) clearTimeout(timer);
    for(const animation of this.fades.values()) animation.cancel();
    for(const animation of this.moves.values()) animation.cancel();
    this.entries = []; this.expiryTimers.clear(); this.fades.clear(); this.moves.clear(); this.rows.clear();
    this.log.replaceChildren();
  }
  private removeEntry(entry: Entry): void {
    const index = this.entries.indexOf(entry); if(index < 0) return;
    this.entries.splice(index, 1);
    clearTimeout(this.expiryTimers.get(entry)); this.expiryTimers.delete(entry);
    this.fades.get(entry)?.cancel(); this.fades.delete(entry);
    this.renderLog();
  }
  private expireEntry(entry: Entry): void {
    this.expiryTimers.delete(entry);
    const row = this.rows.get(entry), duration = this.animationDuration(280);
    if(!duration || !this.context?.visible || row?.parentElement !== this.log) {
      this.removeEntry(entry); return;
    }
    const animation = row.animate([{opacity: 1}, {opacity: 0}], {duration, easing: "ease-in", fill: "forwards"});
    this.fades.set(entry, animation);
    void animation.finished.then(() => this.removeEntry(entry), () => {});
  }
  private renderLog(): void {
    const previousTop = this.log.scrollTop;
    const following = this.log.scrollHeight - this.log.clientHeight - previousTop <= 4;
    const previousPositions = new Map([...this.rows.values()].filter(row => row.parentElement === this.log)
      .map(row => [row, {top: row.getBoundingClientRect().top, opacity: Number(getComputedStyle(row).opacity)}]));
    for(const animation of this.moves.values()) animation.cancel(); this.moves.clear();
    const visible = this.entries.filter(entry => !this.muted.has(entry.clientId));
    for(const [entry, row] of this.rows) {
      if(!visible.includes(entry)) row.remove();
      if(!this.entries.includes(entry)) this.rows.delete(entry);
    }
    const rows = visible.map(entry => {
      let row = this.rows.get(entry);
      if(!row) { row = document.createElement("p"); this.rows.set(entry, row); }
      const label = `P${entry.seat + 1} ${entry.name}: ${this.label(entry.phrase)}`;
      if(row.title !== label) {
        const author = document.createElement("strong"); author.textContent = `P${entry.seat + 1} ${entry.name}`;
        row.title = label; row.replaceChildren(author, document.createTextNode(`: ${this.label(entry.phrase)}`));
      }
      return row;
    });
    rows.forEach((row, index) => {
      const current = this.log.children[index]; if(current !== row) this.log.insertBefore(row, current ?? null);
    });
    this.log.scrollTop = following ? this.log.scrollHeight : previousTop;
    const duration = this.animationDuration(240);
    if(duration) rows.forEach((row, index) => {
      const previous = previousPositions.get(row);
      const delta = previous ? previous.top - row.getBoundingClientRect().top : 6;
      const fading = this.fades.has(visible[index]!);
      const opacity = previous?.opacity ?? 0;
      if(Math.abs(delta) < .5 && (fading || opacity >= .999)) return;
      // Capture the current presentation before cancelling an earlier move so
      // rapid messages continue smoothly. Expiry owns its opacity independently.
      const from: Keyframe = {transform: `translateY(${delta}px)`};
      const to: Keyframe = {transform: "translateY(0)"};
      if(!fading) { from.opacity = opacity; to.opacity = 1; }
      this.moves.set(row, row.animate([from, to], {duration, easing: "cubic-bezier(.2,.7,.2,1)"}));
    });
  }

  private render(): void {
    const ctx = this.context; if(!ctx) return;
    this.root.setAttribute("aria-label", this.text("chat.players"));
    this.prompt.textContent = this.text("chat.prompt");
    this.prompt.setAttribute("aria-expanded", String(this.pickerOpen || this.muteOpen));
    this.prompt.disabled = !ctx.connected;
    this.muteButton.textContent = this.text(this.muteOpen ? "chat.back" : "chat.mute");
    this.muteButton.setAttribute("aria-expanded", String(this.muteOpen));
    this.picker.hidden = !this.pickerOpen; this.muteList.hidden = !this.muteOpen;
    const rows = QUICK_CHAT_ROWS.map(phrases => {
      const row = document.createElement("div"); row.className = "mp-quick-chat-row";
      row.classList.toggle("paired", phrases.length === 2);
      row.append(...phrases.map(phrase => {
        const button = document.createElement("button"); button.type = "button"; button.textContent = this.label(phrase);
        button.className = "mp-quick-chat-phrase";
        button.dataset.phrase = phrase.id; button.title = this.label(phrase);
        button.disabled = ctx.localSeat == null || !ctx.connected;
        button.addEventListener("click", () => {
          if(this.context?.localSeat == null || !this.context.connected) return;
          playQuickChatVoice(phrase.id);
          this.send({type: "quick-chat", phrase: phrase.id, serial: this.context.serial});
          this.pickerOpen = false; this.render();
        }); return button;
      })); return row;
    });
    const empty = document.createElement("p"); empty.textContent = this.text("chat.empty");
    this.picker.replaceChildren(...rows, ...(rows.length ? [] : [empty]), ...(!this.muteOpen ? [this.muteButton] : []));
    this.muteList.replaceChildren(...ctx.seats.flatMap((seat, index) => {
      if(!seat || index === ctx.localSeat) return [];
      const button = document.createElement("button"); button.type = "button";
      button.className = "mp-quick-chat-mute-member";
      button.textContent = `P${index + 1} ${seat.name} · ${this.text(this.muted.has(seat.clientId) ? "chat.unmute" : "chat.mute")}`;
      button.setAttribute("aria-pressed", String(this.muted.has(seat.clientId)));
      button.addEventListener("click", () => {
        if(this.muted.has(seat.clientId)) this.muted.delete(seat.clientId); else this.muted.add(seat.clientId);
        this.render();
      }); return [button];
    }), ...(this.muteOpen ? [this.muteButton] : []));
    this.renderLog();
  }
}
