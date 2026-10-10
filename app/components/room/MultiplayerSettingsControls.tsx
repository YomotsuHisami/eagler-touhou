import {useSyncExternalStore} from 'react';
import {multiplayerConfigForProduct, type MultiplayerProductId} from '../../../src/contracts/product-catalog.mts';
import type {MultiplayerRoomService} from '../../services/multiplayer-room';
import {useLocale} from '../../i18n';
import {LaunchActions} from '../launcher/LaunchActions';
import {MainSelect} from '../launcher/MainSelect';

export interface MultiplayerSettingsControlsProps {
  product: MultiplayerProductId;
  service: MultiplayerRoomService;
  onReplayViewer(): void | Promise<void>;
  onImport(): void;
}
/** Main index382–395 and app7950–7960/8117–8147. This is the slot in the
 * one SettingsBody, so these native controls move with the original MP fold. */
export function MultiplayerSettingsControls({product, service, onReplayViewer, onImport}: MultiplayerSettingsControlsProps) {
  const {t} = useLocale(), state = useSyncExternalStore(service.subscribe, service.getSnapshot, service.getSnapshot);
  const policy = multiplayerConfigForProduct(product)?.inputTiming;
  const room = state.product === product ? state.room : null;
  const ready = !!room?.synced && state.connected, owner = !!room?.synced && state.seat === 0;
  const measured = !!policy?.measuredStartup;
  const advice = room ? service.timingRecommendation() : null;
  const automatic = !room ? t('room.inputDelayRecommended') : t(measured
    ? room.phase && room.phase !== 'lobby' ? room.timing ? 'room.inputDelayMeasured' : 'room.inputDelayMeasuring' : 'room.inputDelayMeasure'
    : 'room.inputDelayAutomatic', {frames: measured ? room.inputDelay ?? 0 : advice!.inputDelay, milliseconds: ((advice?.inputDelay ?? 0) * 16.67).toFixed(2)});
  const selected = room?.phase && room.phase !== 'lobby' ? room.inputDelayAuto ? 'auto' : String(room.inputDelay || 0) : String(room ? state.timingChoice : 'auto');
  return <>
    <section className="item feature-section feature-language mp-setting-item" id="mpInputDelaySetting" hidden={!policy || !room}>
      <div className="itemtop"><label htmlFor="mpInputDelay">{t('room.inputDelay')}</label></div>
      <MainSelect className="option-select" id="mpInputDelay" value={selected} disabled={!ready || !owner || room?.phase !== 'lobby'} data-trigger-i18n={room?.phase === 'lobby' && !owner ? 'room.inputDelayHost' : undefined} onChange={event => service.setTimingChoice(event.currentTarget.value === 'auto' ? 'auto' : Number(event.currentTarget.value))}>
        <option value="auto">{automatic}</option>
        {Array.from({length: (policy?.manualDelayLimit ?? 8) + 1}, (_, value) => <option key={value} value={value}>{value}f</option>)}
      </MainSelect>
    </section>
    <LaunchActions placement="compact" primary={{id: 'mpReplayViewer', label: t('action.watchReplay'), onClick: () => {void onReplayViewer();}}}
      secondary={{id: 'mpGamePackageImport', label: t('action.import'), onClick: onImport}}/>
  </>;
}
