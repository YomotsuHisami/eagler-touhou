import {useLocale} from './LocaleProvider';
import {useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode} from 'react';
import {TOUCH_SENSITIVITY_MAX, TOUCH_SENSITIVITY_MIN} from '../../src/contracts/runtime-protocol.mts';
import {isTouchFocusMode, isTouchMovementMode, touchMovementUsesJoystick} from '../../src/launcher/game-preferences.mts';
import type {PreferencesSnapshot, PreferencesStore} from '../services/preferences.client';
import {createTouchModeConfirmation, type TouchModeWarning} from '../services/touch-mode-confirmation';
import {AnimatedDialog} from './AnimatedDialog';
export const settingsControlClass = 'min-h-11 w-full rounded-xl border border-line bg-background px-3 py-2 text-paper disabled:cursor-not-allowed disabled:opacity-50';
const controlClass = settingsControlClass;
export function SettingsCheckbox({id, label, checked, onChange, description}: {
  id: string; label: string; checked: boolean; onChange: (checked: boolean) => void; description?: string;
}) {
  return <div>
    <label htmlFor={id} className="flex min-h-11 cursor-pointer items-center justify-between gap-4 py-2">
      <span>{label}{description && <small id={`${id}-hint`}>{description}</small>}</span><input id={id} type="checkbox" role="switch" aria-checked={checked} checked={checked} onChange={event => onChange(event.currentTarget.checked)} aria-describedby={description ? `${id}-hint` : undefined} className="size-5 shrink-0 accent-accent"/>
    </label>
  </div>;
}

export function useTouchModeConfirmation() {
  const {t} = useLocale();
  const [prompt, setPrompt] = useState<TouchModeWarning | null>(null);
  const resolver = useRef<((accepted: boolean) => void) | null>(null);
  const ask = useCallback((message: TouchModeWarning) => new Promise<boolean>(resolve => {
    resolver.current = resolve;
    setPrompt(message);
  }), []);
  const confirm = useMemo(() => createTouchModeConfirmation(ask), [ask]);
  const finish = useCallback((accepted: boolean) => {
    const resolve = resolver.current;
    if (!resolve) return;
    resolver.current = null;
    setPrompt(null);
    resolve(accepted);
  }, []);
  useEffect(() => () => {
    const resolve = resolver.current;
    resolver.current = null;
    resolve?.(false);
  }, []);
  const dialog = <AnimatedDialog open={prompt !== null} onOpenChange={open => {if (!open) finish(false);}}
    title={t('action.confirm')} description={prompt ? t(prompt) : ''} layer={80}>
    <div className="mt-5 flex flex-wrap justify-end gap-2">
      <button type="button" className="min-h-11 rounded-xl border border-line px-4 py-2 text-sm" onClick={() => finish(false)}>{t('lobby.cancel')}</button>
      <button type="button" className="min-h-11 rounded-xl border border-line px-4 py-2 text-sm" onClick={() => finish(true)}>{t('touch.enableConfirm')}</button>
    </div>
  </AnimatedDialog>;
  return {confirm, dialog};
}

