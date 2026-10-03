import { decodedCoverAccent } from './cover-accent.mjs';
function applyCoverAccent(card: HTMLElement) {
  const image = card.querySelector<HTMLImageElement>(".card-art .card-art-image");
  if (!image) return;
  image.addEventListener("error", () => card.classList.add("card-art-missing"));
  const apply = () => {
    const accent = decodedCoverAccent(image);
    if (accent) card.style.setProperty("--cover-accent", accent);
  };
  image.addEventListener("load", apply);
  if (image.complete) {
    if (image.naturalWidth) apply();
    else card.classList.add("card-art-missing");
  }
}

/** Magnify neighbors around the pointer without moving their hit-test centers. */
function initializeDirectoryDock(library: HTMLElement, cards: HTMLAnchorElement[]) {
  const desktop = matchMedia("(min-width:781px) and (orientation:landscape) and (hover:hover) and (pointer:fine)");
  const reducedMotion = matchMedia("(prefers-reduced-motion:reduce)");
  const rail = library.querySelector<HTMLElement>(".game-rail");
  let frame = 0;
  let lastTime = 0;
  let pointerY: number | null = null;
  const enabled = () => desktop.matches && !reducedMotion.matches && !document.body.classList.contains("less-motion");
  const reset = () => {
    cancelAnimationFrame(frame);
    frame = 0;
    pointerY = null;
    lastTime = 0;
    cards.forEach(card => card.style.removeProperty("--dock-wave"));
  };
  const update = (time: number) => {
    frame = 0;
    if (!enabled() || pointerY === null) { reset(); return; }
    const elapsed = lastTime ? Math.min(time - lastTime, 32) : 16;
    lastTime = time;
    let keepScrolling = false;
    if (rail) {
      const bounds = rail.getBoundingClientRect();
      const top = Math.max(0, bounds.top);
      const bottom = Math.min(innerHeight, bounds.bottom);
      const edge = Math.min(72, (bottom - top) / 3);
      let speed = 0;
      if (edge > 0 && pointerY >= top && pointerY <= bottom) {
        if (pointerY < top + edge) speed = -360 * (1 - (pointerY - top) / edge);
        else if (pointerY > bottom - edge) speed = 360 * (1 - (bottom - pointerY) / edge);
      }
      const limit = rail.scrollHeight - rail.clientHeight;
      keepScrolling = (speed < 0 && rail.scrollTop > 0) || (speed > 0 && rail.scrollTop < limit - 1);
      if (keepScrolling) rail.scrollTop = Math.max(0, Math.min(limit, rail.scrollTop + speed * elapsed / 1000));
    }
    // Scale is centered, so these centers stay fixed as magnification changes.
    // Read all geometry before writing styles to avoid alternating layout work.
    const waves = cards.map(card => {
      if (card.hidden) return 0;
      const rect = card.getBoundingClientRect();
      const distance = Math.abs(pointerY! - (rect.top + rect.height / 2));
      const radius = card.offsetHeight * 1.65;
      return distance >= radius ? 0 : .12 * (1 + Math.cos(Math.PI * distance / radius)) / 2;
    });
    cards.forEach((card, index) => card.style.setProperty("--dock-wave", waves[index].toFixed(4)));
    if (keepScrolling) frame = requestAnimationFrame(update);
    else lastTime = 0;
  };
  library.addEventListener("pointermove", event => {
    if (event.pointerType !== "mouse" || !enabled()) { reset(); return; }
    pointerY = event.clientY;
    if (!frame) frame = requestAnimationFrame(update);
  });
  library.addEventListener("pointerleave", reset);
  library.addEventListener("pointercancel", reset);
  library.addEventListener("scroll", () => {
    if (pointerY !== null && enabled() && !frame) frame = requestAnimationFrame(update);
  }, true);
  window.addEventListener("blur", reset);
  window.addEventListener("resize", reset);
  document.addEventListener("visibilitychange", reset);
  desktop.addEventListener("change", reset);
  reducedMotion.addEventListener("change", reset);
  new MutationObserver(() => { if (!enabled()) reset(); })
    .observe(document.body, { attributes: true, attributeFilter: ["class"] });
}

