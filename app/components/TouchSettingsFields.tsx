import {useLocale} from './LocaleProvider';
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
  const {t} = useLocale();
  const id = useId(), productId = settings.productId, options = settings.options;
  const joystick = touchMovementUsesJoystick(options.touchMovementMode);
  const movementWarning = options.touchMovementMode === 'touch-unlimited'
    ? t('react.touch.unlimitedWarning')
    : options.touchMovementMode === 'touch' || options.touchMovementMode === 'joystick-free'
      ? t('react.touch.formatWarning') : null;
  return (
    <fieldset className="grid gap-4 rounded-2xl border border-line p-4">
      <legend className="px-2 text-base font-bold">{t('react.touch.sharedSettings')}</legend>
      <p id={`${id}-shared-hint`} className="text-xs leading-relaxed text-muted">{t('react.touch.sharedHint')}</p>
      <div className="grid gap-2"><label htmlFor={`${id}-movement`}>{t('react.touch.movement')}</label>
        <select id={`${id}-movement`} value={options.touchMovementMode} aria-describedby={`${id}-shared-hint${movementWarning ? ` ${id}-movement-warning` : ''}`} className={controlClass} onChange={event => {
          const value = event.currentTarget.value;
          if (isTouchMovementMode(value)) store.setOption(productId, 'touchMovementMode', value);
        }}>
          <option value="touch">{t('react.touch.touchMovement')}</option><option value="touch-unlimited">{t('react.touch.unlimited')}</option><option value="joystick">{t('react.touch.joystick')}</option><option value="joystick-free">{t('react.touch.freeJoystick')}</option>
        </select>
        {movementWarning && <p id={`${id}-movement-warning`} className="text-xs leading-relaxed text-accent">{movementWarning}</p>}
      </div>
      <div className="grid gap-2"><label htmlFor={`${id}-sensitivity`}>{t('touch.sensitivity')} <output htmlFor={`${id}-sensitivity`}>{options.touchSensitivity}%</output></label>
        <div role="group" aria-label={t('touch.sensitivityPresets')} className="flex flex-wrap gap-2">
          {[100, 150, 200].map(value => <button key={value} type="button" disabled={joystick} aria-pressed={options.touchSensitivity === value} className="min-h-11 rounded-xl border border-line px-4 py-2 aria-pressed:border-accent aria-pressed:text-accent disabled:cursor-not-allowed disabled:opacity-50" onClick={() => store.setOption(productId, 'touchSensitivity', value)}>{value}%</button>)}
        </div>
        <input id={`${id}-sensitivity`} type="range" min={TOUCH_SENSITIVITY_MIN} max={TOUCH_SENSITIVITY_MAX} step={1} value={options.touchSensitivity} disabled={joystick} aria-describedby={`${id}-shared-hint`} aria-valuetext={`${options.touchSensitivity}%`} className="min-h-11 w-full accent-accent disabled:opacity-50" onChange={event => store.setOption(productId, 'touchSensitivity', Number(event.currentTarget.value))}/>
      </div>
      <div className="grid gap-2"><label htmlFor={`${id}-focus`}>{t('react.touch.focusMethod')}</label>
        <select id={`${id}-focus`} value={options.touchFocusMode} className={controlClass} onChange={event => {
          const value = event.currentTarget.value;
          if (isTouchFocusMode(value)) store.setOption(productId, 'touchFocusMode', value);
        }}><option value="two-finger" disabled={joystick}>{t('react.touch.twoFinger')}</option><option value="hold-button">{t('react.touch.holdFocus')}</option><option value="toggle-button">{t('react.touch.toggleFocus')}</option></select>
      </div>
      <SettingsCheckbox id={`${id}-bomb`} label={t('react.touch.doubleBomb')} checked={options.doubleTapBombEnabled} onChange={value => store.setOption(productId, 'doubleTapBombEnabled', value)}/>
      <SettingsCheckbox id={`${id}-restart`} label={t('react.touch.showRestart')} checked={options.restartButtonEnabled} onChange={value => store.setOption(productId, 'restartButtonEnabled', value)}/>
      <SettingsCheckbox id={`${id}-practice-controls`} label={t('react.touch.showThprac')} checked={options.thpracTouchControlsEnabled} onChange={value => store.setOption(productId, 'thpracTouchControlsEnabled', value)} description={t('react.touch.thpracHint')}/>
    </fieldset>
  );
}
