import {useSyncExternalStore} from 'react';
import type {GameplayNetworkSnapshot} from '../models/gameplay-network';
import {calibrationConnectionCopy, type NetplayCalibration} from '../models/netplay-calibration';

/** Original one connection window. Calibration replaces its contents only when
 * the authenticated native network model declares the original override guard. */
export function NetplayConnectionWindow({network, calibration, english, onReturn}: {
  network: GameplayNetworkSnapshot; calibration: NetplayCalibration; english: boolean; onReturn(): void;
}) {
  const measured = useSyncExternalStore(calibration.subscribe, calibration.getSnapshot, calibration.getSnapshot);
  const progress = network.calibrationEligible ? measured.connection : null;
  const ready = progress?.phase === 'ready', copy = progress ? calibrationConnectionCopy(progress, english) : null;
  const view = network.connection;
  const details = progress?.calibration && typeof progress.calibration === 'object' ? progress.calibration as Record<string, unknown> : null;
  const players = Array.isArray(details?.players) ? details.players as Record<string, unknown>[] : [];
  const hidden = !progress && (!view || view.hidden);
  return <section className={`netplay-connection-window${!progress && view?.reconnecting ? ' reconnecting' : ''}`}
    id="netplayConnectionWindow" role="status" aria-live="assertive" hidden={hidden} data-calibration={progress ? String(progress.phase) : undefined}>
    <header><strong id="netplayConnectionTitle" role={progress ? 'status' : undefined} aria-live={progress ? 'polite' : undefined}>{copy?.title ?? view?.title ?? ''}</strong></header>
    <p id="netplayConnectionSummary" hidden={!progress && !view?.summary}>{ready && copy ? <><span>{copy.delay}</span><span>{copy.rollback}</span></> : copy?.summary ?? view?.summary ?? ''}</p>
    <div className="netplay-connection-peers" id="netplayConnectionPeers">
      {progress ? ready && copy ? <table className="netplay-calibration-table"><thead><tr>{copy.columns.map(text => <th scope="col" key={text}>{text}</th>)}</tr></thead>
        <tbody>{players.filter(player => player && Number(player.samples)).map((player, index) => <tr key={index}><th scope="row">P{Number(player.player) + 1}</th>
          <td>{(Number(player.p95Us) / 1000).toFixed(2)} ms</td><td>{(Number(player.maxUs) / 1000).toFixed(2)} ms</td></tr>)}</tbody></table>
        : progress.phase !== 'unavailable' && <progress id="netplayCalibrationProgress" max={129}
          value={progress.phase === 'measuring' ? Number(progress.probes ?? 0) : undefined} aria-label={copy?.title}/>
        : view?.peerRows.map(row => <div className="netplay-connection-peer" key={row.player}><span>P{row.player + 1}</span><span>{row.status}</span></div>)}
    </div>
    <p className="netplay-connection-note" id="netplayConnectionNote" hidden={!ready || players.length !== 3}>{ready && players.length === 3 ? copy?.note : ''}</p>
    {ready ? <button id="netplayCalibrationDismiss" type="button" onClick={calibration.dismiss}>{copy?.dismiss}</button>
      : (progress || network.returnToRoom) && !hidden && <button id="netplayConnectionReturn" type="button" onClick={onReturn}>{english ? 'Return to room' : '返回房间'}</button>}
  </section>;
}
