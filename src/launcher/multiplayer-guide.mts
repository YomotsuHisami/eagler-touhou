export const MULTIPLAYER_GUIDE_FILE = "content/MULTIPLAYER.html";

export interface MultiplayerGuideControllerOptions {
  documentObj?: Document;
  fetchImpl?: typeof fetch;
  readFailureText?: (error: unknown) => string;
  getGameId?: () => string;
  matchMediaImpl?: (query: string) => Pick<MediaQueryList, "matches">;
  setTimeoutImpl?: (callback: () => void, delay: number) => number;
}

interface AuthoredGuideGroup {
  key: string;
  nodes: HTMLElement[];
}

export const MULTIPLAYER_GUIDE_GAMES = Object.freeze([
  Object.freeze({ id: "th06", short: "TH06", title: "红魔乡" }),
  Object.freeze({ id: "th07", short: "TH07", title: "妖妖梦" }),
  Object.freeze({ id: "th08", short: "TH08", title: "永夜抄" }),
  Object.freeze({ id: "th10", short: "TH10", title: "风神录" }),
] as const);

export const DEFAULT_MULTIPLAYER_GUIDE_GAME = "th07";
export const MULTIPLAYER_GUIDE_COMMON_HEADING = "通用规则";

function normalizedGroupHeading(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function collectAuthoredGroups(target: HTMLElement): Map<string, AuthoredGuideGroup> {
  const groups = new Map<string, AuthoredGuideGroup>();
  let current: AuthoredGuideGroup | null = null;
  for (const child of Array.from(target.children) as HTMLElement[]) {
    if (child.tagName === "H2") {
      const key = normalizedGroupHeading(child.textContent || "");
      current = { key, nodes: [] };
      groups.set(key, current);
    } else if (current) current.nodes.push(child);
  }
  return groups;
}

function appendAuthoredGroup(panel: HTMLElement, documentObj: Document,
                             group: AuthoredGuideGroup | undefined,
                             skipHeading = ""): void {
  if (!group) return;
  let section: HTMLElement | null = null;
  let flattenSubheadings = false;
  for (const source of group.nodes) {
    const headingText = normalizedGroupHeading(source.textContent || "");
    if (source.tagName === "H3") {
      if (headingText === skipHeading) {
        section = null;
        flattenSubheadings = true;
        continue;
      }
      section = documentObj.createElement("section");
      section.className = "multiplayer-rule-section";
      const heading = documentObj.createElement("h2");
      heading.textContent = source.textContent || "";
      section.append(heading);
      panel.append(section);
      flattenSubheadings = false;
      continue;
    }
    if (source.tagName === "H4") {
      if (section && !flattenSubheadings) {
        const heading = documentObj.createElement("h3");
        heading.className = "multiplayer-rule-subheading";
        heading.textContent = source.textContent || "";
        section.append(heading);
      } else {
        section = documentObj.createElement("section");
        section.className = "multiplayer-rule-section";
        const heading = documentObj.createElement("h2");
        heading.textContent = source.textContent || "";
        section.append(heading);
        panel.append(section);
      }
      continue;
    }
    (section || panel).append(source.cloneNode(true));
  }
}

function makeDisclosure(documentObj: Document, scope: "common" | "specific", label: string,
                        open: boolean): { details: HTMLDetailsElement; body: HTMLElement } {
  const details = documentObj.createElement("details");
  details.className = `multiplayer-rule-disclosure multiplayer-rule-disclosure-${scope}`;
  details.dataset.scope = scope;
  details.open = open;
  const summary = documentObj.createElement("summary");
  summary.className = "multiplayer-rule-disclosure-summary";
  const title = documentObj.createElement("span");
  title.className = "multiplayer-rule-disclosure-title";
  title.textContent = label;
  summary.append(title);
  const body = documentObj.createElement("div");
  body.className = "multiplayer-rule-disclosure-body";
  details.append(summary, body);
  return { details, body };
}

function buildRuleGuide(target: HTMLElement, documentObj: Document, initialGameId: string): void {
  if (!target.children?.length) return;
  const groups = collectAuthoredGroups(target);
  const commonGroup = groups.get(MULTIPLAYER_GUIDE_COMMON_HEADING);
  if (!commonGroup) return;

  const guide = documentObj.createElement("div");
  guide.className = "multiplayer-rule-guide";
  guide.dataset.mpRuleGuide = "";

  const nav = documentObj.createElement("div");
  nav.className = "multiplayer-rule-tabs-shell";
  const gameTabs = documentObj.createElement("div");
  gameTabs.className = "multiplayer-rule-game-tabs";
  gameTabs.setAttribute("role", "tablist");
  gameTabs.setAttribute("aria-label", "作品");
  for (const game of MULTIPLAYER_GUIDE_GAMES) {
    const button = documentObj.createElement("button");
    button.type = "button";
    button.className = "multiplayer-rule-game-tab";
    button.dataset.game = game.id;
    button.setAttribute("role", "tab");
    button.textContent = game.title;
    gameTabs.append(button);
  }
  nav.append(gameTabs);
  guide.append(nav);

  const panels = documentObj.createElement("div");
  panels.className = "multiplayer-rule-panels";
  for (const game of MULTIPLAYER_GUIDE_GAMES) {
    const panel = documentObj.createElement("div");
    panel.className = "multiplayer-rule-panel";
    panel.dataset.game = game.id;
    const common = makeDisclosure(documentObj, "common", "通用规则", false);
    appendAuthoredGroup(common.body, documentObj, commonGroup);
    const specific = makeDisclosure(documentObj, "specific", "本作特有规则", false);
    appendAuthoredGroup(specific.body, documentObj, groups.get(`${game.short} ${game.title}`), "本作特有规则");
    if (!specific.body.children.length) {
      const empty = documentObj.createElement("p");
      empty.textContent = "无";
      specific.body.append(empty);
    }
    panel.append(common.details, specific.details);
    panels.append(panel);
  }
  guide.append(panels);
  target.replaceChildren(guide);

  const availableGames = new Set<string>(MULTIPLAYER_GUIDE_GAMES.map(game => game.id));
  let activeGame = availableGames.has(initialGameId) ? initialGameId : DEFAULT_MULTIPLAYER_GUIDE_GAME;
  const gameButtons = Array.from(gameTabs.querySelectorAll<HTMLButtonElement>("button[data-game]"));
  const panelElements = Array.from(panels.querySelectorAll<HTMLElement>(".multiplayer-rule-panel"));

  const render = () => {
    for (const button of gameButtons) {
      const selected = button.dataset.game === activeGame;
      button.classList.toggle("selected", selected);
      button.setAttribute("aria-selected", String(selected));
      button.tabIndex = selected ? 0 : -1;
    }
    for (const panel of panelElements) {
      panel.hidden = panel.dataset.game !== activeGame;
    }
  };

  const revealActiveGame = () => {
    const selected = gameButtons.find(button => button.dataset.game === activeGame);
    selected?.scrollIntoView({ block: "nearest", inline: "center" });
  };

  const resetRuleScroll = () => {
    target.scrollTop = 0;
  };

  const moveFocus = (buttons: readonly HTMLButtonElement[], current: HTMLButtonElement, delta: number) => {
    const index = buttons.indexOf(current);
    if (index < 0) return;
    buttons[(index + delta + buttons.length) % buttons.length]?.focus();
  };
  gameTabs.addEventListener("click", event => {
    const button = (event.target as Element | null)?.closest<HTMLButtonElement>("button[data-game]");
    if (!button?.dataset.game) return;
    activeGame = button.dataset.game;
    render();
    revealActiveGame();
    resetRuleScroll();
  });
  gameTabs.addEventListener("keydown", event => {
    const button = (event.target as Element | null)?.closest<HTMLButtonElement>("button[data-game]");
    if (!button) return;
    if (event.key === "ArrowLeft") { event.preventDefault(); moveFocus(gameButtons, button, -1); }
    else if (event.key === "ArrowRight") { event.preventDefault(); moveFocus(gameButtons, button, 1); }
  });
  guide.addEventListener("mp-guide-select-game", event => {
    const gameId = (event as CustomEvent<string>).detail;
    if (!availableGames.has(gameId)) return;
    activeGame = gameId;
    render();
    revealActiveGame();
    resetRuleScroll();
  });
  render();
  revealActiveGame();
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
        // Generated by the repository content build; raw authored HTML is
        // escaped and unsafe link/image protocols are removed before publish.
        target.innerHTML = await response.text();
        buildRuleGuide(target, documentObj, options.getGameId?.() || DEFAULT_MULTIPLAYER_GUIDE_GAME);
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
