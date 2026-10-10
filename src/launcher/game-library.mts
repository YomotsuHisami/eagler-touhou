/** Overflow deliberately ends halfway through the following full-size target. */
export function libraryIndexWidth(count: number, available: number, target = 44, gap = 2, padding = 4) {
  const limit = Math.max(target, Math.min(320, available - 16));
  const full = count * target + Math.max(0, count - 1) * gap + padding * 2;
  if (full <= limit) return full;
  const whole = Math.max(1, Math.floor((limit - padding - target / 2) / (target + gap)));
  return Math.min(limit, padding + whole * (target + gap) + target / 2);
}

// Sample each decoded cover once, sharing the result between solo and MP cards.
// A light, restrained accent keeps a clear tonal outline on the dark surface.
const coverAccents = new Map<string, string>();
function applyCoverAccent(card: HTMLElement, cleanups: Array<() => void>) {
  const image = card.querySelector<HTMLImageElement>(".card-art .card-art-image");
  if (!image) return;
  const failed = () => card.classList.add("card-art-missing");
  image.addEventListener("error", failed);
  cleanups.push(() => image.removeEventListener("error", failed));
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
  cleanups.push(() => image.removeEventListener("load", apply));
  if (image.complete) {
    if (image.naturalWidth) apply();
    else card.classList.add("card-art-missing");
  }
}

/** One scroll owner per shelf; ordinary touch scrolling stays browser-native. */
function createRailMotion(rail: HTMLElement, reduced: () => boolean, cleanups: Array<() => void>) {
  let moving = false, settleTimer = 0;
  const finish = () => {
    clearTimeout(settleTimer); settleTimer = 0; moving = false;
    rail.classList.remove("is-navigating");
  };
  const cancel = () => {
    const wasMoving = moving;
    finish();
    if (wasMoving) rail.scrollTo({ left: rail.scrollLeft, behavior: "instant" });
  };
  // Native scrolling can run without a per-frame Launcher JS callback. The
  // quiet period also works on Chrome/WebView 108, without scrollend support.
  const onScroll = () => {
    if (!moving) return;
    clearTimeout(settleTimer);
    settleTimer = window.setTimeout(finish, 120);
  };
  rail.addEventListener("scroll", onScroll, { passive: true });
  cleanups.push(() => { rail.removeEventListener("scroll", onScroll); cancel(); });
  const move = (destination: number) => {
    cancel();
    const target = Math.max(0, Math.min(rail.scrollWidth - rail.clientWidth, destination));
    if (reduced() || Math.abs(target - rail.scrollLeft) < 1) {
      rail.scrollTo({ left: target, behavior: "instant" });
      return;
    }
    moving = true;
    rail.classList.add("is-navigating");
    rail.scrollTo({ left: target, behavior: "smooth" });
    settleTimer = window.setTimeout(finish, 180);
  };
  const settle = (destination: number) => {
    cancel();
    rail.scrollTo({ left: Math.max(0, Math.min(rail.scrollWidth - rail.clientWidth, destination)), behavior: "instant" });
  };
  return { move, settle, cancel };
}

export interface GameLibraryOptions {
  initialProduct?: string;
  onSelectionChange?: (product: string) => void;
  /** Directory selection may stay aligned on resize; Launcher browsing must not snap. */
  alignSelectionOnResize?: boolean;
  openOnFirstClick?: (product: string) => boolean;
}

/** The original document-wide entry point retains its shelf order and selection
 * semantics. React supplies exactly its own shelf to the same gesture owner. */
export function initializeGameLibrary(options: GameLibraryOptions = {}) {
  return bindGameLibraryShelves(document.querySelectorAll<HTMLElement>(".game-shelf"), options);
}

export function bindLibraryRail(shelf: HTMLElement, options: GameLibraryOptions = {}) {
  return bindGameLibraryShelves([shelf], options);
}

/** Owns measured scroll/pointer interaction, never card DOM or route history.
 * Disposal releases all listeners, observers, captures, timers and scrub frames. */
