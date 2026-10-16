import {defaultTh15ChapterThreshold} from "../../../src/launcher/th15-chapter-reward.mts";
import type {RoomOwnerSnapshot, MultiplayerRoomService} from '../../services/multiplayer-room';
import {useLocale} from '../../i18n';
import {RoomChoiceGroup} from './RoomChoiceGroup';
import {roomPresentation} from './presentation';
import {MainSelect} from '../launcher/MainSelect';
import {multiplayerInputTimingPolicy} from '../../../src/contracts/product-catalog.mts';
const difficulties = ['Easy', 'Normal', 'Hard', 'Lunatic', 'Extra', 'Phantasm'];
export function RoomGameSettings({state, service, hidden}: {state: RoomOwnerSnapshot; service: MultiplayerRoomService; hidden: boolean}) {
  const {t} = useLocale(), {room, ready, owner, config} = roomPresentation(state, t)!;
  const policy = config.inputTiming, measured = !!policy?.measuredStartup;
  const advice = service.timingRecommendation();
  const automatic = t(measured ? room.phase !== 'lobby' ? room.timing ? 'room.inputDelayMeasured' : 'room.inputDelayMeasuring' : 'room.inputDelayMeasure'
    : 'room.inputDelayAutomatic', {frames: measured ? room.inputDelay ?? 0 : advice.inputDelay, milliseconds: (advice.inputDelay * 16.67).toFixed(2)});
  const timingPolicy = multiplayerInputTimingPolicy(config);
  const rollback = timingPolicy.rollback && state.rollbackEnabled;
  const fixedZero = rollback && !timingPolicy.manualRollbackDelay;
  const selected = room.phase !== 'lobby' ? room.inputDelayAuto ? 'auto' : String(room.inputDelay || 0) : fixedZero || rollback && state.timingChoice === 'auto' ? '0' : String(state.timingChoice);
  const rule = (kind: 'cheat' | 'challenge') => {const selected = kind === 'cheat' ? !!room.disableCheatMovement : !!room.challengeMode, hintId = kind === 'cheat' ? 'mpRoomCheatHint' : 'mpRoomChallengeHint'; return <div className="mp-room-rule-setting"><button className={`mp-room-rule-tag${selected ? ' selected' : ''}`} type="button" data-room-rule={kind} aria-pressed={selected} aria-describedby={hintId} disabled={!ready || !owner || room.phase !== 'lobby'} onClick={() => service.setRoomSettings(kind === 'cheat' ? {disableCheatMovement: !selected} : {challengeMode: !selected})}><span>{t(kind === 'cheat' ? 'lobby.noCheat' : 'room.challengeMode')}</span><span className="mp-room-rule-state" data-room-rule-state="">{t(selected ? 'room.modeOn' : 'room.modeOff')}</span></button><p className="mp-room-rule-hint" id={hintId}>{t(kind === 'cheat' ? 'room.cheatHint' : 'room.challengeHint')}</p></div>;};
  return <section className="mp-room-settings" data-room-panel="game" id="mpRoomSettings" hidden={hidden}>
    <RoomChoiceGroup title={t('room.visibility')} valueAttribute="data-room-visibility" choices={(['public', 'private'] as const).map(visibility => {
      const selected = visibility === (room.visibility || 'public');
      return {value: visibility, label: t(`room.${visibility}`), selected, disabled: !ready || !owner || room.phase !== 'lobby' || selected};
    })} onSelect={visibility => service.setRoomSettings({visibility})}/><p className="mp-room-settings-hint">{t('room.privateHint')}</p>
    {rule('cheat')}<div id="mpRoomRuleModes" hidden={config.gameplay !== 'cooperative'}>{rule('challenge')}</div>
    {state.product === 'th15mp' && <section className="mp-room-rule-setting" id="mpTh15ChapterSetting">
      <label htmlFor="mpTh15ChapterThreshold">{t('room.th15ChapterThreshold')}</label>
      <MainSelect className="option-select" id="mpTh15ChapterThreshold" aria-describedby="mpTh15ChapterGraze" value={String(room.chapterThreshold ?? defaultTh15ChapterThreshold(room.playerCount))} disabled={!ready || !owner || room.phase !== 'lobby'} onChange={event => service.setRoomSettings({chapterThreshold:Number(event.currentTarget.value)})}>
        {Array.from({length:19},(_,index)=>500000+index*250000).map(value=><option key={value} value={value}>{value.toLocaleString()}</option>)}
      </MainSelect>
      <p className="mp-room-rule-hint" id="mpTh15ChapterGraze">{t('room.th15ChapterGraze',{count:(room.chapterThreshold ?? defaultTh15ChapterThreshold(room.playerCount))/5000})}</p>
    </section>}
    <section className="mp-room-rule-setting" id="mpInputDelaySetting" hidden={!policy}>
      <div className="mp-room-settings-hint"><label htmlFor="mpInputDelay">{t('room.inputDelay')}</label></div>
      <MainSelect className="option-select" id="mpInputDelay" value={selected} disabled={fixedZero || !ready || !owner || room.phase !== 'lobby'} data-trigger-i18n={room.phase === 'lobby' && !owner ? 'room.inputDelayHost' : undefined} onChange={event => service.setTimingChoice(event.currentTarget.value === 'auto' ? 'auto' : Number(event.currentTarget.value))}>
        <option value="auto" disabled={rollback && timingPolicy.manualRollbackDelay}>{automatic}</option>
        {Array.from({length: (policy?.manualDelayLimit ?? 8) + 1}, (_, value) => <option key={value} value={value}>{value}f</option>)}
      </MainSelect>
      {timingPolicy.manualRollbackDelay && <p className="mp-room-settings-hint">{t('room.manualDelayHint')}</p>}
    </section>
    <RoomChoiceGroup title={t('multiplayer.players')} name="playerCount" valueAttribute="data-mp-player-count" choices={([2, 3] as const).map(playerCount => {
      const supported = config.playerCounts.includes(playerCount), selected = playerCount === room.playerCount;
      return {value: playerCount, label: `${playerCount}P`, selected, hidden: !supported, disabled: !supported || !ready || !owner || selected};
    })} onSelect={playerCount => service.setRoomSettings({playerCount})}/>
    {config.inGameSelection ? <p className="mp-room-settings-hint">{t('room.inGameSelectionHint')}</p> : <RoomChoiceGroup title={<><span>{t('multiplayer.difficulty')}</span> <strong id="mpRoomDifficultyText">{config.difficulties[room.difficulty] || 'Normal'}</strong></>} name="difficulty" valueAttribute="data-mp-difficulty" choices={difficulties.map((label, difficulty) => {
      const supported = difficulty < config.difficulties.length, selected = difficulty === room.difficulty;
      return {value: difficulty, label, selected, hidden: !supported, disabled: !supported || !ready || !owner || selected};
    })} onSelect={difficulty => service.setRoomSettings({difficulty})}/>}
    <div className="mp-room-native-selects" aria-hidden="true"><select className="option-select" id="mpRoomPlayerCount" value={room.playerCount} disabled={!ready || !owner} onChange={event => service.setRoomSettings({playerCount: Number(event.target.value) as 2 | 3})}>{([2, 3] as const).map(count => <option key={count} value={count} hidden={!config.playerCounts.includes(count)} disabled={!config.playerCounts.includes(count)}>{count}P</option>)}</select><select className="option-select" id="mpRoomDifficulty" value={room.difficulty} disabled={config.inGameSelection || !ready || !owner} onChange={event => service.setRoomSettings({difficulty: Number(event.target.value)})}>{difficulties.map((label, index) => <option key={index} value={index} hidden={index >= config.difficulties.length} disabled={index >= config.difficulties.length}>{label}</option>)}</select></div>
    <p className="mp-room-settings-hint" id="mpRoomSettingsHint">{t(owner ? 'multiplayer.ownerLocalHint' : !room.seats?.[0] ? 'room.hostAvailable' : 'multiplayer.ownerRemoteHint')}</p><button id="mpTakeHostSeat" type="button" hidden={!!room.seats?.[0] || owner} disabled={!ready || room.phase !== 'lobby'} onClick={() => {void service.takeSeat(0);}}>{t('room.takeHostSeat')}</button>
  </section>;
}
