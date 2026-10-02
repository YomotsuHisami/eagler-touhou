// Sample each decoded cover once, sharing the result between solo and MP cards.
// A light, restrained accent keeps a clear tonal outline on the dark surface.
const coverAccents = new Map<string, string>();
function applyCoverAccent(card: HTMLElement) {
  const image = card.querySelector<HTMLImageElement>(".card-art .card-art-image");
  if (!image) return;
  image.addEventListener("error", () => card.classList.add("card-art-missing"));
  const apply = () => {
    if (!image.naturalWidth) return;
    const source = image.currentSrc || image.src;
    let accent = coverAccents.get(source);
    if (!accent) {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 32;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) return;
        context.drawImage(image, 0, 0, 32, 32);
        const pixels = context.getImageData(0, 0, 32, 32).data;
        const bins = Array.from({ length: 24 }, () => ({ weight: 0, x: 0, y: 0 }));
        for (let i = 0; i < pixels.length; i += 4) {
          const r = pixels[i] / 255, g = pixels[i + 1] / 255, b = pixels[i + 2] / 255;
          const high = Math.max(r, g, b), low = Math.min(r, g, b), chroma = high - low;
          if (pixels[i + 3] < 128 || chroma < .12 || high < .18) continue;
          let hue = high === r ? (g - b) / chroma : high === g ? (b - r) / chroma + 2 : (r - g) / chroma + 4;
          hue = (hue * 60 + 360) % 360;
          const bin = bins[Math.floor(hue / 15)], weight = chroma * Math.sqrt(high);
          bin.weight += weight;
          bin.x += Math.cos(hue * Math.PI / 180) * weight;
          bin.y += Math.sin(hue * Math.PI / 180) * weight;
        }
        const dominant = bins.reduce((best, bin) => bin.weight > best.weight ? bin : best);
        const hue = (Math.atan2(dominant.y, dominant.x) * 180 / Math.PI + 360) % 360;
        accent = dominant.weight ? `hsl(${Math.round(hue)} 62% 78%)` : "#d0cbc3";
        coverAccents.set(source, accent);
      } catch {
        // Missing or cross-origin artwork retains the accessible paper fallback.
        return;
      }
    }
    card.style.setProperty("--cover-accent", accent);
  };
  image.addEventListener("load", apply);
  if (image.complete) {
    if (image.naturalWidth) apply();
    else card.classList.add("card-art-missing");
  }
}

/** One scroll owner per shelf; ordinary touch scrolling stays browser-native. */
function createRailMotion(rail: HTMLElement, reduced: () => boolean) {
  let frame = 0;
  const cancel = () => {
    cancelAnimationFrame(frame); frame = 0;
    rail.classList.remove("is-navigating");
  };
  const move = (destination: number) => {
    cancel();
    const target = Math.max(0, Math.min(rail.scrollWidth - rail.clientWidth, destination));
    const start = rail.scrollLeft, distance = target - start;
    if (reduced() || Math.abs(distance) < 1) { rail.scrollLeft = target; return; }
    rail.classList.add("is-navigating");
    const began = performance.now(), duration = Math.min(560, 300 + Math.abs(distance) * .18);
    const tick = (now: number) => {
      const progress = reduced() ? 1 : Math.min(1, (now - began) / duration);
      rail.scrollLeft = start + distance * (1 - Math.pow(1 - progress, 4));
      if (progress < 1) frame = requestAnimationFrame(tick);
      else { frame = 0; rail.classList.remove("is-navigating"); }
    };
    frame = requestAnimationFrame(tick);
  };
  const settle = (destination: number) => {
    cancel();
    rail.scrollLeft = Math.max(0, Math.min(rail.scrollWidth - rail.clientWidth, destination));
  };
  return { move, settle, cancel };
}

