import {useLayoutEffect, useRef, useSyncExternalStore, type ReactNode} from 'react';
import {useLocale} from '../../i18n';
import type {TitleNetworkModel} from '../../models/title-network';
/** Original index1080–1090. The same room owner supplies the room slot. */
export function TitleNetworkOverlay({model, room}: {model: TitleNetworkModel; room?: ReactNode}) {
  const {t} = useLocale(), state = useSyncExternalStore(model.subscribe, model.getSnapshot, model.getSnapshot);
  const create = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {if (state.open && !state.room) create.current?.focus();}, [state.focusRequest]);
  return <section className="th09-network-dialog" id="th09NetworkDialog" role="dialog" aria-modal="true" aria-label={t('multiplayer.th09DialogTitle')} hidden={!state.open}>
    <div className="th09-network-window">
      <div id="th09NetworkEntry" hidden={state.room}>
        <header><strong>{t('multiplayer.th09DialogTitle')}</strong><button type="button" id="th09NetworkClose" aria-label={t('action.close')} onClick={() => model.close(true)}>×</button></header>
        <p>{t('multiplayer.th09DialogHint')}</p>
        <div className="th09-network-actions"><button ref={create} type="button" id="th09NetworkCreate" onClick={model.create}>{t('multiplayer.createRoom')}</button><label><span>{t('multiplayer.roomCode')}</span>{' '}<input id="th09NetworkCode" maxLength={4} inputMode="numeric" autoComplete="off" spellCheck={false} placeholder="0000" value={state.code} onChange={event => model.setCode(event.currentTarget.value)}/></label><button type="button" id="th09NetworkJoin" onClick={model.join}>{t('multiplayer.joinRoom')}</button></div>
      </div>
      <div id="th09NetworkRoom" hidden={!state.room}>{room}</div>
    </div>
  </section>;
}
