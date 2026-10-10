import {Links, Meta, Outlet, Scripts, ScrollRestoration, useLocation} from 'react-router';
import {useRef, type ReactNode} from 'react';
import {BrowserLauncher} from './BrowserLauncher';
import {OriginalBootstrapHead, OriginalPreloads, OriginalModuleRequestMark, OriginalBootstrapTail} from './components/startup/OriginalBootstrap';
import {AppShellDeploymentMeta} from './components/startup/AppShellDeploymentMeta';
import {InitialLauncher, InitialDocumentBody, OriginalNoscript} from './components/startup/InitialLauncher';
import '../public/styles.css';
import '../public/lobby.css';
import '../public/touch-guide.css';
import './components/launcher/lobby-options.css';
export function Layout({children}: {children: ReactNode}) {
  const {pathname} = useLocation();
  const locale = /\/en\.html\/?$/.test(pathname) ? "en" : "zh-CN";
  const lobby = /\/(?:lobby|lobby\.html)\/?$/.test(pathname);
  // Original boot owns removal. Keep this initial prop constant so later SPA
  // route renders cannot reintroduce the document's retired loading gate.
  const initialLobby = useRef(lobby).current;
  return <html lang={locale} data-ui-locale={locale} data-original-entry={lobby ? 'lobby' : 'library'} data-lobby-boot={initialLobby ? 'loading' : undefined} suppressHydrationWarning><head><meta charSet="utf-8"/><OriginalBootstrapHead/><AppShellDeploymentMeta/><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"/><Meta/><Links/></head>
    <InitialDocumentBody lobby={lobby}><OriginalPreloads/>{children}<OriginalNoscript lobby={lobby}/><ScrollRestoration/><OriginalModuleRequestMark/><Scripts data-eagler-entry="true"/><OriginalBootstrapTail/></InitialDocumentBody></html>;
}
/** Framework's index.html SPA fallback renders this rather than App. */
export function HydrateFallback() {return <InitialLauncher/>;}
/** The document root, not a route component, owns the unkeyed Player/iframe. */
export default function App() {return <><BrowserLauncher/><Outlet/></>;}
