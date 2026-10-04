import {useLayoutEffect, useSyncExternalStore, type ReactNode} from 'react';
import {MotionConfig} from 'motion/react';
import {motionPreferenceStore} from '../services/motion-preference.client';

/** Dialogs also use this adapter when rendered without the full app shell. */
export function useMotionPreference() {
  return useSyncExternalStore(motionPreferenceStore.subscribe, motionPreferenceStore.getSnapshot, motionPreferenceStore.getServerSnapshot);
}

export function MotionPreferenceProvider({children}: {children: ReactNode}) {
  const preference = useMotionPreference();
  useLayoutEffect(() => {
    document.documentElement.dataset.reducedMotion = String(preference.reducedMotion);
    document.body.classList.toggle('less-motion', preference.lessMotion);
  }, [preference]);
  return <MotionConfig reducedMotion={preference.reducedMotion ? 'always' : 'user'}>{children}</MotionConfig>;
}
