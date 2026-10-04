import {useId} from 'react';
import {isMultiplayerProductId, type ProductId} from '../../src/contracts/product-catalog.mts';
import {isMusicMode, type MusicMode} from '../../src/launcher/game-preferences.mts';
import type {PreferencesSnapshot, PreferencesStore} from '../services/preferences.client';
import {TouchLayoutEditor} from './TouchLayoutEditor';
import {useGamePreferences} from './GameSettingsProvider';
import {TouchSettingsFields, SettingsCheckbox as Checkbox, settingsControlClass as controlClass} from './TouchSettingsFields';

const musicLabels: Readonly<Record<MusicMode, string>> = {
  'ogg-stream': 'OGG · 流式解码',
  'ogg-full': 'OGG · 全量解码',
  midi: 'MIDI',
  none: '无音乐',
};

/** Preference edits only. This form does not issue Runtime commands or launch a game. */
export function GameSettings({productId}: {productId: ProductId}) {
  const {store, settings} = useGamePreferences(productId);
  if (!store || !settings) return <p role="status" className="my-6 text-sm text-muted">正在载入本机设置…</p>;
  return <><GameSettingsForm settings={settings} store={store}/><TouchLayoutEditor settings={settings} preferences={store}/></>;
}

/** Controlled view, also reusable without a Router or browser storage. */
export function GameSettingsForm({settings, store}: {settings: PreferencesSnapshot; store: PreferencesStore}) {
  const id = useId();
  const productId = settings.productId;
  const options = settings.options;
  const multiplayer = isMultiplayerProductId(productId);
  const magnifierConflict = options.magnifierEnabled && options.touchFocusMode === 'two-finger';

  return <form aria-label="游戏设置" onSubmit={event => event.preventDefault()} className="my-6 grid gap-6 text-sm">
    <div className="grid gap-2 text-xs leading-relaxed text-muted">
      <p>此表单编辑本机偏好。游戏准备读取点击时的设置，运行中的游戏不会随表单即时切换。</p>
      <p role="status">{settings.persistence === 'session'
        ? '浏览器存储不可用或保存失败。更改保留在本次会话中，刷新或关闭页面后可能丢失。'
        : '更改会自动保存到当前浏览器。'}</p>
    </div>
    <fieldset className="grid gap-1 rounded-2xl border border-line p-4">
      <legend className="px-2 text-base font-bold">通用设置</legend>
      {multiplayer && <Checkbox id={`${id}-share`} label="与单机共用设置" checked={settings.shareSingleplayerSettings} onChange={value => store.setShareSingleplayerSettings(productId, value)} description="关闭后使用此作品的独立联机设置；触控方式等详细设置仍跨作品共用。"/>}
      <Checkbox id={`${id}-fps`} label="限制为 60 FPS" checked={options.frameLimit60Enabled} onChange={value => store.setOption(productId, 'frameLimit60Enabled', value)} description="游玩时帧率频繁严重波动会导致较大输入延迟，可启用此选项。"/>
      {settings.features.thprac && <Checkbox id={`${id}-thprac`} label="启用 thprac" checked={options.thpracEnabled} onChange={value => store.setOption(productId, 'thpracEnabled', value)}/>}
      {settings.features.focusHitbox && <Checkbox id={`${id}-focus-hitbox`} label="低速判定点" checked={options.focusHitboxEnabled} onChange={value => store.setOption(productId, 'focusHitboxEnabled', value)}/>}
      <Checkbox id={`${id}-always-hitbox`} label="始终显示判定点" checked={options.alwaysHitbox} onChange={value => store.setOption(productId, 'alwaysHitbox', value)}/>
      {multiplayer && <Checkbox id={`${id}-local-player`} label="增强本机玩家可见性" checked={options.multiplayerLocalPlayerVisibility} onChange={value => store.setOption(productId, 'multiplayerLocalPlayerVisibility', value)} description="在游戏区域中使用白色定位线标出本机玩家。"/>}
      <Checkbox id={`${id}-touch`} label="启用触控" checked={options.touchEnabled} onChange={value => store.setOption(productId, 'touchEnabled', value)} description="触控开关跟随当前单机或联机设置，不与其他作品共用。"/>
      <Checkbox id={`${id}-magnifier`} label="双指放大镜" checked={options.magnifierEnabled} onChange={value => store.setOption(productId, 'magnifierEnabled', value)} description="允许通过双指手势放大游戏画面；此偏好跟随当前单机或联机设置。"/>
      {magnifierConflict && <p role="status" className="text-xs leading-relaxed text-accent">放大镜与双指低速不兼容。可关闭放大镜，或在下方选择按键低速。</p>}
    </fieldset>
    <fieldset className="grid gap-4 rounded-2xl border border-line p-4">
      <legend className="px-2 text-base font-bold">语言与音乐</legend>
      {settings.language !== null && settings.languages.length > 0 ? <div className="grid gap-2">
        <label htmlFor={`${id}-language`}>游戏语言</label>
        <select id={`${id}-language`} className={controlClass} value={settings.language} disabled={settings.languages.length === 1} onChange={event => store.setLanguage(productId, event.currentTarget.value)}>
          {settings.languages.map(language => <option key={language.id} value={language.id}>{language.title}</option>)}
        </select>
      </div> : <p className="text-xs leading-relaxed text-muted">语言选项等待当前作品的 Host / Package 元数据。</p>}
      {settings.music !== null && settings.musicModes.length > 0 ? <div className="grid gap-2">
        <label htmlFor={`${id}-music`}>背景音乐</label>
        <select id={`${id}-music`} className={controlClass} value={settings.music} disabled={settings.musicModes.length === 1} aria-describedby={`${id}-music-hint`} onChange={event => {
          const value = event.currentTarget.value;
          if (isMusicMode(value)) store.setMusic(productId, value);
        }}>
          {settings.musicModes.map(mode => <option key={mode} value={mode}>{musicLabels[mode]}</option>)}
        </select>
        <p id={`${id}-music-hint`} className="text-xs leading-relaxed text-muted">仅列出当前元数据支持的模式。OGG 流式解码可避免切歌时卡顿，全量解码可避免音频卡顿。选择不会立即下载资源。</p>
        {settings.musicPreferenceExplicit && settings.musicPreference !== settings.music && <p role="status" className="text-xs leading-relaxed text-accent">已保存的音乐偏好为 {musicLabels[settings.musicPreference]}；当前可用模式为 {musicLabels[settings.music]}。原偏好会保留，直到你选择其他模式。</p>}
      </div> : <p className="text-xs leading-relaxed text-muted">音乐选项等待当前作品的 Host / Package 元数据。</p>}
    </fieldset>
    <TouchSettingsFields settings={settings} store={store}/>
  </form>;
}
