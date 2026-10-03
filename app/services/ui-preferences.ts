import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { useReducedMotion } from 'motion/react';
import { UI_LOCALE_STORAGE_KEY, UI_MESSAGES, isUiLocale, isUiMessageKey, type UiLocale, type UiMessageKey, type UiMessageParams } from '../../src/launcher/i18n.mts';
import { SITE_NOTICE_STORAGE_KEY } from '../../src/launcher/site-notice.mts';

export const LESS_MOTION_STORAGE_KEY = 'eagler-touhou-less-motion-v1';
export const DIAGNOSTICS_STORAGE_KEY = 'eagler-touhou-runtime-diagnostics-v1';
export const UI_PREFERENCE_KEYS = Object.freeze([UI_LOCALE_STORAGE_KEY, LESS_MOTION_STORAGE_KEY, DIAGNOSTICS_STORAGE_KEY, SITE_NOTICE_STORAGE_KEY]);
export interface UiPreferences {
  locale: UiLocale;
  lessMotion: boolean;
  /** null retains the existing automatic, test-build-only default. */
  diagnostics: boolean | null;
  siteNotices: boolean;
  persistenceAvailable: boolean;
}
export type UiPreferenceChange = Partial<Omit<UiPreferences, 'persistenceAvailable'>>;
type UiStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const defaults: Readonly<UiPreferences> = Object.freeze({ locale: 'zh-CN', lessMotion: false, diagnostics: null, siteNotices: true, persistenceAvailable: false });

/** Owns UI preferences only. No product identities, game settings, DOM or history. */
export function createUiPreferenceStore(initialStorage: UiStorage | null = null) {
  let storage = initialStorage;
  let snapshot: Readonly<UiPreferences> = defaults;
  const listeners = new Set<() => void>();
  const publish = (next: UiPreferences) => {
    if (Object.keys(next).every(key => next[key as keyof UiPreferences] === snapshot[key as keyof UiPreferences])) return;
    snapshot = Object.freeze(next); listeners.forEach(listener => listener());
  };
  const reload = () => {
    try {
      const locale = storage?.getItem(UI_LOCALE_STORAGE_KEY);
      const diagnostics = storage?.getItem(DIAGNOSTICS_STORAGE_KEY);
      publish({ locale: isUiLocale(locale) ? locale : defaults.locale,
        lessMotion: storage?.getItem(LESS_MOTION_STORAGE_KEY) === '1',
        diagnostics: diagnostics === '1' ? true : diagnostics === '0' ? false : null,
        siteNotices: storage?.getItem(SITE_NOTICE_STORAGE_KEY) !== '0', persistenceAvailable: storage !== null });
    } catch { publish({ ...snapshot, persistenceAvailable: false }); }
  };
  reload();
  return {
    getSnapshot: () => snapshot,
    getServerSnapshot: () => defaults,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    connect(nextStorage: UiStorage | null) { storage = nextStorage; reload(); },
    reload,
    update(change: UiPreferenceChange) {
      const next: UiPreferences = { ...snapshot };
      if (isUiLocale(change.locale)) next.locale = change.locale;
      if (typeof change.lessMotion === 'boolean') next.lessMotion = change.lessMotion;
      if (typeof change.siteNotices === 'boolean') next.siteNotices = change.siteNotices;
      if (typeof change.diagnostics === 'boolean' || change.diagnostics === null) next.diagnostics = change.diagnostics;
      try {
        if (!storage) throw new Error('Storage unavailable');
        if (change.locale !== undefined) storage.setItem(UI_LOCALE_STORAGE_KEY, next.locale);
        if (change.lessMotion !== undefined) storage.setItem(LESS_MOTION_STORAGE_KEY, next.lessMotion ? '1' : '0');
        if (change.siteNotices !== undefined) storage.setItem(SITE_NOTICE_STORAGE_KEY, next.siteNotices ? '1' : '0');
        if (change.diagnostics !== undefined) {
          if (next.diagnostics === null) storage.removeItem(DIAGNOSTICS_STORAGE_KEY);
          else storage.setItem(DIAGNOSTICS_STORAGE_KEY, next.diagnostics ? '1' : '0');
        }
        next.persistenceAvailable = true;
      } catch { next.persistenceAvailable = false; }
      publish(next);
    },
  };
}

