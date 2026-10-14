import {useLocale} from '../../i18n';
import {InlineRoomJoin} from './InlineRoomJoin';

/** Shared original lobby.html room actions, including its disabled boot state. */
export function LobbyRoomTools({disabled, onCreate, onJoin, onRefresh, showRefresh = true, codeLabel, returnToRoom, returnDisabled, inlineJoin}: {
  disabled: boolean; returnToRoom?: () => void; returnDisabled?: boolean; showRefresh?: boolean; codeLabel?: string; onCreate?: () => void; onJoin?: () => void; onRefresh?: () => void;
  inlineJoin?: {busy: boolean; error: string; onJoin(code: string): void; onCancel(): void};
}) {
  const {t} = useLocale();
  return <><button className="lobby-button lobby-primary" id="createButton" type="button" disabled={returnToRoom ? returnDisabled : disabled} onClick={returnToRoom ?? onCreate}>{t(returnToRoom ? 'room.returnRetained' : 'lobby.create')}</button>{inlineJoin
    ? <InlineRoomJoin {...inlineJoin} disabled={disabled} label={codeLabel ?? t('lobby.byCode')}/>
    : <button className="lobby-button lobby-secondary" id="codeButton" type="button" disabled={disabled} onClick={onJoin}>{codeLabel ?? t('lobby.byCode')}</button>}{showRefresh && <button className="lobby-button lobby-refresh" id="refreshRooms" type="button" aria-label={t('lobby.refresh')} onClick={onRefresh}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 7v5h-5M20 12a8 8 0 1 0-2.3 5.7M20 7l-2.3-2.3"/></svg></button>}</>;
}
