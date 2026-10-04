import {createContext, useCallback, useContext, useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode} from 'react';
import {isMultiplayerProductId, type ProductId} from '../../src/contracts/product-catalog.mts';
import {TOUCH_SENSITIVITY_MAX, TOUCH_SENSITIVITY_MIN} from '../../src/contracts/runtime-protocol.mts';
import {isTouchFocusMode, isTouchMovementMode, touchMovementUsesJoystick, type GamePreferenceStorage} from '../../src/launcher/game-preferences.mts';
import type {PreferencesContextSource, PreferencesSnapshot, PreferencesStore} from '../services/preferences.client';

const PreferenceOwner = createContext<PreferencesStore | null>(null);
const unresolvedContext: PreferencesContextSource = () => ({uiLocale: 'zh-CN'});
const noSubscription = () => () => {};
const noSnapshot = () => null;

/** Mount once above route/dialog contents so repeated forms share one owner. */
export function GameSettingsProvider({children, storage, context = unresolvedContext}: {
  children: ReactNode;
  /** Omit for browser storage after mount; pass null for an in-memory session. */
  storage?: GamePreferenceStorage | null;
  context?: PreferencesContextSource;
}) {
  const [store, setStore] = useState<PreferencesStore | null>(null);
  const contextRef = useRef(context);
  contextRef.current = context;
  useEffect(() => {
    let active = true;
    // .client is never evaluated by the SPA prerenderer. React's initial render
    // is identical on server/client and does not access browser storage.
    void import('../services/preferences.client').then(({createPreferencesStore}) => {
      if (!active) return;
      let selectedStorage = storage ?? null;
      if (storage === undefined) {
        try { selectedStorage = window.localStorage; } catch { /* Memory-only session. */ }
      }
      setStore(createPreferencesStore({storage: selectedStorage, context: contextRef.current}));
    });
    return () => { active = false; };
  }, [storage]);
  useEffect(() => { store?.setContext(context); }, [store, context]);
  return <PreferenceOwner.Provider value={store}>{children}</PreferenceOwner.Provider>;
}

const controlClass = 'min-h-11 w-full rounded-xl border border-line bg-background px-3 py-2 text-paper disabled:cursor-not-allowed disabled:opacity-50';

function Checkbox({id, label, checked, onChange, description}: {
  id: string; label: string; checked: boolean; onChange: (checked: boolean) => void; description?: string;
}) {
  return <div>
    <label htmlFor={id} className="flex min-h-11 cursor-pointer items-center justify-between gap-4 py-2">
      <span>{label}</span><input id={id} type="checkbox" checked={checked} onChange={event => onChange(event.currentTarget.checked)} aria-describedby={description ? `${id}-hint` : undefined} className="size-5 shrink-0 accent-accent"/>
    </label>
    {description && <p id={`${id}-hint`} className="pb-2 text-xs leading-relaxed text-muted">{description}</p>}
  </div>;
}

/** Preference edits only. This sample does not issue Runtime commands or launch a game. */
export function GameSettings({productId}: {productId: ProductId}) {
  const store = useContext(PreferenceOwner);
  const getSnapshot = useCallback(() => store?.getSnapshot(productId) ?? null, [store, productId]);
  const settings = useSyncExternalStore(store?.subscribe ?? noSubscription, getSnapshot, noSnapshot);
  useEffect(() => { store?.loadProduct(productId); }, [store, productId]);
  if (!store || !settings) return <p role="status" className="my-6 text-sm text-muted">正在载入本机设置…</p>;
  return <GameSettingsForm settings={settings} store={store}/>;
}

