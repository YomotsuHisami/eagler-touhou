interface FrameInputContext {epoch: number; ready: boolean; target: object | null}
type Frame = Pick<HTMLIFrameElement, 'contentWindow' | 'contentDocument' | 'isConnected'>;

/** Input does not bubble from the game document into its parent Window.
 * Observe only the current same-origin document; WindowProxy identity alone
 * cannot fence navigation to a different document in the same iframe.
 */
export function observeRuntimeRequestResume(options: {
  frame(): Frame | null;
  context(): FrameInputContext;
  resume(event: Event): void;
}) {
  let frame: Frame | null, target: Window | null, document: Document | null;
  let initial: FrameInputContext;
  try {
    initial = options.context();
    frame = options.frame(); target = frame?.contentWindow ?? null; document = frame?.contentDocument ?? null;
    if (!frame?.isConnected || !target || !document || !initial.ready || initial.epoch <= 0 || initial.target !== target) return () => {};
  } catch {return () => {};}
  let disposed = false;
  const interact = (event: Event) => {
    if (disposed || !event.isTrusted || !['pointerdown', 'keydown'].includes(event.type)) return;
    try {
      const current = options.context();
      if (options.frame() !== frame || !frame.isConnected || frame.contentWindow !== target || frame.contentDocument !== document ||
          !current.ready || current.epoch !== initial.epoch || current.target !== target) return;
    } catch {return; /* A replaced or inaccessible frame never reopens its parent's gate. */}
    options.resume(event);
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    try {target.removeEventListener('pointerdown', interact, true);target.removeEventListener('keydown', interact, true);} catch {}
  };
  try {target.addEventListener('pointerdown', interact, true);target.addEventListener('keydown', interact, true);}
  catch {dispose();}
  return dispose;
}
