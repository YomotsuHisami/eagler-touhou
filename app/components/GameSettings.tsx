import {MainSelect} from './MainSelect';
import type {UiMessageKey} from '../../src/launcher/i18n.mts';
import {useLocale} from './LocaleProvider';
import {useEffect, useId, useSyncExternalStore, type ReactNode} from 'react';
import {PRODUCT_GAMES, gameIdForProduct, isMultiplayerProductId, type ProductId} from '../../src/contracts/product-catalog.mts';
import {isMusicMode, type MusicMode} from '../../src/launcher/game-preferences.mts';
import type {PreferencesSnapshot, PreferencesStore} from '../services/preferences.client';
import {settingsDisclosure} from '../services/settings-disclosure';
import {TouchLayoutEditor} from './TouchLayoutEditor';
import {useGamePreferences} from './GameSettingsProvider';
import {HelpLink} from './HelpPanel';
import {ExternalMidiSettings} from './ExternalMidiSettings';
import {settingsControlClass as controlClass, useTouchModeConfirmation} from './TouchSettingsFields';
import './game-settings.css';

function musicLabels(t: ReturnType<typeof useLocale>['t']): Readonly<Record<MusicMode, string>> { return {
  'ogg-stream': t('settings.music.oggStream'),
  'ogg-full': t('settings.music.oggFull'),
  midi: 'MIDI',
  none: t('settings.music.none'),
};}

const languageLabels: Readonly<Record<string, UiMessageKey>> = {ja:'gameLanguage.ja', 'lang_zh-hans':'gameLanguage.zhHans', 'lang_zh-hant':'gameLanguage.zhHant', lang_en:'gameLanguage.en', lang_ru:'gameLanguage.ru'};
const subscribeTouchPriority = (changed: () => void) => {
  const media = window.matchMedia('(pointer: coarse)'); media.addEventListener('change', changed);
  return () => media.removeEventListener('change', changed);
};
const touchPriority = () => (navigator as Navigator & {userAgentData?: {mobile?: boolean}}).userAgentData?.mobile === true || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) ||
  /Macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1 || window.matchMedia('(pointer: coarse)').matches;
const serverTouchPriority = () => null;

function OptionSwitch({id, label, checked, onChange, description, hideDescription = false, status, disabled = false}: {
  id: string;
  label: string;
  checked: boolean;
  onChange(checked: boolean): void;
  description?: string;
  hideDescription?: boolean;
  status?: string;
  disabled?: boolean;
}) {
  const {t} = useLocale();
  const descriptionId = description ? `${id}-hint` : undefined;
  return <div className="game-settings-option">
    <label htmlFor={id} className="game-settings-option-label">
      <span className="game-settings-option-copy">
        <span>{label}</span>
        {description && <small id={descriptionId} className={hideDescription ? 'sr-only' : 'game-settings-option-hint'}>{description}{id.endsWith('-fps') && <> <HelpLink helpTopic="apple" aria-label={t('settings.appleNotice')} className="game-settings-apple-note">{t('settings.appleNotice')}</HelpLink></>}</small>}
        {status && <small role="status" className="game-settings-option-warning">{status}</small>}
      </span>
      <input id={id} type="checkbox" role="switch" checked={checked} disabled={disabled} aria-checked={checked} aria-describedby={descriptionId} onChange={event => onChange(event.currentTarget.checked)}/>
    </label>
  </div>;
}

/** Preference edits only. This form does not issue Runtime commands or launch a game. */
export function GameSettings({productId, fileTools, multiplayerActions}: {productId: ProductId; fileTools?: ReactNode; multiplayerActions?: ReactNode}) {
  const {t} = useLocale();
  const preferTouch = useSyncExternalStore(subscribeTouchPriority, touchPriority, serverTouchPriority);
  const {store, settings} = useGamePreferences(productId);
  if (!store || !settings) return <p role="status" className="my-6 text-sm text-muted">{t('react.settings.loading')}</p>;
  return <GameSettingsForm settings={settings} store={store} fileTools={fileTools}
    preferTouch={preferTouch}
    multiplayerActions={multiplayerActions}
    externalMidiSettings={<ExternalMidiSettings settings={settings} store={store}/>}
    touchLayoutEditor={<TouchLayoutEditor settings={settings} preferences={store} compact/>}/>;
}

