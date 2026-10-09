import {PRODUCT_GAMES, type GameId} from '../../src/contracts/product-catalog.mts';
import type {TouchFocusMode} from '../../src/launcher/game-preferences.mts';
import type {TouchLayoutControlName} from '../../src/launcher/touch-layout-model.mts';
import type {UiMessageKey} from '../../src/launcher/i18n.mts';
import {useLocale} from './LocaleProvider';

export const touchControlLabelKeys = {
  focus: 'touch.focus', fire: 'touch.fire', function: 'touch.specialFunction', bomb: 'react.touch.bomb',
  joystick: 'touch.movement.joystick', escape: 'react.touch.escape', restart: 'react.touch.restart',
  thpracTab: 'react.touch.thpracTab', thpracMenu: 'touch.cheatMenu',
} as const satisfies Record<TouchLayoutControlName, UiMessageKey>;

export function TouchControlCopy({name, game, focusMode}: {name: TouchLayoutControlName; game: GameId; focusMode: TouchFocusMode}) {
  const {t} = useLocale();
  if (name === 'bomb') return <><span className="touch-icon">B</span><strong>BOMB</strong></>;
  if (name === 'joystick') return null;
  if (name === 'escape') return <>ESC</>;
  if (name === 'restart') return <>R</>;
  if (name === 'thpracMenu') return <>{t('touch.cheatMenu')}</>;
  if (name === 'thpracTab') return <><strong>Tab</strong><small>Tracker</small></>;
  if (name === 'function') return <><span className="touch-icon">C</span><strong>{t('touch.specialFunction')}</strong><small>{t('touch.functionKeyHint')}</small></>;
  const hint = name === 'focus' ? focusMode === 'toggle-button' ? 'touch.tapToggle' : 'touch.holdFocus'
    : PRODUCT_GAMES[game].touchFire.mode === 'held-key' ? 'touch.holdFireCharge' : 'touch.tapToggle';
  return <><strong><span className="touch-action-name">{t(touchControlLabelKeys[name])}</span><span className="touch-action-mode">{t((name === 'focus' ? focusMode !== 'toggle-button' : PRODUCT_GAMES[game].touchFire.mode === 'held-key') ? 'touch.actionHold' : 'touch.actionToggle')}</span></strong><small>{t(hint)}</small></>;
}
