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
export function initializeGameLibrary() {
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
