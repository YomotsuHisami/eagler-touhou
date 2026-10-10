import {SITE_NOTICE_DURATION_MS, SITE_NOTICE_STORAGE_KEY, SITE_NOTICE_DISMISSED_KEY,
  parseSiteNoticeText, fallbackBaseUrl} from "./site-notice-content.mjs";
export {SITE_NOTICE_DURATION_MS, SITE_NOTICE_STORAGE_KEY, SITE_NOTICE_DISMISSED_KEY,
  parseSiteNoticeText, siteNoticeBrandAsset, type SiteNoticeSegment, type SiteNoticeLine} from "./site-notice-content.mjs";

function renderSiteNoticeText(target: HTMLElement, text: string, documentObj: Document, baseUrl: string): void {
  target.replaceChildren();
  for (const line of parseSiteNoticeText(text, baseUrl)) {
    const row = documentObj.createElement("div");
    row.className = "site-notice-line";
    for (const segment of line) {
      if (segment.type === "text") {
        row.append(documentObj.createTextNode(segment.text));
        continue;
      }
      const link = documentObj.createElement("a");
      link.className = "site-notice-brand";
      link.href = segment.href;
      if (segment.external) {
        link.target = "_blank";
        link.rel = "noopener noreferrer";
      }
      link.title = segment.resolvedHref;
      if (segment.asset) {
        const icon = documentObj.createElement("span");
        icon.className = "site-notice-brand-icon";
        const image = documentObj.createElement("img");
        image.src = segment.asset;
        image.alt = "";
        image.decoding = "async";
        icon.append(image);
        link.append(icon);
      }
      const label = documentObj.createElement("span");
      label.textContent = segment.label;
      link.append(label);
      row.append(link);
    }
    target.append(row);
  }
}

type NoticeStorage = Pick<Storage, "getItem" | "setItem">;

export interface SiteNoticeControllerOptions {
  documentObj?: Document;
  windowObj?: Window;
  storage?: NoticeStorage | null;
  fetchImpl?: typeof fetch;
  matchMediaImpl?: (query: string) => Pick<MediaQueryList, "matches">;
  setTimeoutImpl?: (callback: () => void, delay: number) => number;
  clearTimeoutImpl?: (timer: number) => void;
  baseUrl?: string;
  durationMs?: number;
  onOptOut?: () => void;
}

function defaultStorage(): NoticeStorage | null {
  try { return globalThis.localStorage ?? null; }
  catch { return null; }
}