/** Keep the heading out of the way of cards entering its text area. */
function initializeDirectoryHeading(library: HTMLElement, cards: HTMLAnchorElement[]) {
  const heading = library.querySelector<HTMLElement>(".shelf-heading");
  const rail = library.querySelector<HTMLElement>(".game-rail");
  if (!heading || !rail) return;
  const desktop = matchMedia("(min-width:781px) and (orientation:landscape)");
  let frame = 0;
  let settlingUntil = 0;
  let hidden = false;
  const update = (time: number) => {
    frame = 0;
    const textRects = [...heading.children].map(child => child.getBoundingClientRect());
    const top = Math.min(...textRects.map(rect => rect.top));
    const bottom = Math.max(...textRects.map(rect => rect.bottom));
    const railRect = rail.getBoundingClientRect();
    // Extra clearance before revealing prevents flicker at the boundary.
    const clearance = hidden ? 18 : 8;
    const covered = desktop.matches && cards.some(card => {
      const rect = card.getBoundingClientRect();
      return !card.hidden && rect.bottom > Math.max(top - clearance, railRect.top)
        && rect.top < Math.min(bottom + clearance, railRect.bottom);
    });
    if (covered !== hidden) {
      hidden = covered;
      heading.classList.toggle("heading-slid-out", hidden);
    }
    if (time < settlingUntil) frame = requestAnimationFrame(update);
  };
  const schedule = () => {
    settlingUntil = performance.now() + 220;
    if (!frame) frame = requestAnimationFrame(update);
  };
  rail.addEventListener("scroll", schedule, { passive: true });
  library.addEventListener("pointermove", schedule, { passive: true });
  library.addEventListener("pointerleave", schedule);
  window.addEventListener("resize", schedule);
  desktop.addEventListener("change", schedule);
  new MutationObserver(schedule).observe(rail, { subtree: true, attributes: true, attributeFilter: ["class", "style"] });
  schedule();
}

