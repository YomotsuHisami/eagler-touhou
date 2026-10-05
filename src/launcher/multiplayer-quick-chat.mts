import { QUICK_CHAT_PHRASES, quickChatPhrase, type QuickChatPhrase } from "../contracts/multiplayer-quick-chat.mjs";
import type { UiMessageKey } from "./i18n.mjs";

interface Seat { clientId: string; name: string }
interface Context {
  visible: boolean; room: string; serial: number; localSeat: number | null;
  seats: readonly (Seat | null)[]; prankMode: boolean; connected: boolean; language: string;
}
interface Entry { clientId: string; seat: number; name: string; phrase: QuickChatPhrase }
interface Drag {
  pointerId: number; clientX: number; clientY: number; x: number; y: number;
  scaleX: number; scaleY: number; minX: number; maxX: number; minY: number; maxY: number;
}

export class MultiplayerQuickChat {
  private context: Context | null = null;
  private entries: Entry[] = [];
  private muted = new Set<string>();
  private pickerOpen = false;
  private muteOpen = false;
  private position = {x: 0, y: 0};
  private drag: Drag | null = null;
  private positionFrame: number | null = null;
  private readonly root = document.createElement("section");
  private readonly dragHandle = document.createElement("button");
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
    this.prompt.type = this.muteButton.type = this.dragHandle.type = "button";
    this.prompt.className = "mp-quick-chat-prompt";
    this.muteButton.className = "mp-quick-chat-mute";
    this.dragHandle.className = "mp-quick-chat-drag-handle";
    const header = document.createElement("header");
    header.className = "mp-quick-chat-header";
    header.append(this.dragHandle, this.muteButton);
    this.dragHandle.addEventListener("pointerdown", event => this.beginDrag(event));
    this.dragHandle.addEventListener("pointermove", event => this.moveDrag(event));
    this.dragHandle.addEventListener("pointerup", event => {
      this.moveDrag(event); this.endDrag(event);
    });
    for(const name of ["pointercancel", "lostpointercapture"] as const)
      this.dragHandle.addEventListener(name, event => this.endDrag(event));
    this.dragHandle.addEventListener("keydown", event => {
      const direction = {ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1]}[event.key];
      if(!direction) return;
      event.preventDefault(); this.endDrag();
      this.position.x += direction[0] * 10; this.position.y += direction[1] * 10;
      this.clampPosition();
    });
    this.prompt.addEventListener("click", () => { this.pickerOpen = !this.pickerOpen; this.muteOpen = false; this.render(); });
    this.muteButton.addEventListener("click", () => { this.muteOpen = !this.muteOpen; this.pickerOpen = false; this.render(); });
    this.root.addEventListener("keydown", event => {
      event.stopPropagation();
      if(event.key === "Escape") { this.pickerOpen = this.muteOpen = false; this.render(); }
    });
    for(const name of ["keyup", "pointerdown", "pointermove", "pointerup", "pointercancel", "touchstart", "touchmove", "touchend", "touchcancel"])
      this.root.addEventListener(name, event => event.stopPropagation());
    this.root.append(header, this.log, this.picker, this.muteList, this.prompt);
    parent.append(this.root);
    new ResizeObserver(() => {
      if(this.root.hidden) return;
      this.endDrag(); this.clampPosition();
    }).observe(parent);
    window.addEventListener("blur", () => this.endDrag());
    document.addEventListener("visibilitychange", () => { if(document.hidden) this.endDrag(); });
  }

  private bounds() {
    const parent = this.root.parentElement!;
    const minX = 8 - this.root.offsetLeft, minY = 8 - this.root.offsetTop;
    return {minX, minY,
      maxX: Math.max(minX, parent.clientWidth - this.root.offsetWidth - 8 - this.root.offsetLeft),
      maxY: Math.max(minY, parent.clientHeight - this.root.offsetHeight - 8 - this.root.offsetTop)};
  }

  private clampPosition(bounds = this.bounds()): void {
    this.position.x = Math.max(bounds.minX, Math.min(bounds.maxX, this.position.x));
    this.position.y = Math.max(bounds.minY, Math.min(bounds.maxY, this.position.y));
    this.applyPosition();
  }

  private applyPosition(): void {
    this.root.style.transform = `translate(${this.position.x}px, ${this.position.y}px)`;
  }

  private beginDrag(event: PointerEvent): void {
    if(!event.isPrimary || event.button !== 0) return;
    event.preventDefault(); this.endDrag(); this.clampPosition();
    const parent = this.root.parentElement!, rect = parent.getBoundingClientRect();
    this.drag = {pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY,
      ...this.position, ...this.bounds(),
      scaleX: rect.width / parent.offsetWidth || 1, scaleY: rect.height / parent.offsetHeight || 1};
    this.root.classList.add("dragging");
    this.dragHandle.focus({preventScroll: true});
    this.dragHandle.setPointerCapture(event.pointerId);
  }

  private moveDrag(event: PointerEvent): void {
    const drag = this.drag;
    if(!drag || event.pointerId !== drag.pointerId) return;
    event.preventDefault();
    this.position.x = Math.max(drag.minX, Math.min(drag.maxX, drag.x + (event.clientX - drag.clientX) / drag.scaleX));
    this.position.y = Math.max(drag.minY, Math.min(drag.maxY, drag.y + (event.clientY - drag.clientY) / drag.scaleY));
    // Pointer moves only update coordinates; one scheduled paint writes the transform.
    this.positionFrame ??= requestAnimationFrame(() => {
      this.positionFrame = null; this.applyPosition();
    });
  }

  private endDrag(event?: PointerEvent): void {
    if(!this.drag || (event && event.pointerId !== this.drag.pointerId)) return;
    const pointerId = this.drag.pointerId; this.drag = null;
    if(this.positionFrame !== null) cancelAnimationFrame(this.positionFrame);
    this.positionFrame = null; this.applyPosition(); this.root.classList.remove("dragging");
    if(this.dragHandle.hasPointerCapture(pointerId)) this.dragHandle.releasePointerCapture(pointerId);
  }

  update(next: Context): void {
    const previous = this.context;
    const reset = previous?.room !== next.room || previous?.serial !== next.serial;
    const changed = reset || !previous || previous.visible !== next.visible ||
      previous.localSeat !== next.localSeat || previous.connected !== next.connected ||
      previous.prankMode !== next.prankMode || previous.language !== next.language ||
      previous.seats.length !== next.seats.length || next.seats.some((seat, index) =>
        seat?.clientId !== previous.seats[index]?.clientId || seat?.name !== previous.seats[index]?.name);
    if(reset) {
      this.entries = []; this.muted.clear(); this.pickerOpen = this.muteOpen = false;
    }
    this.context = {...next, seats: next.seats.map(seat => seat ? {...seat} : null)};
    this.root.hidden = !next.visible;
    if(!next.visible || reset) this.endDrag();
    if(changed) this.render();
  }

  receive(message: Record<string, unknown>): void {
    const ctx = this.context, phrase = quickChatPhrase(message.phrase);
    if(!ctx?.visible || !phrase || message.room !== ctx.room || message.serial !== ctx.serial ||
      typeof message.seat !== "number" || !Number.isInteger(message.seat)) return;
    const seat = ctx.seats[message.seat];
    if(!seat || message.clientId !== seat.clientId) return;
    this.entries.push({clientId: seat.clientId, seat: message.seat, name: seat.name, phrase});
    if(this.entries.length > 50) this.entries.shift();
    this.renderLog();
  }

  private label(phrase: QuickChatPhrase): string { return this.context?.language === "en" ? phrase.en : phrase.zh; }
  private renderLog(): void {
    const previousTop = this.log.scrollTop;
    const following = this.log.scrollHeight - this.log.clientHeight - previousTop <= 4;
    const rows = this.entries.filter(entry => !this.muted.has(entry.clientId)).map(entry => {
      const row = document.createElement("p"), author = document.createElement("strong");
      author.textContent = `P${entry.seat + 1} ${entry.name}`;
      row.append(author, document.createTextNode(this.label(entry.phrase))); return row;
    });
    this.log.replaceChildren(...rows);
    this.log.scrollTop = following ? this.log.scrollHeight : previousTop;
  }

  private render(): void {
    const ctx = this.context; if(!ctx) return;
    this.root.setAttribute("aria-label", this.text("chat.players"));
    this.dragHandle.textContent = this.text("chat.players");
    this.dragHandle.title = this.text("chat.drag");
    this.dragHandle.setAttribute("aria-label", this.text("chat.drag"));
    this.prompt.textContent = this.text("chat.prompt");
    this.prompt.setAttribute("aria-expanded", String(this.pickerOpen));
    this.prompt.disabled = ctx.localSeat == null || !ctx.connected;
    this.muteButton.textContent = this.text("chat.mute");
    this.muteButton.setAttribute("aria-expanded", String(this.muteOpen));
    this.picker.hidden = !this.pickerOpen; this.muteList.hidden = !this.muteOpen;
    const pranks = (["chat.obscure", "chat.split"] as const).map(key => {
      const button = document.createElement("button"); button.type = "button";
      button.textContent = this.text(key); button.disabled = true;
      // Gameplay parameters are intentionally pending, even in prank rooms.
      button.dataset.prankEnabled = String(ctx.prankMode); return button;
    });
    const phrases = QUICK_CHAT_PHRASES.map(phrase => {
      const button = document.createElement("button"); button.type = "button"; button.textContent = this.label(phrase);
      button.addEventListener("click", () => {
        if(this.context?.localSeat == null || !this.context.connected) return;
        this.send({type: "quick-chat", phrase: phrase.id, serial: this.context.serial});
        this.pickerOpen = false; this.render();
      }); return button;
    });
    const empty = document.createElement("p"); empty.textContent = this.text("chat.empty");
    this.picker.replaceChildren(...pranks, ...phrases, ...(phrases.length ? [] : [empty]));
    this.muteList.replaceChildren(...ctx.seats.flatMap((seat, index) => {
      if(!seat || index === ctx.localSeat) return [];
      const button = document.createElement("button"); button.type = "button";
      button.textContent = `P${index + 1} ${seat.name} · ${this.text(this.muted.has(seat.clientId) ? "chat.unmute" : "chat.mute")}`;
      button.setAttribute("aria-pressed", String(this.muted.has(seat.clientId)));
      button.addEventListener("click", () => {
        if(this.muted.has(seat.clientId)) this.muted.delete(seat.clientId); else this.muted.add(seat.clientId);
        this.render();
      }); return [button];
    }));
    this.renderLog();
  }
}
