# ui-main 事件链对照记录

2026-10-09，进行中。用户明确要求：流程、事件链第一，视觉第二。
本分支的实现和旧测试均不作为正确性基准。每条事件链必须由即时 main 的源码证明。

当前 main / origin/main：`5c7ff45de236d9d5859be1e2c370f330836de7a8`，本轮再次 fetch 确认。
当前工作分支：`experiment/ui-main`，已有 WIP 提交 `039b6e0`，本轮后续修改尚未提交。
main 源码对照副本位于工作区 `artifacts/ui-main-visual-20261008/main-reference-current`。
旧 `full-audit.html/json` 是历史能力清单，不能证明本次事件链审计已经完成。

## 已找到并修改的实际偏离

| 事件链 | main 依据 | 候选原来的偏离 | 当前处理 |
| --- | --- | --- | --- |
| 进入房间的准备 | `main:src/launcher/app.mts`，`mpEnterRoom`、`prepareRoomResources` | 等服务器握手后才开始，并锁定完整语言、音乐和启动方案 | 按房间入口自动准备基础 Package，只有 Worker 可复用缓存时预缓存 Runtime。完整方案移到服务器 Start 或 Check game |
| Ready / 房主 Start | `mpReady`、`mpStartGame`、`renderMpRoom` | Ready 被 Runtime 服务门槛禁用，Start 被本机资源准备完成禁用，非房主也显示 Start | Ready 独立于资源下载。Start 仅在房主 Ready 后显示，并等待全体席位在线 Ready。取消 Ready 不再弹移动限制确认 |
| 游戏 Relay 身份 | `mpConfigureRuntimeSession`、`multiplayer-relay-url.mts` | 游戏 URL 丢失跨标签页 member ID，创建参数也偏离当前 main | 大厅和游戏传递同一 member ID，恢复 main 的 challenge / prank 参数清理与声明 |
| 服务器 Start 后的完整准备 | `mpLaunchRoomGame`、`launchConfiguredRuntimeImpl` | 使用进房间时锁住的个人设置 | 服务器 Start 时捕获当前个人设置，然后处理输入确认、播放器、更新、语言音乐、Runtime 配置 |
| 玩家宿主与全屏 | `mpLaunchRoomGame`、普通 `#launch` 点击处理 | 联机没有开局全屏请求，准备期间播放器宿主状态也不同 | 联机复用同一 Player 宿主，在完整资源准备前请求全屏。Check game 打开宿主但不自动请求全屏 |
| 首帧后的实际游戏链路 | `waitForGameplayPath`、`showRoomLaunchCover` | 只看首帧便宣称运行，不等游戏链路 | 首帧后读取同一原生 transport，等实际 RTC 双通道或 Relay。房间覆盖保留到该门槛完成；iOS 触控按 main 露出 Runtime 手势面 |
| DATA 失败与导入续接 | `isResourceLoadFailure`、`mpLaunchRoomGame`、`installImportedGameData` | 所有准备失败都弹导入；服务器已 Start 后反而没有导入续接 | DATA 获取失败才进入导入。保存房间会话、席位、member 和 startSerial，导入后恢复同一局，不再发送 Start。旧房间回调作废 |
| 普通 Start 错误恢复 | `#launch` 点击处理，`GameDataAcquisitionError` | Runtime、语言和音频失败也被当成替换 DATA | 只在 DATA 获取边界给出恢复标记，其他诊断保留。安装已有 DATA 的边界仍需继续逐项核对 |
| 更新选择顺序 | `#launch`、`maybeUpdateInstalledPackageBeforeLaunch` | 更新选择在输入确认和播放器前；更新失败终止 Start | 输入确认、播放器、全屏之后再问更新。更新失败或只取消更新，继续当前版本。取消整个 Start 仍阻止启动 |
| 联机 / Check game / Replay 更新 | `ensureRuntime(true)`、`maybeUpdateInstalledPackageBeforeLaunch` | 这些入口没有共同的当前版本更新选择 | 复用一个更新确认窗口和 Resource Manager 写入所有者。后台更新绑定已准备的原生代次 |
| OGG 起播门槛 | `ensureManagedOggStartupBarrier`、`localMusicInstall.installInitial` | 联机和多人 Replay 等全量 OGG | 只获取前两首，剩余音轨交给既有根 OGG 任务，不创建另一套任务所有者 |
| 后台任务触发点 | `launchConfiguredRuntimeImpl`，`state.launched = true` 后的任务启动，之后才等待 firstFrame | 剩余 OGG 和更新必须等首帧 | 收到原生 launch 确认就开始后台任务，允许首帧仍在等待其他玩家 |
| 受限移动写入 | `setOption` | 先保存不限速移动，再弹调整提示 | 在保存前检查当前房间、席位和规则。确认期间规则变化也重查 |
| 多人文件服务 | `ensureRuntime(false)`、文件读写入口 | 使用 Replay 准备，文件用途也带 replayViewer | 单独标识 files 用途，仍复用同一服务和 iframe，不启动游戏、不选择更新、不准备音乐或翻译 |
| DATA 导入续接的输入与全屏 | `gameDataImportInput` 成功回调，`launchConfiguredRuntimeImpl` | 普通 / 联机导入后重新提示输入并重新请求全屏。首次 import-server 续接也未正确绑定 | 单次导入续接凭据绑定当前作品和页面 / 房间局次。导入后直接启动，不重复输入提示或全屏。联机保留 Player 宿主 |
| MIDI 与 OGG 降级确认 | `confirmInputWarnings`、`mpLaunchRoomGame`、`launchConfiguredRuntimeImpl` | 联机 MIDI 确认挪到资源准备之后。普通 / 联机 OGG 降级又弹一次确认，旧测试把这个偏离当作正确行为 | MIDI 与触控在准备前确认一次。降级仅报告状态并使用既有 MIDI 所有者，不新增确认门槛 |
| 主动取消普通下载 | `#launch` 的 `isCancelledDownload` 分支、`beginGameDataAttempt` | 取消只回到 idle，没有 main 的本地导入续接 | 用户取消当前下载才给出导入续接。页面离开导致的取消不会打开旧导入或恢复启动。只取消更新则继续当前 DATA |
| Player 历史层 / Back | `openPlayerView`、`playerRouteHistoryOperation`、`closePlayerView`、`popstate` | 没有独立 Player 历史层。Back 直接离开产品 / 房间，且必须先点额外的结束确认 | Router 保存同一路径的 Player 层。第一次 Back 保存并收起 Player，保留当前产品 / 房间。下一次房间离开才释放成员。根退出所有者仍唯一 |
| 正常退出与保存失败 | `confirmRuntimeSyncBeforeClose`、`confirmRuntimeClose` | 所有正常退出先弹 End game。旧测试固化额外许可流程 | 正常退出直接保存。只在保存失败、退出失败或草稿需要决定时显示决策。失败可留在游戏、重试或明确放弃保存 |
| 保存完成与历史清理 | 上述根退出顺序 / Router 所有权 | 新 Player 层清理可能先于保存完成回调，作废成功收尾；草稿操作释放 busy 也可能盖掉随后进行的保存 | 清理等当前退出所有者完成。草稿通过后再保存 Runtime，保持 busy。旧完成不会推进已替换的目的地或服务 |
| Save / Hint 写入顺序 | `importFile`、`deleteHint`、`ensureRuntime(false)` | 先选文件再询问覆盖，成功写入后临时 Runtime 留存，错误地启动完整游戏资源 | Save 先问覆盖、再选文件。Save / Hint 同步旧会话、文件用途写入、重载验证并退役，不启动游戏 |
| Replay 管理 / 运行中修改 | `manageReplays`、Replay 导入 / 改名 / 删除分支 | Replay 改名 / 删除先关闭运行中的原生所有者。导入后额外验证或遗留临时会话 | 只允许 Replay 路径在当前所有者内修改。管理仍开着则重载列表，否则在持久化确认后退役，不额外启动 |
| 缺文件下载引导 | `exportFile` 中缺 Save / Replay 的提示 | 跳到管理页 | 原抽屉内提示后直接打开文件选择器，保留作品、查询、hash 和同一 iframe |
| 上层管理窗口 | `manageReplays` 以及文件 / 资源窗口的宿主 | 管理路由替换下层设置 / 房间，回退时重建 | 管理窗口覆盖持续存在的下层设置 / 房间。槽位按窗口层级返回，保留一个服务和成员关系 |
| 多人 Replay 的 DATA 恢复 | `mpReplayViewer`、`gameDataImportInput` | 下层卸载丢失 Replay 意图，或错误地变成普通启动 | 根保留 Replay 意图与 Player。有效导入后使用原请求，页面 / 房间变更后晚到回调不得启动 |
| 实际游戏连接状态 | `updateNetplayConnectionUi`、`returnFromNetplayConnection` | 开局校准之外没有 main 的重连 / 断线返回窗口 | 从当前原生 transport 读取连接状态，健康时恢复，返回先同步关闭原生帧并保留大厅成员 |
| Start 后的受限移动确认 | `mpEnsureMovementAllowed` | 选择只接受 lobby 阶段，服务器 Start 后无法恢复 | 决策绑定同一 startSerial，接受后重试该局，不再发送 Ready / Start |
| 空闲页面更新门槛 | `shouldDeferAppShellReload`、`launcher-lifecycle` | 所有房间关系、已完成 preparation、普通设置 / 公告的 Radix dialog 角色永久阻塞刷新 | 已就绪房间和普通面板不伪装为进行中的工作。真正的启动、导入、保存、决策和草稿仍阻塞 |
| 初始 OGG 的失败 / 取消边界 | `ensureManagedOggStartupBarrier`、`chooseDefaultMusic` | 必需 DATA 与 OGG 同批获取。远程 OGG 失败终止 Start；取消 OGG 也取消整次 Start | DATA 与可选 OGG 分开。仅取消初始 OGG 时降级继续，整次意图取消仍终止。音乐偏好保留，旧任务不能清掉新任务的取消能力 |
| 文件用途与保存的音乐偏好 | `ensureRuntime(false)` 与文件入口 | 重新求有效音乐模式时，保存的 OGG 偏好可能盖掉文件用途的 none | 文件用途明确忽略音乐 / 翻译偏好，保留偏好原值，不获取 OGG / 翻译或准备 MIDI |
| 非 hosted 资源组件 | `selectedRuntimeResources`、`installedPackageRuntimeResources` | external / import 也尝试获取未安装资源组件，并可能把组件失败当作 DATA 失败 | 非 hosted 只消费已安装组件，组件获取位于基础 DATA 的恢复边界之外 |
| 准备期 Back 与原生退出的历史层 | `openPlayerView`、`closePlayerView` | 同 URL 的 Back 可能放过旧 Start；原生普通退出留下多余历史层 | Player 记录接回原启动取消所有者。无 epoch 获取期 Back 和 Replay 导入期 Back 撤销旧意图，普通原生退出返回原设置历史条目。ready 但未 launch 的退出仍有下述缺口 |

