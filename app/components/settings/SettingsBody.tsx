import {useEffect, useRef, useSyncExternalStore, type ReactNode} from 'react';
import {PRODUCT_GAMES, productFeatureAvailable} from '../../../src/contracts/product-catalog.mts';
import {isMusicMode} from '../../../src/launcher/game-preferences.mts';
import {resolveMusicAvailability} from '../../../src/launcher/music-availability.mts';
import type {GameSettingsModel} from '../../models/game-settings';
import {useLocale} from '../../i18n';
import {MainSelect} from '../launcher/MainSelect';
import {OptionSwitch, touchWarningKey} from './TouchSettingsFields';
import type {SettingsActions, SettingsFileAction} from './types';

const downloadPath = 'M4 14v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4M12 3v11m-4-4 4 4 4-4';
const uploadPath = 'M4 14v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4M12 14V3m-4 4 4-4 4 4';
const deletePath = 'M3 6h18M9 6V3h6v3M5 6l1 14h12l1-14M10 10v6m4-6v6';

/** Both library and lobby mount this exact component against the same model.
 * Room timing/launch rows are composed by their existing domain owner. */
export function SettingsBody({model, actions, onOpenTouchLayout, multiplayerControls}: {
  model: GameSettingsModel; actions: SettingsActions; onOpenTouchLayout(): void; multiplayerControls?: ReactNode;
}) {
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot, model.getSnapshot);
  const midi = useSyncExternalStore(actions.externalMidi.subscribe, actions.externalMidi.getSnapshot, actions.externalMidi.getSnapshot);
  const {t} = useLocale();
  const warningEpoch = useRef(0);
  const midiVisible = !!state && PRODUCT_GAMES[state.gameId].musicCapabilities.midi && state.music === 'midi';
  useEffect(() => () => {warningEpoch.current++;}, []);
  useEffect(() => {
    if (!midiVisible && midi.enabled) void actions.externalMidi.setEnabled(false).catch(actions.reportError);
  }, [midiVisible, midi.enabled, actions]);
  if (!state) return null;
  const {context, options, multiplayer} = state, mobileOpen = state.disclosure.touch, product = PRODUCT_GAMES[state.gameId];
  const availability = resolveMusicAvailability(context.musicAvailability);
  const id = (name: string) => multiplayer ? `mp${name[0].toUpperCase()}${name.slice(1)}` : name;
  const item = (extra: string) => `item ${extra}`;
  const hasFaith = 'display' in product && product.display.faithBar;
  const hasHints = 'hintFiles' in product.storage && product.storage.hintFiles.length > 0;
  const switchOption = (name: 'alwaysHitbox' | 'magnifierEnabled' | 'focusHitboxEnabled' | 'faithBarEnabled' | 'thpracEnabled' | 'multiplayerLocalPlayerVisibility') => () => model.setOption(name, !options[name]);
  async function toggleTouch() {
    const enabling = !options.touchEnabled, ticket = ++warningEpoch.current;
    const key = touchWarningKey(options.touchMovementMode);
    // Main's multiplayer enable switch intentionally does not show the SP
    // replay-mode warning. Changing movement in the shared editor still does.
    if (!multiplayer && enabling && key && !await actions.confirm({message: t(key), confirmText: t('touch.enableConfirm')})) return;
    if (ticket !== warningEpoch.current || model.getSnapshot()?.context.productId !== context.productId) return;
    model.setOption('touchEnabled', enabling);
  }
  function actionButton(action: SettingsFileAction, title: string, path: string) {
    return <button type="button" data-action={action} onClick={() => {void actions.file(action, context.productId).catch(actions.reportError);}}><svg viewBox="0 0 24 24" aria-hidden="true"><path d={path}/></svg><span>{title}</span></button>;
  }
  const pack = context.languages.find(entry => entry.id === state.language);
  const selectedPack = pack?.offlinePack || pack?.pack;
  const packBytes = Number((selectedPack as {bytes?: number} | undefined)?.bytes) || 0;
  const packSize = selectedPack ? (packBytes < 1024 * 1024 ? `${(packBytes / 1024).toFixed(1)} KiB` : `${(packBytes / 1024 / 1024).toFixed(2)} MiB`) : t('settings.builtin');
  // Main reorders this one section for mobile, rather than rebuilding it.
  // Its stable sibling key lets React move the same controls across the file,
  // display and advanced groups while preserving focus and local owners.
  const touch = (<section key="touch-options" className={`item mobile-options options-group${mobileOpen ? ' open' : ''}`} id={id('mobileOptions')}>
      <button className="mobile-options-head" id={id('mobileOptionsToggle')} type="button" aria-expanded={mobileOpen} aria-controls={id('mobileOptionsBody')} onClick={() => model.setDisclosure('touch', !mobileOpen)}><span>{t('options.touch')}</span><i aria-hidden="true">⌄</i></button>
      <div className="mobile-options-body" id={id('mobileOptionsBody')} inert={!mobileOpen}>
        <div className="mobile-option"><span>{t('settings.touchEnabled')}</span><OptionSwitch id={id('touchToggle')} label={t('settings.touchEnabled')} checked={options.touchEnabled} onChange={() => {void toggleTouch().catch(actions.reportError);}}/></div>
        <div className="mobile-option touch-layout-option"><span><span>{t('settings.touchLayout')}</span><small className="visually-hidden" id={id('touchLayoutDescription')}>{t('settings.touchLayoutShared')}</small></span><button className="option-action" id={id('touchLayoutEdit')} aria-describedby={id('touchLayoutDescription')} type="button" aria-label={t('settings.touchLayout')} onClick={onOpenTouchLayout}><span aria-hidden="true">›</span></button></div>
        <div className="mobile-option"><span>{t('settings.alwaysHitbox')}</span><OptionSwitch id={id('alwaysHitboxToggle')} label={t('settings.alwaysHitbox')} checked={options.alwaysHitbox} onChange={switchOption('alwaysHitbox')}/></div>
        <div className="mobile-option" id={id('magnifierOption')}><span><span>{t('settings.magnifier')}</span><small id={id('magnifierHint')}><span className="visually-hidden">{t('settings.magnifierHint')}</span><em className="option-warning" id={id('magnifierConflict')} hidden={options.touchFocusMode !== 'two-finger'}>{t('settings.magnifierConflict')}</em></small></span><OptionSwitch id={id('magnifierToggle')} describedBy={id('magnifierHint')} label={t('settings.magnifier')} checked={options.magnifierEnabled} onChange={switchOption('magnifierEnabled')}/></div>
      </div>
    </section>);
  return <div className={multiplayer ? 'mp-settings-body options-settings' : 'options-singleplayer options-settings'}>
    {multiplayer && <><section className={item('option-frame-limit mp-shared-settings')}><div className="itemtop"><span><span>{t('settings.shareSingleplayer')}</span><small>{t('settings.shareSingleplayerHint')}</small></span><OptionSwitch id="mpShareSettingsToggle" checked={state.shareSingleplayerSettings} label={t('settings.shareSingleplayer')} onChange={() => {model.setShareSingleplayerSettings(!state.shareSingleplayerSettings);}}/></div></section>{multiplayerControls}</>}
    {context.mobile && touch}
    <details className="options-group" id={id('fileOptions')} open={state.disclosure.files} onToggle={event => model.setDisclosure('files', event.currentTarget.open)}><summary className="options-group-head"><span>{t('options.files')}</span><i aria-hidden="true">⌄</i></summary><div className={"file-tools-grid"}>
      <section className={item('file-tool-item')} id={id('saveFileTool')}><div className="itemtop"><span>{t('settings.save')}</span></div><div className="mini">{actionButton('export-save', t('settings.download'), downloadPath)}{actionButton('import-save', t('settings.import'), uploadPath)}</div></section>
      <section className={item('file-tool-item')} id={id('replayFileTool')}><div className="itemtop"><span>{t('settings.replay')}</span></div><div className="mini">{actionButton('export-replay', t('settings.download'), downloadPath)}{actionButton('manage-replay', t('settings.manage'), uploadPath)}</div></section>
      <section className={item('file-tool-item')} id={id('hintFileTool')} hidden={!hasHints}><div className="itemtop"><span>{t('settings.hint')}</span></div><div className="mini">{actionButton('import-hint', t('settings.import'), uploadPath)}{actionButton('delete-hint', t('action.delete'), deletePath)}</div></section>
    </div></details>
    <details className="options-group" id={id('displayOptions')} open={state.disclosure.display} onToggle={event => model.setDisclosure('display', event.currentTarget.open)}><summary className="options-group-head"><span>{t('options.display')}</span><i aria-hidden="true">⌄</i></summary><div className="options-advanced-body">
      <section className={item('option-frame-limit')} hidden={!product.support.highRefreshRate}><div className="itemtop"><span><span>{t('settings.frameLimit')}</span><small id={id('frameLimitHint')}><span id={id('frameLimitHintText')}>{t('settings.frameLimitHint')}</span> <button className="frame-limit-apple-note" id={id('frameLimitAppleNote')} type="button" onClick={actions.showAppleNotice}>{t('settings.appleNotice')}</button></small></span><OptionSwitch id={id('frameLimitToggle')} label={t('settings.frameLimit')} checked={product.support.highRefreshRate && !options.frameLimit60Enabled} disabled={!product.support.highRefreshRate} onChange={() => model.setOption('frameLimit60Enabled', !options.frameLimit60Enabled)}/></div></section>
      <section className={item('feature-section feature-language')} id={id('languageOption')} hidden={!multiplayer && context.languages.length <= 1}><div className="itemtop"><span>{t('settings.language')}</span>{!multiplayer && <small id="languagePackSize">{packSize}</small>}</div><MainSelect className="option-select" id={id('languageSelect')} aria-label={t('settings.gameLanguage')} value={state.language} onChange={event => model.setLanguage(event.target.value)}>{context.languages.map(entry => <option key={entry.id} value={entry.id}>{entry.title || entry.id}</option>)}</MainSelect></section>
      <section className={item('option-focus-hitbox')} id={id('focusHitboxOption')} hidden={!productFeatureAvailable(state.gameId, 'focusHitbox', context.hostFeatures)}><div className="itemtop"><span>{t('settings.focusHitbox')}</span><OptionSwitch id={id('focusHitboxToggle')} label={t('settings.focusHitbox')} checked={options.focusHitboxEnabled} onChange={switchOption('focusHitboxEnabled')}/></div></section>
      <section className={item('option-focus-hitbox')} id={id('faithBarOption')} hidden={!hasFaith}><div className="itemtop"><span>{t('settings.faithBar')}</span><OptionSwitch id={id('faithBarToggle')} label={t('settings.faithBar')} checked={options.faithBarEnabled} onChange={switchOption('faithBarEnabled')}/></div></section>
    </div></details>
    <details className="options-group" id={id('advancedOptions')} open={state.disclosure.advanced} onToggle={event => model.setDisclosure('advanced', event.currentTarget.open)}><summary className="options-group-head"><span>{t('options.advanced')}</span><i aria-hidden="true">⌄</i></summary><div className="options-advanced-body">
      <section className={item('feature-section feature-language feature-music')} id={id('musicOption')} hidden={!multiplayer && !availability.ogg}><div className="itemtop"><span>{t('settings.music')}</span></div><MainSelect className="option-select" id={id('musicSelect')} aria-label={multiplayer ? undefined : '音乐模式'} title={availability.audio ? '' : t('settings.webAudioUnavailable')} value={state.music} onChange={event => {if (isMusicMode(event.target.value)) model.setMusic(event.target.value);}}><option value="ogg-stream" disabled={!availability.ogg}>{t('settings.music.oggStream')}</option><option value="ogg-full" disabled={!availability.ogg}>{t('settings.music.oggFull')}</option><option value="midi" disabled={!availability.midi}>midi</option><option value="none">{t('settings.music.none')}</option></MainSelect></section>
      {<section className="item feature-section" id={id('thpracOption')} hidden={!productFeatureAvailable(state.gameId, 'thprac', context.hostFeatures)}><div className="itemtop"><span>thprac<small>{t(multiplayer ? 'settings.thpracMultiplayerDisabled' : 'settings.thpracHint')}</small></span><OptionSwitch id={id('thpracToggle')} label="thprac" disabled={multiplayer} checked={!multiplayer && options.thpracEnabled} onChange={switchOption('thpracEnabled')}/></div></section>}
      {multiplayer && <section className={item('option-frame-limit')}><div className="itemtop"><span><span>{t('settings.localPlayerVisibility')}</span><small>{t('settings.localPlayerVisibilityHint')}</small></span><OptionSwitch id="mpLocalPlayerVisibilityToggle" label={t('settings.localPlayerVisibility')} checked={options.multiplayerLocalPlayerVisibility} onChange={switchOption('multiplayerLocalPlayerVisibility')}/></div></section>}
      <section className={item('option-frame-limit option-external-midi')} id={id('externalMidiOption')} hidden={!midiVisible}><div className="itemtop"><span><span>{t('settings.externalMidi')}</span><small id={id('externalMidiHint')}>{midi.hint}</small></span><OptionSwitch id={id('externalMidiToggle')} label={t('settings.externalMidi')} describedBy={id('externalMidiHint')} checked={midiVisible && midi.enabled} disabled={!midiVisible || !midi.supported} title={midiVisible && !midi.supported ? t('settings.externalMidiUnsupported') : ''} onChange={() => {void actions.externalMidi.setEnabled(!midi.enabled).catch(actions.reportError);}}/></div></section>
      <section className={item('feature-section feature-language')} id={id('externalMidiDeviceOption')} hidden={!midiVisible || !midi.enabled || !midi.granted}><div className="itemtop"><span>{t('settings.externalMidiDevice')}</span></div><MainSelect className="option-select" id={id('externalMidiDeviceSelect')} aria-label={t('settings.externalMidiDevice')} value={midi.selectedId} disabled={!midi.outputs.length} onChange={event => {const value = event.target.value; void actions.externalMidi.selectOutput(value).catch(actions.reportError);}}>{midi.outputs.length ? midi.outputs.map(output => <option key={output.id} value={output.id}>{output.name}</option>) : <option value="" disabled>{t('settings.externalMidiNoDeviceOption')}</option>}</MainSelect></section>
    </div></details>
    {!context.mobile && touch}
  </div>;
}
