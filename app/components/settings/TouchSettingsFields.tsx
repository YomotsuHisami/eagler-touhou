import {useEffect, useRef, useState, useSyncExternalStore, type CSSProperties} from 'react';
import {isTouchFocusMode, isTouchMovementMode, touchMovementUsesJoystick, type TouchMovementMode} from '../../../src/launcher/game-preferences.mts';
import type {GameSettingsModel} from '../../models/game-settings';
import {useLocale} from '../../i18n';
import {MainSelect} from '../launcher/MainSelect';
import type {SettingsActions} from './types';

export function touchWarningKey(mode: TouchMovementMode) {
  return mode === 'touch' ? 'touch.replayWarning' : mode === 'touch-unlimited' ? 'touch.unlimitedWarning' : mode === 'joystick-free' ? 'touch.freeStickWarning' : null;
}
export function OptionSwitch({id, checked, onChange, label, describedBy, title, disabled = false}: {
  id: string; checked: boolean; onChange(): void; label?: string; describedBy?: string; title?: string; disabled?: boolean;
}) {
  return <button id={id} className={`option-switch${checked ? ' on' : ''}`} type="button" role="switch" aria-checked={checked} aria-label={label}
    aria-describedby={describedBy} title={title} disabled={disabled} onClick={onChange}><i/></button>;
}
export function TouchSettingsFields({model, actions, onAdjustViewport, onResetViewport}: {
  model: GameSettingsModel; actions: SettingsActions; onAdjustViewport(): void; onResetViewport(): void;
}) {
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot, model.getSnapshot);
  const {t} = useLocale(), [customOpen, setCustomOpen] = useState(false);
  const sensitivity = useRef<HTMLInputElement>(null), changeEpoch = useRef(0);
  useEffect(() => {
    // Native change is the original commit boundary. React onChange for range
    // fires on each input and would persist every preview sample instead.
    const input = sensitivity.current;
    const commit = () => model.commitPreferences();
    input?.addEventListener('change', commit);
    return () => {input?.removeEventListener('change', commit); changeEpoch.current++;};
  }, [model]);
  if (!state) return null;
  const options = state.options, wheel = touchMovementUsesJoystick(options.touchMovementMode);
  const custom = customOpen || ![100, 150, 200].includes(options.touchSensitivity);
  async function setMovement(value: string) {
    if (!isTouchMovementMode(value) || value === options.touchMovementMode) return;
    const epoch = ++changeEpoch.current, key = touchWarningKey(value);
    if (key && !await actions.confirm({message: t(key), confirmText: t('touch.enableConfirm')})) return;
    if (epoch !== changeEpoch.current || model.getSnapshot()?.context.productId !== state!.context.productId) return;
    try {model.setOption('touchMovementMode', value);} catch (error) {
      if (error instanceof Error && error.message === 'room.movementRequired') actions.feedback(t('room.movementRequired'));
      else actions.reportError(error);
    }
  }
  const rowSwitch = (id: string, name: 'doubleTapBombEnabled' | 'restartButtonEnabled' | 'thpracTouchControlsEnabled', title: string, hint: string) =>
    <div className="touch-layout-setting-row"><span><span>{title}</span><small>{hint}</small></span><OptionSwitch id={id} checked={options[name]} label={title} onChange={() => model.setOption(name, !options[name])}/></div>;
  return <section className="touch-layout-settings" id="touchLayoutSettingsPanel" aria-label={t('touch.settingsAria')}><div className="touch-layout-settings-list">
    <div className="touch-layout-setting-row"><label htmlFor="touchMovementMode">{t('touch.movement')}</label><MainSelect className="option-select" id="touchMovementMode" value={options.touchMovementMode} aria-label={t('touch.movement')} onChange={event => {void setMovement(event.target.value).catch(actions.reportError);}}>
      <option value="touch">{t('touch.movement.touch')}</option><option value="touch-unlimited">{t('touch.movement.unlimited')}</option><option value="joystick">{t('touch.movement.joystick')}</option><option value="joystick-free">{t('touch.movement.joystickFree')}</option>
    </MainSelect></div>
    <div className="touch-layout-setting-row"><label htmlFor="touchFocusMode">{t('touch.focusMethod')}</label><MainSelect className="option-select" id="touchFocusMode" value={options.touchFocusMode} aria-label={t('touch.focusMethod')} onChange={event => {if (isTouchFocusMode(event.target.value)) model.setOption('touchFocusMode', event.target.value);}}>
      <option value="hold-button">{t('touch.focus.hold')}</option><option value="toggle-button">{t('touch.focus.toggle')}</option><option value="two-finger" disabled={wheel}>{t('touch.focus.twoFinger')}</option>
    </MainSelect></div>
    <div className="touch-layout-setting-row touch-sensitivity-row"><span className="touch-sensitivity-heading"><span>{t('touch.sensitivity')}</span> <output id="touchSensitivityValue">{options.touchSensitivity}%</output></span><small>{t('touch.sensitivityHint')}</small>
      <div className="touch-sensitivity-presets" role="group" aria-label={t('touch.sensitivityPresets')}>
        {[100, 150, 200].map(value => <button key={value} type="button" data-touch-sensitivity-preset={value} disabled={wheel} aria-pressed={!custom && options.touchSensitivity === value} className={!custom && options.touchSensitivity === value ? 'selected' : ''} onClick={() => {setCustomOpen(false); model.setOption('touchSensitivity', value);}}>{value}%</button>)}
        <button type="button" id="touchSensitivityCustomToggle" disabled={wheel} aria-pressed={custom} aria-expanded={custom} className={custom ? 'selected' : ''} onClick={() => setCustomOpen(true)}>{t('touch.custom')}</button>
      </div>
      <label className="touch-sensitivity-custom" id="touchSensitivityCustom" htmlFor="touchSensitivity" hidden={!custom}><span>{t('touch.customSensitivity')}</span><input ref={sensitivity} id="touchSensitivity" type="range" min="100" max="300" step="1" value={options.touchSensitivity} disabled={wheel} aria-label={t('touch.customSensitivity')}
        style={{'--touch-range-progress': `${(options.touchSensitivity - 100) / 2}%`} as CSSProperties}
        onInput={event => {setCustomOpen(true); model.previewSensitivity(Number(event.currentTarget.value));}} onChange={() => {}}/></label>
    </div>
    {rowSwitch('doubleTapBombToggle', 'doubleTapBombEnabled', t('touch.doubleTapBomb'), t('touch.doubleTapBombHint'))}
    {rowSwitch('restartButtonToggle', 'restartButtonEnabled', 'R', t('touch.restartHint'))}
    {rowSwitch('thpracTouchControlsToggle', 'thpracTouchControlsEnabled', t('touch.thpracButtons'), t('touch.thpracButtonsHint'))}
    <div className="touch-layout-setting-row touch-layout-viewport-row"><span><span>{t('touch.viewportPosition')}</span><small>{t('touch.viewportHint')}</small></span><div className="touch-layout-viewport-actions"><button id="touchViewportAdjust" type="button" onClick={onAdjustViewport}>{t('touch.adjustViewport')}</button><button id="touchViewportReset" type="button" onClick={onResetViewport}>{t('action.reset')}</button></div></div>
    <div className="touch-layout-setting-row touch-opacity-row"><div className="touch-opacity-heading"><label htmlFor="touchControlOpacity">{t('touch.opacity')}</label><output id="touchControlOpacityValue" htmlFor="touchControlOpacity">{options.touchControlOpacity}%</output></div><input id="touchControlOpacity" type="range" min="20" max="100" step="5" value={options.touchControlOpacity} aria-valuetext={`${options.touchControlOpacity}%`} aria-describedby="touchControlOpacityHint" style={{'--touch-range-progress': `${(options.touchControlOpacity - 20) / .8}%`} as CSSProperties} onChange={event => model.setOption('touchControlOpacity', Number(event.target.value))}/><small id="touchControlOpacityHint">{t('touch.opacityHint')}</small></div>
  </div></section>;
}
