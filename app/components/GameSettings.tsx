import type {UiMessageKey} from '../../src/launcher/i18n.mts';
import {useLocale} from './LocaleProvider';
import {useId} from 'react';
import {isMultiplayerProductId, type ProductId} from '../../src/contracts/product-catalog.mts';
import {isMusicMode, type MusicMode} from '../../src/launcher/game-preferences.mts';
import type {PreferencesSnapshot, PreferencesStore} from '../services/preferences.client';
import {TouchLayoutEditor} from './TouchLayoutEditor';
import {useGamePreferences} from './GameSettingsProvider';
import {TouchSettingsFields, SettingsCheckbox as Checkbox, settingsControlClass as controlClass} from './TouchSettingsFields';

function musicLabels(t: ReturnType<typeof useLocale>['t']): Readonly<Record<MusicMode, string>> { return {
  'ogg-stream': t('react.settings.oggStream'),
  'ogg-full': t('react.settings.oggFull'),
  midi: 'MIDI',
  none: t('react.settings.musicOff'),
};}

const languageLabels: Readonly<Record<string, UiMessageKey>> = {ja:'gameLanguage.ja', 'lang_zh-hans':'gameLanguage.zhHans', 'lang_zh-hant':'gameLanguage.zhHant', lang_en:'gameLanguage.en', lang_ru:'gameLanguage.ru'};

/** Preference edits only. This form does not issue Runtime commands or launch a game. */
export function GameSettings({productId}: {productId: ProductId}) {
  const {t} = useLocale();
  const {store, settings} = useGamePreferences(productId);
  if (!store || !settings) return <p role="status" className="my-6 text-sm text-muted">{t('react.settings.loading')}</p>;
  return <><GameSettingsForm settings={settings} store={store}/><TouchLayoutEditor settings={settings} preferences={store}/></>;
}

/** Controlled view, also reusable without a Router or browser storage. */
export function GameSettingsForm({settings, store}: {settings: PreferencesSnapshot; store: PreferencesStore}) {
  const {t} = useLocale();
  const id = useId();
  const productId = settings.productId;
  const options = settings.options;
  const multiplayer = isMultiplayerProductId(productId);
  const magnifierConflict = options.magnifierEnabled && options.touchFocusMode === 'two-finger';

  return <form data-game-settings="" aria-label={t('react.settings.aria')} onSubmit={event => event.preventDefault()} className="my-6 grid gap-6 text-sm">
    <div className="grid gap-2 text-xs leading-relaxed text-muted">
      <p>{t('react.settings.preferencesHint')}</p>
      <p role="status">{settings.persistence === 'session'
        ? t('react.settings.sessionOnly')
        : t('react.settings.autosave')}</p>
    </div>
    <fieldset className="grid gap-1 rounded-2xl border border-line p-4">
      <legend className="px-2 text-base font-bold">{t('react.settings.general')}</legend>
      {multiplayer && <Checkbox id={`${id}-share`} label={t('react.settings.share')} checked={settings.shareSingleplayerSettings} onChange={value => store.setShareSingleplayerSettings(productId, value)} description={t('react.settings.shareHint')}/>}
      <Checkbox id={`${id}-fps`} label={t('react.settings.frameLimit')} checked={options.frameLimit60Enabled} onChange={value => store.setOption(productId, 'frameLimit60Enabled', value)} description={t('react.settings.frameLimitHint')}/>
      {settings.features.thprac && <Checkbox id={`${id}-thprac`} label={t('react.settings.thprac')} checked={options.thpracEnabled} onChange={value => store.setOption(productId, 'thpracEnabled', value)}/>}
      {settings.features.focusHitbox && <Checkbox id={`${id}-focus-hitbox`} label={t('react.settings.focusHitbox')} checked={options.focusHitboxEnabled} onChange={value => store.setOption(productId, 'focusHitboxEnabled', value)}/>}
      <Checkbox id={`${id}-always-hitbox`} label={t('settings.alwaysHitbox')} checked={options.alwaysHitbox} onChange={value => store.setOption(productId, 'alwaysHitbox', value)}/>
      {multiplayer && <Checkbox id={`${id}-local-player`} label={t('settings.localPlayerVisibility')} checked={options.multiplayerLocalPlayerVisibility} onChange={value => store.setOption(productId, 'multiplayerLocalPlayerVisibility', value)} description={t('settings.localPlayerVisibilityHint')}/>}
      <Checkbox id={`${id}-touch`} label={t('react.settings.enableTouch')} checked={options.touchEnabled} onChange={value => store.setOption(productId, 'touchEnabled', value)} description={t('react.settings.enableTouchHint')}/>
      <Checkbox id={`${id}-magnifier`} label={t('react.settings.magnifier')} checked={options.magnifierEnabled} onChange={value => store.setOption(productId, 'magnifierEnabled', value)} description={t('react.settings.magnifierHint')}/>
      {magnifierConflict && <p role="status" className="text-xs leading-relaxed text-accent">{t('react.settings.magnifierConflict')}</p>}
    </fieldset>
    <fieldset className="grid gap-4 rounded-2xl border border-line p-4">
      <legend className="px-2 text-base font-bold">{t('react.settings.languageMusic')}</legend>
      {settings.language !== null && settings.languages.length > 0 ? <div className="grid gap-2">
        <label htmlFor={`${id}-language`}>{t('settings.gameLanguage')}</label>
        <select id={`${id}-language`} className={controlClass} value={settings.language} disabled={settings.languages.length === 1} onChange={event => store.setLanguage(productId, event.currentTarget.value)}>
          {settings.languages.map(language => <option key={language.id} value={language.id}>{languageLabels[language.id] ? t(languageLabels[language.id]) : language.title}</option>)}
        </select>
      </div> : <p className="text-xs leading-relaxed text-muted">{t('react.settings.languagePending')}</p>}
      {settings.music !== null && settings.musicModes.length > 0 ? <div className="grid gap-2">
        <label htmlFor={`${id}-music`}>{t('react.settings.bgm')}</label>
        <select id={`${id}-music`} className={controlClass} value={settings.music} disabled={settings.musicModes.length === 1} aria-describedby={`${id}-music-hint`} onChange={event => {
          const value = event.currentTarget.value;
          if (isMusicMode(value)) store.setMusic(productId, value);
        }}>
          {settings.musicModes.map(mode => <option key={mode} value={mode}>{musicLabels(t)[mode]}</option>)}
        </select>
        <p id={`${id}-music-hint`} className="text-xs leading-relaxed text-muted">{t('react.settings.musicHint')}</p>
        {settings.musicPreferenceExplicit && settings.musicPreference !== settings.music && <p role="status" className="text-xs leading-relaxed text-accent">{t('react.settings.musicPreference', {preferred:musicLabels(t)[settings.musicPreference], available:musicLabels(t)[settings.music]})}</p>}
      </div> : <p className="text-xs leading-relaxed text-muted">{t('react.settings.musicPending')}</p>}
    </fieldset>
    <TouchSettingsFields settings={settings} store={store}/>
  </form>;
}