export function createSiteNoticeController(options: SiteNoticeControllerOptions = {}) {
  const documentObj = options.documentObj ?? globalThis.document;
  const windowObj = options.windowObj ?? globalThis.window;
  const storage = options.storage === undefined ? defaultStorage() : options.storage;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const matchMediaImpl = options.matchMediaImpl ?? (query => globalThis.matchMedia?.(query) ?? { matches: false });
  const setTimeoutImpl = options.setTimeoutImpl ?? ((callback, delay) => globalThis.setTimeout(callback, delay));
  const clearTimeoutImpl = options.clearTimeoutImpl ?? (timer => globalThis.clearTimeout(timer));
  const baseUrl = options.baseUrl ?? windowObj?.location?.href ?? fallbackBaseUrl();
  const durationMs = options.durationMs ?? SITE_NOTICE_DURATION_MS;
  const onOptOut = options.onOptOut ?? (() => {});

  if (!documentObj || !windowObj || typeof fetchImpl !== "function") {
    throw new Error("Site Notice requires a browser document, window and fetch implementation");
  }

  const element = <T extends HTMLElement>(id: string): T => {
    const value = documentObj.getElementById(id);
    if (!value) throw new Error(`Site Notice element is missing: #${id}`);
    return value as T;
  };
  const bar = element<HTMLElement>("siteNotice");
  const content = element<HTMLElement>("siteNoticeContent");
  const optOutButton = element<HTMLButtonElement>("siteNoticeOptOut");
  const closeButton = element<HTMLButtonElement>("siteNoticeClose");
  const toggleButton = element<HTMLButtonElement>("siteNoticeToggle");

  let dismissed = false;
  try { dismissed = storage?.getItem(SITE_NOTICE_DISMISSED_KEY) === "1"; } catch {}
  let enabled = true;
  try { enabled = storage?.getItem(SITE_NOTICE_STORAGE_KEY) !== "0"; } catch {}
  let timer: number | null = null;
  let closeTimer: number | null = null;
  let requestSerial = 0;
  const scrollPositions = new WeakMap<object, number>();

  const clearTimer = (value: number | null) => {
    if (value != null) clearTimeoutImpl(value);
  };

  function close(): void {
    ++requestSerial;
    clearTimer(timer);
    timer = null;
    if (bar.hidden || bar.classList.contains("site-notice-closing")) return;
    if (matchMediaImpl("(prefers-reduced-motion: reduce)").matches || bar.classList.contains("site-notice-scroll-hidden")) {
      bar.hidden = true;
      bar.classList.remove("site-notice-scroll-hidden", "site-notice-closing");
      return;
    }
    bar.classList.add("site-notice-closing");
    closeTimer = setTimeoutImpl(() => {
      bar.hidden = true;
      bar.classList.remove("site-notice-scroll-hidden", "site-notice-closing");
    }, 220);
  }

  async function load(): Promise<boolean> {
    if (!enabled) return false;
    const request = ++requestSerial;
    try {
      const response = await fetchImpl("NOTICE.txt", { cache: "no-store" });
      if (!response.ok) return false;
      const text = (await response.text()).replace(/^\uFEFF/, "").trim();
      if (!text || !enabled || request !== requestSerial) return false;
      renderSiteNoticeText(content, text, documentObj, baseUrl);
      optOutButton.hidden = !dismissed;
      clearTimer(timer);
      clearTimer(closeTimer);
      bar.classList.remove("site-notice-scroll-hidden", "site-notice-closing");
      const scrollingElement = documentObj.scrollingElement || documentObj.documentElement;
      scrollPositions.set(scrollingElement, Math.max(0, windowObj.scrollY || scrollingElement.scrollTop || 0));
      bar.style.setProperty("--site-notice-duration", `${durationMs}ms`);
      bar.hidden = false;
      timer = setTimeoutImpl(close, durationMs);
      return true;
    } catch {
      return false;
    }
  }

  function setEnabled(nextEnabled: boolean): void {
    enabled = nextEnabled;
    try { storage?.setItem(SITE_NOTICE_STORAGE_KEY, enabled ? "1" : "0"); } catch {}
    toggleButton.setAttribute("aria-checked", String(enabled));
    if (enabled) void load();
    else close();
  }

  function handleScroll(event: Event): void {
    if (bar.hidden) return;
    const scrollingElement = documentObj.scrollingElement || documentObj.documentElement;
    const eventTarget = event.target as { scrollTop?: unknown } | null;
    const target = eventTarget && typeof eventTarget.scrollTop === "number" ? eventTarget : scrollingElement;
    const current = Math.max(0, target === scrollingElement ? (windowObj.scrollY || scrollingElement.scrollTop || 0) : Number(target.scrollTop) || 0);
    const previous = scrollPositions.get(target as object) ?? current;
    scrollPositions.set(target as object, current);
    const delta = current - previous;
    if (Math.abs(delta) < 3) return;
    if (delta > 0 && current > 10) bar.classList.add("site-notice-scroll-hidden");
    else if (delta < 0) bar.classList.remove("site-notice-scroll-hidden");
  }

  const handleClose = () => {
    dismissed = true;
    try { storage?.setItem(SITE_NOTICE_DISMISSED_KEY, "1"); } catch {}
    close();
  };
  const handleOptOut = () => {
    setEnabled(false);
    onOptOut();
  };
  const handleToggle = () => setEnabled(!enabled);

  closeButton.addEventListener("click", handleClose);
  optOutButton.addEventListener("click", handleOptOut);
  toggleButton.setAttribute("aria-checked", String(enabled));
  toggleButton.addEventListener("click", handleToggle);
  documentObj.addEventListener("scroll", handleScroll, { capture: true, passive: true });

  function destroy(): void {
    ++requestSerial;
    clearTimer(timer);
    clearTimer(closeTimer);
    timer = null;
    closeTimer = null;
    closeButton.removeEventListener("click", handleClose);
    optOutButton.removeEventListener("click", handleOptOut);
    toggleButton.removeEventListener("click", handleToggle);
    documentObj.removeEventListener("scroll", handleScroll, { capture: true });
  }

  return Object.freeze({
    load,
    close,
    setEnabled,
    destroy,
    isEnabled: () => enabled,
    isOpen: () => !bar.hidden && !bar.classList.contains("site-notice-closing"),
  });
}
