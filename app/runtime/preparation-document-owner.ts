interface PreparationDocumentOwnerOptions<T extends {dispose(): void}> {
  target: Pick<Window, 'addEventListener' | 'removeEventListener'>;
  ready?: () => boolean;
  load: () => Promise<() => T>;
  onController(controller: T | null): void;
  onError(error: unknown): void;
}
/** React unmount cleanup is not a document-navigation boundary. A lazy module
 * may resolve after pagehide, when WebKit already forbids new fetches. Fence
 * controller creation there, and create a fresh job owner after BFCache return.
 * Detach/attach alone preserves the owner for React's effect replay.
 */
export function createPreparationDocumentOwner<T extends {dispose(): void}>(options: PreparationDocumentOwnerOptions<T>) {
  // This is the one document-active state, established before Runtime exists.
  // Effect detach/attach must not turn a departed document active again.
  let attached=false, active=true, disposed=false, serial=0;
  let controller: T | null=null;
  let loading: Promise<() => T> | null=null;
  function activate() {
    if(disposed || !attached || !active || options.ready?.()===false) return;
    if(controller){options.onController(controller);return;}
    const ticket=++serial;
    const task=loading ?? (loading=Promise.resolve().then(options.load));
    void task.then(create=>{
      if(disposed || !attached || !active || options.ready?.()===false || ticket!==serial) return;
      controller=create();options.onController(controller);
    }).catch(error=>{
      if(loading===task) loading=null;
      if(!disposed && attached && active && ticket===serial) options.onError(error);
    });
  }
  const hide=()=>{
    active=false;serial++;
    controller?.dispose();controller=null;options.onController(null);
  };
  const show=()=>{active=true;activate();};
  function detach() {
    if(!attached) return;
    attached=false;serial++;
    options.target.removeEventListener('pagehide',hide);
    options.target.removeEventListener('pageshow',show);
  }
  return Object.freeze({
    attach() {
      if(disposed || attached) return;
      attached=true;
      options.target.addEventListener('pagehide',hide);
      options.target.addEventListener('pageshow',show);
      activate();
    },
    detach,
    reset() {
      if(disposed) return;
      serial++;controller?.dispose();controller=null;options.onController(null);activate();
    },
    dispose() {
      if(disposed) return;
      disposed=true;detach();controller?.dispose();controller=null;
    },
  });
}
