import { QUICK_CHAT_ROWS, type QuickChatPhrase } from "../contracts/multiplayer-quick-chat.mjs";
import { playQuickChatVoice } from "./quick-chat-voice.mjs";
import {createMultiplayerQuickChatModel, type QuickChatContext as Context, type QuickChatEntry as Entry, type MultiplayerQuickChatModel} from "./multiplayer-quick-chat-model.mjs";
import type { UiMessageKey } from "./i18n.mjs";

export class MultiplayerQuickChat {
  private readonly model: MultiplayerQuickChatModel;
  private get context() {return this.model.getSnapshot().context;}
  private get entries() {return this.model.getSnapshot().entries;}
  private get muted() {return this.model.getSnapshot().muted;}
  private get pickerOpen() {return this.model.getSnapshot().pickerOpen;}
  private get muteOpen() {return this.model.getSnapshot().muteOpen;}
  private readonly rows = new Map<Entry, HTMLParagraphElement>();
  private readonly fades = new Map<Entry, Animation>();
  private readonly moves = new Map<HTMLParagraphElement, Animation>();
  private readonly root = document.createElement("section");
  private readonly log = document.createElement("div");
  private readonly picker = document.createElement("div");
  private readonly muteList = document.createElement("div");
  private readonly prompt = document.createElement("button");
  private readonly muteButton = document.createElement("button");
  private readonly text: (key: UiMessageKey) => string;


  constructor(parent: HTMLElement, text: (key: UiMessageKey) => string,
    send: (message: Record<string, unknown>) => void) {
    this.text = text;
    this.model = createMultiplayerQuickChatModel({send, voice: playQuickChatVoice, timers: window});
    this.model.setExpiryPresenter(entry => this.expireEntry(entry));
    let previous = this.model.getSnapshot();
    this.model.subscribe(() => {
      const next = this.model.getSnapshot();
      const full = next.context !== previous.context || next.muted !== previous.muted ||
        next.pickerOpen !== previous.pickerOpen || next.muteOpen !== previous.muteOpen;
      previous = next;
      this.root.hidden = !next.context?.visible;
      if (full) this.render(); else this.renderLog();
    });
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
      this.model.togglePicker();
    });
    this.muteButton.addEventListener("click", () => {
      this.model.toggleMute();
    });
    this.root.addEventListener("keydown", event => {
      event.stopPropagation();
      if(event.key === "Escape") this.model.dismiss();
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

  update(next: Context): void {this.model.update(next);}
  receive(message: Record<string, unknown>): void {this.model.receive(message);}

  private label(phrase: QuickChatPhrase): string { return this.context?.language === "en" ? phrase.en : phrase.zh; }
  private animationDuration(duration: number): number {
    return this.context?.lessMotion || matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : duration;
  }
  private expireEntry(entry: Entry): Promise<void> | void {
    const row = this.rows.get(entry), duration = this.animationDuration(280);
    if (!duration || !this.context?.visible || row?.parentElement !== this.log) return;
    const animation = row.animate([{opacity: 1}, {opacity: 0}], {duration, easing: "ease-in", fill: "forwards"});
    this.fades.set(entry, animation);
    return animation.finished.then(() => {});
  }
  private renderLog(): void {
    const previousTop = this.log.scrollTop;
    const following = this.log.scrollHeight - this.log.clientHeight - previousTop <= 4;
    const previousPositions = new Map([...this.rows.values()].filter(row => row.parentElement === this.log)
      .map(row => [row, {top: row.getBoundingClientRect().top, opacity: Number(getComputedStyle(row).opacity)}]));
    for(const animation of this.moves.values()) animation.cancel(); this.moves.clear();
    const visible = this.entries.filter(entry => !this.muted.includes(entry.clientId));
    for(const [entry, row] of this.rows) {
      if(!visible.includes(entry)) row.remove();
      if(!this.entries.includes(entry)) {
        this.fades.get(entry)?.cancel(); this.fades.delete(entry);
        this.rows.delete(entry);
      }
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
          this.model.sendPhrase(phrase.id);
        }); return button;
      })); return row;
    });
    const empty = document.createElement("p"); empty.textContent = this.text("chat.empty");
    this.picker.replaceChildren(...rows, ...(rows.length ? [] : [empty]), ...(!this.muteOpen ? [this.muteButton] : []));
    this.muteList.replaceChildren(...ctx.seats.flatMap((seat, index) => {
      if(!seat || index === ctx.localSeat) return [];
      const button = document.createElement("button"); button.type = "button";
      button.className = "mp-quick-chat-mute-member";
      button.textContent = `P${index + 1} ${seat.name} · ${this.text(this.muted.includes(seat.clientId) ? "chat.unmute" : "chat.mute")}`;
      button.setAttribute("aria-pressed", String(this.muted.includes(seat.clientId)));
      button.addEventListener("click", () => {
        this.model.toggleMember(seat.clientId);
      }); return [button];
    }), ...(this.muteOpen ? [this.muteButton] : []));
    this.renderLog();
  }
}
