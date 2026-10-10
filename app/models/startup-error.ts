import type {Translate} from '../i18n';
import {errorText} from '../services/error-text';
/** Original app3209–3244 error surface, independent of navigation and history. */
export function createStartupErrorModel({translate: t, launched, copyText, toast, now = () => new Date()}: {
  translate: Translate; launched(): boolean; copyText(text: string): Promise<boolean>; toast(message: string, duration: number): void; now?: () => Date;
}) {
  const listeners = new Set<() => void>(); let snapshot: Readonly<{open: boolean; detail: string}> = Object.freeze({open: false, detail: ''});
  const publish = (open: boolean, detail: string) => {snapshot = Object.freeze({open, detail}); for (const listener of listeners) listener();};
  return {
    subscribe(listener: () => void) {listeners.add(listener); return () => {listeners.delete(listener);};}, getSnapshot: () => snapshot,
    show(error: unknown, context = t('startup.failed'), allowAfterLaunch = false) {
      if (launched() && !allowAfterLaunch) return;
      const detail = error instanceof Error ? error.stack || error.message : errorText(error);
      publish(true, `[${now().toLocaleString()}] ${context}\n${detail}`);
    },
    close() {publish(false, '');},
    async copy() {const detail = snapshot.detail; if (detail) toast(t(await copyText(detail) ? 'dialog.errorCopied' : 'dialog.errorCopyFailed'), 3200);},
    dispose() {listeners.clear();},
  };
}
export type StartupErrorModel = ReturnType<typeof createStartupErrorModel>;
