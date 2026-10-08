/** Multiplayer Replay presentation, separate from room/server launch controls. */
export const multiplayerReplayUiEntries = [
  ['ui.multiplayerReplay.title', '联机 Replay 查看器', 'Multiplayer Replay viewer'],
  ['ui.multiplayerReplay.hint', '点击打开即可准备并启动联机 Runtime，进入游戏后再选择 Replay。', 'Select Open once to prepare and start the multiplayer Runtime, then choose Replay in the game menu.'],
  ['ui.multiplayerReplay.loading', '正在载入 Replay 查看器…', 'Loading the Replay viewer…'],
  ['ui.multiplayerReplay.prepare', '准备 Replay 查看器', 'Prepare Replay viewer'],
  ['ui.multiplayerReplay.preparing', '正在准备 {game} Replay 查看器…', 'Preparing the {game} Replay viewer…'],
  ['ui.multiplayerReplay.ready', '{game} Replay 查看器已就绪', '{game} Replay viewer is ready'],
  ['ui.multiplayerReplay.open', '打开 Replay 查看器', 'Open Replay viewer'],
  ['ui.multiplayerReplay.starting', '正在打开 Replay 查看器…', 'Opening the Replay viewer…'],
  ['ui.multiplayerReplay.unavailable', 'Replay 查看器暂不可用：{reason}', 'Replay viewer unavailable: {reason}'],
  ['ui.multiplayerReplay.resources', '导入或管理游戏资源', 'Import or manage game resources'],
  ['ui.multiplayerReplay.importHint', '缺少资源时可先导入游戏资源，再返回此页重试打开；此入口会保留联机 Replay 模式。', 'If resources are missing, import them, then return here and select Open again. This entry keeps multiplayer Replay mode.'],
  ['ui.multiplayerReplay.closeCurrent', '请先保存并关闭当前 Runtime，再准备 Replay 查看器。', 'Save and close the current Runtime before preparing the Replay viewer.'],
  ['ui.multiplayerReplay.leaveRoom', '请先退出当前联机房间，再打开 Replay 查看器。', 'Leave the current multiplayer room before opening the Replay viewer.'],
  ['ui.multiplayerReplay.waiting', '正在等待作品设置与资源信息…', 'Waiting for game settings and resource information…'],
] as const;
