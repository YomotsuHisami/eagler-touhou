import {useLocale} from '../../i18n';
import type {RoomOwnerSnapshot} from '../../services/multiplayer-room';
import type {RoomNetworkPresentation, RoomViewContext} from './types';
import {networkMessage, roomPresentation} from './presentation';
export function RoomNetwork({state, network, context, peerId, hidden}: {state: RoomOwnerSnapshot; network: RoomNetworkPresentation; context: RoomViewContext; peerId?: string; hidden: boolean}) {
  const {t} = useLocale(), presentation = roomPresentation(state, t);
  if (!presentation) return null;
  const {room, label} = presentation, message = networkMessage(state, context, t), capabilities = network.capabilities();
  const peers = (room.seats || []).slice(0, room.playerCount).flatMap((seat, index) => seat && index !== state.seat && (!peerId || peerId === seat.clientId) ? [{seat, index}] : []);
  const note = t(!state.connected || !room.synced ? 'room.networkNote' : !capabilities.supported ? 'room.probeUnsupported' : !capabilities.rtcAvailable ? 'room.rtcUnavailable' : !capabilities.turnConfigured ? 'room.turnUnconfigured' : 'room.networkNote');
  return <section className="mp-room-network" data-room-panel="network" aria-labelledby="mpNetworkTitle" hidden={hidden}>
    <header><div><h3 id="mpNetworkTitle">{t('room.network')}</h3><p>{t('room.networkHint')}</p></div><button id="mpRoomNetworkRetry" type="button" disabled={!!message} onClick={() => network.retry(peerId)}>{t('room.retry')}</button></header>
    <div id="mpRoomNetworkRows">{message || !peers.length ? <p className="mp-network-empty">{message || t('room.peerLeft')}</p> : peers.map(({seat, index}) => <div className="mp-network-peer" key={seat.clientId}>
      <div className="mp-network-peer-name"><span>{t('multiplayer.you')} → P{index + 1}</span><strong>{label(seat.loadout)}</strong></div>
      {(['direct', 'turn', 'relay'] as const).map(lane => {const metric = network.metric(seat.clientId, lane), measured = !seat.offline && metric.state === 'connected' && metric.rtt != null; return <div key={lane} className="mp-network-metric" data-quality={measured ? metric.rtt! < 100 ? 'good' : metric.rtt! < 200 ? 'fair' : 'poor' : 'unknown'}><span>{t(`room.${lane}`)}</span><strong>{measured ? `${Math.max(1, Math.round(metric.rtt!))} ms` : t(seat.offline || metric.state === 'unavailable' ? 'room.unavailable' : 'room.checking')}</strong><small>{measured && metric.jitter != null ? t('room.jitter', {value: Math.round(metric.jitter)}) : '—'}</small></div>;})}
    </div>)}</div><p className="mp-network-footnote">{note}</p>
  </section>;
}
