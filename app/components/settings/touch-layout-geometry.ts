import {normalizeTouchLayoutPriorityOrder, touchLayoutControlMeta, touchLayoutControlNames,
  type TouchLayoutControlName, type TouchLayoutProfile, type TouchLayoutControlPlacement} from '../../../src/launcher/touch-layout-model.mts';
export function controlElement(surface: HTMLElement, name: TouchLayoutControlName): HTMLElement {
  const element = surface.querySelector<HTMLElement>(`#${touchLayoutControlMeta[name].id}`);
  if (!element) throw new Error(`Missing touch control: ${name}`);
  return element;
}
/** Main captureDefaultTouchLayoutProfile: derive defaults from final authored
 * CSS, never from an approximate second coordinate table. */
export function captureTouchLayoutDefaults(surface: HTMLElement, unavailable: string): TouchLayoutProfile {
  const elements = touchLayoutControlNames.map(name => [name, controlElement(surface, name)] as const);
  const previous = elements.map(([name, element]) => ({name, element, hidden: element.hidden, style: element.getAttribute('style')}));
  const custom = surface.classList.contains('touch-layout-custom');
  surface.classList.add('touch-layout-capturing'); surface.classList.remove('touch-layout-custom');
  for (const [, element] of elements) {element.hidden = false; element.removeAttribute('style');}
  try {
    const safe = surface.querySelector<HTMLElement>('#touchLayoutSafeZone')!.getBoundingClientRect();
    if (!safe.width || !safe.height) throw new Error(unavailable);
    const controls: TouchLayoutProfile['controls'] = {};
    for (const [name, element] of elements) {
      const rect = element.getBoundingClientRect();
      if (!rect.width || !rect.height) throw new Error(unavailable);
      controls[name] = {x: Math.max(0, Math.min(1, (rect.left + rect.width / 2 - safe.left) / safe.width)),
        y: Math.max(0, Math.min(1, (rect.top + rect.height / 2 - safe.top) / safe.height)),
        scale: name === 'bomb' ? 1.5 : 1, priority: touchLayoutControlMeta[name].priority};
    }
    return {controls: normalizeTouchLayoutPriorityOrder(controls), viewport: {x: 0}};
  } finally {
    for (const {element, hidden, style} of previous) {element.hidden = hidden; if (style == null) element.removeAttribute('style'); else element.setAttribute('style', style);}
    surface.classList.toggle('touch-layout-custom', custom); surface.classList.remove('touch-layout-capturing');
  }
}
export function visibleTouchControls(surface: HTMLElement) {
  return touchLayoutControlNames.filter(name => {const element = controlElement(surface, name); return !element.hidden && getComputedStyle(element).display !== 'none';});
}
export function effectivePlacement(element: HTMLElement, item: TouchLayoutControlPlacement, safe: DOMRect) {
  const marginX = Math.min(.48, (element.offsetWidth * item.scale / 2 + 6) / Math.max(1, safe.width));
  const marginY = Math.min(.48, (element.offsetHeight * item.scale / 2 + 6) / Math.max(1, safe.height));
  return {x: Math.max(marginX, Math.min(1 - marginX, item.x)), y: Math.max(marginY, Math.min(1 - marginY, item.y))};
}
export function overlapRatio(a: DOMRect, b: DOMRect) {
  const width = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
  const height = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  return width * height / Math.max(1, Math.min(a.width * a.height, b.width * b.height));
}
