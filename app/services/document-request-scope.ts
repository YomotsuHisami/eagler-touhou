/** A document departure fences new fetches and lazy module starts before pagehide disposes owners.
 * beforeunload can be cancelled, so it must not cancel a prepared Runtime or
 * destroy its controller. Hold new fetches until pagehide or safe re-entry.
 */
export function createDocumentRequestScope(options: {
  target: Pick<Window, 'addEventListener' | 'removeEventListener'>;
  fetchImpl: typeof fetch;
  canResume?: () => boolean;
}) {
  type Pending = {start(): void; reject(reason: unknown): void};
  const pending = new Set<Pending>();
  let state: 'active' | 'leaving' | 'departed' = 'active';
  let attached = false, disposed = false;
  const stopped = () => new DOMException('The document has departed', 'AbortError');
  function drain() {
    if (!attached || disposed || state !== 'active') return;
    for (const request of [...pending]) request.start();
  }
  const beforeUnload = () => {if (!disposed && state === 'active') state = 'leaving';};
  const hide = () => {
    state = 'departed';
    for (const request of [...pending]) request.reject(stopped());
  };
  const show = () => {
    if (disposed) return;
    state = options.canResume?.() === false ? 'leaving' : 'active';
    drain();
  };
  const interact = (event: Event) => {
    // An attempted navigation may have been cancelled by a native warning.
    // Programmatic effects/events must never revive the departing document.
    if (attached && !disposed && event.isTrusted && ['pointerdown', 'keydown'].includes(event.type) &&
        state === 'leaving' && options.canResume?.() !== false) show();
  };
  // Import() cannot receive an AbortSignal. Fence its start in the same place
  // as fetch, while the owning controller fences eventual resolution/rejection.
  function run<T>(start: () => T | PromiseLike<T>, signal?: AbortSignal | null): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const cleanup = () => {pending.delete(request); signal?.removeEventListener('abort', abort);};
      const request: Pending = {
        reject(reason) {cleanup(); reject(reason);},
        start() {
          if (signal?.aborted) {request.reject(signal.reason ?? stopped()); return;}
          if (disposed || state === 'departed') {request.reject(stopped()); return;}
          if (!attached || state !== 'active') return;
          cleanup();
          try {resolve(start());} catch (error) {reject(error);}
        },
      };
      const abort = () => request.reject(signal?.reason ?? stopped());
      pending.add(request);
      signal?.addEventListener('abort', abort, {once: true});
      request.start();
    });
  }
  const fetchForDocument: typeof fetch = (input, init) => {
    const signal = init?.signal === null ? null
      : init?.signal ?? (typeof Request !== 'undefined' && input instanceof Request ? input.signal : null);
    return run(() => options.fetchImpl(input, init), signal);
  };
  function detach() {
    if (!attached) return;
    attached = false;
    options.target.removeEventListener('beforeunload', beforeUnload, true);
    options.target.removeEventListener('pagehide', hide, true);
    options.target.removeEventListener('pageshow', show, true);
    options.target.removeEventListener('pointerdown', interact, true);
    options.target.removeEventListener('keydown', interact, true);
  }
  return Object.freeze({
    fetch: fetchForDocument,
    run,
    resumeFromTrustedInput: interact,
    attach() {
      if (attached || disposed) return;
      attached = true;
      // Capture fences every owner before their ordinary pagehide callbacks
      // can publish state and flush another owner's delayed React effects.
      options.target.addEventListener('beforeunload', beforeUnload, true);
      options.target.addEventListener('pagehide', hide, true);
      options.target.addEventListener('pageshow', show, true);
      options.target.addEventListener('pointerdown', interact, true);
      options.target.addEventListener('keydown', interact, true);
      drain();
    },
    detach,
    dispose() {
      if (disposed) return;
      disposed = true; detach(); hide();
    },
  });
}
