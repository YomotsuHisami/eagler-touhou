import type {ReactNode} from 'react';
import {useLocale} from '../../i18n';
import {useMainDialog} from '../notices/use-main-dialog';
import {OptionsBackdrop} from './OptionsBackdrop';
export interface LobbyOptionsHostProps {
  /** Visual lifetime is supplied by the shared options presence owner. */
  open: boolean;
  onCloseRequest(): void;
  children: ReactNode;
  /** Editor/player stays in its fixed root DOM location. Pause only the modal. */
  foregroundActive?: boolean;
}
/** Native focus/input carrier only. The shared options owner and CSS drive
 * entrance, exit and retirement on both the library and directory surfaces. */
export function LobbyOptionsHost({open, onCloseRequest, children, foregroundActive = false}: LobbyOptionsHostProps) {
  const {t} = useLocale();
  const dialog = useMainDialog({open, onCloseRequest, suspended: foregroundActive}, 0);
  return <dialog ref={dialog.ref} className="lobby-options-host" id="lobbyOptionsDialog" aria-label={t('lobby.gameOptions')}
    onCancel={event => {event.preventDefault(); onCloseRequest();}}
    onClick={event => {if (event.target === event.currentTarget) onCloseRequest();}}>
    <div data-launcher-document="" className="lobby-options-document"><div className="main library-layout">
      <OptionsBackdrop onBack={onCloseRequest}/>
      {children}
    </div></div>
  </dialog>;
}