export const uiPreferenceStore = createUiPreferenceStore();
let browserInitialized = false;
let browserConsumers = 0;
let removeBrowserListeners: (() => void) | null = null;
function initializeBrowser() {
  if (browserInitialized || typeof window === 'undefined') return;
  browserInitialized = true;
  let storage: Storage | null = null;
  try { storage = window.localStorage; } catch { /* Session preferences remain usable. */ }
  uiPreferenceStore.connect(storage);
}
function connectBrowser() {
  initializeBrowser();
  if (typeof window === 'undefined') return () => {};
  browserConsumers++;
  if (browserConsumers === 1) {
    const apply = () => {
      const value = uiPreferenceStore.getSnapshot();
      document.documentElement.lang = value.locale;
      document.documentElement.dataset.uiLocale = value.locale;
      document.documentElement.classList.toggle('less-motion', value.lessMotion);
    };
    const changed = (event: StorageEvent) => {
      if (event.key === null || UI_PREFERENCE_KEYS.includes(event.key)) uiPreferenceStore.reload();
    };
    apply();
    const unsubscribe = uiPreferenceStore.subscribe(apply);
    window.addEventListener('storage', changed);
    removeBrowserListeners = () => { unsubscribe(); window.removeEventListener('storage', changed); };
  }
  return () => {
    browserConsumers--;
    if (!browserConsumers) { removeBrowserListeners?.(); removeBrowserListeners = null; }
  };
}
export function setUiPreferences(change: UiPreferenceChange) {
  initializeBrowser(); uiPreferenceStore.update(change);
}
export function useUiPreferences() {
  const value = useSyncExternalStore(uiPreferenceStore.subscribe, uiPreferenceStore.getSnapshot, uiPreferenceStore.getServerSnapshot);
  useEffect(connectBrowser, []);
  return value;
}
export function useUiReducedMotion() {
  const preferences = useUiPreferences();
  const systemReduced = useReducedMotion();
  return preferences.lessMotion || systemReduced === true;
}

