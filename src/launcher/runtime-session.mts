export interface RuntimeSessionToken {
  readonly id: number;
  readonly game: string;
  readonly runtimeVariant: string;
  readonly generationId: string | null;
  readonly revision: string | null;
}

export function createRuntimeSessionOwner() {
  let serial = 0;
  let active: RuntimeSessionToken | null = null;
  const listeners = new Set<(session: RuntimeSessionToken | null) => void>();
  const notify = () => { for (const listener of listeners) listener(active); };

  return Object.freeze({
    begin(input: Omit<RuntimeSessionToken, "id">): RuntimeSessionToken {
      active = Object.freeze({ id: ++serial, ...input });
      notify();
      return active;
    },
    clear(): void {
      serial++;
      active = null;
      notify();
    },
    current(): RuntimeSessionToken | null {
      return active;
    },
    isCurrent(token: RuntimeSessionToken | null | undefined): boolean {
      return !!token && !!active && token.id === active.id;
    },
    assertCurrent(token: RuntimeSessionToken | null | undefined): RuntimeSessionToken {
      if (!token || !active || token.id !== active.id) throw new Error("Runtime session is no longer active");
      return active;
    },
    subscribe(listener: (session: RuntimeSessionToken | null) => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  });
}
