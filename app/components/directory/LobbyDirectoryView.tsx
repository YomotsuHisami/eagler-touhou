import {useSyncExternalStore} from 'react';
import {useLocale} from '../../i18n';
import {LobbySurface, type LobbySurfaceProps} from '../launcher/LobbySurface';
import {DirectoryRoomRows} from './DirectoryRoomRows';
import {LobbyRoomTools} from './LobbyRoomTools';
import type {DirectoryFormMode, LobbyDirectoryService} from '../../services/lobby-directory';

type Derived = 'selectedProduct' | 'connectionWarning' | 'membership' | 'notice' | 'roomTools' | 'roomList' | 'hasRooms' | 'loading' | 'emptyState' | 'roomCount' | 'connectionNote' | 'roomUsersArtwork';
export interface LobbyDirectoryViewProps extends Omit<LobbySurfaceProps, Derived> {
  service: LobbyDirectoryService;
  assetUrl(path: string): string;
  /** The owner prepares the model then opens the original same-URL form entry. */
  onOpenForm(mode: DirectoryFormMode): void;
  initialRows?: boolean;
}
/** Original lobby.mts349–385 render conditions, composed once in LobbySurface. */
export function LobbyDirectoryView({service, assetUrl, onOpenForm, initialRows = false, ...surface}: LobbyDirectoryViewProps) {
  const {t} = useLocale(), state = useSyncExternalStore(service.subscribe, service.getSnapshot, service.getSnapshot);
  const disabled = state.connection !== 'live' || !!state.mine || state.leaving || !state.products.length;
  const warning = <aside className="lobby-warning lobby-connection-warning" id="connectionWarning" role="alert" hidden={!state.connectionInterrupted}>
    <div><strong><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10.3 4.7 2.8 18a2 2 0 0 0 1.7 3h15a2 2 0 0 0 1.7-3L13.7 4.7a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4m0 4h.01"/></svg><span id="connectionWarningTitle">{t(state.connection === 'unsupported' ? 'lobby.unsupported' : state.rooms.length ? 'lobby.disconnected' : 'lobby.offline')}</span></strong><p id="connectionWarningHint">{t(state.connection === 'unsupported' ? 'lobby.unsupportedHint' : state.connection === 'missing' ? 'lobby.noService' : 'lobby.refreshHint')}</p></div>
    <button className="lobby-button" id="connectionRefresh" type="button" onClick={service.retry}>{t('lobby.refresh')}</button>
  </aside>;
  const membership = <aside className="lobby-membership" id="membership" hidden={!state.mine}><strong id="membershipTitle">{state.mine ? t('lobby.mine', {code: state.mine.code}) : ''}</strong><p id="membershipHint">{t(state.supportsRecovery ? 'lobby.mineHint' : 'lobby.releaseUnsupported')}</p><button className="lobby-button" id="releaseMembership" type="button" hidden={!state.mine || !state.supportsRecovery} disabled={!!state.recovering || state.connection !== 'live' || state.leaving || !state.mine?.recoveryToken} onClick={service.releaseMembership}>{t(state.recovering ? 'lobby.releasing' : 'lobby.release')}</button></aside>;
  const roomTools = <LobbyRoomTools disabled={disabled} onCreate={() => onOpenForm('create')} onJoin={() => onOpenForm('join')} onRefresh={service.refreshRooms}/>;
  const empty = state.loading || state.visibleRooms.length || state.connectionInterrupted ? null : {
    title: t(state.connection === 'live' ? 'lobby.empty' : state.connection === 'loading' ? 'lobby.connecting' : state.connection === 'unsupported' ? 'lobby.unsupported' : 'lobby.offline'),
    hint: t(state.connection === 'live' ? 'lobby.emptyHint' : state.connection === 'loading' ? 'lobby.loadingHint' : state.connection === 'unsupported' ? 'lobby.unsupportedHint' : state.connection === 'missing' ? 'lobby.noService' : 'lobby.offlineHint'),
    action: state.connection === 'loading' || (state.connection === 'live' && !!state.mine) ? undefined : {label: t(state.connection === 'live' ? 'lobby.create' : 'lobby.retry'), onClick: () => state.connection === 'live' ? onOpenForm('create') : service.retry()},
  };
  return <LobbySurface {...surface} selectedProduct={state.selectedProduct} connectionWarning={warning} membership={membership} notice={state.notice} roomTools={roomTools}
    roomList={<DirectoryRoomRows snapshot={state} service={service} assetUrl={assetUrl} initialRows={initialRows}/>}
    hasRooms={!!state.visibleRooms.length} loading={state.loading} emptyState={empty} roomCount={state.loading ? '' : t('lobby.roomCount', {count: state.visibleRooms.length})}
    connectionNote={state.connection === 'live' && state.total > state.rooms.length ? t('lobby.truncated', {count: state.rooms.length}) : undefined} roomUsersArtwork={assetUrl('assets/room-users.svg')}/>;
}