/** New React-only labels extend, rather than fork, the existing shared catalog. */
export const UI_EXTENSION_MESSAGES = Object.freeze({
  'ui.nav': ['站点导航', 'Site navigation'],
  'ui.library': ['游戏库', 'Game library'],
  'ui.homeHint': ['网站公告与联机大厅', 'Announcements and multiplayer'],
  'ui.preferencesHint': ['界面设置在此浏览器中保存。游戏语言、音乐和存档由游戏设置单独管理。', 'Interface preferences are saved in this browser. Game language, music, and files are managed separately.'],
  'ui.presentation': ['显示与动画', 'Display and motion'],
  'ui.motionHint': ['减少界面切换动画；系统的减少动态效果设置始终优先。', 'Reduce interface animations. Your system’s reduced-motion preference is always respected.'],
  'ui.information': ['信息显示', 'Information display'],
  'ui.diagnosticsAuto': ['自动（测试站点开启）', 'Automatic (enabled on test sites)'],
  'ui.diagnosticsShow': ['显示', 'Show'],
  'ui.diagnosticsHide': ['隐藏', 'Hide'],
  'ui.diagnosticsHint': ['控制游戏运行时的诊断信息，不修改游戏存档。', 'Control runtime diagnostics without changing game files.'],
  'ui.noticesHint': ['控制网站公告的显示。', 'Control whether site announcements are shown.'],
  'ui.sessionOnly': ['浏览器不允许保存设置；本次会话内仍然生效。', 'This browser could not save preferences. Changes still apply for this session.'],
  'ui.settingsLoading': ['正在读取设置…', 'Loading settings…'],
  'ui.gameSettings': ['游戏设置', 'Game settings'],
  'ui.gameSharedHint': ['显示、音乐与触控沿用现有共享设置；存档和录像仍按当前单机或联机作品独立保存。', 'Display, music, and touch follow the existing shared preferences. Saves and replays stay separate for the current single-player or multiplayer product.'],
  'ui.languageLoading': ['正在读取可用语言…', 'Loading available languages…'],
  'ui.languageUnavailable': ['已保存的语言 {language} 当前不可用', 'Saved language {language} is currently unavailable'],
  'ui.languageError': ['可用语言读取失败：{reason}', 'Could not load available languages: {reason}'],
  'ui.restartButton': ['显示快速重开', 'Show quick restart'],
  'ui.routeNotFound': ['这个页面不存在', 'This page does not exist'],
  'ui.routeError': ['页面暂时无法打开', 'This page could not be opened'],
  'ui.backLibrary': ['返回游戏库', 'Back to game library'],
  'ui.openLibrary': ['正在打开游戏库…', 'Opening the game library…'],
  "ui.replay.soloHint": ["管理所选游戏的 Replay，并在游戏内的 Replay 菜单选择播放。", "Manage this game's replays and choose playback from its in-game Replay menu."],
  "ui.replay.multiplayerHint": ["管理此联机版本的 Replay。播放时不会加入联机房间。", "Manage this multiplayer version's replays. Playback does not join a room."],
  "ui.replay.exportAll": ["导出全部 ZIP", "Export all as ZIP"],
  "ui.replay.play": ["打开 Replay 播放", "Open Replay playback"],
  "ui.replay.refresh": ["重新读取", "Refresh files"],
  "ui.replay.imported": ["已导入并保存 {count} 个 Replay。重名文件会分配新的槽位", "Imported and saved {count} replays. Name collisions receive new slots."],
  "ui.replay.opened": ["已打开游戏，请在游戏内 Replay 菜单选择播放", "Game opened. Choose playback from its Replay menu."],
  "ui.replay.working": ["正在处理 Replay…", "Working on replays…"],
  "ui.replay.filename": ["文件名", "Filename"],
  "ui.replay.renameHint": ["使用此游戏的 Replay 槽位名称，并保留 .rpy 或 .rpyx 扩展名。", "Use this game's Replay slot naming format and keep the .rpy or .rpyx extension."],
  "ui.replay.replaceTitle": ["替换已有 Replay？", "Replace existing replay?"],
  "ui.replay.replaceHint": ["{name} 已存在。继续将覆盖这个文件，原内容无法在这里恢复。", "{name} already exists. Continuing overwrites it; the old contents cannot be recovered here."],
  "ui.replay.replace": ["替换文件", "Replace file"],
  "ui.replay.closeTitle": ["先保存并关闭当前游戏？", "Save and close the current game?"],
  "ui.replay.closeHint": ["{game} 正在运行。继续会先保存并关闭它，再执行所选 Replay 操作。保存失败时会保留当前游戏。", "{game} is running. Continuing saves and closes it before the selected Replay operation. A save failure keeps the game open."],
  "ui.replay.close": ["保存并关闭后继续", "Save, close, and continue"],
  "ui.replay.confirmHint": ["确认后才会执行此操作。", "This action only runs after confirmation."],
  "ui.runtime.running": ["游戏运行中", "Game running"],
  "ui.runtime.readOnly": ["只读观战", "Read-only spectator"],
  "ui.runtime.saving": ["保存中…", "Saving…"],
  "ui.runtime.saveExit": ["保存并退出", "Save and exit"],
  "ui.runtime.help": ["帮助", "Help"],
  "ui.runtime.fullscreen": ["全屏", "Fullscreen"],
  "ui.runtime.fullscreenBlocked": ["浏览器未允许全屏，可继续在当前窗口游戏", "Fullscreen was not allowed. You can keep playing in this window"],
  "ui.runtime.firstFrame": ["正在显示游戏画面…", "Waiting for the game picture…"],
  "ui.runtime.saveFailed": ["保存未完成", "Save incomplete"],
  "ui.runtime.saveRetained": ["游戏仍然保留。可重试保存，或返回游戏继续。", "Your game is still open. Retry saving or continue playing."],
  "ui.runtime.discardQuestion": ["确认放弃未保存进度？", "Discard unsaved progress?"],
  "ui.runtime.discard": ["放弃未保存进度…", "Discard unsaved progress…"],
  "ui.runtime.discardConfirm": ["确认放弃并退出", "Discard and exit"],
  "ui.runtime.discardWarning": ["继续退出会丢失本次尚未保存的进度，此操作无法撤销。", "Exiting now loses unsaved progress. This cannot be undone."],
  "ui.runtime.touchControls": ["触控操作", "Touch controls"],
  "ui.runtime.hold": ["按住", "Hold"],
  "ui.runtime.toggle": ["切换", "Toggle"],
  "ui.runtime.autoFire": ["自动开火", "Auto-fire"],
  "ui.runtime.off": ["已关闭", "Off"],
  "ui.runtime.charge": ["蓄力", "Charge"],
  "ui.runtime.holdZ": ["按住 Z", "Hold Z"],
  "ui.runtime.pause": ["游戏菜单 / 暂停", "Game menu / pause"],
  "ui.runtime.restart": ["快速重试 R", "Quick restart R"],
  "ui.runtime.practiceKeys": ["练习键", "Practice keys"],
} satisfies Record<string, readonly [string, string]>);
export type UiTextKey = UiMessageKey | keyof typeof UI_EXTENSION_MESSAGES;
export function uiText(locale: UiLocale, key: UiTextKey, params: UiMessageParams = {}): string {
  const value = isUiMessageKey(key) ? UI_MESSAGES[locale][key] : UI_EXTENSION_MESSAGES[key][locale === 'en' ? 1 : 0];
  return value.replace(/\{([A-Za-z0-9_]+)\}/g, (_, name: string) => String(params[name] ?? `{${name}}`));
}
export function useUiText() {
  const { locale } = useUiPreferences();
  return useMemo(() => (key: UiTextKey, params: UiMessageParams = {}) => uiText(locale, key, params), [locale]);
}
