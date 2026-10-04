import {Links, Meta, Outlet, Scripts, ScrollRestoration} from 'react-router';
import type {ReactNode} from 'react';
import {MotionConfig} from 'motion/react';
import {LauncherShell} from './components/LauncherShell';
import './styles.css';
import {GlobalHelpPanel, HelpProvider} from './components/HelpPanel';
import {SamplePreparationProvider} from './components/SamplePreparation';
import {RuntimeControls} from './runtime/RuntimeControls';
import {RuntimeProvider} from './runtime/RuntimeHost';
import {GameSettingsProvider} from './components/GameSettings';
export function Layout({children}: {children: ReactNode}) {
  return <html lang="zh-CN"><head><meta charSet="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"/><Meta/><Links/></head><body>{children}<ScrollRestoration/><Scripts/></body></html>;
}
export default function App() {return <MotionConfig reducedMotion="user"><RuntimeProvider><SamplePreparationProvider><HelpProvider><RuntimeControls/><GlobalHelpPanel/><GameSettingsProvider><LauncherShell><Outlet/></LauncherShell></GameSettingsProvider></HelpProvider></SamplePreparationProvider></RuntimeProvider></MotionConfig>;}
export function HydrateFallback() {return <main role="status">正在载入启动器…</main>;}
