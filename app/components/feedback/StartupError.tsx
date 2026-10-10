import {useLayoutEffect, useSyncExternalStore} from 'react';
import {useLocale} from '../../i18n';
import type {StartupErrorModel} from '../../models/startup-error';
import {closeMainSelectMenus} from '../launcher/MainSelect';
/** Exact main index738–745. Root supplies its fullscreen transient host. */
export function StartupError({model}: {model: StartupErrorModel}) {
  const {t} = useLocale(), state = useSyncExternalStore(model.subscribe, model.getSnapshot, model.getSnapshot);
  useLayoutEffect(() => {if (state.open) closeMainSelectMenus();}, [state]);
  return <section className="startup-error" id="startupError" role="alertdialog" aria-modal="false" aria-labelledby="startupErrorTitle" aria-describedby="startupErrorText" hidden={!state.open}>
    <header><strong id="startupErrorTitle">{t('dialog.errorTitle')}</strong><button className="startup-error-close" id="startupErrorClose" type="button" aria-label={t('dialog.closeError')} title={t('dialog.closeError')} onClick={model.close}>×</button></header>
    <pre className="startup-error-detail"><code id="startupErrorText">{state.detail}</code></pre><footer><button className="startup-error-copy" id="startupErrorCopy" type="button" onClick={() => {void model.copy();}}>{t('dialog.copyError')}</button></footer>
  </section>;
}
