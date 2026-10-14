import {useLocale} from '../../i18n';
import type {MultiplayerRoomService, RoomOwnerSnapshot} from '../../services/multiplayer-room';

/** Same preparation stream as main's RoomProgress, including peer reports. */
export function RoomSeatProgress({state, index, service, onDevice}: {state: RoomOwnerSnapshot; index: number; service: MultiplayerRoomService; onDevice(element: HTMLElement): void}) {
  const {t} = useLocale(), local = state.seat === index, seat = state.room?.seats?.[index];
  const progress = local ? state.preparation : seat?.resource;
  const status = progress?.status ?? 'preparing';
  const total = local ? state.preparation?.total : undefined;
  const measured = total && total > 0 ? (state.preparation?.loaded ?? 0) / total * 100 : progress?.percent;
  const percent = status === 'ready' ? 100 : status === 'preparing' && measured != null ? Math.max(0, Math.min(100, Math.round(measured))) : undefined;
  const offline = !state.connected || seat?.offline;
  const editing = !offline && (local ? state.editingSettings : seat?.editingSettings === true);
  const selected = local ? state.selectionConfirmed && !state.loadoutPending : seat?.selectionConfirmed === true || seat?.ready === true;
  const prepared = status === 'ready' && selected && (local ? state.ready : seat?.ready);
  const displayStatus = offline ? 'offline' : status === 'ready' ? prepared ? 'prepared' : selected ? 'loaded' : 'choosing' : status;
  const label = offline ? t('multiplayer.playerReconnecting') : editing ? t('room.editingSettings') : prepared ? t('room.ready') : status === 'ready' ? t(selected ? 'room.loaded' : local ? 'room.selectCharacter' : 'room.selectingCharacter') : status === 'failed' ? t('room.resourcesUnavailable') : status === 'cancelled' ? t('room.resourcesCancelled') : status === 'importing' ? t('package.importingSimple') : progress?.stage === 'runtime' ? t('room.preparingRuntime') : percent == null ? t('room.loading') : t('room.loadingPercent', {percent});
  const device = local ? state.localDeviceType : seat?.deviceType ?? 'unknown';
  const retry = local && !editing && (status === 'failed' || status === 'cancelled');
  const indeterminate = !offline && (status === 'importing' || status === 'preparing' && percent == null);
  return <div className="room-seat-bottom" data-status={displayStatus}>
    <div className="room-seat-capsule">
      <div className={`room-seat-progress${indeterminate ? ' indeterminate' : ''}`} role="progressbar" aria-label={`P${index+1} · ${label}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-valuetext={label}>
        <span className="room-seat-progress-fill" style={{width:`${percent ?? 0}%`}}/>
      </div>
      <span className="room-seat-progress-label" role={status === 'ready' || status === 'failed' ? 'status' : undefined}>{label}{retry && <button onClick={service.retryPreparation}>{t('room.retryDownload')}</button>}</span>
    </div>
    <button className="room-seat-device" data-device={device} aria-label={`P${index+1} · ${t(`room.device.${device}`)}`} title={t(`room.device.${device}`)} disabled={!local && (!state.connected || !!seat?.offline)} onClick={event => onDevice(event.currentTarget)}>
      <svg viewBox="0 0 24 24" aria-hidden="true">{device === 'desktop' ? <><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 21h8m-4-5v5"/></> : device === 'tablet' ? <><rect x="4" y="2" width="16" height="20" rx="3"/><path d="M11 18h2"/></> : device === 'phone' ? <><rect x="6" y="2" width="12" height="20" rx="3"/><path d="M11 18h2"/></> : <><path d="M9 8a3 3 0 1 1 5 2c-2 1-2 2-2 3m0 4v.1"/><circle cx="12" cy="12" r="10"/></>}</svg>
    </button>
  </div>;
}
