import {useSyncExternalStore,type ReactNode} from 'react';
import { isRouteErrorResponse, Links, Meta, Outlet, Scripts, ScrollRestoration, useRouteError } from 'react-router';
import { MotionConfig } from 'motion/react';
import { useUiPreferences, useUiText } from './services/ui-preferences';
import {runtimePresentationActive} from './runtime/presentation';
import { BrowserServicesProvider,useBrowserServices } from './services/browser-services';
import { RuntimeHost } from './runtime/runtime-host';
import './ui/tokens.css';
import styles from './ui/app.module.css';

export function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="theme-color" content="#0d0d0c" />
        <title>Eagler Touhou</title>
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export function HydrateFallback() {
  const t = useUiText();
  return <main className={styles.boot} aria-busy="true"><span className={styles.brand}>EAGLER TOUHOU</span><p role="status">{t('ui.openLibrary')}</p></main>;
}

export default function App() {
  const {lessMotion}=useUiPreferences();
  return (
    <MotionConfig reducedMotion={lessMotion ? "always" : "user"}>
      <BrowserServicesProvider>
        <RuntimeLayout />
      </BrowserServicesProvider>
    </MotionConfig>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  const t = useUiText();
  const message = isRouteErrorResponse(error)
    ? error.status === 404 ? t('ui.routeNotFound') : `${t('ui.routeError')} (${error.status})`
    : t('ui.routeError');
  return <main className={styles.boot}><h1>{message}</h1><a href="/">{t('ui.backLibrary')}</a></main>;
}

const emptySubscribe=()=>()=>{};
function RuntimeLayout(){
 const services=useBrowserServices();
 const active=useSyncExternalStore(services?.runtime.subscribe??emptySubscribe,()=>runtimePresentationActive(services?.runtime.getSnapshot()??null),()=>false);
 return <><div inert={active||undefined} aria-hidden={active||undefined}><Outlet/></div><RuntimeHost/></>;
}
