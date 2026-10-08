import {useEffect, useRef, useState, useSyncExternalStore} from 'react';
import {useLocale} from './LocaleProvider';
import {createRuntimeOrientationController, type PlayerOrientation} from '../services/runtime-orientation.client';
import type {LayoutRect} from '../services/touch-layout.client';

const empty = () => null, subscribeNone = () => () => {};
const inlineButton = 'min-h-11 rounded-xl border border-line px-3 py-2 text-xs hover:bg-nav-hover hover:text-nav-ink disabled:cursor-not-allowed disabled:opacity-50';
export function PlayerOrientationControl({epoch, enabled, orientation, fullscreen, enterFullscreen, placement = 'inline', hostControls, showUnavailable = false, className}: {
  epoch: number | null;
  enabled: boolean;
  orientation: PlayerOrientation;
  fullscreen: boolean;
  enterFullscreen(): Promise<boolean>;
  placement?: 'inline' | 'floating';
  hostControls?: Readonly<LayoutRect> | null;
  showUnavailable?: boolean;
  className?: string;
}) {
  const {t} = useLocale();
  const [owner] = useState(createRuntimeOrientationController);
  const state = useSyncExternalStore(owner.subscribe, owner.getSnapshot, owner.getSnapshot);
  const [notice, setNotice] = useState<string | null>(null), timer = useRef<number | null>(null);
  const current = useRef({epoch, enabled});current.current = {epoch, enabled};
  useEffect(() => {owner.setSession(epoch);}, [owner, epoch]);
  useEffect(() => {if (enabled && fullscreen) void owner.probe(true, epoch, () => current.current.enabled && current.current.epoch === epoch);}, [owner, enabled, fullscreen, epoch]);
  useEffect(() => () => {if (timer.current !== null) window.clearTimeout(timer.current);owner.dispose();}, [owner]);
  if (!enabled) return null;
  const target: PlayerOrientation = orientation === 'landscape' ? 'portrait' : 'landscape';
  const targetTitle = t(target === 'landscape' ? 'touch.landscape' : 'touch.portrait');
  const showButton = state.available;
  async function request() {
    if (!showButton || !state.available || state.pending) return;
    if (timer.current !== null) window.clearTimeout(timer.current);
    setNotice(null);
    const result = await owner.request({epoch, orientation, fullscreen, enterFullscreen,
      current: () => current.current.enabled && current.current.epoch === epoch});
    if (result.status === 'superseded' || result.status === 'unavailable') return;
    const message = result.status === 'requested' ? t('touch.orientationRequested', {orientation: targetTitle}) : t('touch.orientationFailed');
    setNotice(message);timer.current = window.setTimeout(() => setNotice(null), 3500);
  }
  const button = showButton && <button type="button" data-player-orientation-control aria-label={t(target === 'landscape' ? 'player.switchLandscape' : 'player.switchPortrait')}
    title={t('player.switchOrientationTitle')} disabled={!enabled || state.pending}
    className={placement === 'floating' ? `fixed z-[32] grid h-[42px] min-w-[52px] place-items-center rounded-lg border border-white/55 bg-black/65 px-2 text-xs font-semibold text-white shadow ${className ?? ''}` : `${inlineButton} ${className ?? ''}`}
    style={placement === 'floating' ? {top: hostControls?.top ?? 'max(8px,env(safe-area-inset-top))', right: hostControls ? `calc(100vw - ${hostControls.left}px + 2px)` : 'max(114px,calc(env(safe-area-inset-right) + 114px))'} : undefined}
    onClick={() => void request()}>{t('player.rotate')}<strong className="block">{targetTitle}</strong></button>;
  const unavailable = showUnavailable && state.mobile && !state.available && <p role="status" data-player-orientation-unavailable className="text-xs leading-relaxed text-muted">{t('touch.orientationUnsupported')}</p>;
  const status = notice && <p role="status" data-player-orientation-status className={placement === 'floating' ? 'fixed right-3 top-14 z-[33] max-w-[min(320px,calc(100vw-24px))] rounded-lg border border-line bg-panel/95 px-3 py-2 text-xs text-paper shadow-menu' : 'text-xs text-muted'}>{notice}</p>;
  if (placement === 'inline' && !button && !unavailable && !status) return null;
  return placement === 'floating'
    ? <>{button}{status}</>
    : <div className="grid gap-2">{unavailable}{button}{status}</div>;
}
