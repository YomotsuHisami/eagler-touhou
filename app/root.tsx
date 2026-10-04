import {Links, Meta, Outlet, Scripts, ScrollRestoration} from 'react-router';
import type {ReactNode} from 'react';
import {MotionConfig} from 'motion/react';
import {LauncherShell} from './components/LauncherShell';
import './styles.css';
import {GlobalHelpPanel, HelpProvider} from './components/HelpPanel';
import {GameLaunchProvider} from './components/GameLaunchProvider';
import {RuntimeControls} from './runtime/RuntimeControls';
import {RuntimeProvider} from './runtime/RuntimeHost';
import {GameSettingsProvider} from './components/GameSettings';
import {ResourceManagerProvider, useResourcePreferences} from './components/ResourceManagerProvider';
import {NavigationDraftProvider} from './components/NavigationDrafts';
import {ReplayProvider} from './components/ReplayProvider';
export function Layout({children}: {children: ReactNode}) {
  return <html lang="zh-CN"><head><meta charSet="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"/><Meta/><Links/></head><body>{children}<ScrollRestoration/><Scripts/></body></html>;
}
function SettingsBoundary({children}: {children: ReactNode}) {
  const context = useResourcePreferences();
  return <GameSettingsProvider context={context}>{children}</GameSettingsProvider>;
}
export default function App() {return <MotionConfig reducedMotion="user"><RuntimeProvider><NavigationDraftProvider><ResourceManagerProvider><ReplayProvider><HelpProvider><RuntimeControls/><GlobalHelpPanel/><SettingsBoundary><GameLaunchProvider><LauncherShell><Outlet/></LauncherShell></GameLaunchProvider></SettingsBoundary></HelpProvider></ReplayProvider></ResourceManagerProvider></NavigationDraftProvider></RuntimeProvider></MotionConfig>;}
export function HydrateFallback() {return <main role="status">正在载入启动器…</main>;}
