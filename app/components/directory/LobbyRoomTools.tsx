import {useLocale} from '../../i18n';

/** Shared original lobby.html room actions, including its disabled boot state. */
export function LobbyRoomTools({disabled, onCreate, onJoin, onRefresh}: {
  disabled: boolean; onCreate?: () => void; onJoin?: () => void; onRefresh?: () => void;
}) {
  const {t} = useLocale();
  return <><button className="lobby-button lobby-primary" id="createButton" type="button" disabled={disabled} onClick={onCreate}>{t('lobby.create')}</button><button className="lobby-button lobby-secondary" id="codeButton" type="button" disabled={disabled} onClick={onJoin}>{t('lobby.byCode')}</button><button className="lobby-button lobby-refresh" id="refreshRooms" type="button" aria-label={t('lobby.refresh')} onClick={onRefresh}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 7v5h-5M20 12a8 8 0 1 0-2.3 5.7M20 7l-2.3-2.3"/></svg></button></>;
}
