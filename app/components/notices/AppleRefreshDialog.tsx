import {useLocale} from '../../i18n';
import {useMainDialog, type MainDialogProps} from './use-main-dialog';
/** Exact main index.html778–803, using only the original catalog messages. */
export function AppleRefreshDialog(props: MainDialogProps) {
  const {t} = useLocale(), dialog = useMainDialog(props, 220, 'replay-window-out');
  return <dialog ref={dialog.ref} data-launcher-document="" className="apple-refresh-dialog" id="appleRefreshDialog" aria-labelledby="appleRefreshTitle" onCancel={dialog.onCancel} onClick={dialog.onClick} onAnimationEnd={dialog.onAnimationEnd}>
    <article className="apple-refresh-window"><header><h1 id="appleRefreshTitle">{t('settings.appleNotice')}</h1><button id="appleRefreshClose" type="button" aria-label={t('apple.close')} onClick={dialog.requestClose}>×</button></header>
      <div className="apple-refresh-faq" aria-label={t('apple.faqAria')}>
        <article className="apple-refresh-faq-item"><h2>{t('apple.highRefreshQuestion')}</h2><p>{t('apple.highRefreshIntro')}</p><p className="apple-refresh-path">{t('apple.highRefreshPath')}</p><p>{t('apple.highRefreshStep')}</p><p>{t('apple.highRefreshResult')}</p></article>
        <article className="apple-refresh-faq-item"><h2>{t('apple.lowFpsQuestion')}</h2><p>{t('apple.lowPowerStep')}</p></article>
      </div>
    </article>
  </dialog>;
}
