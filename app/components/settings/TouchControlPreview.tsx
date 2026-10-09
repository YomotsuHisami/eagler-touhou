import {PRODUCT_GAMES} from '../../../src/contracts/product-catalog.mts';
import {touchMovementUsesJoystick} from '../../../src/launcher/game-preferences.mts';
import {functionKeyGames} from '../../../src/launcher/touch-function-key.mts';
import type {SettingsSnapshot} from '../../models/game-settings';
import {useLocale} from '../../i18n';
const Resize = () => <span className="touch-layout-resize-handle" aria-hidden="true">↘</span>;
/** Authored touch geometry/labels. Editor controls select/move; they never send
 * live Runtime input. All native input ownership stays with the Runtime host. */
export function TouchControlPreview({settings}: {settings: SettingsSnapshot}) {
  const {t} = useLocale(), {options} = settings, game = PRODUCT_GAMES[settings.gameId];
  const heldFire = game.touchFire.mode === 'held-key', heldFocus = options.touchFocusMode === 'hold-button';
  const extraU = 'thpracExtraFunctionKeys' in game && game.thpracExtraFunctionKeys.includes('U');
  return <>
    <nav className="touch-hud" id="touchHud" aria-label={t('touch.leftControls')}>
      <button className="touch-focus" id="touchFocus" data-touch-layout-control="focus" type="button" aria-pressed="false" hidden={options.touchFocusMode === 'two-finger'} aria-label={t('touch.focus') + t(heldFocus ? 'touch.actionHold' : 'touch.actionToggle')}><strong><span className="touch-action-name">{t('touch.focus')}</span><span className="touch-action-mode">{t(heldFocus ? 'touch.actionHold' : 'touch.actionToggle')}</span></strong><small>{t(heldFocus ? 'touch.holdFocus' : 'touch.tapToggle')}</small><Resize/></button>
      <button className={`touch-fire${heldFire ? '' : ' is-on'}`} id="touchFire" data-touch-layout-control="fire" type="button" aria-pressed={!heldFire} aria-label={t('touch.fire') + t(heldFire ? 'touch.actionHold' : 'touch.actionToggle')}><strong><span className="touch-action-name">{t('touch.fire')}</span><span className="touch-action-mode">{t(heldFire ? 'touch.actionHold' : 'touch.actionToggle')}</span></strong><small>{t(game.touchFire.labelKey)}</small><Resize/></button>
      <button className="touch-function touch-fire" id="touchFunction" data-touch-layout-control="function" type="button" aria-label={t('touch.specialFunction')} hidden={!functionKeyGames.has(settings.gameId)}><span className="touch-icon" aria-hidden="true">C</span><strong>{t('touch.specialFunction')}</strong><small>{t('touch.functionKeyHint')}</small><Resize/></button>
      <button className="touch-bomb" id="touchBomb" data-touch-layout-control="bomb" type="button"><span className="touch-icon">B</span><strong>BOMB</strong><Resize/></button>
    </nav>
    <div className="touch-joystick" id="touchJoystick" data-touch-layout-control="joystick" aria-label={t('touch.joystickAria')} role="application" hidden={!touchMovementUsesJoystick(options.touchMovementMode)}><div className="touch-joystick-base"><i className="touch-joystick-ring" aria-hidden="true"/><b className="touch-joystick-knob" id="touchJoystickKnob" aria-hidden="true"/></div><Resize/></div>
    <button className="touch-escape" id="touchEscape" data-touch-layout-control="escape" type="button" aria-label={t('touch.escapeAria')} title={t('touch.escapeTitle')}>ESC<Resize/></button>
    <button className="touch-restart" id="touchRestart" data-touch-layout-control="restart" type="button" aria-label="R" title={t('touch.restartTitle')} hidden={!options.restartButtonEnabled}>R<Resize/></button>
    <button className="touch-thprac-tab" id="touchThpracTab" data-touch-layout-control="thpracTab" data-thprac-key="Tab" type="button" hidden={!options.thpracTouchControlsEnabled}><strong>Tab</strong><small>Tracker</small><Resize/></button>
    <div className="touch-thprac-menu" id="touchThpracMenu" data-touch-layout-control="thpracMenu" hidden={!options.thpracTouchControlsEnabled}>
      <button className="touch-thprac-backspace" id="touchThpracBackspace" type="button">{t('touch.cheatMenu')}</button>
      <div className="touch-thprac-function-keys" id="touchThpracFunctionKeys" hidden>
        {([['F12','touch.advancedMenu'],['F1','touch.invincible'],['F2','touch.infiniteLives'],['F3','touch.infiniteBombs'],['F4','touch.infinitePower'],['F5','touch.timeLock'],['F6','touch.autoBomb'],['F7','touch.enemyBgm'],['U','touch.enemyInvincible']] as const).map(([key, label]) => <button key={key} type="button" data-thprac-key={key} hidden={key === 'U' && !extraU}><strong>{key}</strong><small>{t(label)}</small></button>)}
      </div><Resize/>
    </div>
  </>;
}
