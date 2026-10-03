/** Geometry extracted unchanged from the former launcher handlers. Game movement,
 * gestures, speed limits and joystick modes remain entirely Runtime-owned. */
export interface InputRect { left: number; top: number; width: number; height: number }
export function directTouchPoint(rect: InputRect, point: {clientX: number; clientY: number}) {
  if (!(rect.width > 0) || !(rect.height > 0)) return null;
  return {x: (point.clientX - rect.left) / rect.width, y: (point.clientY - rect.top) / rect.height};
}
export function joystickPoint(rect: InputRect, point: {clientX: number; clientY: number}) {
  if (!(rect.width > 0) || !(rect.height > 0)) return null;
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const maxTravel = Math.max(1, Math.min(rect.width, rect.height) * .34);
  const dx = point.clientX - cx;
  const dy = point.clientY - cy;
  const distance = Math.hypot(dx, dy);
  const clamped = Math.min(distance, maxTravel);
  const ux = distance > 0 ? dx / distance : 0;
  const uy = distance > 0 ? dy / distance : 0;
  const radial = Math.min(1, distance / maxTravel);
  const deadZone = .16;
  const magnitude = radial <= deadZone ? 0 : (radial - deadZone) / (1 - deadZone);
  return {visualX: ux * clamped, visualY: uy * clamped,
    joystickX: Math.round(ux * magnitude * 32767), joystickY: Math.round(uy * magnitude * 32767)};
}
export function layoutPosition(item: {x: number; y: number; scale: number}, control: {width: number; height: number}, safe: {width: number; height: number}) {
  if (!safe.width || !safe.height) return {x: item.x, y: item.y};
  const marginX = Math.min(.48, ((control.width * item.scale) / 2 + 6) / safe.width);
  const marginY = Math.min(.48, ((control.height * item.scale) / 2 + 6) / safe.height);
  return {x: Math.max(marginX, Math.min(1 - marginX, item.x)), y: Math.max(marginY, Math.min(1 - marginY, item.y))};
}
