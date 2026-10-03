import { replace, type ClientLoaderFunctionArgs } from 'react-router';
import { GlobalSettings } from '../features/GlobalSettings';
import { useCloseIntent } from '../navigation/close-intent';
import { setUiPreferences, useUiText } from '../services/ui-preferences';
import { Button } from '../ui';

/** Explicit legacy URL aliases use only Router navigation and preserve query/hash. */
export function clientLoader({ request }: ClientLoaderFunctionArgs) {
  const url = new URL(request.url);
  const pathname = url.pathname.replace(/\/$/, '') || '/';
  const hash = typeof location !== 'undefined' ? location.hash : url.hash;
  if (pathname === '/en.html') {
    setUiPreferences({ locale: 'en' });
    return replace(`/${url.search}${hash}`);
  }
  if (pathname === '/lobby.html') return replace(`/lobby${url.search}${hash}`);
  if (pathname === '/index.html') return replace(`/${url.search}${hash}`);
  return null;
}
export default function SettingsRoute() {
  const t = useUiText();
  const close = useCloseIntent('/');
  return <section style={{ padding: 24, maxWidth: 820 }}>
    <h1>{t('settings.globalTitle')}</h1>
    <GlobalSettings />
    <Button onClick={() => void close()}>{t('action.back')}</Button>
  </section>;
}
