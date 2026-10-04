/** Fixture-only clock. Real room recovery stays enabled, but UI assertions must
 * not race its 650 ms Host retry on slower browser engines. Advancing this clock
 * is explicit; Router, animation, focus and browser timers remain untouched. */
export function createRoomPanelClock() {
  let now = 0, serial = 0;
  const pending = new Map<number, {at: number; callback(): void}>();
  return {
    now: () => now,
    set(callback: () => void, delay: number) {
      const id = ++serial;
      pending.set(id, {at: now + delay, callback});
      return id;
    },
    clear(handle: unknown) {pending.delete(handle as number);},
    advance(milliseconds: number) {
      if (!Number.isFinite(milliseconds) || milliseconds < 0) throw Error('Room fixture clock must advance by finite nonnegative milliseconds');
      const end = now + milliseconds;
      for (;;) {
        const next = [...pending].sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
        if (!next || next[1].at > end) break;
        const [id, task] = next;
        now = task.at; pending.delete(id); task.callback();
      }
      now = end;
    },
    pending: () => [...pending.values()].map(task => task.at).sort((a, b) => a - b),
  };
}
