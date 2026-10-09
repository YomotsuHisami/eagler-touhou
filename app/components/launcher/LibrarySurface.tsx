import type {ReactNode} from 'react';
import {useLocale} from '../../i18n';
import {LibraryCards, type LibraryCardsProps} from './LibraryCards';

export interface LibrarySurfaceProps extends Omit<LibraryCardsProps, 'variant' | 'lobbyLink' | 'inert'> {
  masthead: ReactNode;
  footer: ReactNode;
  lobbyHref: string;
  roomUsersArtwork: string;
  optionsOpen: boolean;
  onBack: () => void;
  children?: ReactNode;
}
/** OptionsPanel must be a direct child of .main.library-layout for main's CSS. */
export function LibrarySurface({masthead, footer, lobbyHref, roomUsersArtwork, optionsOpen, onBack, children, ...rail}: LibrarySurfaceProps) {
  const {t} = useLocale();
  return <><div className="library-background" aria-hidden="true"/><div className="sheet">
    {masthead}
    <main className="main library-layout" id="main">
      <h1 className="visually-hidden">{t('site.documentTitle')}</h1>
      <div className="game-library" inert={optionsOpen}>
        <LibraryCards {...rail} products={rail.products.filter(p => !p.multiplayer)} variant="singleplayer"/>
        <LibraryCards {...rail} products={rail.products.filter(p => p.multiplayer)} variant="multiplayer" lobbyLink={<a className="shelf-lobby-link" href={lobbyHref}><img src={roomUsersArtwork} alt="" width="18" height="18"/><span>{t('lobby.title')}</span></a>}/>
      </div>
      <button className="library-backdrop" id="libraryBackdrop" type="button" tabIndex={-1} aria-hidden="true" aria-label={t('library.back')} onClick={onBack}/>
      {children}
    </main>
  </div>{footer}</>;
}