## 证据边界

- **2026-10-09 写交接时的最新状态不是全绿。** 完整服务最后 **943/944**，`sample-launch.test.mjs` 在初始化组装 UI 产物时因预渲染超时失败，其内部用例没有完整执行，日志 `.cache/event-chain-all-services.log`。之前曾 963/963 通过，958/958 是更早检查点，不能沿用为当前结果。
- Chromium 合成引擎已经区分“首帧”和“实际游戏 Relay 可用”两个事件。它不运行真实游戏、真实 Relay 或真实音频。
- 房间抽屉浏览器检查覆盖保留同一房间和 iframe、返回/重开、触控编辑、受限移动写入拒绝。视觉只作为第二阶段证据。
- 六组 Chromium 合成浏览器回归 **82/82 通过**，见 `.cache/event-chain-browser-final.log`。覆盖普通 / 联机 / Replay 导入续接、无 epoch 的准备期 Back、原生普通退出、已运行的保存失败后 Stay、同房返回、TH09 标题入口，以及抽屉与管理窗口叠层。音频 / 启动 job 定向 Node **96/96**，见 `.cache/event-chain-audio.log`。
- 类型检查与依赖边界最后通过。**生产构建最后失败，串行 / 单独构建仍有 `/` 的 SPA 预渲染超时**，见 `.cache/event-chain-build.log`、`.cache/event-chain-build-isolated.log`。普通本地 preview 的 127.0.0.1 / localhost 请求均 200，不等于精确 SPA build request 已通过。根因尚未查明，没有修改超时或跳过检查。

