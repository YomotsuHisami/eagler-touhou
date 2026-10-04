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
  const releaseKey = () => { if (timer !== null) cancel(timer); timer = null;
    if (held) { held = false; send(false); } };
  const release = () => { pointer = null; releaseKey(); };
  return {
    down(id: number) { if (pointer !== null) return false;
      if (timer !== null) cancel(timer); timer = null; pointer = id;
      if (!held) { held = true; send(true); }
      if (mode === "tap") timer = schedule(releaseKey); return true; },
    up(id: number) { if (pointer !== id) return; pointer = null;
      // Ensure a very short tap survives at least one 60 Hz sample. Long holds
      // remain held; cancellation/background always releases immediately.
      if (mode === "hold") timer = schedule(releaseKey); },
    lost(id: number) { if (pointer === id) release(); },
    cancel: release,
  };
}
