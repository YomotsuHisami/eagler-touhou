import type {UiMessageKey} from '../../src/launcher/i18n.mts';
import type {GameOptions} from '../../src/launcher/game-preferences.mts';

export type TouchModeWarning = Extract<UiMessageKey, 'touch.unlimitedWarning' | 'touch.freeStickWarning'>;

/** Keep the confirmation gate aligned with the two movement modes main warns about. */
export function touchModeWarning(mode: GameOptions['touchMovementMode']): TouchModeWarning | null {
  return mode === 'touch-unlimited' ? 'touch.unlimitedWarning'
    : mode === 'joystick-free' ? 'touch.freeStickWarning' : null;
}

/** Commit a preference only after the user accepts the main-equivalent warning. */
export function createTouchModeConfirmation(ask: (message: TouchModeWarning) => Promise<boolean>) {
  let pending = false;
  return async function confirm(mode: GameOptions['touchMovementMode'], commit: () => void): Promise<boolean> {
    const warning = touchModeWarning(mode);
    if (!warning) { commit(); return true; }
    if (pending) return false;
    pending = true;
    try {
      if (!await ask(warning)) return false;
      commit();
      return true;
    } finally { pending = false; }
  };
}