## 已确认的优先缺口

1. main 在语言 / OGG / MIDI 前打开原生帧并等待 ready；候选仍先 `buildPreparation` 再 `runtime.prepare`。分阶段准备尚未实现，不能用额外 iframe 或假 ready 代替。
2. `RuntimeControls.close` 当前先 `player.cancelStart` 后 `service.close`。取消回调可能先 cancel 已 ready 的 configuring / prepared 帧，跳过 main 的 sync。需要补真实 App held-configure 的 Back / 保存失败 / Stay 续接链，现有测试不覆盖该情况。
3. 全屏控制器按 native epoch 改变退役，可能关闭刚进入的 Player 全屏；无 epoch DATA 失败也需核对真实全屏退出。计数 stub 不是真实全屏证明。
4. 原生安装时无 MIDI 作品的晚到 OGG 字节失败仍被候选阻断，main 的 sentinel / 降级行为尚未完整对应。初始获取阶段的 none 降级也不能自动证明内部配置完全一致。

代码位置、下一步顺序和执行环境的完整交接见 [UI_MAIN_HANDOFF.md](UI_MAIN_HANDOFF.md)。

## 尚未完成，继续时不得假定正确

1. 继续核对所有文件错误分支与多窗口在途写入。上述 Save / Hint / Replay 主链已有源码对照和合成证据，真实持久化与真实游戏仍未验收。
2. 继续核对观战在途加入与退出、连续多局、断线恢复和 TH09 标题内房间的全部失败分支。普通 Back / 主动离开 / 同房返回 / 原生重连展示已有新证据，不等于这些入口全部通过。
3. 继续核对首次 import-server 的真实浏览器入口、更新选择窗口、语言 / 音乐回退提示，以及联机完整准备中的下载取消。普通 DATA 续接与其单次确认已修复，但不能以此推广到所有恢复流程。
4. 设置共享切换、触控布局保存/放弃/复位、方向与全屏、首次输入帮助、菜单/公告/PWA 更新与页面生命周期。PWA 空闲房间门槛已按源码调整，仍需实机 Worker 场景证明。
5. 逐个重新审查旧能力清单的其余入口。旧“源码已核对”或“测试通过”均不自动转成事件链通过。
6. 流程通过后再重新做 main 抽屉、房间和其他窗口的视觉对照，不能声明 100% 一致。

本轮未 push、deploy、发布 GitHub 评论或更新分支。
