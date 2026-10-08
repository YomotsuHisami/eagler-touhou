import {useLayoutEffect, useState} from 'react';
import {useLocale} from './LocaleProvider';

const themeStorageKey = 'eagler-theme';

function metaElement(id: string, name: string) {
  return document.getElementById(id) as HTMLMetaElement | null
    ?? document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
}

function syncDocumentTheme(light: boolean, persist: boolean) {
  const root = document.documentElement;
  if (light) root.setAttribute('data-theme', 'light');
  else root.removeAttribute('data-theme');

  const colorScheme = metaElement('colorSchemeMeta', 'color-scheme');
  const themeColor = metaElement('themeColorMeta', 'theme-color');
  if (colorScheme) colorScheme.content = light ? 'light' : 'dark';
  if (themeColor) themeColor.content = light ? '#e9e4db' : '#10100f';

  if (persist) {
    try {window.localStorage.setItem(themeStorageKey, light ? 'light' : 'dark');} catch {}
  }
}

function storedLightTheme() {
  try {return window.localStorage.getItem(themeStorageKey) === 'light';} catch {return false;}
}

/** Keeps the original document theme attribute, metadata, and storage key in sync. */
export function ThemeToggle({className = 'theme-toggle'}: {className?: string}) {
  const {locale} = useLocale();
  const [light, setLight] = useState(false);

  useLayoutEffect(() => {
    const current = document.documentElement.getAttribute('data-theme');
    const initial = current === 'light' ? true : current === 'dark' ? false : storedLightTheme();
    setLight(initial);
    syncDocumentTheme(initial, false);
  }, []);

  const label = locale === 'zh-CN'
    ? light ? '切换到夜间模式' : '切换到白天模式'
    : light ? 'Switch to dark mode' : 'Switch to light mode';

  function toggle() {
    const next = !light;
    setLight(next);
    syncDocumentTheme(next, true);
  }

  return <button type="button" className={className} aria-label={label} title={label} aria-pressed={light} onClick={toggle}>
    <svg className="theme-toggle-icon theme-toggle-sun" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10ZM11 1h2v3h-2V1Zm0 19h2v3h-2v-3ZM1 11h3v2H1v-2Zm19 0h3v2h-3v-2ZM4.2 2.8l2.1 2.1-1.4 1.4-2.1-2.1 1.4-1.4Zm14.9 14.9 2.1 2.1-1.4 1.4-2.1-2.1 1.4-1.4ZM4.9 17.7l1.4 1.4-2.1 2.1-1.4-1.4 2.1-2.1ZM19.8 2.8l1.4 1.4-2.1 2.1-1.4-1.4 2.1-2.1Z"/>
    </svg>
    <svg className="theme-toggle-icon theme-toggle-moon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M21 14.3A8.5 8.5 0 0 1 9.7 3a9 9 0 1 0 11.3 11.3Z"/>
    </svg>
  </button>;
}