function bindGameLibraryShelves(shelves: Iterable<HTMLElement>, options: GameLibraryOptions) {
  const cleanups: Array<() => void> = [];
  type Events = HTMLElementEventMap & DocumentEventMap & WindowEventMap;
  const listen = <K extends keyof Events>(target: EventTarget, type: K, listener: (event: Events[K]) => void, options?: boolean | AddEventListenerOptions) => {
    target.addEventListener(type, listener as EventListener, options);
    cleanups.push(() => target.removeEventListener(type, listener as EventListener, options));
  };
  const observeResize = (target: Element, callback: ResizeObserverCallback) => {
    const observer = new ResizeObserver(callback); observer.observe(target); cleanups.push(() => observer.disconnect());
  };
  let currentProduct = '';
  const selectors: Array<(product: string) => void> = [];
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  const reduced = () => reducedMotion.matches || document.body.classList.contains("less-motion");
  for (const shelf of shelves) {
    const rail = shelf.querySelector<HTMLElement>(".game-rail");
    if (!rail) continue;
    const cards = [...rail.querySelectorAll<HTMLAnchorElement>(".game")];
    cards.forEach(card => applyCoverAccent(card, cleanups));
    const root = shelf.querySelector<HTMLElement>(".shelf-minimap")!;
    const dock = root.querySelector<HTMLElement>(".minimap-dock")!;
    const toggles = [...root.querySelectorAll<HTMLButtonElement>(".minimap-toggle")];
    const motion = createRailMotion(rail, reduced, cleanups);
    const productOf = (card: HTMLElement) => card.dataset.product || card.dataset.game;
    const cardFor = (id?: string) => cards.find(card => productOf(card) === id && !card.hidden);
    let activeId = "", holdTimer = 0, suppressClickUntil = 0;
    let visibleCards: HTMLAnchorElement[] = [];
    let cardLefts: number[] = [];
    let pointer: { id: number; x: number; y: number; held: boolean; choice: string | null; touch: boolean; owner: HTMLButtonElement } | null = null;
    let scrubFrame = 0, scrubTime = 0, scrubX = 0, scrubY = 0;
    let indexStep = 46, indexSettleTimer = 0;
    const fitIndex = () => {
      const available = toggles.filter(button => !button.hidden);
      const target = available[0]?.offsetWidth || 44;
      const style = getComputedStyle(dock);
      const gap = parseFloat(style.columnGap) || 0, padding = parseFloat(style.paddingLeft) || 0;
      indexStep = target + gap;
      root.style.width = `${libraryIndexWidth(available.length, shelf.clientWidth, target, gap, padding)}px`;
    };
    const snapIndex = () => {
      if (pointer?.held || !dock.getClientRects().length) return;
      const maximum = Math.max(0, dock.scrollWidth - dock.clientWidth);
      const left = Math.max(0, Math.min(maximum, Math.round(dock.scrollLeft / indexStep) * indexStep));
      if (Math.abs(left - dock.scrollLeft) > .5) dock.scrollTo({left, behavior: "instant"});
    };
    const updateIndexEdges = () => {
      dock.classList.toggle("is-overflowing", dock.scrollWidth > dock.clientWidth + 1);
      dock.classList.toggle("can-scroll-left", dock.scrollLeft > 1);
      dock.classList.toggle("can-scroll-right", dock.scrollLeft + dock.clientWidth < dock.scrollWidth - 1);
    };
    const revealIndex = (instant = false) => {
      if (pointer?.held) return; // Do not move the numbers under a held finger.
      const button = toggles.find(button => !button.hidden && button.dataset.minimapPreview === activeId);
      if (!button) return;
      const bounds = dock.getBoundingClientRect(), target = button.getBoundingClientRect();
      const delta = target.left < bounds.left + 18 ? target.left - bounds.left - 18
        : target.right > bounds.right - 18 ? target.right - bounds.right + 18 : 0;
      if (delta) {
        const destination = dock.scrollLeft + delta;
        const left = delta > 0 ? Math.ceil(destination / indexStep) * indexStep : Math.floor(destination / indexStep) * indexStep;
        dock.scrollTo({left, behavior: instant || reduced() ? "instant" : "smooth"});
      }
    };
    listen(dock, "scroll", () => {
      updateIndexEdges();
      clearTimeout(indexSettleTimer);
      if (!pointer?.held) indexSettleTimer = window.setTimeout(snapIndex, 120);
    }, {passive: true});
    observeResize(dock, () => {fitIndex(); updateIndexEdges(); revealIndex(true); snapIndex();});
    const highlight = (id: string) => {
      if (activeId === id) return;
      activeId = id; currentProduct = id;
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
      clearTimeout(indexSettleTimer); indexSettleTimer = 0;
      cancelAnimationFrame(scrubFrame); scrubFrame = 0; scrubTime = 0;
      if (previousPointer?.owner.hasPointerCapture(previousPointer.id)) previousPointer.owner.releasePointerCapture(previousPointer.id);
      root.classList.remove("is-holding");
      root.classList.remove("is-scrubbing");
    };
    const retire = cancelHold;
    const select = (id?: string, focusCard = false, settle = false) => {
      const card = cardFor(id);
      if (!card) return;
      highlight(id!);
      revealIndex(settle);
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
      retire();
      if (activeId !== id) select(id, false, settle);
      card.click();
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
      // Stop a previous reveal animation before the finger owns the index.
      dock.scrollTo({left: dock.scrollLeft, behavior: "instant"});
      if (!pointer.owner.hasPointerCapture(pointer.id)) pointer.owner.setPointerCapture(pointer.id);
      root.classList.remove("is-holding"); root.classList.add("is-scrubbing");
      const id = pointer.owner.dataset.minimapPreview!;
      candidate(id);
      moveScrub(pointer.x, pointer.y);
    };
    const scrub = (x: number, y: number) => {
      const dockBounds = dock.getBoundingClientRect();
      if (y < dockBounds.top - 64 || y > dockBounds.bottom + 64) return;
      // A scrub is a continuous horizontal track, not isolated button hit tests.
      // Include the gaps and tolerate vertical finger drift; pointer capture may
      // keep event.target on the starting button throughout a touch gesture.
      const choices = toggles.filter(button => {
        const rect = button.getBoundingClientRect();
        return !button.hidden && rect.right > dockBounds.left && rect.left < dockBounds.right;
      });
      if (!choices.length) return;
      const visibleX = Math.max(dockBounds.left, Math.min(dockBounds.right, x));
      const distance = (button: HTMLElement) => {
        const rect = button.getBoundingClientRect();
        return Math.abs(visibleX - rect.left - rect.width / 2);
      };
      const nearest = choices.reduce((best, button) => distance(button) < distance(best) ? button : best);
      candidate(nearest.dataset.minimapPreview!);
    };
    const edgeSpeed = () => {
      if (!pointer?.held) return 0;
      const bounds = dock.getBoundingClientRect();
      if (scrubY < bounds.top - 64 || scrubY > bounds.bottom + 64) return 0;
      const edge = Math.min(32, bounds.width / 4);
      if (scrubX < bounds.left + edge && dock.scrollLeft > 0)
        return -240 * Math.min(1, (bounds.left + edge - scrubX) / edge);
      if (scrubX > bounds.right - edge && dock.scrollLeft < dock.scrollWidth - dock.clientWidth - 1)
        return 240 * Math.min(1, (scrubX - bounds.right + edge) / edge);
      return 0;
    };
    const scrollScrub = (now: number) => {
      scrubFrame = 0;
      const speed = edgeSpeed();
      if (!speed) {scrubTime = 0; return;}
      const elapsed = scrubTime ? Math.min(32, now - scrubTime) : 16;
      scrubTime = now;
      dock.scrollTo({left: dock.scrollLeft + speed * elapsed / 1000, behavior: "instant"});
      scrub(scrubX, scrubY);
      scrubFrame = requestAnimationFrame(scrollScrub);
    };
    const moveScrub = (x: number, y: number) => {
      scrubX = x; scrubY = y;
      scrub(x, y);
      if (!scrubFrame && edgeSpeed()) scrubFrame = requestAnimationFrame(scrollScrub);
    };
    const update = () => {
      visibleCards = cards.filter(card => !card.hidden);
      shelf.hidden = visibleCards.length === 0;
      for (const button of toggles) button.hidden = !cardFor(button.dataset.minimapPreview);
      root.hidden = visibleCards.length < 2;
      fitIndex();
      if (shelf.hidden || !rail.getClientRects().length) { retire(); motion.cancel(); return; }
      const railLeft = rail.getBoundingClientRect().left;
      cardLefts = visibleCards.map(card => rail.scrollLeft + card.getBoundingClientRect().left - railLeft);
      if (!cardFor(activeId)) highlight(cardFor(options.initialProduct) ? options.initialProduct! : productOf(visibleCards[0])!);
      updateIndexEdges();
      revealIndex(true);
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
    listen(rail, "pointerdown", event => {
      if (event.pointerType !== "mouse") { manualScroll(); return; }
      if (!event.isPrimary || event.button !== 0 || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
      endDrag(); manualScroll(); suppressRailClickUntil = 0;
      drag = { id: event.pointerId, x: event.clientX, startX: event.clientX, startY: event.clientY, scrollLeft: rail.scrollLeft, held: false, moved: false };
      dragTimer = window.setTimeout(beginDrag, 180);
    });
    listen(document, "pointermove", event => {
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
    listen(document, "pointerup", event => { if (drag?.id === event.pointerId) endDrag(); });
    listen(document, "pointercancel", event => { if (drag?.id === event.pointerId) endDrag(); });
    listen(rail, "lostpointercapture", event => { if (drag?.id === event.pointerId) endDrag(); });
    listen(rail, "click", event => {
      // A drag release must never select or launch the card underneath it.
      if (performance.now() < suppressRailClickUntil) {
        event.preventDefault(); event.stopImmediatePropagation();
      }
    }, { capture: true });
    listen(rail, "dragstart", event => event.preventDefault());
    listen(rail, "selectstart", event => event.preventDefault());
    for (const element of rail.querySelectorAll<HTMLElement>("a,img")) element.draggable = false;
    listen(rail, "wheel", event => {
      if (event.ctrlKey) return; // Preserve browser pinch/zoom.
      // Vertical wheel input belongs to the page. Horizontal/Shift-wheel must
      // not bypass the deliberate drag gesture through native rail scrolling.
      if (event.deltaX !== 0 || event.shiftKey) event.preventDefault();
    }, { passive: false });
    observeResize(rail, () => {
      update();
      if (options.alignSelectionOnResize && !rail.closest("[inert]")) select(activeId, false, true);
    });
    const visibilityObserver = new MutationObserver(update);
    visibilityObserver.observe(rail, { subtree: true, attributes: true, attributeFilter: ["hidden"] });
    cleanups.push(() => visibilityObserver.disconnect());
    listen(rail, "keydown", event => {
      if (event.ctrlKey || event.metaKey || event.altKey || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      const visible = cards.filter(card => !card.hidden), index = visible.indexOf(document.activeElement as HTMLAnchorElement);
      if (index < 0) return;
      event.preventDefault();
      const destination = event.key === "Home" ? 0 : event.key === "End" ? visible.length - 1 : Math.max(0, Math.min(visible.length - 1, index + (event.key === "ArrowRight" ? 1 : -1)));
      select(productOf(visible[destination]), true);
    });
    // Browsing a different cover must not reach the application's Tools route.
    // A second activation of the current cover keeps the existing route owner.
    cards.forEach(card => listen(card, "click", event => {
      if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      const id = productOf(card)!;
      if (activeId !== id && !options.openOnFirstClick?.(id)) {
        event.preventDefault(); event.stopImmediatePropagation();
        select(id);
      }
    }, { capture: true }));
    for (const toggle of toggles) {
      listen(toggle, "click", event => {
        if (performance.now() < suppressClickUntil) return;
        const id = toggle.dataset.minimapPreview;
        const touch = (event as PointerEvent).pointerType === "touch" || matchMedia("(pointer: coarse)").matches;
        if (activeId === id) openTools(id, touch);
        else select(id);
      });
      listen(toggle, "pointerdown", event => {
        if (!event.isPrimary || event.button !== 0) return;
        cancelHold();
        suppressClickUntil = 0;
        pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, held: false, choice: null, touch: event.pointerType !== "mouse", owner: toggle };
        root.classList.add("is-holding");
        holdTimer = window.setTimeout(beginHold, 350);
      });
      listen(toggle, "lostpointercapture", event => {
        if (pointer?.id === event.pointerId) { suppressClickUntil = performance.now() + 500; retire(); }
      });
    }
    listen(document, "pointermove", event => {
      if (pointer?.id !== event.pointerId) return;
      if (!pointer.held) {
        const dx = Math.abs(event.clientX - pointer.x), dy = Math.abs(event.clientY - pointer.y);
        if (dx >= 8 && dx > dy * 1.25) beginHold();
        else if (dy > 24 && dy > dx) {
          suppressClickUntil = performance.now() + 500; cancelHold();
        }
        if (!pointer?.held) return;
      }
      event.preventDefault();
      moveScrub(event.clientX, event.clientY);
    });
    listen(document, "pointerup", event => {
      if (pointer?.id !== event.pointerId) return;
      if (pointer.held && pointer.choice) scrub(event.clientX, event.clientY);
      const { held, choice, touch } = pointer;
      if (held) suppressClickUntil = performance.now() + 500;
      cancelHold();
      if (held && choice) select(choice, true, touch);
    });
    listen(document, "pointercancel", event => {
      if (pointer?.id === event.pointerId) { suppressClickUntil = performance.now() + 500; retire(); }
    });
    listen(root, "contextmenu", event => event.preventDefault());
    listen(root, "keydown", event => {
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
    listen(document, "pointerdown", event => { if (!(event.target instanceof Node) || !root.contains(event.target)) retire(); });
    const suspend = () => { retire(); endDrag(); motion.cancel(); };
    cleanups.push(suspend);
    listen(window, "blur", suspend);
    listen(window, "pagehide", suspend);
    listen(document, "visibilitychange", () => { if (document.hidden) suspend(); });
    update();
    if (cardFor(options.initialProduct)) select(options.initialProduct, false, true);
    selectors.push(product => { if (cardFor(product)) select(product); });
  }
  return {
    selectProduct: (product: string) => selectors.forEach(select => select(product)),
    getSelectedProduct: () => currentProduct,
    dispose: () => { for (const cleanup of cleanups.splice(0).reverse()) cleanup(); },
  };
}
