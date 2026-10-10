import {useLayoutEffect, useRef, useState, useSyncExternalStore} from 'react';
import {touchMovementUsesJoystick} from '../../../src/launcher/game-preferences.mts';
import type {BrowserSession} from '../../session/browser-session';
import {bindPlayerInput, bindPlayerLayoutUpdates, applySavedPlayerTouchLayout} from '../../services/player-input';
import type {PlayerTouch} from '../../services/player-touch';
import type {SettingsSnapshot} from '../../models/game-settings';
import {TouchHelp} from './TouchHelp';
import {TitleNetworkOverlay} from './TitleNetworkOverlay';
import {NetplayConnectionWindow} from '../NetplayConnectionWindow';
import {NetplayCalibrationReport} from '../NetplayCalibrationReport';
import {RuntimeDiagnostics, type NetplayDiagnosticLines} from './RuntimeDiagnostics';
import {TransferPanel} from './TransferPanel';
import {TouchControlPreview} from '../settings/TouchControlPreview';
import {useSurfaceNavigation} from '../../navigation/surface-navigation';
import {useLocale} from '../../i18n';
import {playerUtilityIcons} from './utility-icons';
const noopSubscribe = () => () => {};
const initialTouch = () => undefined;
const noNetwork = () => null;
/** The editor and actual game use one original control markup tree. Only this
 * mounted gameplay binding can deliver native input. */
export function PlayerControls({session}: {session: BrowserSession}) {
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot), navigation = useSurfaceNavigation(), {locale, t} = useLocale();
  const feedback = useSyncExternalStore(session.feedback.subscribe, session.feedback.getSnapshot, session.feedback.getSnapshot);
  const selected = useSyncExternalStore(session.settings.subscribe, session.settings.getSnapshot, session.settings.getSnapshot);
  const settings = session.getActiveSettings() ?? selected, diagnostics = session.getDiagnostics();
  const gameplay = session.getGameplayNetwork();
  const network = useSyncExternalStore(gameplay?.subscribe ?? noopSubscribe, gameplay?.getSnapshot ?? noNetwork, noNetwork);
  useLayoutEffect(() => {const player = document.getElementById('player'); player?.classList.toggle('netplay-player-status-visible', network?.playerStatusVisible === true); return () => player?.classList.remove('netplay-player-status-visible');}, [network?.playerStatusVisible]);
  const netplay = network?.diagnostics as NetplayDiagnosticLines | undefined;
  return <><TitleNetworkOverlay model={session.titleNetwork}/>{network && <NetplayConnectionWindow network={network} calibration={session.calibration} english={locale === 'en'} onReturn={navigation.closeSurface}/>}
    {diagnostics && <RuntimeDiagnostics model={diagnostics} netplay={netplay}><NetplayCalibrationReport model={session.calibration} english={locale === 'en'} currentNetwork={() => gameplay?.getSnapshot().diagnostics.runtimeNetplayQualityDiag ?? ''}/></RuntimeDiagnostics>}
    <aside className="netplay-player-status" id="netplayPlayerStatus" aria-label={t('multiplayer.connection')} hidden={!network?.playerStatusVisible}>{network?.playerStatus.map((row, index) => <span key={index} title={row.title}>{row.text}</span>)}</aside>
    <TransferPanel model={session.transfer}/><span id="playerStatus" className="visually-hidden" role="status">{feedback.playerStatus}</span>
    {settings && <PlayerUtilities session={session} settings={settings}/>}
    {settings && state.bootTouchPreview && !session.getActiveSettings() && navigation.surface !== 'touch' && <BootTouchControls session={session} settings={settings}/>}
    {session.getActiveSettings() && navigation.surface !== 'touch' && state.playerOpen && <GameplayControls session={session}/>}</>;
}
/** Boot preview is original static presentation; it creates no native input owner. */
function BootTouchControls({session, settings}: {session: BrowserSession; settings: SettingsSnapshot}) {
  const enabled = settings.options.touchEnabled, wheel = touchMovementUsesJoystick(settings.options.touchMovementMode);
  useLayoutEffect(() => {
    const player = document.getElementById('player')!;
    player.classList.toggle('touch-enabled', enabled); player.classList.toggle('touch-joystick-enabled', enabled && wheel);
    player.style.setProperty('--touch-control-opacity', String(settings.options.touchControlOpacity / 100));
    return () => {player.classList.remove('touch-enabled', 'touch-joystick-enabled'); player.style.removeProperty('--touch-control-opacity');};
  }, [enabled, wheel, settings.options.touchControlOpacity]);
  useLayoutEffect(() => {
    const player = document.getElementById('player')!, safe = document.getElementById('touchLayoutSafeZone')!;
    const apply = () => {
      const width = window.visualViewport?.width || document.documentElement.clientWidth || player.clientWidth;
      const height = window.visualViewport?.height || document.documentElement.clientHeight || player.clientHeight;
      applySavedPlayerTouchLayout(player, safe, session.touchLayout.getSnapshot().saved?.profiles[width >= height ? 'landscape' : 'portrait'] ?? null);
    };
    const updates = bindPlayerLayoutUpdates({window, safeZone: safe, applyLayout: apply});
    const unsubscribe = session.touchLayout.subscribe(apply); apply();
    return () => {updates.dispose(); unsubscribe(); player.classList.remove('touch-layout-custom');};
  }, [session]);
  return <><div className="touch-layout-safe-zone" id="touchLayoutSafeZone" aria-hidden="true"/>
    <div className="touch-direct-surface" id="touchDirectSurface" aria-hidden="true" hidden/>
    <TouchControlPreview settings={settings} fireEnabled={session.touchFireState.getEnabled()}/></>;
}
function GameplayControls({session}: {session: BrowserSession}) {
  const {t} = useLocale(), state = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  const settings = session.getActiveSettings()!, latestT = useRef(t); latestT.current = t;
  const [input, setInput] = useState<PlayerTouch | null>(null);
  const touch = useSyncExternalStore(input?.subscribe ?? noopSubscribe, input?.getSnapshot ?? initialTouch, initialTouch);
  const spectator = state.runtime?.spectator === true, enabled = settings.options.touchEnabled && !spectator;
  const wheel = touchMovementUsesJoystick(settings.options.touchMovementMode);
  const hostDirect = /\bAndroid\b|iPhone|iPad|iPod/i.test(navigator.userAgent) || /Macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1;
  useLayoutEffect(() => {
    const binding = bindPlayerInput({session, document, window, translate: (key, params) => latestT.current(key, params)}); setInput(binding.touch);
    const unbindRelayout = session.bindPlayerRelayout(binding.relayoutAfterOrientation);
    return () => {unbindRelayout(); binding.dispose();};
  }, [session]);
  useLayoutEffect(() => {
    const player = document.getElementById('player')!;
    player.classList.toggle('touch-enabled', enabled); player.classList.toggle('touch-joystick-enabled', enabled && wheel);
    player.style.setProperty('--touch-control-opacity', String(settings.options.touchControlOpacity / 100));
    return () => {player.classList.remove('touch-enabled', 'touch-joystick-enabled', 'touch-layout-custom'); player.style.removeProperty('--touch-control-opacity');};
  }, [settings, enabled, wheel]);
  return <><div className="touch-layout-safe-zone" id="touchLayoutSafeZone" aria-hidden="true"/>
    <div className="touch-direct-surface" id="touchDirectSurface" aria-hidden="true" hidden={!(state.runtime?.launched && enabled && hostDirect && !wheel)}/>
    <TouchControlPreview settings={settings} live={touch} spectator={spectator}/>
  </>;
}
/** Main keeps these controls/help content in its hidden Player document before
 * launch; original behavior tests query their mode/copy from the settings UI. */
