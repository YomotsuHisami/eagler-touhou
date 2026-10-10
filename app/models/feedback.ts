/** Original main status channels and fixed two-second toast lifetime. */
export interface FeedbackSnapshot {readonly status: string; readonly playerStatus: string; readonly toast: string; readonly toastOpen: boolean; readonly toastRevision: number;}
export function createFeedbackModel(timers: {setTimeout: typeof setTimeout; clearTimeout: typeof clearTimeout} = {setTimeout, clearTimeout}) {
  const listeners = new Set<() => void>();
  let statusRenderer: (() => string) | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let snapshot: FeedbackSnapshot = Object.freeze({status: '', playerStatus: '', toast: '', toastOpen: false, toastRevision: 0});
  function publish(patch: Partial<FeedbackSnapshot>) {snapshot = Object.freeze({...snapshot, ...patch}); for (const listener of listeners) listener();}
  function dismiss() {if (timer !== null) timers.clearTimeout(timer); timer = null; publish({toastOpen: false});}
  return {
    subscribe(listener: () => void) {listeners.add(listener); return () => {listeners.delete(listener);};},
    getSnapshot: () => snapshot,
    status(status: string) {statusRenderer = null; publish({status});},
    translatedStatus(render: () => string) {statusRenderer = render; publish({status: render()});},
    refreshLocale() {if (statusRenderer) publish({status: statusRenderer()});},
    playerStatus: (playerStatus: string) => publish({playerStatus}),
    toast(toast: string, duration = 2000) {
      if (timer !== null) timers.clearTimeout(timer);
      publish({toast, toastOpen: true, toastRevision: snapshot.toastRevision + 1});
      timer = timers.setTimeout(dismiss, duration);
    },
    dismiss,
    dispose() {if (timer !== null) timers.clearTimeout(timer); timer = null; listeners.clear();},
  };
}
export type FeedbackModel = ReturnType<typeof createFeedbackModel>;