/** Controlled view, also reusable without a Router or browser storage. */
export function GameSettingsForm({settings, store}: {settings: PreferencesSnapshot; store: PreferencesStore}) {
  const id = useId();
  const productId = settings.productId;
  const options = settings.options;
  const joystick = touchMovementUsesJoystick(options.touchMovementMode);
  const movementWarning = options.touchMovementMode === 'touch-unlimited'
    ? '不限速触控会使用与原版不兼容的录像格式、破坏原有弹幕设计，并将处理落率标记为 100%，非常不建议使用。'
    : options.touchMovementMode === 'touch' || options.touchMovementMode === 'joystick-free'
      ? '触控移动与自由摇杆会使用新的录像格式，和原版录像系统不兼容。' : null;

  return <form aria-label="游戏设置" onSubmit={event => event.preventDefault()} className="my-6 grid gap-6 text-sm">
    <p className="text-xs leading-relaxed text-muted">此表单编辑本机偏好。游戏运行尚未接入；浏览器无法保存时，本次会话仍可使用这些设置。</p>
    <fieldset className="grid gap-1 rounded-2xl border border-line p-4">
      <legend className="px-2 text-base font-bold">通用设置</legend>
      {isMultiplayerProductId(productId) && <Checkbox id={`${id}-share`} label="与单机共用设置" checked={settings.shareSingleplayerSettings} onChange={value => store.setShareSingleplayerSettings(productId, value)} description="关闭后使用此作品的独立联机设置；触控方式等详细设置仍跨作品共用。"/>}
      <Checkbox id={`${id}-fps`} label="限制为 60 FPS" checked={options.frameLimit60Enabled} onChange={value => store.setOption(productId, 'frameLimit60Enabled', value)} description="游玩时帧率频繁严重波动会导致较大输入延迟，可启用此选项。当前只保存偏好，尚未应用到游戏。"/>
      {settings.features.thprac && <Checkbox id={`${id}-thprac`} label="启用 thprac" checked={options.thpracEnabled} onChange={value => store.setOption(productId, 'thpracEnabled', value)}/>}
      {settings.features.focusHitbox && <Checkbox id={`${id}-focus-hitbox`} label="低速判定点" checked={options.focusHitboxEnabled} onChange={value => store.setOption(productId, 'focusHitboxEnabled', value)}/>}
      <Checkbox id={`${id}-touch`} label="启用触控" checked={options.touchEnabled} onChange={value => store.setOption(productId, 'touchEnabled', value)} description="触控开关跟随当前单机或联机设置，不与其他作品共用。"/>
    </fieldset>
    <fieldset className="grid gap-4 rounded-2xl border border-line p-4">
      <legend className="px-2 text-base font-bold">共用触控设置</legend>
      <p id={`${id}-shared-hint`} className="text-xs leading-relaxed text-muted">以下触控偏好跨作品及单机、联机共用。摇杆模式使用按键低速，不使用双指低速或触控灵敏度。</p>
      <div className="grid gap-2"><label htmlFor={`${id}-movement`}>移动方式</label>
        <select id={`${id}-movement`} value={options.touchMovementMode} aria-describedby={`${id}-shared-hint${movementWarning ? ` ${id}-movement-warning` : ''}`} className={controlClass} onChange={event => {
          const value = event.currentTarget.value;
          if (isTouchMovementMode(value)) store.setOption(productId, 'touchMovementMode', value);
        }}>
          <option value="touch">触控移动</option><option value="touch-unlimited">无限制触控</option><option value="joystick">摇杆</option><option value="joystick-free">自由摇杆</option>
        </select>
        {movementWarning && <p id={`${id}-movement-warning`} className="text-xs leading-relaxed text-accent">{movementWarning}</p>}
      </div>
      <div className="grid gap-2"><label htmlFor={`${id}-sensitivity`}>触控灵敏度 <output htmlFor={`${id}-sensitivity`}>{options.touchSensitivity}%</output></label>
        <input id={`${id}-sensitivity`} type="range" min={TOUCH_SENSITIVITY_MIN} max={TOUCH_SENSITIVITY_MAX} step={1} value={options.touchSensitivity} disabled={joystick} aria-describedby={`${id}-shared-hint`} aria-valuetext={`${options.touchSensitivity}%`} className="min-h-11 w-full accent-accent disabled:opacity-50" onChange={event => store.setOption(productId, 'touchSensitivity', Number(event.currentTarget.value))}/>
      </div>
      <div className="grid gap-2"><label htmlFor={`${id}-focus`}>低速方式</label>
        <select id={`${id}-focus`} value={options.touchFocusMode} className={controlClass} onChange={event => {
          const value = event.currentTarget.value;
          if (isTouchFocusMode(value)) store.setOption(productId, 'touchFocusMode', value);
        }}><option value="two-finger" disabled={joystick}>双指低速</option><option value="hold-button">按住低速按钮</option><option value="toggle-button">切换低速按钮</option></select>
      </div>
      <Checkbox id={`${id}-bomb`} label="双击放雷" checked={options.doubleTapBombEnabled} onChange={value => store.setOption(productId, 'doubleTapBombEnabled', value)}/>
      <Checkbox id={`${id}-restart`} label="显示重新开始按钮" checked={options.restartButtonEnabled} onChange={value => store.setOption(productId, 'restartButtonEnabled', value)}/>
      <Checkbox id={`${id}-practice-controls`} label="显示 thprac 触控按钮" checked={options.thpracTouchControlsEnabled} onChange={value => store.setOption(productId, 'thpracTouchControlsEnabled', value)} description="只保存按钮显示偏好，不会启用当前作品不支持的练习功能。"/>
    </fieldset>
    <p className="text-xs leading-relaxed text-muted">语言与音乐选择等待真实 Host / Package 元数据接入。</p>
  </form>;
}
