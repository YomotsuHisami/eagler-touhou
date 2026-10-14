import type {ScoreStatistics} from '../../models/score-statistics';
import type {SaveLibraryModel} from '../../models/save-library';
import {SaveChoice} from './SaveChoice';
import {ScorePanel} from './ScorePanel';
import type {ReactNode} from 'react';
import {useLocale} from '../../i18n';
import {useSurfaceNavigation} from '../../navigation/surface-navigation';
import type {LibraryProduct} from './products';
import {AppLink} from './AppLink';

/** Persistent information surface; native game and file owners remain with the host. */
export function GameWorkspace({product, scores, saveLibrary, scoreLanguage = 'ja', assetUrl = path => path, actions, renderActions, multiplayerOnline, multiplayerDiagnostics, multiplayerHref, onFiles, onSettings}: {
  saveLibrary?: SaveLibraryModel; scores?: ScoreStatistics; scoreLanguage?: string; assetUrl?: (path: string) => string; product: LibraryProduct; actions?: ReactNode; renderActions?(middle: ReactNode): ReactNode; multiplayerOnline?: ReactNode; multiplayerDiagnostics?: ReactNode; multiplayerHref?: string; onFiles(): void; onSettings(): void;
}) {
  const {t} = useLocale(), navigation = useSurfaceNavigation();
  const notice = !product.multiplayer && product.adaptationNotice ? <details className="tools-callout" id="gameNoticeCallout"><summary>{t('options.adaptation')}</summary><p>{t('gameNotice.earlyTest')}</p><a href={product.sourceRepository} target="_blank" rel="noopener noreferrer">{t('gameNotice.repo')}</a></details> : null;
  const multiplayerAction = multiplayerHref ? <AppLink className="launch launch-multiplayer" id="optionsLobbyLink" href={multiplayerHref} preventScrollReset><span className="launch-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M22 21v-2a4 4 0 0 0-3-3.9"/><circle cx="9" cy="7" r="4"/><path d="M16 3.1a4 4 0 0 1 0 7.8"/></svg></span>{t('workspace.multiplayer')}</AppLink> : null;
  return <aside className="tools workspace-panel game-workspace" aria-labelledby="gameTitle" aria-hidden="false" onKeyDown={event => {if (event.key === 'Escape' && !event.defaultPrevented) {event.preventDefault(); navigation.closeSurface();}}}>
    <div className="workspace-toolbar"><button id="scoreFilesOpen" type="button" aria-controls="scoreFilesDialog" onClick={onFiles}>{t('workspace.files')}</button>{saveLibrary && <SaveChoice model={saveLibrary} product={product.id} language={scoreLanguage} onFiles={onFiles}/>}<button className="workspace-game-settings" type="button" aria-controls="globalSettingsDialog" onClick={onSettings}>{t('settings.gameTitle')}</button></div>
    {scores ? <ScorePanel model={scores} product={product} language={scoreLanguage} assetUrl={assetUrl} notice={notice}/> : <section className="workspace-game-info"><span id="gameId" className="visually-hidden" data-game={product.gameId}>{product.gameId.toUpperCase()}</span><p className="workspace-game-number" aria-hidden="true">{product.number}</p><h2 id="gameTitle">{product.title}</h2><p className="workspace-game-subtitle">{product.subtitle}</p><p className="workspace-game-hint">{t('workspace.readyHint')}</p></section>}
    {product.multiplayer && <section className="mp-shell workspace-multiplayer" id="mpShell">{multiplayerOnline}{multiplayerDiagnostics}</section>}
    {!scores && notice}
    <div className="workspace-launch-footer">{renderActions ? renderActions(multiplayerAction) : <>{actions}{multiplayerAction}</>}</div>
  </aside>;
}
