import type {Route} from './+types/root';
import {launcherDocumentMetadata} from './services/document-metadata';
import {Links, Meta, Outlet, Scripts, ScrollRestoration} from 'react-router';
import {UI_MESSAGES} from '../src/launcher/i18n.mts';
import {useCallback, useLayoutEffect, type ReactNode} from 'react';
import {LocaleProvider, useLocale} from './components/LocaleProvider';
import {NoticesProvider} from './components/Notices';
import {MotionPreferenceProvider} from './components/MotionPreferenceProvider';
import {LauncherShell} from './components/LauncherShell';
import {ManagementSurfaceProvider} from './components/ManagementSurface';
import './styles.css';
import browserCompatibilityGate from './browser/compatibility-gate.js?raw';
import bootRecovery from './browser/boot-recovery.js?raw';
import {LauncherErrorBoundary} from './components/LauncherErrorBoundary';
import {bootUiEntries} from '../src/launcher/i18n-boot-ui.mts';
import {GlobalHelpPanel, HelpProvider} from './components/HelpPanel';
import {GameLaunchProvider} from './components/GameLaunchProvider';
import {RuntimeControls} from './runtime/RuntimeControls';
import {RuntimeProvider} from './runtime/RuntimeHost';
import {GameSettingsProvider} from './components/GameSettingsProvider';
import {ResourceManagerProvider, useResourcePreferences} from './components/ResourceManagerProvider';
import {NavigationDraftProvider} from './components/NavigationDrafts';
import {LegacyEntryAdapter} from './components/LegacyEntryAdapter';
import {LobbyDirectoryProvider} from './components/LobbyDirectoryProvider';
import {MultiplayerRoomProvider} from './components/MultiplayerRoomProvider';
import {MultiplayerReplayProvider} from './components/MultiplayerReplayProvider';
import {AppShellProvider} from './components/AppShellProvider';
import {SaveProvider} from './components/SaveProvider';
import {RuntimeTouchControls} from './runtime/RuntimeTouchControls';
import {ReplayProvider} from './components/ReplayProvider';
import {PlayerSurfaceProvider} from './runtime/PlayerToolsSurface';
import {StorageBootstrapProvider} from './components/StorageBootstrapProvider';
import {DocumentRequestProvider} from './components/DocumentRequestProvider';
export function meta({location}: Route.MetaArgs) {return launcherDocumentMetadata(location.pathname, location.search);}
const bootMessages = JSON.stringify(Object.fromEntries(['zh-CN', 'en'].map((locale, index) =>
  [locale, Object.fromEntries(bootUiEntries.map(entry => [entry[0], entry[index + 1]]))])));
export function Layout({children}: {children: ReactNode}) {
  return <html lang="zh-CN"><head><meta charSet="utf-8"/><script id="browser-compatibility-gate" data-compatibility-url={`${import.meta.env.BASE_URL}compatibility.html`} dangerouslySetInnerHTML={{__html:browserCompatibilityGate}}/><script id="launcher-boot-watchdog" data-assets-url={`${import.meta.env.BASE_URL}assets/`} data-messages={bootMessages} dangerouslySetInnerHTML={{__html:bootRecovery}}/><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"/><Meta/><Links/></head><body>{children}<div id="launcher-boot-recovery" suppressHydrationWarning dangerouslySetInnerHTML={{__html:''}}/><ScrollRestoration/><Scripts data-launcher-boot-module=""/></body></html>;
}
function SettingsBoundary({children}: {children: ReactNode}) {
  const metadata = useResourcePreferences(), {locale} = useLocale();
  const context = useCallback((game: import('../src/contracts/product-catalog.mts').GameId) => ({...metadata(game),uiLocale:locale}),[metadata,locale]);
  return <GameSettingsProvider context={context}>{children}</GameSettingsProvider>;
}
export default function App() {
  // A committed Framework tree, not module evaluation, downloads, fonts or a
  // game/metadata request, ends the one initial-document watchdog.
  useLayoutEffect(() => {window.__eaglerUiBoot?.ready();}, []);
  return <DocumentRequestProvider><LocaleProvider><MotionPreferenceProvider><PlayerSurfaceProvider><StorageBootstrapProvider><NoticesProvider>
    <RuntimeProvider><ManagementSurfaceProvider><NavigationDraftProvider><ResourceManagerProvider><ReplayProvider><SaveProvider>
      <LobbyDirectoryProvider><HelpProvider>
        <LegacyEntryAdapter/><RuntimeControls/>
        <SettingsBoundary><GameLaunchProvider><MultiplayerRoomProvider><MultiplayerReplayProvider><AppShellProvider><RuntimeTouchControls/>
          <LauncherShell><Outlet/></LauncherShell>
        </AppShellProvider></MultiplayerReplayProvider></MultiplayerRoomProvider></GameLaunchProvider><GlobalHelpPanel/></SettingsBoundary>
      </HelpProvider></LobbyDirectoryProvider>
    </SaveProvider></ReplayProvider></ResourceManagerProvider></NavigationDraftProvider></ManagementSurfaceProvider></RuntimeProvider>
  </NoticesProvider></StorageBootstrapProvider></PlayerSurfaceProvider></MotionPreferenceProvider></LocaleProvider></DocumentRequestProvider>;
}
/** The shared static SPA fallback must hydrate identically at every URL. */
export function HydrateFallback() {return <main role="status"><span lang="zh-CN">{UI_MESSAGES['zh-CN']['react.app.loading']}</span> / <span lang="en">{UI_MESSAGES.en['react.app.loading']}</span></main>;}
export function ErrorBoundary({error}: Route.ErrorBoundaryProps) {return <LauncherErrorBoundary error={error}/>;}
