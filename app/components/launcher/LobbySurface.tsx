import type {ReactNode} from 'react';
import {useLocale} from '../../i18n';
import {LibraryCards, type LibraryCardsProps} from './LibraryCards';

export interface LobbySurfaceProps extends Omit<LibraryCardsProps, 'variant' | 'lobbyLink' | 'inert'> {
  masthead: ReactNode;
  onGuide: (() => void) | null;
  onNetwork: (() => void) | null;
  networkRunning?: boolean;
  connectionWarning?: ReactNode;
  membership?: ReactNode;
  notice?: string;
  roomTools: ReactNode;
  roomList: ReactNode;
  hasRooms: boolean;
  loading: boolean;
  emptyState: {title: string; hint: string; action?: {label: string; onClick: () => void}} | null;
  roomCount: string;
  connectionNote?: string;
  roomUsersArtwork: string;
  children?: ReactNode;
}
/** Dedicated lobby skeleton from main lobby.html43–105, without home brand/footer. */
export function LobbySurface({masthead, onGuide, onNetwork, networkRunning = false, connectionWarning, membership, notice, roomTools, roomList, hasRooms, loading, emptyState, roomCount, connectionNote, roomUsersArtwork, children, ...rail}: LobbySurfaceProps) {
  const {t} = useLocale();
  const testProduct = ['th08mp', 'th09mp', 'th10mp'].includes(rail.selectedProduct ?? '');
  return <><main className="lobby-main" inert={rail.interactive === false}>
    {masthead}
    <aside className="lobby-survey-notice" aria-label={t('notice.label')}>
      <strong>{t('lobby.surveyNotice')}</strong><a className="lobby-button lobby-primary" href="https://v.wjx.cn/vm/QqmTdwh.aspx#" target="_blank" rel="noopener noreferrer">{t('lobby.surveyAction')}</a>
    </aside>
    <header className="lobby-intro"><h1>{t('lobby.title')}</h1><nav className="lobby-support-links" aria-label={t('multiplayerGuide.title')}>
      <button className="lobby-support-link" id="lobbyGuideOpen" type="button" disabled={!onGuide} onClick={onGuide ?? undefined}><span>{t('multiplayerGuide.action')}</span><span aria-hidden="true">›</span></button>
      <button className={`lobby-support-link${networkRunning ? " running" : ""}`} id="lobbyNetworkCheck" aria-disabled={networkRunning ? "true" : undefined} type="button" disabled={!onNetwork} onClick={onNetwork ?? undefined}><span>{t('networkCheck.action')}</span><span aria-hidden="true">›</span></button>
    </nav></header>
    {connectionWarning}
    <p className="lobby-notice" id="notice" role="status" hidden={!notice}>{notice}</p>
    {membership}
    <section className="main library-layout lobby-library" aria-label={t('lobby.game')}><LibraryCards {...rail} variant="lobby"/></section>
    <p className="lobby-test-notice" id="gameTestNotice" role="status" hidden={!testProduct}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10.3 4.7 2.8 18a2 2 0 0 0 1.7 3h15a2 2 0 0 0 1.7-3L13.7 4.7a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4m0 4h.01"/></svg><span>{t('lobby.testStageHint')}</span></p>
    <header className="lobby-room-tools"><div className="lobby-actions">{roomTools}</div></header>
    <section className="lobby-list-surface" aria-label={t('lobby.rooms')}>
      <div className="lobby-list-head" id="listHead" aria-hidden="true" hidden={!hasRooms}><span>{t('lobby.gameAndRoom')}</span><span>{t('lobby.difficulty')}</span><span/><span>{t('lobby.capacity')}</span><span>{t('lobby.state')}</span><span/></div>
      <div className="lobby-room-list" id="roomList" role="list" aria-busy={loading}>{roomList}</div>
      <div className="lobby-list-loading" id="listLoading" role="status" hidden={!loading}><i className="lobby-preload-spinner" aria-hidden="true"/><span className="lobby-sr-only">{t('lobby.loadingHint')}</span></div>
      {emptyState && <div className="lobby-empty" id="emptyState"><img src={roomUsersArtwork} alt="" width="36" height="36"/><h2 id="emptyTitle">{emptyState.title}</h2><p id="emptyHint">{emptyState.hint}</p>{emptyState.action && <button className="lobby-button" id="emptyAction" type="button" onClick={emptyState.action.onClick}>{emptyState.action.label}</button>}</div>}
    </section>
    <p className="lobby-notice" id="connectionNote" role="status" hidden={!connectionNote}>{connectionNote}</p>
    <p className="lobby-sr-only" id="roomCount" aria-live="polite">{roomCount}</p>
  </main>{children}</>;
}
