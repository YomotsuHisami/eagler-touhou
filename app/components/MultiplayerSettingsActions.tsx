import {useId} from 'react';
import {multiplayerConfigForProduct, type MultiplayerProductId} from '../../src/contracts/product-catalog.mts';
import {useLocale} from './LocaleProvider';
import {MultiplayerReplayViewer} from './MultiplayerReplayViewer';
import {useMultiplayerRoom} from './MultiplayerRoomProvider';
import {settingsControlClass} from './TouchSettingsFields';

export function MultiplayerSettingsActions({productId}: {productId: MultiplayerProductId}) {
  return <><MultiplayerSettingsTiming productId={productId}/><MultiplayerReplayViewer productId={productId} compact/></>;
}

function MultiplayerSettingsTiming({productId}: {productId: MultiplayerProductId}) {
  const {t} = useLocale();
  const {controller, snapshot} = useMultiplayerRoom();
  const id = useId();
  const policy = multiplayerConfigForProduct(productId)?.inputTiming;
  if (!policy || !snapshot?.room || snapshot.route?.productId !== productId) return null;
  const room = snapshot.room, host = room.seats[0]?.clientId === snapshot.clientId, waiting = room.phase === 'lobby';
  const value = waiting ? host ? snapshot.timingChoice.inputDelay : 'auto' : room.inputDelayAuto ? 'auto' : room.inputDelay;
  return <div className="game-settings-select-item game-settings-mp-delay">
    <label htmlFor={`${id}-input-delay`}>{t('room.inputDelay')}</label>
    <select id={`${id}-input-delay`} className={settingsControlClass} value={value} disabled={!controller || !host || !waiting} onChange={event => {
      controller?.setTimingChoice({...snapshot.timingChoice, inputDelay: event.currentTarget.value === 'auto' ? 'auto' : Number(event.currentTarget.value)});
    }}>
      <option value="auto">{t(!host && waiting ? 'room.inputDelayHost' : 'room.inputDelayRecommended')}</option>
      {Array.from({length: (policy.manualDelayLimit ?? 8) + 1}, (_, index) => <option key={index} value={index}>{index}f</option>)}
    </select>
  </div>;
}
