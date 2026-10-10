import type {MainDialogMotion} from './use-main-dialog';

// All informational dialogs share one motion, independent of content/layout.
// Completion belongs to the native Animation, never a mirrored CSS timeout.
const motion = {duration: 180, easing: 'cubic-bezier(.2,0,0,1)', fill: 'both'} as const;
const hidden = {opacity: 0, transform: 'translateY(12px) scale(.98)'};
const visible = {opacity: 1, transform: 'translateY(0) scale(1)'};
export const informationalDialogMotion: MainDialogMotion = (dialog, phase, fromCurrent) => {
  const view = dialog.ownerDocument.defaultView;
  if (!view || !motion.duration || typeof dialog.animate !== 'function'
    || view.matchMedia?.('(prefers-reduced-motion: reduce)').matches || dialog.closest('.less-motion')) return null;
  try {
    // Read before the lifecycle owner cancels the preceding animation. A
    // close/reopen continues from its current appearance, without committing
    // inline styles or keeping a second presence/animation registry.
    const current = fromCurrent ? view.getComputedStyle(dialog) : null;
    const start = current ? {opacity: current.opacity || '1', transform: current.transform || 'none'} : hidden;
    const animation = dialog.animate([start, phase === 'enter' ? visible : hidden], motion);
    // Older partial WAAPI implementations degrade immediately, not to another
    // completion timer. Explicit keyframes need no inferred-keyframe polyfill.
    if (!animation.finished || typeof animation.finished.then !== 'function') {animation.cancel(); return null;}
    return animation;
  } catch {return null;}
};
