// Informational windows share Back ownership. Room/settings sheets keep their
// existing route owners; closing a help window must never reach those owners.
const historyKey = "eaglerInfoDialog";
const selector = "#mpGuideDialog,#firstUseNoticeDialog,#donationDialog,#appleRefreshDialog,#replayDialog,#lobbyNetworkDialog";

export function installDialogNavigation(): void {
  type Entry = { token: string; parent: string | undefined; dialog: HTMLDialogElement };
  const entries = new Map<string, Entry>();
  let active: Entry | null = null;
  let returning = false;
  let sequence = 0;
  const session = Date.now().toString(36);
  const currentToken = () => history.state?.[historyKey] as string | undefined;

  // A reloaded document has no open dialog corresponding to the old marker.
  if (currentToken()) {
    const state = { ...history.state };
    delete state[historyKey];
    history.replaceState(state, "");
  }

  function sync(dialog: HTMLDialogElement): void {
    if (dialog.open) {
      if (active?.dialog === dialog && currentToken() === active.token) return;
      const entry = { token: `${session}-${++sequence}`, parent: currentToken(), dialog };
      entries.set(entry.token, entry);
      history.pushState({ ...history.state, [historyKey]: entry.token }, "");
      active = entry;
    } else if (active?.dialog === dialog && currentToken() === active.token && !returning) {
      // The close button, backdrop and Escape consume the same entry as Back.
      returning = true;
      history.back();
    }
  }

  const observer = new MutationObserver(records => {
    for (const dialog of new Set(records.map(record => record.target))) {
      if (dialog instanceof HTMLDialogElement) sync(dialog);
    }
  });
  for (const dialog of document.querySelectorAll<HTMLDialogElement>(selector)) {
    observer.observe(dialog, { attributes: true, attributeFilter: ["open"] });
    if (dialog.open) sync(dialog);
  }

  window.addEventListener("popstate", event => {
    const next = entries.get(currentToken() || "") || null;
    if (!active && !next) return;
    if (active?.token === next?.token) return;
    // Consume only our own modal transition, before room/player route handlers.
    event.stopImmediatePropagation();
    const previous = active;
    active = next;
    returning = false;
    if (previous?.dialog.open && next?.parent !== previous.token) {
      // Existing cancel handlers own animation, cleanup and focus restoration.
      const cancel = new Event("cancel", { cancelable: true });
      if (previous.dialog.dispatchEvent(cancel)) previous.dialog.close();
    }
    if (next && !next.dialog.open) {
      next.dialog.classList.remove("closing");
      next.dialog.showModal();
    }
  }, { capture: true });
}
