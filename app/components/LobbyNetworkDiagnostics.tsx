import {useEffect, useState, useSyncExternalStore} from 'react';
import {useLocation} from 'react-router';
import {createLobbyNetworkDiagnostics} from '../services/lobby-network-diagnostics.client';
import {AnimatedDialog, AnimatedDialogClose} from './AnimatedDialog';
import {useLocale} from './LocaleProvider';

/** Measurements are local modal state; Router and the directory remain owners
 * of navigation and discovery. Closing or leaving cancels every live probe. */
export function LobbyNetworkDiagnostics({relayUrl, className}: {relayUrl: string | null; className?: string}) {
  const {t} = useLocale(), location = useLocation();
  const [service] = useState(createLobbyNetworkDiagnostics), [open, setOpen] = useState(false);
  const snapshot = useSyncExternalStore(service.subscribe, service.getSnapshot, service.getSnapshot);
  useEffect(() => {
    service.reset();setOpen(false);
    const hide = () => {service.cancel();setOpen(false);};
    window.addEventListener('pagehide', hide);
    return () => {window.removeEventListener('pagehide', hide);service.cancel();};
  }, [service, relayUrl, location.key]);
  function show() {setOpen(true);void service.run(relayUrl);}
  return <>
    <button type="button" className={className} onClick={show}>{t('networkCheck.action')}</button>
    <AnimatedDialog open={open} onOpenChange={value => {setOpen(value);if (!value) service.cancel();}} title={t('networkCheck.title')}>
      <div className="grid gap-5" aria-busy={snapshot.running} aria-live="polite">
        {(['server', 'direct'] as const).map(group => <section key={group}>
          <h2 className="mb-3 font-bold">{t(group === 'server' ? 'networkCheck.serverCapability' : 'networkCheck.directCapability')}</h2>
          <dl className="grid gap-3">{(group === 'server' ? ['ws', 'turn'] as const : ['nat', 'ipv6'] as const).map(kind => {
            const result = snapshot.results[kind];
            return <div key={kind} data-network-result={kind} data-state={!result ? 'pending' : result.good ? 'good' : 'bad'} className="flex items-center justify-between gap-4 rounded-xl border border-line p-3">
              <dt lang="en">{{ws: 'WebSocket', turn: 'TURN', nat: 'NAT', ipv6: 'IPv6'}[kind]}</dt>
              <dd><output className={!result ? 'text-muted' : result.good ? 'text-[#bdd29d]' : 'text-[#eda0a0]'}>{result ? result.message ? t(result.message, result.params) : result.value : t('networkCheck.checking')}</output></dd>
            </div>;
          })}</dl>
        </section>)}
      </div>
      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <button type="button" className={className} disabled={snapshot.running} onClick={() => void service.run(relayUrl)}>{t('networkCheck.action')}</button>
        <AnimatedDialogClose className={className}>{t('action.close')}</AnimatedDialogClose>
      </div>
    </AnimatedDialog>
  </>;
}
