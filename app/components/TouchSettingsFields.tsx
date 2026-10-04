import {useId} from 'react';
import {TOUCH_SENSITIVITY_MAX, TOUCH_SENSITIVITY_MIN} from '../../src/contracts/runtime-protocol.mts';
import {isTouchFocusMode, isTouchMovementMode, touchMovementUsesJoystick} from '../../src/launcher/game-preferences.mts';
import type {PreferencesSnapshot, PreferencesStore} from '../services/preferences.client';
export const settingsControlClass = 'min-h-11 w-full rounded-xl border border-line bg-background px-3 py-2 text-paper disabled:cursor-not-allowed disabled:opacity-50';
const controlClass = settingsControlClass;
export function SettingsCheckbox({id, label, checked, onChange, description}: {
  id: string; label: string; checked: boolean; onChange: (checked: boolean) => void; description?: string;
}) {
  return <div>
    <label htmlFor={id} className="flex min-h-11 cursor-pointer items-center justify-between gap-4 py-2">
      <span>{label}</span><input id={id} type="checkbox" checked={checked} onChange={event => onChange(event.currentTarget.checked)} aria-describedby={description ? `${id}-hint` : undefined} className="size-5 shrink-0 accent-accent"/>
    </label>
    {description && <p id={`${id}-hint`} className="pb-2 text-xs leading-relaxed text-muted">{description}</p>}
  </div>;
}

export function TouchSettingsFields({settings, store}: {settings: PreferencesSnapshot; store: PreferencesStore}) {
  const id = useId(), productId = settings.productId, options = settings.options;
  const joystick = touchMovementUsesJoystick(options.touchMovementMode);
  const movementWarning = options.touchMovementMode === 'touch-unlimited'
    ? '不限速触控会使用与原版不兼容的录像格式、破坏原有弹幕设计，并将处理落率标记为 100%，非常不建议使用。'
    : options.touchMovementMode === 'touch' || options.touchMovementMode === 'joystick-free'
      ? '触控移动与自由摇杆会使用新的录像格式，和原版录像系统不兼容。' : null;
  return (
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
        <div role="group" aria-label="触控灵敏度档位" className="flex flex-wrap gap-2">
          {[100, 150, 200].map(value => <button key={value} type="button" disabled={joystick} aria-pressed={options.touchSensitivity === value} className="min-h-11 rounded-xl border border-line px-4 py-2 aria-pressed:border-accent aria-pressed:text-accent disabled:cursor-not-allowed disabled:opacity-50" onClick={() => store.setOption(productId, 'touchSensitivity', value)}>{value}%</button>)}
        </div>
        <input id={`${id}-sensitivity`} type="range" min={TOUCH_SENSITIVITY_MIN} max={TOUCH_SENSITIVITY_MAX} step={1} value={options.touchSensitivity} disabled={joystick} aria-describedby={`${id}-shared-hint`} aria-valuetext={`${options.touchSensitivity}%`} className="min-h-11 w-full accent-accent disabled:opacity-50" onChange={event => store.setOption(productId, 'touchSensitivity', Number(event.currentTarget.value))}/>
      </div>
      <div className="grid gap-2"><label htmlFor={`${id}-focus`}>低速方式</label>
        <select id={`${id}-focus`} value={options.touchFocusMode} className={controlClass} onChange={event => {
          const value = event.currentTarget.value;
          if (isTouchFocusMode(value)) store.setOption(productId, 'touchFocusMode', value);
        }}><option value="two-finger" disabled={joystick}>双指低速</option><option value="hold-button">按住低速按钮</option><option value="toggle-button">切换低速按钮</option></select>
      </div>
      <SettingsCheckbox id={`${id}-bomb`} label="双击放雷" checked={options.doubleTapBombEnabled} onChange={value => store.setOption(productId, 'doubleTapBombEnabled', value)}/>
      <SettingsCheckbox id={`${id}-restart`} label="显示重新开始按钮" checked={options.restartButtonEnabled} onChange={value => store.setOption(productId, 'restartButtonEnabled', value)}/>
      <SettingsCheckbox id={`${id}-practice-controls`} label="显示 thprac 触控按钮" checked={options.thpracTouchControlsEnabled} onChange={value => store.setOption(productId, 'thpracTouchControlsEnabled', value)} description="只保存按钮显示偏好，不会启用当前作品不支持的练习功能。"/>
    </fieldset>
  );
}
