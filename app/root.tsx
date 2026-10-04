import {Links, Meta, Outlet, Scripts, ScrollRestoration} from 'react-router';
import type {ReactNode} from 'react';
import {MotionConfig} from 'motion/react';
import {LauncherShell} from './components/LauncherShell';
import './styles.css';
export function Layout({children}: {children: ReactNode}) {
  return <html lang="zh-CN"><head><meta charSet="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"/><Meta/><Links/></head><body>{children}<ScrollRestoration/><Scripts/></body></html>;
}
export default function App() {return <MotionConfig reducedMotion="user"><LauncherShell><Outlet/></LauncherShell></MotionConfig>;}
export function HydrateFallback() {return <main role="status">正在载入启动器…</main>;}
