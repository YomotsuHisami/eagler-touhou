import {Links, Meta, Outlet, Scripts, ScrollRestoration} from 'react-router';
import {UI_MESSAGES} from '../src/launcher/i18n.mts';
import {useCallback, type ReactNode} from 'react';
import {LocaleProvider, useLocale} from './components/LocaleProvider';
import {NoticesProvider} from './components/Notices';
import {MotionPreferenceProvider} from './components/MotionPreferenceProvider';
import {LauncherShell} from './components/LauncherShell';
import './styles.css';
import browserCompatibilityGate from './browser/compatibility-gate.js?raw';
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
export function Layout({children}: {children: ReactNode}) {
  return <html lang="zh-CN"><head><meta charSet="utf-8"/><script id="browser-compatibility-gate" data-compatibility-url={`${import.meta.env.BASE_URL}compatibility.html`} dangerouslySetInnerHTML={{__html:browserCompatibilityGate}}/><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"/><Meta/><Links/></head><body>{children}<ScrollRestoration/><Scripts/></body></html>;
}
function SettingsBoundary({children}: {children: ReactNode}) {
  const metadata = useResourcePreferences(), {locale} = useLocale();
  const context = useCallback((game: import('../src/contracts/product-catalog.mts').GameId) => ({...metadata(game),uiLocale:locale}),[metadata,locale]);
  return <GameSettingsProvider context={context}>{children}</GameSettingsProvider>;
}
export default function App() {
  return <DocumentRequestProvider><LocaleProvider><MotionPreferenceProvider><PlayerSurfaceProvider><StorageBootstrapProvider><NoticesProvider>
    <RuntimeProvider><NavigationDraftProvider><ResourceManagerProvider><ReplayProvider><SaveProvider>
      <LobbyDirectoryProvider><HelpProvider>
        <LegacyEntryAdapter/><RuntimeControls/><GlobalHelpPanel/>
        <SettingsBoundary><GameLaunchProvider><MultiplayerRoomProvider><MultiplayerReplayProvider><AppShellProvider><RuntimeTouchControls/>
          <LauncherShell><Outlet/></LauncherShell>
        </AppShellProvider></MultiplayerReplayProvider></MultiplayerRoomProvider></GameLaunchProvider></SettingsBoundary>
      </HelpProvider></LobbyDirectoryProvider>
    </SaveProvider></ReplayProvider></ResourceManagerProvider></NavigationDraftProvider></RuntimeProvider>
  </NoticesProvider></StorageBootstrapProvider></PlayerSurfaceProvider></MotionPreferenceProvider></LocaleProvider></DocumentRequestProvider>;
}
/** The shared static SPA fallback must hydrate identically at every URL. */
export function HydrateFallback() {return <main role="status"><span lang="zh-CN">{UI_MESSAGES['zh-CN']['react.app.loading']}</span> / <span lang="en">{UI_MESSAGES.en['react.app.loading']}</span></main>;}