export function initializeGameLibrary(options: {
  initialProduct?: string;
  onSelectionChange?: (product: string) => void;
  openOnFirstClick?: (product: string) => boolean;
} = {}) {
  const selectors: Array<(product: string) => void> = [];
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  const reduced = () => reducedMotion.matches || document.body.classList.contains("less-motion");
  for (const shelf of document.querySelectorAll<HTMLElement>(".game-shelf")) {
    const rail = shelf.querySelector<HTMLElement>(".game-rail");
    if (!rail) continue;
    const cards = [...rail.querySelectorAll<HTMLAnchorElement>(".game")];
    cards.forEach(applyCoverAccent);
    const root = shelf.querySelector<HTMLElement>(".shelf-minimap")!;
    const toggles = [...root.querySelectorAll<HTMLButtonElement>(".minimap-toggle")];
    const motion = createRailMotion(rail, reduced);
    const productOf = (card: HTMLElement) => card.dataset.product || card.dataset.game;
    const cardFor = (id?: string) => cards.find(card => productOf(card) === id && !card.hidden);
    let activeId = "", holdTimer = 0, suppressClickUntil = 0;
    let visibleCards: HTMLAnchorElement[] = [];
    let cardLefts: number[] = [];
    let pointer: { id: number; x: number; y: number; held: boolean; choice: string | null; touch: boolean; owner: HTMLButtonElement } | null = null;
    const highlight = (id: string) => {
      if (activeId === id) return;
      activeId = id;
      cards.forEach(card => card.classList.toggle("nav-preview", productOf(card) === id));
      for (const button of toggles) {
        const current = button.dataset.minimapPreview === id;
        button.classList.toggle("is-current", current);
        button.setAttribute("aria-current", String(current));
      }
      options.onSelectionChange?.(id);
    };
    const cancelHold = () => {
      const previousPointer = pointer;
      clearTimeout(holdTimer); holdTimer = 0; pointer = null;
      if (previousPointer?.owner.hasPointerCapture(previousPointer.id)) previousPointer.owner.releasePointerCapture(previousPointer.id);
      root.classList.remove("is-holding");
      root.classList.remove("is-scrubbing");
    };
    const retire = cancelHold;
    const select = (id?: string, focusCard = false, settle = false) => {
      const card = cardFor(id);
      if (!card) return;
      highlight(id!);
      // Match the rail gutter in one motion. Free scrolling has no CSS snap
      // correction, so small wheel deltas and touch momentum stay continuous.
      const index = visibleCards.indexOf(card);
      const left = index >= 0 ? cardLefts[index] : rail.scrollLeft + card.getBoundingClientRect().left - rail.getBoundingClientRect().left;
      if (settle) motion.settle(left - 6);
      else motion.move(left - 6);
      if (focusCard) card.focus({ preventScroll: true });
    };
    const openTools = (id?: string, settle = false) => {
      const card = cardFor(id);
      if (!card) return;
      retire(); select(id, false, settle); card.click();
    };
    const candidate = (id: string) => {
      if (!pointer || pointer.choice === id) return;
      pointer.choice = id;
      // Only a new title retargets the animation, never each pointer pixel.
      if (activeId !== id) select(id);
    };
    const beginHold = () => {
      if (!pointer || pointer.held || document.hidden || !pointer.owner.getClientRects().length) return;
      clearTimeout(holdTimer); holdTimer = 0;
      pointer.held = true;
      if (!pointer.owner.hasPointerCapture(pointer.id)) pointer.owner.setPointerCapture(pointer.id);
      root.classList.remove("is-holding"); root.classList.add("is-scrubbing");
      const id = pointer.owner.dataset.minimapPreview!;
      candidate(id);
    };
    const scrub = (x: number, y: number) => {
      const dockBounds = root.getBoundingClientRect();
      if (y < dockBounds.top - 64 || y > dockBounds.bottom + 64) return;
      // A scrub is a continuous horizontal track, not isolated button hit tests.
      // Include the gaps and tolerate vertical finger drift; pointer capture may
      // keep event.target on the starting button throughout a touch gesture.
      const choices = toggles.filter(button => !button.hidden);
      if (!choices.length) return;
      const distance = (button: HTMLElement) => {
        const rect = button.getBoundingClientRect();
        return Math.abs(x - rect.left - rect.width / 2);
      };
      const nearest = choices.reduce((best, button) => distance(button) < distance(best) ? button : best);
      candidate(nearest.dataset.minimapPreview!);
    };
    const update = () => {
      visibleCards = cards.filter(card => !card.hidden);
      shelf.hidden = visibleCards.length === 0;
      for (const button of toggles) button.hidden = !cardFor(button.dataset.minimapPreview);
      root.hidden = visibleCards.length < 2;
      if (shelf.hidden || !rail.getClientRects().length) { retire(); motion.cancel(); return; }
      const railLeft = rail.getBoundingClientRect().left;
      cardLefts = visibleCards.map(card => rail.scrollLeft + card.getBoundingClientRect().left - railLeft);
      if (!cardFor(activeId)) highlight(cardFor(options.initialProduct) ? options.initialProduct! : productOf(visibleCards[0])!);
    };
    const manualScroll = () => { motion.cancel(); retire(); };
    let dragTimer = 0, suppressRailClickUntil = 0;
    let drag: { id: number; x: number; startX: number; startY: number; scrollLeft: number; held: boolean; moved: boolean } | null = null;
    const beginDrag = () => {
      if (!drag || drag.held || document.hidden || !rail.getClientRects().length) return;
      clearTimeout(dragTimer); dragTimer = 0;
      drag.held = true;
      rail.setPointerCapture(drag.id);
      rail.classList.add("is-dragging");
    };
    const endDrag = () => {
      clearTimeout(dragTimer); dragTimer = 0;
      const previousDrag = drag;
      drag = null;
      rail.classList.remove("is-dragging");
      if (previousDrag?.held || previousDrag?.moved) suppressRailClickUntil = performance.now() + 500;
      if (previousDrag && rail.hasPointerCapture(previousDrag.id)) rail.releasePointerCapture(previousDrag.id);
    };
    rail.addEventListener("pointerdown", event => {
      if (event.pointerType !== "mouse") { manualScroll(); return; }
      if (!event.isPrimary || event.button !== 0 || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
      endDrag(); manualScroll(); suppressRailClickUntil = 0;
      drag = { id: event.pointerId, x: event.clientX, startX: event.clientX, startY: event.clientY, scrollLeft: rail.scrollLeft, held: false, moved: false };
      dragTimer = window.setTimeout(beginDrag, 180);
    });
    document.addEventListener("pointermove", event => {
      if (drag?.id !== event.pointerId) return;
      if (!(event.buttons & 1)) { endDrag(); return; }
      drag.x = event.clientX;
      const dx = Math.abs(drag.x - drag.startX), dy = Math.abs(event.clientY - drag.startY);
      if (Math.max(dx, dy) > 4) drag.moved = true;
      // Horizontal intent starts immediately; keep the original grab point so
      // neither the threshold nor the hold timer discards the user's movement.
      if (dx > 4 && dx > dy) beginDrag();
      if (!drag.held) return;
      event.preventDefault();
      rail.scrollLeft = drag.scrollLeft + drag.startX - drag.x;
    });
    document.addEventListener("pointerup", event => { if (drag?.id === event.pointerId) endDrag(); });
    document.addEventListener("pointercancel", event => { if (drag?.id === event.pointerId) endDrag(); });
    rail.addEventListener("lostpointercapture", event => { if (drag?.id === event.pointerId) endDrag(); });
    rail.addEventListener("click", event => {
      // A drag release must never select or launch the card underneath it.
      if (performance.now() < suppressRailClickUntil) {
        event.preventDefault(); event.stopImmediatePropagation();
      }
    }, { capture: true });
    rail.addEventListener("dragstart", event => event.preventDefault());
    rail.addEventListener("selectstart", event => event.preventDefault());
    for (const element of rail.querySelectorAll<HTMLElement>("a,img")) element.draggable = false;
    rail.addEventListener("wheel", event => {
      if (event.ctrlKey) return; // Preserve browser pinch/zoom.
      // Vertical wheel input belongs to the page. Horizontal/Shift-wheel must
      // not bypass the deliberate drag gesture through native rail scrolling.
      if (event.deltaX !== 0 || event.shiftKey) event.preventDefault();
    }, { passive: false });
    new ResizeObserver(() => {
      update();
      if (options.onSelectionChange) select(activeId, false, true);
    }).observe(rail);
    new MutationObserver(update).observe(rail, { subtree: true, attributes: true, attributeFilter: ["hidden"] });
    rail.addEventListener("keydown", event => {
      if (event.ctrlKey || event.metaKey || event.altKey || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      const visible = cards.filter(card => !card.hidden), index = visible.indexOf(document.activeElement as HTMLAnchorElement);
      if (index < 0) return;
      event.preventDefault();
      const destination = event.key === "Home" ? 0 : event.key === "End" ? visible.length - 1 : Math.max(0, Math.min(visible.length - 1, index + (event.key === "ArrowRight" ? 1 : -1)));
      select(productOf(visible[destination]), true);
    });
    // Browsing a different cover must not reach the application's Tools route.
    // A second activation of the current cover keeps the existing route owner.
    cards.forEach(card => card.addEventListener("click", event => {
      if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      const id = productOf(card)!;
      if (activeId !== id && !options.openOnFirstClick?.(id)) {
        event.preventDefault(); event.stopImmediatePropagation();
        select(id);
      }
    }, { capture: true }));
    for (const toggle of toggles) {
      toggle.addEventListener("click", event => {
        if (performance.now() < suppressClickUntil) return;
        const id = toggle.dataset.minimapPreview;
        const touch = (event as PointerEvent).pointerType === "touch" || matchMedia("(pointer: coarse)").matches;
        if (activeId === id) openTools(id, touch);
        else select(id);
      });
      toggle.addEventListener("pointerdown", event => {
        if (!event.isPrimary || event.button !== 0) return;
        cancelHold();
        suppressClickUntil = 0;
        pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, held: false, choice: null, touch: event.pointerType !== "mouse", owner: toggle };
        root.classList.add("is-holding");
        holdTimer = window.setTimeout(beginHold, 350);
      });
      toggle.addEventListener("lostpointercapture", event => {
        if (pointer?.id === event.pointerId) { suppressClickUntil = performance.now() + 500; retire(); }
      });
    }
    document.addEventListener("pointermove", event => {
      if (pointer?.id !== event.pointerId) return;
      if (!pointer.held) {
        const dx = Math.abs(event.clientX - pointer.x), dy = Math.abs(event.clientY - pointer.y);
        if (dx >= 8 && dx > dy * 1.25) beginHold();
        else if (dy > 24 && dy > dx) {
          suppressClickUntil = performance.now() + 500; cancelHold();
        }
        if (!pointer?.held) return;
      }
      scrub(event.clientX, event.clientY);
    });
    document.addEventListener("pointerup", event => {
      if (pointer?.id !== event.pointerId) return;
      if (pointer.held && pointer.choice) scrub(event.clientX, event.clientY);
      const { held, choice, touch } = pointer;
      if (held) suppressClickUntil = performance.now() + 500;
      cancelHold();
      if (held && choice) select(choice, true, touch);
    });
    document.addEventListener("pointercancel", event => {
      if (pointer?.id === event.pointerId) { suppressClickUntil = performance.now() + 500; retire(); }
    });
    root.addEventListener("contextmenu", event => event.preventDefault());
    root.addEventListener("keydown", event => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key === "Escape") {
        event.preventDefault(); event.stopPropagation();
        toggles.find(toggle => toggle.dataset.minimapPreview === activeId)?.focus({ preventScroll: true }); retire();
      } else if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
        event.preventDefault();
        const available = toggles.filter(button => !button.hidden);
        const index = Math.max(0, available.indexOf(document.activeElement as HTMLButtonElement));
        const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? available.length - 1 : Math.max(0, Math.min(available.length - 1, index + (event.key === "ArrowRight" ? 1 : -1)));
        available[nextIndex]?.focus({ preventScroll: true });
        select(available[nextIndex]?.dataset.minimapPreview);
      }
    });
    document.addEventListener("pointerdown", event => { if (!(event.target instanceof Node) || !root.contains(event.target)) retire(); });
    const suspend = () => { retire(); endDrag(); motion.cancel(); };
    window.addEventListener("blur", suspend);
    window.addEventListener("pagehide", suspend);
    document.addEventListener("visibilitychange", () => { if (document.hidden) suspend(); });
    update();
    if (cardFor(options.initialProduct)) select(options.initialProduct, false, true);
    selectors.push(product => { if (cardFor(product)) select(product); });
  }
  return { selectProduct: (product: string) => selectors.forEach(select => select(product)) };
}
