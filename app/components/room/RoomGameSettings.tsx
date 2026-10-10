import type {RoomOwnerSnapshot, MultiplayerRoomService} from '../../services/multiplayer-room';
import {useLocale} from '../../i18n';
import {RoomChoiceGroup} from './RoomChoiceGroup';
import {roomPresentation} from './presentation';
const difficulties = ['Easy', 'Normal', 'Hard', 'Lunatic', 'Extra', 'Phantasm'];
export function RoomGameSettings({state, service, hidden}: {state: RoomOwnerSnapshot; service: MultiplayerRoomService; hidden: boolean}) {
  const {t} = useLocale(), {room, ready, owner, config} = roomPresentation(state, t)!;
  const rule = (kind: 'cheat' | 'challenge') => {const selected = kind === 'cheat' ? !!room.disableCheatMovement : !!room.challengeMode, hintId = kind === 'cheat' ? 'mpRoomCheatHint' : 'mpRoomChallengeHint'; return <div className="mp-room-rule-setting"><button className={`mp-room-rule-tag${selected ? ' selected' : ''}`} type="button" data-room-rule={kind} aria-pressed={selected} aria-describedby={hintId} disabled={!ready || !owner || room.phase !== 'lobby'} onClick={() => service.setRoomSettings(kind === 'cheat' ? {disableCheatMovement: !selected} : {challengeMode: !selected})}><span>{t(kind === 'cheat' ? 'lobby.noCheat' : 'room.challengeMode')}</span><span className="mp-room-rule-state" data-room-rule-state="">{t(selected ? 'room.modeOn' : 'room.modeOff')}</span></button><p className="mp-room-rule-hint" id={hintId}>{t(kind === 'cheat' ? 'room.cheatHint' : 'room.challengeHint')}</p></div>;};
  return <section className="mp-room-settings" data-room-panel="game" id="mpRoomSettings" hidden={hidden}>
    <RoomChoiceGroup title={t('room.visibility')} valueAttribute="data-room-visibility" choices={(['public', 'private'] as const).map(visibility => {
      const selected = visibility === (room.visibility || 'public');
      return {value: visibility, label: t(`room.${visibility}`), selected, disabled: !ready || !owner || room.phase !== 'lobby' || selected};
    })} onSelect={visibility => service.setRoomSettings({visibility})}/><p className="mp-room-settings-hint">{t('room.privateHint')}</p>
    {rule('cheat')}<div id="mpRoomRuleModes" hidden={config.gameplay !== 'cooperative'}>{rule('challenge')}</div>
    <RoomChoiceGroup title={t('multiplayer.players')} name="playerCount" valueAttribute="data-mp-player-count" choices={([2, 3] as const).map(playerCount => {
      const supported = config.playerCounts.includes(playerCount), selected = playerCount === room.playerCount;
      return {value: playerCount, label: `${playerCount}P`, selected, hidden: !supported, disabled: !supported || !ready || !owner || selected};
    })} onSelect={playerCount => service.setRoomSettings({playerCount})}/>
    <RoomChoiceGroup title={<><span>{t('multiplayer.difficulty')}</span> <strong id="mpRoomDifficultyText">{config.difficulties[room.difficulty] || 'Normal'}</strong></>} name="difficulty" valueAttribute="data-mp-difficulty" choices={difficulties.map((label, difficulty) => {
      const supported = difficulty < config.difficulties.length, selected = difficulty === room.difficulty;
      return {value: difficulty, label, selected, hidden: !supported, disabled: !supported || !ready || !owner || selected};
    })} onSelect={difficulty => service.setRoomSettings({difficulty})}/>
    <div className="mp-room-native-selects" aria-hidden="true"><select className="option-select" id="mpRoomPlayerCount" value={room.playerCount} disabled={!ready || !owner} onChange={event => service.setRoomSettings({playerCount: Number(event.target.value) as 2 | 3})}>{([2, 3] as const).map(count => <option key={count} value={count} hidden={!config.playerCounts.includes(count)} disabled={!config.playerCounts.includes(count)}>{count}P</option>)}</select><select className="option-select" id="mpRoomDifficulty" value={room.difficulty} disabled={!ready || !owner} onChange={event => service.setRoomSettings({difficulty: Number(event.target.value)})}>{difficulties.map((label, index) => <option key={index} value={index} hidden={index >= config.difficulties.length} disabled={index >= config.difficulties.length}>{label}</option>)}</select></div>
    <p className="mp-room-settings-hint" id="mpRoomSettingsHint">{t(owner ? 'multiplayer.ownerLocalHint' : !room.seats?.[0] ? 'room.hostAvailable' : 'multiplayer.ownerRemoteHint')}</p><button id="mpTakeHostSeat" type="button" hidden={!!room.seats?.[0] || owner} disabled={!ready || room.phase !== 'lobby'} onClick={() => {void service.takeSeat(0);}}>{t('room.takeHostSeat')}</button>
  </section>;
}
