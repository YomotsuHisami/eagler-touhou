import { isUiMessageKey, t as defaultTranslate, type UiMessageKey } from './i18n.mjs';
import {createCustomSelectState, type CustomSelectState} from './custom-select-state.mjs';

export interface CustomSelectPresentation {
  root: HTMLDivElement; trigger: HTMLButtonElement; value: HTMLSpanElement; menu: HTMLDivElement;
  state: CustomSelectState;
  /** Commit only the presentation during native event handling, never the native select. */
  commit?(update: () => void): void;
}

// The Launcher and lobby use the same select implementation and CSS classes.
export function createCustomSelectController({getHost, translate = defaultTranslate, syncOwner}: {
  getHost?: (select?: HTMLSelectElement) => HTMLElement;
  translate?: (key: UiMessageKey) => string;
  syncOwner?: (select: HTMLSelectElement, menu: HTMLDivElement) => void;
} = {}) {
  let t = translate;
  const globalCleanups: Array<() => void> = [];
  const listen = <K extends keyof HTMLElementEventMap>(target: EventTarget, type: K, callback: (event: HTMLElementEventMap[K]) => void, options?: boolean | AddEventListenerOptions, cleanups = globalCleanups) => {
    const listener = (event: Event) => callback(event as HTMLElementEventMap[K]);
    target.addEventListener(type, listener, options);
    cleanups.push(() => target.removeEventListener(type, listener, options));
  };
  const update = (ui: CustomSelectUi, action: () => void, immediate = false) => immediate && ui.commit ? ui.commit(action) : action();
  interface CustomSelectUi extends CustomSelectPresentation {cleanups: Array<() => void>; native: boolean}
  const customSelects = new Map<HTMLSelectElement, CustomSelectUi>();
  function customSelectHost(select?: HTMLSelectElement) {
    return getHost?.(select) ?? select?.closest<HTMLDialogElement>('dialog[open]') ?? document.body;
  }
  function closeCustomSelect(select: HTMLSelectElement, { restoreFocus = false, immediate = false }: { restoreFocus?: boolean; immediate?: boolean } = {}) {
    const ui = customSelects.get(select);
    if (!ui) return;
    if (!ui.state.getSnapshot().open && ui.menu.hidden && ui.trigger.getAttribute("aria-expanded") === "false" && !ui.root.classList.contains("open")) {
      if (restoreFocus) ui.trigger.focus({ preventScroll: true });
      return;
    }
    update(ui, () => ui.state.setOpen(false), immediate);
    // Closing is synchronous even from a host layout effect before showModal.
    // The model owns the flag; this narrow reflection preserves native ordering.
    ui.trigger.setAttribute("aria-expanded", "false");
    ui.menu.hidden = true;
    ui.root.classList.remove("open");
    if (restoreFocus) ui.trigger.focus({ preventScroll: true });
  }
  function closeOtherCustomSelects(except: HTMLSelectElement | null = null, immediate = false) {
    for (const select of customSelects.keys()) if (select !== except) closeCustomSelect(select, {immediate});
  }
  function positionCustomSelectMenu(select: HTMLSelectElement) {
    const ui = customSelects.get(select);
    if (!ui || ui.menu.hidden) return;
    const rect = ui.trigger.getBoundingClientRect();
    const gap = 7;
    const viewportGap = 10;
    const host = ui.menu.parentElement;
    const dialogHost = host instanceof HTMLDialogElement ? host : null;
    const hostRect = dialogHost?.getBoundingClientRect();
    const visibleLeft = hostRect ? Math.max(viewportGap, hostRect.left + viewportGap) : viewportGap;
    const visibleRight = hostRect ? Math.min(window.innerWidth - viewportGap, hostRect.right - viewportGap) : window.innerWidth - viewportGap;
    const visibleTop = hostRect ? Math.max(viewportGap, hostRect.top + viewportGap) : viewportGap;
    const visibleBottom = hostRect ? Math.min(window.innerHeight - viewportGap, hostRect.bottom - viewportGap) : window.innerHeight - viewportGap;
    const width = Math.min(Math.max(rect.width, 192), Math.min(280, Math.max(1, visibleRight - visibleLeft)));
    const left = Math.max(visibleLeft, Math.min(rect.left, visibleRight - width));
    const belowHeight = Math.max(0, visibleBottom - rect.bottom - gap);
    const aboveHeight = Math.max(0, rect.top - gap - visibleTop);
    const naturalHeight = ui.menu.scrollHeight;
    const openBelow = belowHeight >= Math.min(naturalHeight, 120) || belowHeight >= aboveHeight;
    const availableHeight = Math.max(1, openBelow ? belowHeight : aboveHeight);
    const top = openBelow ? rect.bottom + gap : rect.top - gap - Math.min(naturalHeight, availableHeight);
    ui.menu.style.position = dialogHost ? "absolute" : "fixed";
    ui.menu.style.minWidth = `${Math.round(rect.width)}px`;
    ui.menu.style.width = `${Math.round(width)}px`;
    ui.menu.style.maxHeight = `${Math.round(availableHeight)}px`;
    if (dialogHost && hostRect) {
      ui.menu.style.left = `${Math.round(left - hostRect.left + dialogHost.scrollLeft - dialogHost.clientLeft)}px`;
      ui.menu.style.top = `${Math.round(top - hostRect.top + dialogHost.scrollTop - dialogHost.clientTop)}px`;
    } else {
      ui.menu.style.left = `${Math.round(left)}px`;
      ui.menu.style.top = `${Math.round(top)}px`;
    }
  }
  function reflectDescription(ui: CustomSelectPresentation) {
    const description = ui.state.getSnapshot().description;
    if (!description) return;
    ui.value.textContent = description.label;
    ui.trigger.setAttribute("aria-label", description.ariaLabel);
    ui.menu.setAttribute("aria-label", description.ariaLabel);
    ui.trigger.disabled = description.disabled;
    ui.trigger.setAttribute("aria-disabled", String(description.disabled));
    ui.menu.querySelectorAll<HTMLButtonElement>(".mizuki-select-item").forEach(item => {
      const selected = item.dataset.value === description.value;
      item.classList.toggle("selected", selected); item.setAttribute("aria-selected", String(selected));
    });
  }
  function syncCustomSelect(select: HTMLSelectElement, immediate = false) {
    const ui = customSelects.get(select);
    if (!ui) return;
    const selected = select.selectedOptions[0] || select.options[0];
    const triggerI18n = select.dataset.triggerI18n;
    const label = isUiMessageKey(triggerI18n) ? t(triggerI18n) : (selected?.textContent || "");
    const explicitLabel = select.id ? document.querySelector<HTMLLabelElement>(`label[for="${CSS.escape(select.id)}"]`)?.textContent?.trim() : "";
    const ariaLabel = select.getAttribute("aria-label") || explicitLabel || t("common.selectOption");
    const options = Array.from(select.options, (option, index) => ({value: option.value, text: option.textContent || "", disabled: option.disabled, index}));
    const signature = Array.from(select.options, option => `${option.value}\u0000${option.textContent}\u0000${option.disabled}`).join("\u0001");
    syncOwner?.(select, ui.menu);
    update(ui, () => ui.state.sync({value: select.value, label, ariaLabel, disabled: select.disabled, signature, options}), immediate);
    // Reflect the single projection on existing nodes before native change.
    // Flushing React after focus would also flush unrelated ancestor updates,
    // restoring an old controlled select.value before its change event. React
    // owns node creation/replacement and converges to this projection afterward.
    reflectDescription(ui);
    if (!ui.menu.hidden) positionCustomSelectMenu(select);
  }
  function openCustomSelect(select: HTMLSelectElement) {
    const ui = customSelects.get(select);
    if (!ui || select.disabled) return;
    closeOtherCustomSelects(select, true);
    syncCustomSelect(select, true);
    const host = customSelectHost(select);
    if (ui.menu.parentNode !== host) host.append(ui.menu);
    update(ui, () => ui.state.setOpen(true), true);
    ui.menu.hidden = false;
    ui.root.classList.add("open");
    ui.trigger.setAttribute("aria-expanded", "true");
    positionCustomSelectMenu(select);
  }
  function createNativePresentation(select: HTMLSelectElement): CustomSelectPresentation {
    const root = document.createElement("div");
    root.className = "mizuki-select";
    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "mizuki-select-trigger";
    trigger.setAttribute("aria-haspopup", "listbox");
    trigger.setAttribute("aria-expanded", "false");
    trigger.setAttribute("aria-label", select.getAttribute("aria-label") || t("common.selectOption"));
    const value = document.createElement("span");
    value.className = "mizuki-select-value";
    const arrow = document.createElement("i");
    arrow.className = "mizuki-select-arrow";
    arrow.setAttribute("aria-hidden", "true");
    arrow.innerHTML = '<svg viewBox="0 0 24 24" focusable="false"><path d="m7 10 5 5 5-5"/></svg>';
    trigger.append(value, arrow);
    const prefixTemplate = select.parentElement?.querySelector<HTMLTemplateElement>(":scope > template[data-select-trigger-prefix]");
    if (prefixTemplate) trigger.prepend(prefixTemplate.content.cloneNode(true));
    select.before(root);
    root.append(trigger, select);
    select.classList.add("custom-select-native");
    select.tabIndex = -1;
    select.setAttribute("aria-hidden", "true");
    const menu = document.createElement("div");
    menu.className = "mizuki-select-menu";
    menu.setAttribute("role", "listbox");
    menu.setAttribute("aria-label", select.getAttribute("aria-label") || t("common.selectOption"));
    menu.hidden = true;
    const state = createCustomSelectState();
    const presentation = {root, trigger, value, menu, state};
    let signature = "";
    state.subscribe(() => {
      const snapshot = state.getSnapshot(), description = snapshot.description;
      trigger.setAttribute("aria-expanded", String(snapshot.open));
      menu.hidden = !snapshot.open; root.classList.toggle("open", snapshot.open);
      if (!description) return;
      if (signature !== description.signature) {
        signature = description.signature;
        menu.replaceChildren(...description.options.map(option => {
          const item = document.createElement("button"); item.type = "button"; item.className = "mizuki-select-item";
          item.dataset.value = option.value; item.dataset.index = String(option.index); item.setAttribute("role", "option"); item.disabled = option.disabled;
          const label = document.createElement("span"); label.textContent = option.text;
          const check = document.createElement("i"); check.setAttribute("aria-hidden", "true"); check.textContent = "✓";
          item.append(label, check); return item;
        }));
      }
      reflectDescription(presentation);
    });
    return presentation;
  }
  function installCustomSelect(select: HTMLSelectElement, presentation?: CustomSelectPresentation) {
    if (!select || customSelects.has(select)) return;
    const originalTabIndex = select.getAttribute('tabindex'), originalAriaHidden = select.getAttribute('aria-hidden');
    const originallyNative = select.classList.contains('custom-select-native');
    const ui: CustomSelectUi = {...(presentation ?? createNativePresentation(select)), cleanups: [], native: !presentation};
    const {root, trigger, menu} = ui;
    customSelects.set(select, ui);
    select.classList.add("custom-select-native"); select.tabIndex = -1; select.setAttribute("aria-hidden", "true");
    ui.cleanups.push(() => {
      if (!originallyNative) select.classList.remove('custom-select-native');
      if (originalTabIndex === null) select.removeAttribute('tabindex'); else select.setAttribute('tabindex', originalTabIndex);
      if (originalAriaHidden === null) select.removeAttribute('aria-hidden'); else select.setAttribute('aria-hidden', originalAriaHidden);
    });
    if (select.id) {
      document.querySelectorAll<HTMLElement>(`label[for="${CSS.escape(select.id)}"]`).forEach(label => {
        listen(label, "click", event => {
          event.preventDefault();
          trigger.focus({ preventScroll: true });
          openCustomSelect(select);
        }, undefined, ui.cleanups);
      });
    }
    listen(trigger, "click", event => {
      event.stopPropagation();
      if (ui.state.getSnapshot().open) closeCustomSelect(select, {immediate: true});
      else openCustomSelect(select);
    }, undefined, ui.cleanups);
    listen(trigger, "keydown", event => {
      if (!["Enter", " ", "ArrowDown", "ArrowUp", "Escape"].includes(event.key)) return;
      if (event.key === "Escape") { event.preventDefault(); closeCustomSelect(select, {immediate: true}); return; }
      event.preventDefault();
      if (!ui.state.getSnapshot().open) openCustomSelect(select);
      if (event.key === "Enter" || event.key === " ") return;
      const items = [...menu.querySelectorAll<HTMLButtonElement>(".mizuki-select-item:not(:disabled)")];
      const selectedIndex = Math.max(0, items.findIndex(item => item.dataset.value === select.value));
      items[event.key === "ArrowUp" ? Math.max(0, selectedIndex - 1) : Math.min(items.length - 1, selectedIndex + 1)]?.focus();
    }, undefined, ui.cleanups);
    listen(menu, "click", event => {
      const item = event.target instanceof Element ? event.target.closest<HTMLButtonElement>(".mizuki-select-item") : null;
      if (!item || item.disabled) return;
      const changed = select.value !== item.dataset.value;
      select.value = item.dataset.value ?? "";
      closeCustomSelect(select, { restoreFocus: true });
      syncCustomSelect(select);
      if (changed) select.dispatchEvent(new Event("change", { bubbles: true }));
    }, undefined, ui.cleanups);
    listen(menu, "keydown", event => {
      const item = event.target instanceof Element ? event.target.closest<HTMLButtonElement>(".mizuki-select-item") : null;
      if (!item) return;
      const items = [...menu.querySelectorAll<HTMLButtonElement>(".mizuki-select-item:not(:disabled)")];
      const index = items.indexOf(item);
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        items[(index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
      } else if (event.key === "Escape") {
        event.preventDefault();
        closeCustomSelect(select, { restoreFocus: true, immediate: true });
      } else if (event.key === "Home" || event.key === "End") {
        event.preventDefault();
        items[event.key === "Home" ? 0 : items.length - 1]?.focus();
      }
    }, undefined, ui.cleanups);
    syncCustomSelect(select);
  }
  function syncAllCustomSelects() {
    for (const select of customSelects.keys()) syncCustomSelect(select);
  }
  
  listen(document, "pointerdown", event => {
    for (const [select, ui] of customSelects) {
      if (event.target instanceof Node && (ui.root.contains(event.target) || ui.menu.contains(event.target))) continue;
      closeCustomSelect(select, {immediate: true});
    }
  }, true);
  listen(window, "resize", () => {
    for (const select of customSelects.keys()) positionCustomSelectMenu(select);
  });
  listen(window, "scroll", () => {
    for (const select of customSelects.keys()) positionCustomSelectMenu(select);
  }, true);
  function uninstallCustomSelect(select: HTMLSelectElement) {
    const ui = customSelects.get(select); if (!ui) return;
    closeCustomSelect(select);
    for (const cleanup of ui.cleanups) cleanup();
    if (ui.native) {ui.menu.remove(); ui.root.before(select); ui.root.remove();}
    customSelects.delete(select);
  }
  return {installCustomSelect, uninstallCustomSelect, syncCustomSelect, syncAllCustomSelects, closeOtherCustomSelects, positionCustomSelectMenu,
    setTranslate(translate: (key: UiMessageKey) => string) {t = translate;},
    dispose() {for (const select of [...customSelects.keys()]) uninstallCustomSelect(select); for (const cleanup of globalCleanups.splice(0)) cleanup();},
  };
}
