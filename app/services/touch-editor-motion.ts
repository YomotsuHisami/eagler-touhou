/** Whole-scene entry only: opacity never alters measured control geometry.
 * A cancelled/finished entry cannot leave a hidden scene or cancel a later one. */
export interface TouchEditorAnimation {finished: Promise<unknown>; cancel(): void}
export function createTouchEditorEntryMotion(animate: () => TouchEditorAnimation) {
  let started = false, active: TouchEditorAnimation | null = null;
  function cancel() {const previous = active; active = null; previous?.cancel();}
  return {
    ready(reduced: boolean) {
      if (started) return;
      started = true;
      if (reduced) return;
      const animation = animate(); active = animation;
      void animation.finished.then(() => {if (active === animation) cancel();}, () => {if (active === animation) active = null;});
    },
    preferenceChanged(reduced: boolean) {if (reduced) cancel();},
    dispose() {cancel(); started = false;},
  };
}
