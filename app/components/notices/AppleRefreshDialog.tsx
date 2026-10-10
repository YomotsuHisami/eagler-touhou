import {useLocale} from '../../i18n';
import type {MainDialogProps} from './use-main-dialog';
import {InformationalDialog, informationalDialogPresentation} from './InformationalDialog';
/** Exact main index.html778–803, using only the original catalog messages. */
export function AppleRefreshDialog(props: MainDialogProps) {
  const {t} = useLocale();
  return <InformationalDialog {...props} id="appleRefreshDialog" titleId="appleRefreshTitle" closeId="appleRefreshClose"
    title={t('settings.appleNotice')} closeLabel={t('apple.close')} launcherDocument presentation={informationalDialogPresentation.standard}>
      <div className="apple-refresh-faq" aria-label={t('apple.faqAria')}>
        <article className="apple-refresh-faq-item"><h2>{t('apple.highRefreshQuestion')}</h2><p>{t('apple.highRefreshIntro')}</p><p className="apple-refresh-path">{t('apple.highRefreshPath')}</p><p>{t('apple.highRefreshStep')}</p><p>{t('apple.highRefreshResult')}</p></article>
        <article className="apple-refresh-faq-item"><h2>{t('apple.lowFpsQuestion')}</h2><p>{t('apple.lowPowerStep')}</p></article>
      </div>
  </InformationalDialog>;
}
