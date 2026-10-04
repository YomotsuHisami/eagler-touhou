import {useLayoutEffect, useState} from 'react';
import {isRouteErrorResponse, useLocation} from 'react-router';
import {copyText} from '../browser/clipboard';
import {formatUiMessage} from '../services/locale-message';
import {routeUiLocale} from '../services/locale-route';

/** Independent of app providers, storage, Runtime and network. Router errors
 * after initial hydration remain route errors, never a second boot failure. */
export function LauncherErrorBoundary({error}: {error: unknown}) {
  const location = useLocation(), locale = routeUiLocale(location.pathname, location.search) ?? 'zh-CN';
  const t = (key: Parameters<typeof formatUiMessage>[1]) => formatUiMessage(locale, key);
  const status = isRouteErrorResponse(error) && Number.isInteger(error.status) && error.status >= 400 && error.status <= 599 ? error.status : null;
  const diagnostic = ['EAGLER-UI-RECOVERY/1', 'scope=route', `kind=${status === 404 ? 'not-found' : 'route-error'}`, `status=${status ?? 'unknown'}`].join('\n');
  const [copied, setCopied] = useState<boolean | null>(null);
  useLayoutEffect(() => {window.__eaglerUiBoot?.handled();}, []);
  return <main lang={locale} className="flex min-h-svh items-center justify-center bg-background p-5 text-paper" data-route-recovery="">
    <section role="alert" aria-labelledby="route-recovery-title" className="w-full max-w-[460px] rounded-[22px] border border-line bg-menu p-6 shadow-menu">
      <h1 id="route-recovery-title" className="text-xl font-bold text-accent">{t('boot.routeTitle')}</h1>
      <p className="mt-3">{t(status === 404 ? 'boot.notFound' : 'boot.routeError')}</p>
      <p className="mt-2 text-sm text-muted">{t('boot.hint')}</p>
      <details className="mt-4" open={copied === false || undefined}><summary className="min-h-11 cursor-pointer">{t('boot.details')}</summary>
        <pre className="select-text whitespace-pre-wrap break-words rounded-xl bg-background p-3 font-mono text-xs" data-route-diagnostics="">{diagnostic}</pre>
      </details>
      <div className="mt-5 flex flex-wrap gap-3">
        <button type="button" className="min-h-11 rounded-xl bg-accent px-4 py-2 font-bold text-ink" onClick={() => window.location.reload()}>{t('boot.reload')}</button>
        <button type="button" className="min-h-11 rounded-xl border border-line px-4 py-2 font-bold" onClick={() => {void copyText(diagnostic).then(setCopied);}}>{t('boot.copy')}</button>
      </div>
      {copied !== null && <p role="status" className="mt-3 text-sm">{t(copied ? 'boot.copied' : 'boot.copyFailed')}</p>}
    </section>
  </main>;
}
