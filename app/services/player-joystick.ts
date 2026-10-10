import {touchMovementUsesJoystick, type TouchMovementMode} from '../../src/launcher/game-preferences.mts';
/** Original .34 travel and .16 radial dead-zone; native adapters own thresholds. */
export function bindPlayerJoystick({element, knob, allowed, movement, axes, schedule}: {
  element: HTMLElement; knob: HTMLElement; allowed(): boolean; movement(): TouchMovementMode;
  axes(x: number, y: number): void; schedule(): void;
}) {
  let pointer: number | null = null;
  const cleanup: (() => void)[] = [];
  function on(type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel' | 'lostpointercapture', listener: (event: PointerEvent) => void) {
    element.addEventListener(type, listener); cleanup.push(() => element.removeEventListener(type, listener));
  }
  function reset(sync = true) {
    pointer = null; axes(0, 0); knob.style.transform = 'translate(-50%,-50%)'; element.classList.remove('active'); if (sync) schedule();
  }
  function update(event: PointerEvent) {
    if (event.pointerId !== pointer) return;
    const rect = element.getBoundingClientRect(); if (!rect.width || !rect.height) return;
    const maxTravel = Math.max(1, Math.min(rect.width, rect.height) * .34);
    const dx = event.clientX - rect.left - rect.width / 2, dy = event.clientY - rect.top - rect.height / 2;
    const distance = Math.hypot(dx, dy), clamped = Math.min(distance, maxTravel);
    const ux = distance > 0 ? dx / distance : 0, uy = distance > 0 ? dy / distance : 0;
    knob.style.transform = `translate(calc(-50% + ${ux * clamped}px),calc(-50% + ${uy * clamped}px))`;
    const radial = Math.min(1, distance / maxTravel), magnitude = radial <= .16 ? 0 : (radial - .16) / (1 - .16);
    axes(Math.round(ux * magnitude * 32767), Math.round(uy * magnitude * 32767)); schedule();
  }
  on('pointerdown', event => {
    if (!allowed() || !touchMovementUsesJoystick(movement()) || pointer !== null) return;
    event.preventDefault(); pointer = event.pointerId; element.classList.add('active');
    try {element.setPointerCapture(event.pointerId);} catch {} update(event);
  });
  on('pointermove', event => {if (pointer !== null) {event.preventDefault(); update(event);}});
  const release = (event: PointerEvent) => {if (event.pointerId !== pointer) return; event.preventDefault(); reset();};
  on('pointerup', release); on('pointercancel', release); on('lostpointercapture', release);
  return {reset, dispose() {reset(false); for (const off of cleanup) off();}};
}
