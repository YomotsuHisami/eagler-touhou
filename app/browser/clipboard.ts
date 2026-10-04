/** Clipboard API is unavailable on ordinary HTTP hosts and may reject access.
 * Keep the legacy copy path, including fullscreen/modal containment and focus. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {await navigator.clipboard.writeText(text); return true;}
  } catch {}
  if (typeof document === 'undefined') return false;
  const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const selection = document.getSelection();
  const ranges = selection ? Array.from({length: selection.rangeCount}, (_, index) => selection.getRangeAt(index).cloneRange()) : [];
  const inputSelection = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement
    ? {start: active.selectionStart, end: active.selectionEnd, direction: active.selectionDirection} : null;
  const area = document.createElement('textarea');
  area.value = text; area.readOnly = true;
  area.style.cssText = 'position:fixed;inset:0 auto auto 0;width:1px;height:1px;opacity:0;pointer-events:none';
  // A Radix focus trap must not redirect focus before execCommand copies.
  const modal = active?.closest('[role="dialog"]');
  (modal ?? document.fullscreenElement ?? document.body).append(area);
  let copied = false;
  try {area.select(); area.setSelectionRange(0, area.value.length); copied = document.execCommand('copy');} catch {}
  finally {
    area.remove();
    if (active?.isConnected) {
      active.focus({preventScroll: true});
      if (inputSelection?.start != null && inputSelection.end != null && (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement)) {
        try {active.setSelectionRange(inputSelection.start, inputSelection.end, inputSelection.direction ?? undefined);} catch {}
      }
    }
    if (selection && ranges.length) {
      try {selection.removeAllRanges(); for (const range of ranges) selection.addRange(range);} catch {}
    }
  }
  return copied;
}
