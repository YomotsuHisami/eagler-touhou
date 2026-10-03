import { SettingsGroup, SettingsRow, SettingsSwitch } from '../ui';
import { setUiPreferences, useUiPreferences, useUiText } from '../services/ui-preferences';

export function GlobalSettings() {
  const preferences = useUiPreferences();
  const t = useUiText();
  return <>
    <SettingsGroup title={t('ui.language')} description={t('ui.preferencesHint')}>
      <SettingsRow label={t('ui.language')} htmlFor="global-ui-language">
        <select id="global-ui-language" value={preferences.locale} onChange={event => setUiPreferences({ locale: event.target.value === 'en' ? 'en' : 'zh-CN' })}>
          <option value="zh-CN">{t('ui.language.zhCN')}</option><option value="en">{t('ui.language.en')}</option>
        </select>
      </SettingsRow>
    </SettingsGroup>
    <SettingsGroup title={t('ui.presentation')}>
      <SettingsSwitch label={t('nav.lessMotion')} description={t('ui.motionHint')} checked={preferences.lessMotion} onCheckedChange={lessMotion => setUiPreferences({ lessMotion })} />
    </SettingsGroup>
    <SettingsGroup title={t('ui.information')}>
      <SettingsRow label={t('diagnostics.toggle')} description={t('ui.diagnosticsHint')} htmlFor="global-diagnostics">
        <select id="global-diagnostics" value={preferences.diagnostics === null ? 'auto' : preferences.diagnostics ? 'show' : 'hide'} onChange={event => setUiPreferences({ diagnostics: event.target.value === 'auto' ? null : event.target.value === 'show' })}>
          <option value="auto">{t('ui.diagnosticsAuto')}</option><option value="show">{t('ui.diagnosticsShow')}</option><option value="hide">{t('ui.diagnosticsHide')}</option>
        </select>
      </SettingsRow>
      <SettingsSwitch label={t('notice.aria')} description={t('ui.noticesHint')} checked={preferences.siteNotices} onCheckedChange={siteNotices => setUiPreferences({ siteNotices })} />
    </SettingsGroup>
    {!preferences.persistenceAvailable && <p role="status">{t('ui.sessionOnly')}</p>}
  </>;
}