/** The directory has one entry per game; activation is owned by the launcher. */
function initializeDirectoryLibrary() {
  const library = document.querySelector<HTMLElement>(".game-library");
  if (!library) return;
  const cards = [...library.querySelectorAll<HTMLAnchorElement>(".game")];
  cards.forEach(applyCoverAccent);
  initializeDirectoryDock(library, cards);
  initializeDirectoryHeading(library, cards);
  const header = document.querySelector<HTMLElement>(".masthead");
  if (header) {
    const measureHeader = () => library.style.setProperty("--directory-header-height", `${header.offsetTop + header.offsetHeight}px`);
    new ResizeObserver(measureHeader).observe(header);
    measureHeader();
  }
  const directoryKeyboardLocked = () => document.body.dataset.directoryKeyboardLocked === "true" && !!document.querySelector(".tools.mp-mode");
  library.addEventListener("keydown", event => {
    if (directoryKeyboardLocked() && ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) { event.preventDefault(); return; }
    const horizontal = matchMedia("(max-width:780px) and (orientation:portrait)").matches;
    const previousKey = horizontal ? "ArrowLeft" : "ArrowUp";
    const nextKey = horizontal ? "ArrowRight" : "ArrowDown";
    if (event.ctrlKey || event.metaKey || event.altKey ||
        ![previousKey, nextKey, "Home", "End"].includes(event.key)) return;
    const visible = cards.filter(card => !card.hidden);
    const index = visible.indexOf(document.activeElement as HTMLAnchorElement);
    if (index < 0) return;
    event.preventDefault();
    if (event.repeat) return;
    const next = event.key === "Home" ? 0 : event.key === "End" ? visible.length - 1
      : Math.max(0, Math.min(visible.length - 1, index + (event.key === nextKey ? 1 : -1)));
    visible[next]?.focus();
    if (!horizontal && next !== index) visible[next]?.click();
  });
  const portrait = matchMedia("(max-width:780px) and (orientation:portrait)");
  const canBrowse = () => !directoryKeyboardLocked() && !document.body.matches(".player-active,.mp-room-active")
    && !document.querySelector("dialog[open], [aria-modal='true']:not([hidden])");
  const stepSelection = (direction: number) => {
    const visible = cards.filter(card => !card.hidden);
    const index = Math.max(0, visible.findIndex(card => card.classList.contains("selected")));
    const next = Math.max(0, Math.min(visible.length - 1, index + direction));
    if (next === index) return;
    visible[next]?.click();
    visible[next]?.scrollIntoView({ block: "nearest", inline: portrait.matches ? "center" : "nearest" });
  };
  document.addEventListener("keydown", event => {
    if (event.defaultPrevented || portrait.matches || !canBrowse() || event.ctrlKey || event.altKey || event.metaKey
      || !["ArrowUp", "ArrowDown"].includes(event.key)) return;
    const target = event.target as HTMLElement;
    if (target.closest("input,textarea,select,[contenteditable='true'],[role='slider'],[role='listbox'],[role='menu'],[role='dialog']")) return;
    event.preventDefault();
    if (event.repeat || directoryKeyboardLocked()) return;
    stepSelection(event.key === "ArrowDown" ? 1 : -1);
  });
  const cover = document.querySelector<HTMLElement>(".directory-layout > .tools > .score-panel");
  for (const surface of [library, cover]) {
    if (!surface) continue;
    let gesture: { id: number; x: number; y: number; dragging: boolean } | null = null;
    let suppressClickUntil = 0;
    surface.addEventListener("dragstart", event => { if (portrait.matches) event.preventDefault(); });
    surface.addEventListener("pointerdown", event => {
      if (!portrait.matches || !canBrowse() || !event.isPrimary || event.button !== 0 || (event.target as HTMLElement).closest("button,input,summary,.score-table-wrap")) return;
      gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, dragging: false };
    });
    surface.addEventListener("pointermove", event => {
      if (!gesture || gesture.id !== event.pointerId) return;
      const dx = event.clientX - gesture.x, dy = event.clientY - gesture.y;
      if (Math.abs(dy) > 16 && Math.abs(dy) > Math.abs(dx)) { gesture = null; return; }
      if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.4) {
        gesture.dragging = true;
        surface.setPointerCapture(event.pointerId);
      }
    });
    surface.addEventListener("pointerup", event => {
      if (!gesture || gesture.id !== event.pointerId) return;
      const dx = event.clientX - gesture.x, dy = event.clientY - gesture.y;
      const swiped = gesture.dragging && Math.abs(dx) >= 40 && Math.abs(dx) > Math.abs(dy) * 1.4;
      if (gesture.dragging) suppressClickUntil = performance.now() + 350;
      gesture = null;
      if (swiped && portrait.matches && canBrowse()) stepSelection(dx < 0 ? 1 : -1);
    });
    surface.addEventListener("pointercancel", () => { gesture = null; });
    surface.addEventListener("click", event => {
      if (event.isTrusted && performance.now() < suppressClickUntil) {
        event.preventDefault();
        event.stopPropagation();
      }
    }, true);
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

function initializeShelfGameLibrary(options: {
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

/** Preserve each surface's navigation: a unified vertical directory on the
 * Launcher and the horizontal, selectable rails in the network lobby. */
export function initializeGameLibrary(options: {
  initialProduct?: string;
  onSelectionChange?: (product: string) => void;
  openOnFirstClick?: (product: string) => boolean;
} = {}) {
  if (!document.querySelector('.game-library [data-directory="site"]')) {
    return initializeShelfGameLibrary(options);
  }
  initializeDirectoryLibrary();
  return {
    selectProduct(product: string) {
      const cards = [...document.querySelectorAll<HTMLAnchorElement>('.game-library .game[data-game]')];
      const card = cards.find(item => (item.dataset.product || item.dataset.game) === product)
        || cards.find(item => item.dataset.game === product.replace(/mp$/, ''));
      if (card && !card.hidden) card.scrollIntoView({ block: "nearest", inline: "nearest" });
    },
  };
}
