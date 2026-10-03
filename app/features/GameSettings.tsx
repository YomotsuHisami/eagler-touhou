import { useEffect, useState, useSyncExternalStore } from 'react';
import { gameIdForProduct, isMultiplayerProductId, productFeatureAvailable, type ProductId } from '../../src/contracts/product-catalog.mts';
import type { GameOptions, MusicMode, TouchFocusMode, TouchMovementMode } from '../../src/launcher/game-preferences.mts';
import type { LanguageCatalogEntry } from '../../src/launcher/language-catalog.mts';
import { useBrowserServices } from '../services/browser-services';
import { useUiText, type UiTextKey } from '../services/ui-preferences';
import { Button, SettingsGroup, SettingsRow, SettingsSwitch } from '../ui';
const emptySubscribe = () => () => {};
const languageLabels: Readonly<Record<string, UiTextKey>> = {
  ja: 'gameLanguage.ja', 'lang_zh-hans': 'gameLanguage.zhHans', 'lang_zh-hant': 'gameLanguage.zhHant', lang_en: 'gameLanguage.en', lang_ru: 'gameLanguage.ru',
};
interface Languages { productId: ProductId; items: LanguageCatalogEntry[]; loading: boolean; error: string }
/** One shared business form, retaining the canonical global and product schemas. */
export function GameSettings({ productId }: { productId: ProductId }) {
  const services = useBrowserServices();
  const t = useUiText();
  const preferences = useSyncExternalStore(services?.preferences.subscribe ?? emptySubscribe, () => services?.preferences.read(productId) ?? null, () => null);
  const game = gameIdForProduct(productId);
  const completedPackages = useSyncExternalStore(services?.packageTasks.subscribe ?? emptySubscribe,
    () => services?.packageTasks.getSnapshot().filter(task => task.game === game && task.status === 'completed').map(task => `${task.id}:${task.generationId}`).join('|') ?? '', () => '');
  const [languageResult, setLanguageResult] = useState<Languages | null>(null);
  const [languageRevision, setLanguageRevision] = useState(0);
  useEffect(() => {
    if (!services) return;
    let cancelled = false;
    setLanguageResult({ productId, items: [], loading: true, error: '' });
    void services.runtime.languages(productId).then(items => {
      if (!cancelled) setLanguageResult({ productId, items, loading: false, error: '' });
    }, reason => {
      if (!cancelled) setLanguageResult({ productId, items: [], loading: false, error: reason instanceof Error ? reason.message : String(reason) });
    });
    return () => { cancelled = true; };
  }, [services, productId, completedPackages, languageRevision]);
  if (!services || !preferences) return <p role="status">{t('ui.settingsLoading')}</p>;
  const languages = languageResult?.productId === productId ? languageResult : null;
  const languagePresent = languages?.items.some(entry => entry.id === preferences.language) ?? false;
  const updateOption = <K extends keyof GameOptions>(key: K, value: GameOptions[K]) => services.preferences.update(productId, { options: { ...preferences.options, [key]: value } });
  return <>
    <SettingsGroup title={t('ui.gameSettings')} description={t('ui.gameSharedHint')}>
      <SettingsRow label={t('settings.gameLanguage')} htmlFor={`${productId}-language`} description={languages?.loading || !languages ? t('ui.languageLoading') : undefined}>
        <select id={`${productId}-language`} value={preferences.language} disabled={!languages || languages.loading || !!languages.error} onChange={event => {
          if (languages?.items.some(entry => entry.id === event.target.value)) services.preferences.update(productId, { language: event.target.value });
        }}>
          {!languagePresent && <option value={preferences.language} disabled>{languages && !languages.loading ? t('ui.languageUnavailable', { language: preferences.language }) : preferences.language}</option>}
          {languages?.items.map(entry => <option key={entry.id} value={entry.id}>{languageLabels[entry.id] ? t(languageLabels[entry.id]) : entry.title || entry.id}</option>)}
        </select>
      </SettingsRow>
      {languages?.error && <p role="status">{t('ui.languageError', { reason: languages.error })} <Button size="sm" onClick={() => setLanguageRevision(value => value + 1)}>{t('action.retry')}</Button></p>}
      <SettingsRow label={t('settings.music')} htmlFor={`${productId}-music`}>
        <select id={`${productId}-music`} value={preferences.musicPreference} onChange={event => services.preferences.update(productId, { music: event.target.value as MusicMode, musicPreference: event.target.value as MusicMode, musicPreferenceExplicit: true })}>
          <option value="ogg-stream">{t('settings.music.oggStream')}</option><option value="ogg-full">{t('settings.music.oggFull')}</option><option value="midi">MIDI</option><option value="none">{t('settings.music.none')}</option>
        </select>
      </SettingsRow>
      <SettingsSwitch label={`thprac · ${t('settings.thpracHint')}`} checked={preferences.options.thpracEnabled} disabled={!productFeatureAvailable(game, 'thprac') || isMultiplayerProductId(productId)} onCheckedChange={value => updateOption('thpracEnabled', value)} />
      <SettingsSwitch label={t('settings.frameLimit')} checked={preferences.options.frameLimit60Enabled} onCheckedChange={value => updateOption('frameLimit60Enabled', value)} />
      <SettingsSwitch label={t('settings.alwaysHitbox')} checked={preferences.options.alwaysHitbox} onCheckedChange={value => updateOption('alwaysHitbox', value)} />
      <SettingsSwitch label={t('settings.magnifier')} checked={preferences.options.magnifierEnabled} onCheckedChange={value => updateOption('magnifierEnabled', value)} />
    </SettingsGroup>
    <SettingsGroup title={t('options.touch')}>
      <SettingsSwitch label={t('settings.touchEnabled')} checked={preferences.options.touchEnabled} onCheckedChange={value => updateOption('touchEnabled', value)} />
      <SettingsRow label={t('touch.movement')} htmlFor={`${productId}-movement`}>
        <select id={`${productId}-movement`} value={preferences.options.touchMovementMode} onChange={event => updateOption('touchMovementMode', event.target.value as TouchMovementMode)}>
          <option value="touch">{t('touch.movement.touch')}</option><option value="touch-unlimited">{t('touch.movement.unlimited')}</option><option value="joystick">{t('touch.movement.joystick')}</option><option value="joystick-free">{t('touch.movement.joystickFree')}</option>
        </select>
      </SettingsRow>
      <SettingsRow label={t('touch.sensitivity')} htmlFor={`${productId}-sensitivity`}>
        <input id={`${productId}-sensitivity`} type="range" min="100" max="300" step="5" value={preferences.options.touchSensitivity} onChange={event => updateOption('touchSensitivity', Number(event.target.value))} /><output>{preferences.options.touchSensitivity}%</output>
      </SettingsRow>
      <SettingsRow label={t('touch.focusMethod')} htmlFor={`${productId}-focus`}>
        <select id={`${productId}-focus`} value={preferences.options.touchFocusMode} onChange={event => updateOption('touchFocusMode', event.target.value as TouchFocusMode)}>
          <option value="hold-button">{t('touch.focus.hold')}</option><option value="toggle-button">{t('touch.focus.toggle')}</option><option value="two-finger">{t('touch.focus.twoFinger')}</option>
        </select>
      </SettingsRow>
      <SettingsSwitch label={t('touch.doubleTapBomb')} checked={preferences.options.doubleTapBombEnabled} onCheckedChange={value => updateOption('doubleTapBombEnabled', value)} />
      <SettingsSwitch label={t('ui.restartButton')} checked={preferences.options.restartButtonEnabled} onCheckedChange={value => updateOption('restartButtonEnabled', value)} />
    </SettingsGroup>
  </>;
}
