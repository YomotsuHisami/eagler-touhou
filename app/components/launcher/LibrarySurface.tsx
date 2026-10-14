import type {SiteNoticeLine} from '../notices/site-notice-source';
import type {ReactNode} from 'react';
import {GameDirectory} from './GameDirectory';
import {SiteWorkspace} from './SiteWorkspace';
import {useLocale} from '../../i18n';
import type {LibraryProduct} from './products';

export interface LibrarySurfaceProps {
  products: readonly LibraryProduct[];
  selectedProduct?: string;
  onActivate(id: string): void;
  interactive?: boolean;
  masthead: ReactNode;
  footer: ReactNode;
  serverStatusNote?: ReactNode;
  lobbyHref: string;
  optionsOpen: boolean;
  settingsOpen?: boolean;
  settingsCard?: ReactNode;
  filesOpen?: boolean;
  filesCard?: ReactNode;
  lobby?: boolean;
  onSite?(): void;
  siteHref?: string;
  roomOpen?: boolean;
  roomDirectoryLocked?: boolean;
  foregroundActive?: boolean;
  roomDrawer?: ReactNode;
  onBack: () => void;
  children?: ReactNode;
  siteNoticeLines?: readonly SiteNoticeLine[];
  assetUrl?: (path: string) => string;
}
/** Persistent workspace. Directory selection stays available beside the information panel. */
export function LibrarySurface({masthead, footer, serverStatusNote, lobbyHref, optionsOpen, settingsOpen = false, settingsCard, filesOpen = false, filesCard, roomOpen = false, roomDirectoryLocked = true, foregroundActive = false, roomDrawer, onBack, children, siteNoticeLines, assetUrl = path => path, products, selectedProduct, interactive, onActivate, lobby = false, onSite, siteHref}: LibrarySurfaceProps) {
  const {locale} = useLocale();
  return <><div className="library-background" aria-hidden="true"/><div className={`sheet redesign-sheet${lobby ? ' lobby-redesign-sheet' : ''}`} inert={foregroundActive}>
    {masthead}
    <main className={`main library-layout directory-layout${lobby ? ' lobby-main lobby-directory-layout' : ''}${optionsOpen ? ' has-selection' : ''}${optionsOpen && !lobby && !roomOpen ? ' game-info-layout' : ''}${settingsOpen || !lobby && !roomOpen ? ' launcher-workspace-layout' : ''}${settingsOpen ? ' settings-layout' : ''}${roomOpen ? ' mp-room-open' : ''}`} id="main" inert={lobby && interactive === false}>
      <h1 className="visually-hidden">东方Project 原作 STG ~ EAGLER TOUHOU</h1>
      <GameDirectory locked={roomOpen && roomDirectoryLocked} siteDisabled={roomOpen} products={products} selectedProduct={selectedProduct} interactive={interactive} onActivate={onActivate} railId={lobby ? 'lobbyGameRail' : undefined} onSite={roomOpen ? () => {} : onSite ?? onBack} siteHref={siteHref ?? (locale === 'en' ? 'en.html' : './')}/>
      <div className="workspace-column"><div className="workspace-current" hidden={settingsOpen || filesOpen} inert={settingsOpen || filesOpen}>{children ?? <SiteWorkspace noticeLines={siteNoticeLines} assetUrl={assetUrl} interactive={interactive}/>}</div>{filesCard}{settingsCard}{footer}</div>
    </main>
    {roomDrawer}{serverStatusNote}
  </div></>;
}