export function TouchSettingsFields({settings, store, viewportControls}: {settings: PreferencesSnapshot; store: PreferencesStore; viewportControls?: ReactNode}) {
  const {t} = useLocale();
  const {confirm, dialog} = useTouchModeConfirmation();
  const id = useId(), productId = settings.productId, options = settings.options;
  const [customOpen, setCustomOpen] = useState(false);
  const customSelected = customOpen || ![100, 150, 200].includes(options.touchSensitivity);
  const joystick = touchMovementUsesJoystick(options.touchMovementMode);
  const movementWarning = options.touchMovementMode === 'touch-unlimited'
    ? t('react.touch.unlimitedWarning')
    : options.touchMovementMode === 'touch' || options.touchMovementMode === 'joystick-free'
      ? t('react.touch.formatWarning') : null;
  return <>
    <fieldset className="touch-settings-fields">
      <legend className="sr-only">{t('touch.settingsAria')}</legend>
      <p id={`${id}-shared-hint`} className="sr-only">{t('touch.profileHint')}</p>
      <div className="touch-settings-row"><label htmlFor={`${id}-movement`}>{t('touch.movement')}</label>
        <select id={`${id}-movement`} value={options.touchMovementMode} aria-describedby={`${id}-shared-hint${movementWarning ? ` ${id}-movement-warning` : ''}`} className={controlClass} onChange={event => {
          const value = event.currentTarget.value;
          if (isTouchMovementMode(value)) void confirm(value, () => store.setOption(productId, 'touchMovementMode', value));
        }}>
          <option value="touch">{t('touch.movement.touch')}</option><option value="touch-unlimited">{t('touch.movement.unlimited')}</option><option value="joystick">{t('touch.movement.joystick')}</option><option value="joystick-free">{t('touch.movement.joystickFree')}</option>
        </select>
        {movementWarning && <p id={`${id}-movement-warning`} className="text-xs leading-relaxed text-accent">{movementWarning}</p>}
      </div>
      <div className="touch-settings-row"><label htmlFor={`${id}-focus`}>{t('touch.focusMethod')}</label>
        <select id={`${id}-focus`} value={options.touchFocusMode} className={controlClass} onChange={event => {
          const value = event.currentTarget.value;
          if (isTouchFocusMode(value)) store.setOption(productId, 'touchFocusMode', value);
        }}><option value="hold-button">{t('touch.focus.hold')}</option><option value="toggle-button">{t('touch.focus.toggle')}</option><option value="two-finger" disabled={joystick}>{t('touch.focus.twoFinger')}</option></select>
      </div>
      <div className="touch-settings-row touch-settings-sensitivity"><label htmlFor={`${id}-sensitivity`}>{t('touch.sensitivity')} <output htmlFor={`${id}-sensitivity`}>{options.touchSensitivity}%</output></label>
        <small>{t('touch.sensitivityHint')}</small>
        <div role="group" aria-label={t('touch.sensitivityPresets')} className="touch-settings-presets">
          {[100, 150, 200].map(value => <button key={value} type="button" disabled={joystick} aria-pressed={!customSelected && options.touchSensitivity === value} onClick={() => {setCustomOpen(false); store.setOption(productId, 'touchSensitivity', value);}}>{value}%</button>)}
          <button type="button" disabled={joystick} aria-pressed={customSelected} aria-expanded={customSelected} aria-controls={`${id}-custom`} onClick={() => setCustomOpen(!customSelected)}>{t('touch.custom')}</button>
        </div>
        <label id={`${id}-custom`} className="touch-settings-custom" hidden={!customSelected} htmlFor={`${id}-sensitivity`}><span>{t('touch.customSensitivity')}</span><input id={`${id}-sensitivity`} aria-label={t('touch.customSensitivity')} type="range" min={TOUCH_SENSITIVITY_MIN} max={TOUCH_SENSITIVITY_MAX} step={1} value={options.touchSensitivity} disabled={joystick} aria-describedby={`${id}-shared-hint`} aria-valuetext={`${options.touchSensitivity}%`} onChange={event => store.setOption(productId, 'touchSensitivity', Number(event.currentTarget.value))}/></label>
      </div>
      <SettingsCheckbox id={`${id}-bomb`} label={t('touch.doubleTapBomb')} description={t('touch.doubleTapBombHint')} checked={options.doubleTapBombEnabled} onChange={value => store.setOption(productId, 'doubleTapBombEnabled', value)}/>
      <SettingsCheckbox id={`${id}-restart`} label="R" description={t('touch.restartHint')} checked={options.restartButtonEnabled} onChange={value => store.setOption(productId, 'restartButtonEnabled', value)}/>
      <SettingsCheckbox id={`${id}-practice-controls`} label={t('touch.thpracButtons')} checked={options.thpracTouchControlsEnabled} onChange={value => store.setOption(productId, 'thpracTouchControlsEnabled', value)} description={t('touch.thpracButtonsHint')}/>
      {viewportControls}
      <div className="touch-settings-row touch-settings-opacity">
        <label htmlFor={`${id}-opacity`} className="flex items-center justify-between gap-3">
          <span>{t('touch.opacity')}</span><output htmlFor={`${id}-opacity`}>{options.touchControlOpacity}%</output>
        </label>
        <input id={`${id}-opacity`} type="range" min={20} max={100} step={5} value={options.touchControlOpacity} aria-describedby={`${id}-opacity-hint`} aria-valuetext={`${options.touchControlOpacity}%`} className="min-h-11 w-full accent-accent" onChange={event => store.setOption(productId, 'touchControlOpacity', Number(event.currentTarget.value))}/>
        <p id={`${id}-opacity-hint`} className="text-xs leading-relaxed text-muted">{t('touch.opacityHint')}</p>
      </div>
    </fieldset>
    {dialog}
  </>;
}
