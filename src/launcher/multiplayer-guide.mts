import { renderContentFragment } from "./content-fragment.mjs";
import {buildRuleGuide, DEFAULT_GUIDE_GAME} from "./multiplayer-guide-content.mjs";

export const MULTIPLAYER_GUIDE_FILE = "content/MULTIPLAYER.html";

export interface MultiplayerGuideControllerOptions {
  documentObj?: Document;
  fetchImpl?: typeof fetch;
  readFailureText?: (error: unknown) => string;
  getGameId?: () => string;
  matchMediaImpl?: (query: string) => Pick<MediaQueryList, "matches">;
  setTimeoutImpl?: (callback: () => void, delay: number) => number;
}

function isDialogElement(value: HTMLElement): value is HTMLDialogElement {
  return "showModal" in value && typeof value.showModal === "function" &&
    "close" in value && typeof value.close === "function" &&
    "open" in value && typeof value.open === "boolean";
}

export function createMultiplayerGuideController(options: MultiplayerGuideControllerOptions = {}) {
  const documentObj = options.documentObj ?? globalThis.document;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const matchMediaImpl = options.matchMediaImpl ?? (query => globalThis.matchMedia?.(query) ?? { matches: false });
  const setTimeoutImpl = options.setTimeoutImpl ?? ((callback, delay) => globalThis.setTimeout(callback, delay));
  const readFailureText = options.readFailureText ?? (() => "联机玩法介绍读取失败，请刷新页面后重试。");
  if (!documentObj || typeof fetchImpl !== "function") throw new Error("Multiplayer guide requires a browser document and fetch implementation");

  const find = (id: string): HTMLElement => {
    const value = documentObj.getElementById(id);
    if (!value) throw new Error(`Multiplayer guide element is missing: #${id}`);
    return value;
  };
  const candidate = find("mpGuideDialog");
  if (!isDialogElement(candidate)) throw new Error("Multiplayer guide element must be a dialog: #mpGuideDialog");
  const dialog = candidate;
  const target = find("mpGuideContent");
  const closeButton = find("mpGuideClose");
  let loaded = false;
  let loading: Promise<void> | null = null;
  let closing = false;
  let closeGeneration = 0;

  function renderStatus(text: string, className: string): void {
    const paragraph = documentObj.createElement("p");
    paragraph.className = className;
    paragraph.textContent = text;
    target.replaceChildren(paragraph);
  }

  async function load(): Promise<void> {
    if (loaded) return;
    if (!loading) loading = (async () => {
      try {
        const response = await fetchImpl(MULTIPLAYER_GUIDE_FILE);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        renderContentFragment(target, await response.text(), documentObj);
        buildRuleGuide(target, documentObj, options.getGameId?.() || DEFAULT_GUIDE_GAME);
        loaded = true;
      } catch (error) {
        renderStatus(readFailureText(error), "multiplayer-guide-error");
      } finally {
        loading = null;
      }
    })();
    await loading;
  }

  async function show(): Promise<void> {
    ++closeGeneration;
    closing = false;
    dialog.classList.remove("closing");
    if (!dialog.open) dialog.showModal();
    await load();
    const guide = target.querySelector<HTMLElement>("[data-mp-rule-guide]");
    const currentGame = options.getGameId?.();
    if (guide && currentGame) guide.dispatchEvent(new CustomEvent("mp-guide-select-game", { detail: currentGame }));
  }

  function close(): void {
    if (!dialog.open || closing) return;
    const generation = ++closeGeneration;
    if (matchMediaImpl("(prefers-reduced-motion: reduce)").matches) { dialog.close(); return; }
    closing = true;
    dialog.classList.add("closing");
    setTimeoutImpl(() => {
      if (generation !== closeGeneration) return;
      if (dialog.open) dialog.close();
      dialog.classList.remove("closing");
      closing = false;
    }, 180);
  }

  closeButton.addEventListener("click", close);
  dialog.addEventListener("cancel", event => { event.preventDefault(); close(); });
  dialog.addEventListener("click", event => { if (event.target === dialog) close(); });
  return Object.freeze({ load, show, close, isOpen: () => dialog.open });
}