function PlayerUtilities({session, settings}: {session: BrowserSession; settings: SettingsSnapshot}) {
  const {t} = useLocale(), state = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  const [, updateOrientation] = useState(0);
  const portrait = (window.visualViewport?.height || window.innerHeight) > (window.visualViewport?.width || window.innerWidth);
  useLayoutEffect(() => {const update = () => updateOrientation(value => value + 1); window.addEventListener('resize', update); window.visualViewport?.addEventListener('resize', update); window.screen.orientation?.addEventListener('change', update); return () => {window.removeEventListener('resize', update); window.visualViewport?.removeEventListener('resize', update); window.screen.orientation?.removeEventListener('change', update);};}, []);
  return <>
    <TouchHelp open={state.touchHelpOpen} onCloseRequest={session.closeTouchHelp} touchEnabled={settings.options.touchEnabled} focusMode={settings.options.touchFocusMode} showIosFullscreenHelp={/iPhone|iPad|iPod/i.test(navigator.userAgent) || navigator.maxTouchPoints > 1 && /Macintosh/i.test(navigator.userAgent) || new URLSearchParams(location.search).get('iosHelpPreview') === '1'}/>
    <nav className="touch-utility-row" aria-label={t('touch.tools')}>
      <button className="fullscreen-toggle" id="fullscreenToggle" type="button" data-fullscreen={session.nativeTouch.isFullscreen()} aria-label={t(session.nativeTouch.isFullscreen() ? 'player.exitFullscreen' : 'player.enterFullscreen')} title={t(session.nativeTouch.isFullscreen() ? 'player.exitFullscreenTitle' : 'player.enterFullscreenTitle')} onClick={() => {if (state.runtime?.launched) void session.togglePlayerFullscreen();}} dangerouslySetInnerHTML={{__html: playerUtilityIcons.fullscreenToggle}}/>
      <button className="touch-help-open" id="touchHelpOpen" type="button" aria-label={t('help.open')} title={t('help.title')} onClick={session.openTouchHelp} dangerouslySetInnerHTML={{__html: playerUtilityIcons.touchHelpOpen}}/>
      <button className="orientation-toggle" id="orientationToggle" type="button" aria-label={t(portrait ? 'player.switchLandscape' : 'player.switchPortrait')} title={t('player.switchOrientationTitle')} hidden={!state.runtime?.launched || !session.nativeTouch.canSwitchOrientation()} onClick={event => {if (!state.runtime?.launched) return; event.preventDefault(); event.stopPropagation(); void session.switchPlayerOrientation(portrait ? 'landscape' : 'portrait');}}><strong id="orientationTarget">{t(portrait ? 'touch.landscape' : 'touch.portrait')}</strong><small>{t('player.rotate')}</small><span style={{display: 'contents'}} dangerouslySetInnerHTML={{__html: playerUtilityIcons.orientationToggle.slice(playerUtilityIcons.orientationToggle.indexOf('<svg'))}}/></button>
      <button className="game-zoom-toggle" id="gameZoomToggle" type="button" aria-label={t('player.restoreViewportAria')} title={t('player.restoreViewportTitle')} hidden><strong>{t('action.reset')}</strong><small id="gameZoomScale">100%</small></button>
    </nav>
  </>;
}
