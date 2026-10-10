import {useLayoutEffect, useRef, useState, type ReactNode} from 'react';
import {useLocale} from '../../i18n';
import {useMainDialog} from '../notices/use-main-dialog';
import {useBackdropWheel} from './use-options-interactions';
export interface LobbyOptionsHostProps {
  open: boolean;
  onCloseRequest(): void;
  /** Shared OptionsPanel kept open in the retained original embedded document. */
  children: ReactNode;
  /** Editor/player stays in its fixed root DOM location. Pause only the modal. */
  foregroundActive?: boolean;
}
/** Native carrier: lobby.html131–137/lobby.css137–139. Presentation handshake:
 * app.mts9803–9840. Shared React subtree replaces only the iframe document.
 */
export function LobbyOptionsHost({open, onCloseRequest, children, foregroundActive = false}: LobbyOptionsHostProps) {
  const {t} = useLocale();
  const dialog = useMainDialog({open, onCloseRequest, suspended: foregroundActive}, 650);
  const backdrop = useRef<HTMLButtonElement>(null); useBackdropWheel(backdrop);
  const [presented, setPresented] = useState(false);
  const current = useRef(dialog); current.current = dialog;
  useLayoutEffect(() => {
    const host = dialog.ref.current, tools = host?.querySelector<HTMLElement>('.tools');
    if (!host || !tools || foregroundActive) return;
    let active = true, timer = 0;
    if (open) {
      const cover = tools.querySelector<HTMLImageElement>('#optionsCover');
      void Promise.allSettled([cover?.decode?.(), document.fonts?.ready]).then(() => {
        if (!active) return;
        tools.getBoundingClientRect(); // Commit original closed transform first.
        setPresented(true);
      });
    } else {
      setPresented(false);
      if (host.open) {
        const report = () => {
          if (!active) return; active = false; clearTimeout(timer); timer = 0;
          tools.removeEventListener('transitionend', transition); current.current.finishPendingClose();
        };
        const durations = getComputedStyle(tools).transitionDuration.split(',').map(value => parseFloat(value) * (value.trim().endsWith('ms') ? 1 : 1000));
        const duration = Math.max(0, ...durations);
        const transition = (event: TransitionEvent) => {if (event.target === tools && event.propertyName === 'transform') report();};
        tools.addEventListener('transitionend', transition);
        if (!duration) report(); else timer = window.setTimeout(report, duration + 40);
        return () => {active = false; clearTimeout(timer); tools.removeEventListener('transitionend', transition);};
      }
    }
    return () => {active = false; clearTimeout(timer);};
  }, [open, foregroundActive]);
  return <dialog ref={dialog.ref} className="lobby-options-host" id="lobbyOptionsDialog" aria-label={t('lobby.gameOptions')}
    onCancel={event => {event.preventDefault(); onCloseRequest();}}
    onClick={event => {if (event.target === event.currentTarget) onCloseRequest();}}>
    <div data-launcher-document="" className={`lobby-options-document${open && presented ? ' lobby-options-presented' : ''}`}><div className="main library-layout">
      <button ref={backdrop} className="library-backdrop" id="libraryBackdrop" type="button" tabIndex={-1} aria-hidden="true" aria-label={t('library.back')} onClick={onCloseRequest}/>
      {children}
    </div></div>
  </dialog>;
}
