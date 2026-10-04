import {PRODUCT_GAMES, type GameId} from '../../src/contracts/product-catalog.mts';
import type {TouchFocusMode} from '../../src/launcher/game-preferences.mts';
import {touchLayoutControlMeta, type TouchLayoutControlName} from '../../src/launcher/touch-layout-model.mts';

export function TouchControlCopy({name, game, focusMode}: {name: TouchLayoutControlName; game: GameId; focusMode: TouchFocusMode}) {
  if (name === 'bomb') return <><span>B</span><strong>BOMB</strong></>;
  if (name === 'joystick') return null;
  if (name === 'escape') return <>ESC</>;
  if (name === 'restart') return <>R</>;
  if (name === 'thpracMenu') return <>作弊菜单</>;
  if (name === 'thpracTab') return <><strong>Tab</strong><small>Tracker</small></>;
  const hint = name === 'focus' ? focusMode === 'toggle-button' ? '点按切换' : '按住低速'
    : name === 'function' ? '功能按键' : PRODUCT_GAMES[game].touchFire.mode === 'held-key' ? '按住开火 / 蓄力' : '点按切换';
  return <><strong>{touchLayoutControlMeta[name].title}</strong><small>{hint}</small></>;
}

