import {useRef, type ReactNode} from 'react';
import {useBackdropWheel} from './use-options-interactions';
import {useLocale} from '../../i18n';
import {LibraryCards, type LibraryCardsProps} from './LibraryCards';
import {AppLink} from './AppLink';

export interface LibrarySurfaceProps extends Omit<LibraryCardsProps, 'variant' | 'lobbyLink' | 'inert'> {
  masthead: ReactNode;
  footer: ReactNode;
  serverStatusNote?: ReactNode;
  lobbyHref: string;
  roomUsersArtwork: string;
  optionsOpen: boolean;
  roomOpen?: boolean;
  roomDrawer?: ReactNode;
  onBack: () => void;
  children?: ReactNode;
}
/** OptionsPanel must be a direct child of .main.library-layout for main's CSS. */
export function LibrarySurface({masthead, footer, serverStatusNote, lobbyHref, roomUsersArtwork, optionsOpen, roomOpen = false, roomDrawer, onBack, children, ...rail}: LibrarySurfaceProps) {
  const {t} = useLocale();
  const Link = rail.interactive === false ? 'a' : AppLink;
  const backdrop = useRef<HTMLButtonElement>(null); useBackdropWheel(backdrop);
  return <><div className="library-background" aria-hidden="true"/><div className="sheet">
    {masthead}
    <main className={`main library-layout${roomOpen ? ' mp-room-open' : ''}`} id="main">
      <h1 className="visually-hidden">东方Project 原作 STG ~ EAGLER TOUHOU</h1>
      <div className="game-library" inert={optionsOpen}>
        <LibraryCards {...rail} products={rail.products.filter(p => !p.multiplayer)} variant="singleplayer"/>
        <LibraryCards {...rail} products={rail.products.filter(p => p.multiplayer)} variant="multiplayer" lobbyLink={<Link className="shelf-lobby-link" href={lobbyHref}><img src={roomUsersArtwork} alt="" width="18" height="18"/><span>{t('lobby.title')}</span></Link>}/>
      </div>
      <button ref={backdrop} className="library-backdrop" id="libraryBackdrop" type="button" tabIndex={-1} aria-hidden="true" aria-label={t('library.back')} onClick={onBack}/>
      {children}
    </main>
    {roomDrawer}{serverStatusNote}
  </div>{footer}</>;
}
