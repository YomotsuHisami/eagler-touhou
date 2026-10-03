import { isUiMessageKey, t } from './i18n.mjs';

// The Launcher and lobby use the same select implementation and CSS classes.
export function createCustomSelectController({ getHost }: { getHost?: (select?: HTMLSelectElement) => HTMLElement } = {}) {
  interface CustomSelectUi {
    root: HTMLDivElement;
    trigger: HTMLButtonElement;
    value: HTMLSpanElement;
    arrow: HTMLElement;
    menu: HTMLDivElement;
    signature: string;
  }
  const customSelects = new Map<HTMLSelectElement, CustomSelectUi>();
  function customSelectHost(select?: HTMLSelectElement) {
    return getHost?.(select) ?? select?.closest<HTMLDialogElement>('dialog[open]') ?? document.body;
  }
  function closeCustomSelect(select: HTMLSelectElement, { restoreFocus = false }: { restoreFocus?: boolean } = {}) {
    const ui = customSelects.get(select);
    if (!ui) return;
    if (ui.menu.hidden && ui.trigger.getAttribute("aria-expanded") === "false" && !ui.root.classList.contains("open")) {
      if (restoreFocus) ui.trigger.focus({ preventScroll: true });
      return;
    }
    ui.trigger.setAttribute("aria-expanded", "false");
    ui.menu.hidden = true;
    ui.root.classList.remove("open");
    if (restoreFocus) ui.trigger.focus({ preventScroll: true });
  }
  function closeOtherCustomSelects(except: HTMLSelectElement | null = null) {
    for (const select of customSelects.keys()) if (select !== except) closeCustomSelect(select);
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
  function syncCustomSelect(select: HTMLSelectElement) {
    const ui = customSelects.get(select);
    if (!ui) return;
    const selected = select.selectedOptions[0] || select.options[0];
    const triggerI18n = select.dataset.triggerI18n;
    ui.value.textContent = isUiMessageKey(triggerI18n) ? t(triggerI18n) : (selected?.textContent || "");
    const explicitLabel = select.id ? document.querySelector<HTMLLabelElement>(`label[for="${CSS.escape(select.id)}"]`)?.textContent?.trim() : "";
    const ariaLabel = select.getAttribute("aria-label") || explicitLabel || t("common.selectOption");
    ui.trigger.setAttribute("aria-label", ariaLabel);
    ui.menu.setAttribute("aria-label", ariaLabel);
    ui.trigger.disabled = select.disabled;
    ui.trigger.setAttribute("aria-disabled", String(select.disabled));
    const signature = Array.from(select.options, option => `${option.value}\u0000${option.textContent}\u0000${option.disabled}`).join("\u0001");
    if (signature !== ui.signature) {
      ui.signature = signature;
      ui.menu.replaceChildren(...Array.from(select.options, (option, index) => {
        const item = document.createElement("button");
        item.type = "button";
        item.className = "mizuki-select-item";
        item.dataset.value = option.value;
        item.dataset.index = String(index);
        item.setAttribute("role", "option");
        item.disabled = option.disabled;
        const label = document.createElement("span");
        label.textContent = option.textContent;
        const check = document.createElement("i");
        check.setAttribute("aria-hidden", "true");
        check.textContent = "✓";
        item.append(label, check);
        return item;
      }));
    }
    ui.menu.querySelectorAll<HTMLButtonElement>(".mizuki-select-item").forEach(item => {
      const selectedItem = item.dataset.value === select.value;
      item.classList.toggle("selected", selectedItem);
      item.setAttribute("aria-selected", String(selectedItem));
    });
    if (!ui.menu.hidden) positionCustomSelectMenu(select);
  }
  function openCustomSelect(select: HTMLSelectElement) {
    const ui = customSelects.get(select);
    if (!ui || select.disabled) return;
    closeOtherCustomSelects(select);
    syncCustomSelect(select);
    const host = customSelectHost(select);
    if (ui.menu.parentNode !== host) host.append(ui.menu);
    ui.menu.hidden = false;
    ui.root.classList.add("open");
    ui.trigger.setAttribute("aria-expanded", "true");
    positionCustomSelectMenu(select);
  }
  function installCustomSelect(select: HTMLSelectElement) {
    if (!select || customSelects.has(select)) return;
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
    if (select.id) {
      document.querySelectorAll<HTMLElement>(`label[for="${CSS.escape(select.id)}"]`).forEach(label => {
        label.addEventListener("click", event => {
          event.preventDefault();
          trigger.focus({ preventScroll: true });
          openCustomSelect(select);
        });
      });
    }
    const menu = document.createElement("div");
    menu.className = "mizuki-select-menu";
    menu.setAttribute("role", "listbox");
    menu.setAttribute("aria-label", select.getAttribute("aria-label") || t("common.selectOption"));
    menu.hidden = true;
    customSelects.set(select, { root, trigger, value, arrow, menu, signature: "" });
    trigger.addEventListener("click", event => {
      event.stopPropagation();
      if (trigger.getAttribute("aria-expanded") === "true") closeCustomSelect(select);
      else openCustomSelect(select);
    });
    trigger.addEventListener("keydown", event => {
      if (!["Enter", " ", "ArrowDown", "ArrowUp", "Escape"].includes(event.key)) return;
      if (event.key === "Escape") { event.preventDefault(); closeCustomSelect(select); return; }
      event.preventDefault();
      if (trigger.getAttribute("aria-expanded") !== "true") openCustomSelect(select);
      if (event.key === "Enter" || event.key === " ") return;
      const items = [...menu.querySelectorAll<HTMLButtonElement>(".mizuki-select-item:not(:disabled)")];
      const selectedIndex = Math.max(0, items.findIndex(item => item.dataset.value === select.value));
      items[event.key === "ArrowUp" ? Math.max(0, selectedIndex - 1) : Math.min(items.length - 1, selectedIndex + 1)]?.focus();
    });
    menu.addEventListener("click", event => {
      const item = event.target instanceof Element ? event.target.closest<HTMLButtonElement>(".mizuki-select-item") : null;
      if (!item || item.disabled) return;
      const changed = select.value !== item.dataset.value;
      select.value = item.dataset.value ?? "";
      closeCustomSelect(select, { restoreFocus: true });
      syncCustomSelect(select);
      if (changed) select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    menu.addEventListener("keydown", event => {
      const item = event.target instanceof Element ? event.target.closest<HTMLButtonElement>(".mizuki-select-item") : null;
      if (!item) return;
      const items = [...menu.querySelectorAll<HTMLButtonElement>(".mizuki-select-item:not(:disabled)")];
      const index = items.indexOf(item);
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        items[(index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
      } else if (event.key === "Escape") {
        event.preventDefault();
        closeCustomSelect(select, { restoreFocus: true });
      } else if (event.key === "Home" || event.key === "End") {
        event.preventDefault();
        items[event.key === "Home" ? 0 : items.length - 1]?.focus();
      }
    });
    syncCustomSelect(select);
  }
  function syncAllCustomSelects() {
    for (const select of customSelects.keys()) syncCustomSelect(select);
  }

  document.addEventListener("pointerdown", event => {
    for (const [select, ui] of customSelects) {
      if (event.target instanceof Node && (ui.root.contains(event.target) || ui.menu.contains(event.target))) continue;
      closeCustomSelect(select);
    }
  }, true);
  window.addEventListener("resize", () => {
    for (const select of customSelects.keys()) positionCustomSelectMenu(select);
  });
  window.addEventListener("scroll", () => {
    for (const select of customSelects.keys()) positionCustomSelectMenu(select);
  }, true);
  return { installCustomSelect, syncCustomSelect, syncAllCustomSelects, closeOtherCustomSelects };
}