/** Controlled view, also reusable without a Router or browser storage. */
export function GameSettingsForm({settings, store, fileTools, touchLayoutEditor, multiplayerActions, externalMidiSettings, preferTouch = false}: {
  settings: PreferencesSnapshot;
  store: PreferencesStore;
  fileTools?: ReactNode;
  touchLayoutEditor?: ReactNode;
  multiplayerActions?: ReactNode;
  externalMidiSettings?: ReactNode;
  preferTouch?: boolean | null;
}) {
  const {t} = useLocale();
  const touchModeConfirmation = useTouchModeConfirmation();
  const id = useId();
  const productId = settings.productId;
  const options = settings.options;
  const multiplayer = isMultiplayerProductId(productId);
  const domain = multiplayer ? 'multiplayer' : 'singleplayer';
  const disclosure = useSyncExternalStore(settingsDisclosure.subscribe, () => settingsDisclosure.getSnapshot(domain), settingsDisclosure.getServerSnapshot);
  useEffect(() => {if (preferTouch !== null) settingsDisclosure.initializeTouch(domain, preferTouch);}, [domain, preferTouch]);
  const game = PRODUCT_GAMES[gameIdForProduct(productId)];
  const highRefresh = game.support.highRefreshRate;
  const faithBarAvailable = 'display' in game && game.display.faithBar;
  const magnifierConflict = options.magnifierEnabled && options.touchFocusMode === 'two-finger';
  const selectedLanguage = settings.languages.find(language => language.id === settings.language);
  const languageSize = selectedLanguage?.bytes !== undefined
    ? selectedLanguage.bytes < 1024 * 1024 ? `${(selectedLanguage.bytes / 1024).toFixed(1)} KiB` : `${(selectedLanguage.bytes / (1024 * 1024)).toFixed(2)} MiB`
    : t('settings.builtin');

  const files = fileTools != null && <details className="game-settings-group game-settings-file-group" open={disclosure.files} onToggle={event => settingsDisclosure.setOpen(domain, 'files', event.currentTarget.open)}>
      <summary className="game-settings-summary"><span>{t('options.files')}</span><i aria-hidden="true"/></summary>
      <div className="game-settings-group-content game-settings-file-content">{fileTools}</div>
    </details>;

  const display = <details className="game-settings-group game-settings-display" open={disclosure.display} onToggle={event => settingsDisclosure.setOpen(domain, 'display', event.currentTarget.open)}>
      <summary className="game-settings-summary"><span>{t('options.display')}</span><i aria-hidden="true"/></summary>
      <div className="game-settings-group-content">
        <fieldset className="game-settings-fields game-settings-display-fields">
          <legend className="sr-only">{t('options.display')}</legend>
          <OptionSwitch id={`${id}-fps`} label={t('settings.frameLimit')} disabled={!highRefresh} checked={highRefresh && !options.frameLimit60Enabled} onChange={value => store.setOption(productId, 'frameLimit60Enabled', !value)} description={t('settings.frameLimitHint')}/>
          {settings.language !== null && settings.languages.length > 0 ? <div className="game-settings-select-item">
            <label htmlFor={`${id}-language`} className="game-settings-language-label"><span>{t('settings.language')}</span><small>{languageSize}</small></label>
            <MainSelect id={`${id}-language`} aria-label={t('settings.gameLanguage')} className={controlClass} value={settings.language} disabled={settings.languages.length === 1} onChange={event => store.setLanguage(productId, event.currentTarget.value)}>
              {settings.languages.map(language => <option key={language.id} value={language.id}>{languageLabels[language.id] ? t(languageLabels[language.id]!) : language.title}</option>)}
            </MainSelect>
          </div> : <p role="status" className="game-settings-pending">{t('react.settings.languagePending')}</p>}
          {settings.features.focusHitbox && <OptionSwitch id={`${id}-focus-hitbox`} label={t('settings.focusHitbox')} checked={options.focusHitboxEnabled} onChange={value => store.setOption(productId, 'focusHitboxEnabled', value)}/>}
          {faithBarAvailable && <OptionSwitch id={`${id}-faith-bar`} label={t('settings.faithBar')} checked={options.faithBarEnabled} onChange={value => store.setOption(productId, 'faithBarEnabled', value)}/>}
        </fieldset>
      </div>
    </details>;

  const advanced = <details className="game-settings-group game-settings-advanced" open={disclosure.advanced} onToggle={event => settingsDisclosure.setOpen(domain, 'advanced', event.currentTarget.open)}>
      <summary className="game-settings-summary"><span>{t('options.advanced')}</span><i aria-hidden="true"/></summary>
      <div className="game-settings-group-content">
        <fieldset className="game-settings-fields game-settings-advanced-fields">
          <legend className="sr-only">{t('options.advanced')}</legend>
          {settings.music !== null && settings.musicModes.length > 0 ? <div className="game-settings-select-item">
            <label htmlFor={`${id}-music`}>{t('settings.music')}</label>
            <MainSelect id={`${id}-music`} className={controlClass} value={settings.music} disabled={settings.musicModes.length === 1} aria-describedby={`${id}-music-hint`} onChange={event => {
              const value = event.currentTarget.value;
              if (isMusicMode(value)) store.setMusic(productId, value);
            }}>
              {settings.musicModes.map(mode => <option key={mode} value={mode}>{musicLabels(t)[mode]}</option>)}
            </MainSelect>
            <p id={`${id}-music-hint`} className="sr-only">{t('react.settings.musicHint')}</p>
            {settings.musicPreferenceExplicit && settings.musicPreference !== settings.music && <p role="status" className="game-settings-warning">{t('react.settings.musicPreference', {preferred:musicLabels(t)[settings.musicPreference], available:musicLabels(t)[settings.music]})}</p>}
          </div> : <p role="status" className="game-settings-pending">{t('react.settings.musicPending')}</p>}
          {!multiplayer && settings.features.thprac && <OptionSwitch id={`${id}-thprac`} label="thprac" description={t('settings.thpracHint')} checked={options.thpracEnabled} onChange={value => store.setOption(productId, 'thpracEnabled', value)}/>}
          {multiplayer && <OptionSwitch id={`${id}-local-player`} label={t('settings.localPlayerVisibility')} checked={options.multiplayerLocalPlayerVisibility} onChange={value => store.setOption(productId, 'multiplayerLocalPlayerVisibility', value)} description={t('settings.localPlayerVisibilityHint')}/>}
          {externalMidiSettings}
        </fieldset>
      </div>
    </details>;

  const touch = <details className="game-settings-group game-settings-touch" open={disclosure.touch ?? preferTouch === true} onToggle={event => settingsDisclosure.setOpen(domain, 'touch', event.currentTarget.open)}>
      <summary className="game-settings-summary"><span>{t('options.touch')}</span><i aria-hidden="true"/></summary>
      <div className="game-settings-group-content">
        <fieldset className="game-settings-fields game-settings-touch-fields">
          <legend className="sr-only">{t('options.touch')}</legend>
          <OptionSwitch id={`${id}-touch`} label={t('settings.touchEnabled')} checked={options.touchEnabled} onChange={value => {
            if (!value) store.setOption(productId, 'touchEnabled', false);
            else void touchModeConfirmation.confirm(options.touchMovementMode, () => store.setOption(productId, 'touchEnabled', true));
          }}/>
          {touchLayoutEditor}
          <OptionSwitch id={`${id}-always-hitbox`} label={t('settings.alwaysHitbox')} checked={options.alwaysHitbox} onChange={value => store.setOption(productId, 'alwaysHitbox', value)}/>
          <OptionSwitch id={`${id}-magnifier`} label={t('settings.magnifier')} checked={options.magnifierEnabled} onChange={value => store.setOption(productId, 'magnifierEnabled', value)} description={t('settings.magnifierHint')} hideDescription status={magnifierConflict ? t('react.settings.magnifierConflict') : undefined}/>
        </fieldset>
      </div>
    </details>;

  return <form data-game-settings="" data-multiplayer-settings={multiplayer ? '' : undefined} aria-label={t('react.settings.aria')} onSubmit={event => event.preventDefault()} className="game-settings-form grid text-sm">
    {multiplayer ? <>
      <div className="game-settings-fields game-settings-mp-share"><OptionSwitch id={`${id}-share`} label={t('settings.shareSingleplayer')} checked={settings.shareSingleplayerSettings} onChange={value => store.setShareSingleplayerSettings(productId, value)} description={t('settings.shareSingleplayerHint')}/></div>
      {multiplayerActions}{preferTouch && touch}{files}{display}{advanced}{!preferTouch && touch}
    </> : <>{preferTouch && touch}{files}{display}{advanced}{!preferTouch && touch}</>}
    <p role="status" className="game-settings-save-status sr-only">{settings.persistence === 'session'
      ? t('react.settings.sessionOnly')
      : t('react.settings.autosave')}</p>
    {touchModeConfirmation.dialog}
  </form>;
}
