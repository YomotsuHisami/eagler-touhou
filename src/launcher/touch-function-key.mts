// Reserved ordinary C input. Future titles opt in here; title mechanics never
// belong to Launcher. Tap is the default; future titles can explicitly opt
// into hold semantics for charge/release mechanics.
export const functionKeySpec = Object.freeze({ code: "KeyC", key: "c", keyCode: 67 });
export const functionKeyGames: ReadonlySet<string> = new Set(["th11"]);

export function createFunctionKeyOwner(send: (down: boolean) => void,
  mode: "tap" | "hold" = "tap",
  schedule: (fn: () => void) => unknown = fn => setTimeout(fn, 50),
  cancel: (timer: unknown) => void = timer => clearTimeout(timer as ReturnType<typeof setTimeout>)) {
  let held = false, pointer: number | null = null, timer: unknown = null;
  let queued = 0;
  const releaseKey = () => { if (timer !== null) cancel(timer); timer = null;
    if (held) { held = false; send(false); } };
  const pulse = () => {
    held = true; send(true);
    timer = schedule(() => {
      timer = null; held = false; send(false);
      // Preserve a sampled UP between pulses. An immediate UP/DOWN pair can
      // collapse back into a hold before Runtime's next logical input sample.
      timer = schedule(() => {
        timer = null;
        if (queued > 0) { queued--; pulse(); }
      });
    });
  };
  const release = () => { pointer = null; queued = 0; releaseKey(); };
  return {
    down(id: number) { if (pointer !== null) return false;
      if (mode === "tap") {
        pointer = id;
        if (timer !== null) queued++; else pulse();
        return true;
      }
      if (timer !== null) cancel(timer); timer = null; pointer = id;
      if (!held) { held = true; send(true); }
      return true; },
    up(id: number) { if (pointer !== id) return; pointer = null;
      // Ensure a very short tap survives at least one 60 Hz sample. Long holds
      // remain held; cancellation/background always releases immediately.
      if (mode === "hold") timer = schedule(releaseKey); },
    lost(id: number) { if (pointer === id) release(); },
    cancel: release,
  };
}
