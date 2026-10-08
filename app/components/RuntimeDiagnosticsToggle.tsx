import {useEffect, useSyncExternalStore} from 'react';
import {PLAYER_DIAGNOSTICS_STORAGE_KEY, playerDiagnosticsPreference} from '../services/player-tools-diagnostics';
import {useLocale} from './LocaleProvider';

export function useDiagnosticsPreference() {
  const snapshot = useSyncExternalStore(playerDiagnosticsPreference.subscribe, playerDiagnosticsPreference.getSnapshot, playerDiagnosticsPreference.getSnapshot);
  useEffect(() => {
    let storage: Storage | null; try {storage = window.localStorage;} catch {storage = null;}
    if (playerDiagnosticsPreference.getSnapshot().persistence === 'unknown') playerDiagnosticsPreference.hydrate(storage);
    const changed = (event: StorageEvent) => {
      if (event.key === PLAYER_DIAGNOSTICS_STORAGE_KEY || event.key === null) playerDiagnosticsPreference.hydrate(storage);
    };
    window.addEventListener('storage', changed);
    return () => window.removeEventListener('storage', changed);
  }, []);
  return {snapshot, store: playerDiagnosticsPreference};
}

export function RuntimeDiagnosticsToggle({className, testBuild = false}: {className?: string; testBuild?: boolean}) {
  const {t} = useLocale();
  const {snapshot, store} = useDiagnosticsPreference();
  const enabled = snapshot.preference ?? testBuild;
  return <button id="runtimeDiagnosticsToggle" type="button" role="switch" aria-checked={enabled} className={className} onClick={() => store.setEnabled(!enabled)}>
    <svg className="masthead-menu-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h16v12H4zm2 2v8h12V6zm1 9h4v2H7zm6 0h4v2h-4zM8 8l2 2-2 2 1.4 1.4L12.8 10 9.4 6.6z"/></svg>
    <span>{t('diagnostics.toggle')}</span><i className="masthead-menu-state" aria-hidden="true"/>
  </button>;
}
