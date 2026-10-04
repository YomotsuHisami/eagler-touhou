import type {DialogMotionSample} from './dialog-motion-fixture';

/** A real in-flight frame, independent of which interior progress CI paints. */
export function isRunningInteriorMotion(sample: DialogMotionSample): boolean {
  const animation = sample.native;
  return animation !== null && animation.playState === 'running' && !animation.pending &&
    animation.startTime !== null && animation.currentTime !== null &&
    animation.currentTime > 0 && animation.currentTime < animation.duration &&
    sample.opacity > 0 && sample.opacity < 1;
}
