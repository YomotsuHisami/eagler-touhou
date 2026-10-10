import {useLayoutEffect, useRef, useSyncExternalStore} from 'react';
import {useLocale} from '../../i18n';
import type {FeedbackModel} from '../../models/feedback';
import {closeMainSelectMenus} from '../launcher/MainSelect';
/** Original main index732–737. Root places this in the active fullscreen host. */
export function Feedback({model}: {model: FeedbackModel}) {
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot, model.getSnapshot), {t} = useLocale();
  const toast = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const node = toast.current;
    if (!node) return;
    node.classList.remove('show');
    if (state.toastOpen) {closeMainSelectMenus(); void node.offsetWidth; node.classList.add('show');}
  }, [state.toastOpen, state.toastRevision]);
  return <><span id="status" className="visually-hidden" role="status">{state.status}</span>
    <div ref={toast} className="toast" id="toast" role="status" aria-live="polite"><span className="toast-copy" id="toastText">{state.toast}</span>
      <button className="toast-close" id="toastClose" type="button" aria-label={t('dialog.closeNotice')} title={t('dialog.closeNotice')} onClick={model.dismiss}><span aria-hidden="true">×</span></button>
    </div></>;
}
