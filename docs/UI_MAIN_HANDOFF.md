# ui-main 重构交接

## 上传说明与用户硬性要求（2026-10-09，优先于下方历史记录）

**这是一份未完成验收的 WIP。接手必须先按用户要求审流程，不能把现有实现、旧测试或构建通过当成正确性证明。**

- **流程、事件链第一，视觉第二。** 普通启动、选项栏启动、联机房间启动等入口都要逐项对照 main，包含触发条件、事件顺序、状态归属、取消、错误恢复和退出保存。
- 用户明确判断本分支 **99% 的流程偏离原项目**。这是用户的审查前提，不是统计结果。必须假定每条现有流程都可能错误，不能继续假设它是对的，更不能只修几个显眼问题。
- 基准是 **继续工作时即时的 main**，不是 ui-main 自己、旧截图或旧审计表。每轮记录 main 的提交号，并在 main 更新后复核。上传准备时远端 main 为 `5c7ff45de236d9d5859be1e2c370f330836de7a8`。
- **整体界面与抽屉视觉都要尽量 100% 一致。** 流程核实后，再按实际展开、关闭、准备、失败和运行状态比对布局、尺寸、间距、字体、颜色和交互。不能凭相似画面宣布一致。
- 全量审查要有 main 源码依据和实际验证证据。区分已经核对、agent 自述修复、尚未复验和仍未审查，不能把未知项刷成通过。

### 本次上传范围与验证边界

上传目标是现有 `experiment/ui-main` 分支的后续 WIP，保留上述要求及事件链审计记录。其他任务的服务器、TH15 资源构建和新增 TH11 联机规则改动不纳入本次 UI 快照。UI 文件里重叠的新增联机规则仅从上传版本排除，不改写其他任务的工作树。

最后已有日志：10:29 类型检查与 harness 构建通过，10:30 正式 UI 构建通过。较早完整服务测试为 **989/990**，帮助内容断言失败。后续有修改，但没有最后修改后的完整全绿记录。核心检查较早也失败，不能视为已通过。上述记录属于当时工作树，隔离其他任务后的上传快照须单独核对。

本次上传准备另行检查了 **实际暂存源码快照**：应用和测试两份 TypeScript 配置均通过，UI 依赖边界与暂存差异格式检查通过。快照复用了已有生成路由类型。没有重跑快照的完整服务、正式构建或全量浏览器验收，不能将这些有限检查写成全绿。

另一 agent 的记录报告修复了真实全屏生命周期、音乐失败哨兵回退、旧邀请入口、TH10 Hint 归属和首次触控帮助，也修正了自定义选项栏及语言菜单。这里仅记录其进度，不替代全量流程与视觉验收。记录最后出现服务端 401 认证中断。

原生 ready 的准确位置、准备期 Back 的保存与取消顺序，以及所有未审查入口和失败分支仍须逐项核对。下方 08:06 交接中的问题清单保留作追踪线索，其中构建失败已被后续成功日志更新，其他“未修”状态也不能未经核对直接沿用。

用户本次已要求上传 GitHub，覆盖旧的“本次只写交接、不上传”范围。公开标题和说明仍按用户规定先过眼。本次上传不代表验收完成或合入 main。

## 2026-10-09 08:06 历史交接（以下状态需按上方更新复核）

## 当前结论与用户要求

2026-10-09。**审计与重构仍在进行，当前工作树不是全绿，不能当成已经与 main 一致。**

用户多次明确：本分支绝大多数流程偏离原项目，必须把每条流程都视为待证。顺序是 **流程与事件链第一，视觉第二**。依据是即时 main，抽屉也必须尽量完全一致。旧代码、旧测试、旧“已修复”标签都不能自动转成通过。

用户撤回过“整理交接然后更新到原分支”的指令。本次最新要求只有“写交接”。继续时保留未提交工作，不自行 commit、push、合树、部署或发布 GitHub 言论。项目规定：只有明令要求才开树，公开 GitHub 文字必须先给用户过眼。

更细的流程对照见 [UI_MAIN_EVENT_CHAIN_AUDIT.md](UI_MAIN_EVENT_CHAIN_AUDIT.md)。本交接的当前状态优先于下面所有历史段落。

## 工作位置与基线

- 仓库：`D:\workspace\eagler\eagler-touhou`，在原目录修改，没有新建工作树。
- 分支：`experiment/ui-main`。
- HEAD：`039b6e0034a70536afe5d7561d078d7e7e2c295d`，既有 WIP 快照。本轮没有新提交。
- 最后再次 fetch 确认的 main / origin/main：`5c7ff45de236d9d5859be1e2c370f330836de7a8`。接手仍应先 fetch 再确认即时 main。
- main 源码副本：`D:\workspace\eagler\artifacts\ui-main-visual-20261008\main-reference-current`；对应站点副本是 `main-reference-current-site`。
- 当前有大量未提交修改和 15 个未跟踪源文件。先看 `git status --short` 与相关 diff，不能 reset、clean 或整体覆盖。
- 开始源代码工作前，按工作区要求读 `WORKSPACE.md`、共享 `docs\agent\ROUTES.md` 及相关主要 playbook。此任务主要用启动器 / Package、multiplayer、audio、input-touch、testing-acceptance 手册。

## 已经落入工作树的主要修正

以下是已修改与有局部证据的范围，**不表示这些入口的全部分支已经审完**。

1. **联机进房与开局分离。** 进房只准备基础 Package。有 Worker 才预缓存 Runtime。Ready 独立于下载进度，房主 Start 等服务器确认的在线 Ready 席位。游戏沿用大厅 member ID。完整个人设置在服务器 Start 时捕获。
2. **实际游戏链路门槛。** 保留唯一 iframe，使用原生 peer transport 判断 RTC 双通道或 Relay。首帧不能替代实际链路可用。iOS 触控按 main 暴露原生手势面。新增重连 / 断线窗口，返回前同步关闭原生帧并保留大厅成员。
3. **DATA 导入续接。** DATA / Package 获取失败与 Runtime / 音频 / 语言错误分开。普通启动用单次续接凭据；联机绑定房间、席位和 startSerial；多人 Replay 保留原 Replay 意图与 Player。导入后不重复输入确认或全屏请求，晚到回调不能启动旧页面 / 旧房间。
4. **确认与更新顺序。** 输入提示在 Player / 全屏和更新选择之前，移除了 OGG 降级的额外确认。普通 / 联机 / Check game / Replay 共用更新选择和资源写入所有者。只取消更新或更新失败可继续当前版本，后台更新和剩余 OGG 在原生 launch 确认后开始。
5. **音频准备边界。** 必需 DATA 与可选初始 OGG 已分开。语言在 OGG 屏障前处理，MIDI 在这些资源之后准备。按保存的音乐偏好重新求有效模式，偏好不会被降级覆盖。取消初始 OGG只降级，不取消整次 Start；整次意图取消仍阻止启动。没有 MIDI 播放能力的作品使用 none 降级，其与 main 内部 sentinel 的完全一致性仍需核对。
6. **文件流程。** 文件用途固定 ja / none，不能因保存的 OGG / 翻译偏好额外下载或准备 MIDI。Save 先问覆盖再选文件。Save / Hint 写入、重载验证后退役临时所有者。运行中只允许 Replay 路径修改。Replay 管理仍开着则刷新，否则持久化后退役。缺文件下载提示直接选择导入文件，不跳管理页。
7. **窗口与历史层。** 上层管理窗口覆盖持续存在的下层设置 / 房间，槽位按层级返回。新增 Router Player 历史层，普通原生退出消耗该层。Back 在资源获取阶段撤销原 Start，而不是因 URL 相同放过旧意图。准备期 / 导入期取消沿原启动所有者，保持一个 iframe 和一个房间成员关系。
8. **正常退出与草稿。** 正常退出直接保存，只在失败或草稿决策时显示窗口。旧测试中“所有退出先确认 End game”的错误预期已改写。历史清理等退出操作完成，草稿释放 busy 不再盖掉随后进行的保存。准备期已 ready 的退出仍有下节所述缺口。
9. **其他。** 受限移动在写偏好之前确认，服务器 Start 后可恢复同一局。空闲房间、已完成 preparation、普通设置 / 公告面板不再永久阻塞 App Shell 更新。个人入口 / 个人窗口、网络和观战窗口标题按 main 重新校对。PWA 的真实 Worker 场景和视觉仍未完成验收。

## 已确认或高优先级待核对的偏离

接手不要先做视觉，也不要因测试通过而跳过这些项。

### P1：原生 ready 的位置仍与 main 不同

main 的 `src/launcher/app.mts`：`launchConfiguredRuntimeImpl` 先 `ensureRuntime(true)`，`ensureInstalledPackageRuntime` 打开同一原生帧并等待 ready，然后才准备语言、初始 OGG、MIDI、configure 和 launch。

候选的 `app/services/game-launch.client.ts` 仍先在 `buildPreparation` 完成可选资源 / MIDI，再调用 `runtimeService.prepare(plan)`。基础 DATA → 语言 → OGG → MIDI 的顺序修了一部分，但**原生 ready 尚未前移**。影响原生错误出现的时机、iOS 宿主 / 手势面及 MIDI / 外部输出准备事件。

上轮只做了租约与会话分析，没有实现新的分阶段 API。应复用当前 Runtime service / iframe，不能用额外 iframe 或假的 ready 凑顺序。若 OGG 获取产生新 Package generation，必须保留已加载 DATA 的真实租约和身份，明确附加资源与后台更新的代次，不能悄悄把会话说成另一代 DATA。

### P1：准备期 Back 可能先 cancel 再保存

`app/runtime/RuntimeControls.tsx` 的 `close()` 当前在 `service.close()` 前调用 `player.cancelStart()`。普通启动的取消回调可能通过 job.cancel 直接 cancel 已 ready、处于 configuring / prepared 的原生帧。main 则在 ready 时先 sync，保存成功或用户明确放弃后才 reset。

现有新浏览器测试覆盖无 epoch 的获取期 Back，以及已运行的保存失败 / Stay，**没有完整覆盖 ready 但尚未 launch 的 Back**。应补实际 App 的 held-configure 场景，检查 sync → 退役顺序，以及保存失败后 Stay 是否保留并续接原启动。普通、联机、Replay 都要核对，不能只清掉 saveError 来放行新的启动。

### P1：全屏还可能按错误的 epoch 退役

main 在 Player 意图内管理全屏。候选 `PlayerToolsForService` 绑定原生 epoch，`app/services/player-tools.client.ts:setSession()` 在 epoch 改变时调用 `retire()`，而 retire 会退出所属 Player 全屏。

因此首次创建原生 epoch 时是否会关闭刚请求的全屏，以及无 epoch DATA 失败时是否按 main 退出全屏，仍需实际验证。当前导入续接用例把 `requestFullscreen` 替换成计数 stub，**不能证明真实全屏正确**。运行后的退出有 fullscreen controller 的退役逻辑，不应笼统说它完全没有退出全屏。

### P1 / P2：音乐后半段与取消仍需继续审

- `runtime.client.ts` 的原生安装时 OGG 字节失败仍只允许 `fallbackToMidi && product.musicCapabilities.midi`。无 MIDI 作品的晚到字节失败与 main 的 sentinel 降级行为尚不相同，需区分配置哨兵与实际播放能力。
- 普通 Start 的初始 OGG 取消已接回当前 job。联机完整准备阶段的取消入口、语言 / 音乐降级提示是否真的展示，以及首次 import-server 的实际浏览器入口仍未全量核对。
- Save / Hint / Replay 主链有新证据，但多窗口在途写入与全部失败分支、观战在途加入 / 离开、连续多局、TH09 全部失败分支、设置共享、首次帮助、生命周期仍需逐项审。

## 最新验证：不能写成全绿

| 检查 | 最后实际结果 | 日志 / 范围 |
| --- | --- | --- |
| 六组 Chromium 浏览器回归 | **82/82 通过** | `.cache/event-chain-browser-final.log`。file-workflow、preflight、room-panels、replay-manager、runtime-controls、title-room-entry |
| 音频 / 启动 job 定向 Node | **96/96 通过** | `.cache/event-chain-audio.log`，包括最后修正的文件用途不读取音乐 / 语言偏好 |
| 类型检查 | 通过 | `.cache/event-chain-typecheck.log` |
| 依赖边界 | 最后检查通过 | `node scripts/check-ui-boundaries.mjs` |
| 完整服务 / 原生协议 | **最新 943/944，1 个模块初始化失败** | `.cache/event-chain-all-services.log`，`sample-launch.test.mjs` 在组装 UI 产物时构建失败，其内部用例未完整执行，不能冒充完整覆盖 |
| 生产构建 | **最新失败，单独构建也失败** | `.cache/event-chain-build.log`、`.cache/event-chain-build-isolated.log`，SPA `/` 预渲染请求超时 |
| 格式 | 之前的 3 个 EOF 空白已处理，交接后应再检查 | `git diff --check` |
| 路由 | 历史 19/20 | Windows 拒绝符号链接夹具 EPERM，未解除或弱化测试，不能说已通过 |

在最后“文件用途音乐偏好隔离”修正之前，完整服务曾 **963/963** 通过。958/958 是更早检查点。当前最后一轮不能沿用这些绿色结论。

所有浏览器场景均使用合成 DATA / 协议 peer / 控制 transport。没有真实引擎、真实 Relay、音频、持久化或物理设备验收。TH09 夹具现有一个显式的合成控制 socket，提供服务器确认的本地席位；它没有连接真实网络。

## 构建故障：中断时停在这里

起初把完整服务与生产构建并行执行，检查本身会再构建 UI，出现预渲染超时。后来串行完整服务和独立生产构建也复现，**所以尚不能认定只是并行竞争，也不能认定是代理问题**。

已查看安装的 `@react-router/dev v8.4.0`：`node_modules/@react-router/dev/dist/vite.js` 的 prerender 会启动本地 Vite preview，用 `nodeHttpFetch` 请求生成页面，默认超时 10 秒，`agent:false`。日志中有很慢的 CSS / virtual-modules 构建回调，随后 `/` 预渲染超时。没有改依赖、加大超时或取消预渲染来绕过失败。

诊断脚本 `.cache/probe-ui-prerender.mjs` 设置 `IS_RR_BUILD_REQUEST=yes`，启动 127.0.0.1 动态端口的 preview。对 127.0.0.1 与 localhost 的普通 `/` 请求都收到了 **200，20383 字节**。这只是普通预览请求，不等同于框架精确的 SPA 预渲染请求 / 头部。脚本在 `server.close()` 后仍有进程残留，写交接时已核实并停止本任务 PID 38980；没有停止其他预览或应用。

下一步应重现框架完整 SPA 预渲染请求、检查 preview 配置 / 中间件 / CPU 时序，区分普通预览与 build request。不能把我最初的“并行构建导致”解释当成已经查明的根因。

## 代码入口与运行方法

- 启动与恢复：`GameLaunchProvider.tsx`、`settings-launch.client.ts`、`game-launch-job.client.ts`、`game-launch.client.ts`。
- 房间与原生启动：`MultiplayerRoomProvider.tsx`、`multiplayer-room.client.ts`、`multiplayer-launch.client.ts`、新增 `multiplayer-room-resources.client.ts` / `multiplayer-gameplay-path.client.ts`。
- 同一 Player / 历史 / 退出：`PlayerToolsSurface.tsx`、`RuntimeControls.tsx`、`route-session.mts`、`player-tools.client.ts`。
- 文件：`FilePreparationBridge`、`runtime.client.ts:withFileSession`、Save / Replay / Hint providers 与 services。
- 下层与窗口：`library.tsx`、新增 `ProductSettings.tsx`、`ManagementSurface.tsx`、`AnimatedDialog.tsx`。
- 多人 Replay：`MultiplayerReplayProvider.tsx`、`multiplayer-replay.client.ts`。

PowerShell，在仓库内执行。完整服务会构建 UI，不要与生产构建并行：

```powershell
npm run typecheck:ui
node scripts/check-ui-boundaries.mjs
npm run test:ui:services
npm run build:ui

npm run build:ui:harness
npx playwright test -c .cache/playwright-event-chain.config.mjs --workers=1
git -c safe.directory=D:/workspace/eagler/eagler-touhou diff --check
```

`.cache/playwright-event-chain.config.mjs` 是未跟踪、被忽略的本地配置。它只运行上述六组 Chromium、一个 worker，启动 4175 的独立 harness 服务，`reuseExistingServer:false`。新会话 / 新机器如果没有此文件，应从六组列表重建配置，而不是删用例。现有 4181 / 4184 预览的运行与产物状态没有最终复核，不能把它们的旧画面当作当前结果。

本机默认沙箱 exec 曾返回 helper_unknown_error，后续命令走经过 auto-review 的 `require_escalated`。这只是执行环境情况，不是新的用户许可需求。没有 auto-review 拒绝未处理项。

新增源文件（不能因 `git diff --stat` 不列 untracked 而漏提交）：`ProductSettings.tsx`、`RoomSettingsPolicy.tsx`、`multiplayer-room.css`、`netplay-connection.css`、`useMultiplayerConnection.ts`、`entry-package-update.client.ts`、`game-data-acquisition.ts`、`multiplayer-gameplay-path.client.ts`、`multiplayer-room-resources.client.ts`，以及 file-workflow fixture / peer / HTML / spec、合成 `th06.html` 与事件链审计 Markdown。

## 历史材料与下一轮顺序

旧 `D:\workspace\eagler\artifacts\ui-main-visual-20261008\full-audit.html/json` 已标记 **historical-invalidated**，撤回“全量对照已完成”判断。原版保存在 `full-audit.pre-event-chain.html/json`。旧 74 项能力映射、旧 c195 / f12 基线、旧截图和“已修复”状态均不能证明当前事件链。不要盲跑 `.cache/build-full-audit.mjs` 或 `update-continuation-audit.mjs` 把旧条目全部刷绿。

建议接手顺序：先确认基线与工作树，查清构建故障，再处理上面原生 ready / 准备期退出 / 全屏的 P1 链路；然后继续所有未证入口与错误分支。**流程通过后** 才重新生成 main / candidate 抽屉、房间、其他窗口的逐状态视觉对照。不得说视觉 100% 一致。

下面仅保留旧交接原文供历史检索，不是当前执行指令或验收结果。

## 2026-10-08 full parity audit (uncommitted WIP snapshot)

The `experiment/ui-main` working tree is a full visual/behavioural parity audit
of the React launcher against live `main`, begun at
`c195a91f6b613bec53968b601543844e8bb5e400` and re-synced when main advanced to
`5c7ff45de236d9d5859be1e2c370f330836de7a8` ("Restore lobby initialization with
the shared quick index"). 155 app files are mapped into 74 capability
comparisons; the machine-readable report and HTML live in
`../../artifacts/ui-main-visual-20261008/full-audit.json` and `full-audit.html`.

Repaired against main: ordinary one-click Start (previously split into "prepare
resources" then "confirm start"), in-place drawer import, four-viewport
card/drawer geometry, compact file tools, quick navigation, the 320px header
theme-button overlap, import-window focus/accessibility after reopen, touch
settings placement and default state by device pointer, external MIDI wiring,
gameplay orientation via device orientation lock, the global diagnostics toggle,
and the multiplayer room flow (automatic preparation, challenge-mode rule and
directory tag, restricted-movement touch/joystick/cancel confirmation, host
removal confirmation, room import continuation, quick chat).

The session was interrupted on its last item — restoring the room page to main's
compact dock/seat-stage layout — so the tree is NOT green:

- `build:ui` FAILS: `app/components/MultiplayerRoom.tsx` imports
  `./multiplayer-room.css`, which was never created.
- `test:ui:services` 830/838. The 8 failures are all in the multiplayer/room/
  calibration/labels area: five files fail (`multiplayer-labels`,
  `multiplayer-replay-view`, `multiplayer-room`, `react-ui-labels`,
  `sample-launch`), plus `provider-ui-labels` ("locale must not enter service
  lifecycle effects"; calibration renders an undefined `report`) and
  `room-panel-route` (room/Runtime owner mounts 3x instead of 1).
- `test:ui:routing` 19/20; the remaining case is the known Windows EPERM symlink
  fixture, not a product defect.
- typecheck and dependency-boundary checks pass.

Still-open differences in `full-audit.json` (21 items) were partly repaired this
session and must be re-derived against `5c7ff45`. Confirmed remaining: room
screen structure (MP-12), calibration retry/failure/suspended states (MP-14),
lobby product-card settings entry and artwork (MP-02), nickname/seat/loadout
display (MP-05), room Back origin for direct links (MP-11), spectator privacy
(MP-15), and `navigator.storage.persist` after import (STOR-02).

Source/fixture checks and four Chromium viewports do not prove actual game,
audio, durable user files, live multiplayer or physical-phone acceptance.

Updated 2026-10-08. Continue on `experiment/ui-main`; do not merge or deploy as
part of this handoff. Preserve reusable TS business/protocol/storage code while
retiring obsolete UI only after its capabilities and publication paths migrate.

## Verified published checkpoints

- `83fe4c066d2f135e26b10d3d3c388bcd98d9108e`: earlier bounded sample; 208 synthetic
  browser tests passed. This does not establish original-game or phone acceptance.
- `b7ad9e3ee42c12921e8681279b6ded882e1193f2`: resources, Replay, measured touch editor,
  shared dirty-draft/Runtime guard, general published TH06–TH11 preparation and
  explicit Start. Exact snapshot: 210 Node checks and type/build checks passed.
  Browser CI: 231/236; four failures were an invalid background-toolbar visibility
  lookup while a modal was open; one WebKit motion test missed its arbitrary
  opacity window during a 650ms sampling gap.
- `665b563494395d769b4c21b65ff828c5f46e0ae2`: scoped tests repair. It checks the actual
  prepared state while the modal is open and accepts genuinely running interior
  animation frames. Real duration, continuity and DOM-identity assertions remain.
  Exact snapshot: 213 Node checks, SPA and fixture builds passed. Recheck this
  revision's browser CI: 234/236 passed. The remaining two failures were old-document metadata fetches during reload. A shared document fetch gate and 11 deterministic lifecycle cases now address that source race; actual WebKit confirmation awaits the next CI.

Main's reviewed content baseline remains `a1426aba791a1eb2e1d52b2e9bf489d7af91761e`.
`experiment/ui-rebuild` is an untouched historical backup, not the new entry.

## Latest published CI and active checkpoint

- `92c34c8d7e632853c43fce5072e92c879a7b2bbb`: exact-head core CI passed;
  main browser **608/608**, nested **6/6**, publication **9/9** passed.
  [Verified completed workflow](https://github.com/YomotsuHisami/eagler-touhou/actions/runs/37242089553).
  Exact source also passed 852 service +20 route checks, strict types, all three
  builds, 20 publication contracts and full core. The following checkpoint only
  improves settled screenshot evidence and reconciles documentation; its exact
  CI must be checked separately. This is synthetic browser acceptance, not
  original-game, live-relay, durable-save or physical-phone/performance acceptance.

- `187999ba5b74cc7c62cbda6b59580d425b776f48`: exact source passed 852 service
  and 20 route cases, root/nested/harness builds, 20 publication contracts and
  full core checks. Core CI passed; main browser 601/608, nested 6/6 and
  publication 9/9. Warning Escape now closes only its own prompt; the remaining
  four focus assertions used programmatic click without first focusing Start.
  Trace confirmed restoration to the actual previously focused draft control.
  Tests now establish the intended opener before same-task click/double Escape.
  Three notice gesture cases sent the next pointer stream 20ms into the retained
  260ms inert exit. Settled-gesture tests now wait for physical modal retirement
  and complete entry before the next gesture. Full default motion, parent-zero,
  focus/history/frame/launch assertions and separate reversal coverage remain.
  These are fixture sequencing repairs; no production behavior changes here.
  Recheck the next exact-head CI before declaring browser acceptance complete.

- `2c4178c6c75ea7995fa2540f99da4c5d122851c2`: core CI passed; main 599/608,
  nested 6/6 and publication 9/9. The real-HTTP WebKit failed-module recovery
  cases passed. Publication success retains the explicitly limited WebKit
  origin-unavailable scope; navigator.offline emulation is still unverified.
  Remaining main failures: four same-task warning Escapes still reached the
  old parent Radix layer, and five notice assertions expected desktop 18px
  instead of original mobile 17px. The next scoped fix marks only warnings as
  local Escape owners, shields lower parent callbacks and dismisses only the
  exact current gate prompt. History/frame/launch and parent-zero assertions
  remain. Typography source is unchanged; tests now follow its 780px breakpoint.


- `e45d1e6d25d0179af99aa9272106e006ffd22ad0`: exact source passed 840 service
  and 20 route cases plus builds/publication/core. Core CI passed; main 592/604,
  nested 6/6, publication 7/9. Preflight, pending Help and earlier cold-route
  failures passed. Follow-up preserves requirements while addressing:
  - Warning open/reopen must establish its keyboard scope synchronously and
    let Radix capture Start before applying initial focus
  - Closing child dialogs may restore from Radix's exact parent-container
    fallback, while newer user controls/frames/modals remain protected
  - Actual first-use prose uses h3; separate two-level synthetic content keeps
    h2 typography coverage without waiting for nonexistent real headings
  - Failed modulepreload caching matches WebKit bug 270357. Explicit Reload
    now performs bounded same-origin generated-module raw revalidation before
    ordinary reload. This remains a hypothesis until real-HTTP CI confirms it
  - Playwright 1.63 / WebKit 2359 offline emulation matches issue 42775. Per review,
    revised CI closes only its owned fixture origin, proves uncached failure
    and actual Service Worker navigation/reload, then retains update/data checks.
    Chromium/Firefox additionally keep setOffline; WebKit navigator.offline
    acceptance remains BLOCKED/UNVERIFIED, not replaced by an equivalent pass

  Sources: https://bugs.webkit.org/show_bug.cgi?id=270357 and
  https://github.com/microsoft/playwright/issues/42775 (fix #42894 still open
  when reviewed 2026-10-04). No browser security settings or production origin
  are changed by these fixture controls.

- `10cd54a78de48a2b80554625cce595c2a42db708`: all five final parity repairs and
  interaction/test-consumer migration. Exact source: 830 service +20 route
  checks, root/nested/harness builds,15 publication cases and full core pass.
  Core CI passed; main browser 516/596, nested navigation 6/6, publication 1/9.
  These results do not complete browser acceptance. Trace-backed follow-up:
  - Preflight fixture violated immutable Runtime URL and TH08 DATA contracts
  - Standalone modal fixtures lacked their required composition/DOM RouterProvider
  - Cold-route interception also held an eager game-preferences chunk
  - Gesture tests assumed native CSS smooth scrolling despite the tested RAF owner,
    sampled after animation completion, or requested unsupported mobile wheel injection
  - Directory join label includes room identity; notice geometry was read during entry
  - WebKit inspector-aborted modules were not re-requested on Reload; HTTP503→200
    recovery and inspector-abort detection are now separate explicit cases
  - Publication install had reached offline-ready; its card selector omitted locale
    query. Plain-preview fixture used browser-restricted4190. Source now uses4178
    with browser security unchanged; actual offline/update assertions remain

  The follow-up changes fixtures/assertion timing and adds composition/contract
  regressions. Runtime validation, production modal/boot behavior and timeouts
  are not loosened to manufacture a pass. Exact next-commit CI remains required.

- `8d0a2e7d04da4577305f9b6149909524fc0b1367`: 104-file retirement and
  main-panel continuity checkpoint. Exact exported tree passed 658 service/SSR
  plus 18 route cases, both strict typecheck projects, root/nested builds, ten
  actual nested-artifact publication cases and the complete repository core
  check. Remote ref/tree were read back; GitHub core CI passed. Main UI CI
  passed 435/476 cases. Captured DOM identifies higher Help incorrectly hidden
  by a later-mounted library modal; Escape also reaches lower modal owners.
  Donation tests still target background controls beneath the restored sheet.
  One viewport geometry assertion sampled an unfinished animation. Independent
  nested/publication lanes ran but failed setup after a test-side root/nested
  build-output contamination; their browser acceptance is not established.
  It includes modal-contained prepared Start/Exit controls and task notices.
  Fixes require a new exact commit CI; none is accepted solely from diagnosis.

- `dc0e8ddfb6d0ded0d6312684408fde8edbdc8cc4`: default React publication consumers
  and launcher-capability restoration. Exact source passed 657 UI/route Node
  cases, ten actual nested-artifact publication cases and full core check.
  GitHub core passed; main browser CI **408/420**. Earlier viewport/refresh fixes
  passed. Three OS-motion restoration cases exposed stale cached media state;
  nine room cases crossed the fixture's real 650–899ms metadata retry timer.
  Subsequent source fixes synchronous snapshot reads while preserving subscriber
  delivery, and injects a controlled room-fixture clock with explicit retry
  coverage. Existing travel and requests===1 assertions are retained. Browser
  confirmation is pending. Nested/publication browser lanes were skipped; the
  next workflow runs these independent lanes even if main-UI assertions fail.


- `6a02ce9ff3dbbc1965dd3c886bfcfc30f659527a`: 142-file service/player/publication
  checkpoint. Exact isolated source passed 571 Node UI/route checks, eight actual
  nested-artifact publication cases and full repository core checks. GitHub core
  CI passed. Main browser CI: **305/308**; nested/publication browser steps were
  skipped after that failure. One title-dialog fullscreen gutter case and two
  WebKit/mobile refresh module-import failures are fixed in subsequent source,
  awaiting the next exact commit CI. Do not label these browser fixes accepted.


- `04e5fc1b36441eb30132823239ac2ebe64dced21`: integrated resource imports/removal,
  saves, room/Runtime handoff, progressive audio, touch viewport and notices.
  Exact local check: 413 Node checks plus both builds. Core CI passed; browser
  CI passed 252/264, all 12 failures in the viewport fixture readiness probe.
- `1782e4fd50f5c626b6213ede29164c9a02c84fe3`: fixture probe after iframe commit.
  Core CI passed; browser CI passed 262/264. Two Chromium geometry assertions
  exposed a 15px library scrollbar gutter in the fullscreen Runtime. The next
  source checkpoint disables this gutter only while the Runtime is visible;
  strict viewport geometry assertions are retained. These Runtime cases passed
  in 6a02ce9; its distinct fullscreen title-dialog gutter case is noted above.

The current migration has 608 main UI, six nested and nine publication browser
cases. Exact-head outcomes are recorded above; case counts are not pass claims.

Production old UI retirement: 17 entry/controller/build files deleted, 732 lines
of unused mixed-module DOM/translation/history adapters removed, and standalone
page styles reduced from about 267KB to 3.2KB. Canonical TS models/contracts,
Package/legacy storage readers, Runtime protocol/cache/leases, recovery/info pages,
minimal prebuilt self-hosting and old-release verification remain. The actual
keyboard listeners are extracted into runtime/keyboard-binding.ts for shared
production/test use.

Visual source restores a persistent library under the 480px right-hand settings
sheet and mobile cover-led bottom sheet, shared child management views and room
options; Runtime remains root-owned and takes over without replacing the frame.
Root metadata now supplies title/description/OG/theme through server-safe route
locale data. Synthetic screenshots cover library/settings/resources/Replay/saves plus populated
directory and room sheets. Their source-backed visual review is recorded below;
physical-phone appearance, performance and gameplay remain unverified.

Historical browser CLI consumers are ported and inventoried in
[BROWSER_TEST_LANES.md](BROWSER_TEST_LANES.md), including all 42 advertised
browser/performance entrypoints. Unique native/relay/storage/performance scope
is retained; unexecuted lanes remain unverified. React CI is a separate synthetic
lane and does not replace real-game/storage/device evidence.

## Current ownership

- Framework SPA Router owns location and history. `/play/:productId` is the UI
  namespace; `/games/**` remains game resources. The root RuntimeControls blocker
  coordinates registered unsaved drafts before Runtime exit consent.
- RuntimeService alone owns the retained iframe, native file protocol, epochs and
  Package/code leases. Exclusive prepared file sessions prevent Start/cancel from
  racing Replay or save transactions. No React view writes IDBFS independently.
- Preferences and resource/launch/file controllers are plain TS services. Views
  emit intents. Providers retain jobs across route changes and fence document loss.
- Package installer owns serialization, Web Locks, staging and atomic generation
  commits. Resource removal must detach a confirmed current pointer and preserve
  retained generations/objects; it is not a save-data deletion or forced GC.
- New build ownership proof lists source modules, chunk bytes and lazy imports.
  Legacy app/lobby DOM bootstraps and Node-only modules may not enter the new graph.

## Continuing work, not yet an overall completion claim

The integrated implementation includes local ZIP/raw-DATA import, confirmed
base-resource detach, root provider/view splitting, legacy links, directory and room
state with authoritative Runtime handoff, MIDI, progressive OGG, language cache and
fallback, live touch/viewport/magnifier, locale/notices/help, and save replacement
with fresh-owner byte reread. Check the exact commit and CI before accepting any
browser result. Injected transport/storage tests are not live relay or durable
browser/gameplay evidence.

Prepared-control amendment: the library modal previously obscured root Start/Exit
and task notices. A stable ManagementSurface presentation slot now places those
existing controls inside the active modal, preserving their root controllers and
save guard. Normal-click CI cases cover Start/file locks/Exit/save failures; no
forced click or duplicate Runtime was used.

Additional preserved-main behavior restored in the current source: card/minimap hold/scrub/wheel gestures, notice-edge gestures,
and local-OGG MIDI-sentinel/effective fallback semantics. Catalog MIDI capability
must remain authoritative (a sentinel is not evidence that TH10 supports MIDI).
These repairs have targeted source coverage; browser/native verification remains separate.

Remaining acceptance gates:

1. Recheck the exact published retirement + visual + CI-fix revision. Review all
   primary-surface screenshots and interrupted navigation traces, fixing defects.
2. Execute the ported native/browser commands in their documented environments;
   retain their native/storage/WebKit/Adonis acceptance scope.
3. Root/nested publication browser lanes passed at 2c4178c and 187999b, including
   real worker deep reload/update/data-retention under owned-origin unavailability.
   WebKit navigator.offline emulation remains blocked by upstream issue 42775;
   it is not equivalent to origin-unavailable coverage.
4. Real game, relay, crash-durable saves and physical phone/browser versions remain
   unverified. Never bypass browser restrictions or relabel synthetic evidence.

## Reproduction

Use Node 24 and the locked dependencies:

```sh
npm ci --ignore-scripts
npm run check:ui
node scripts/build-ui-harness.mjs
```

Only in a permitted browser environment:

```sh
npm run test:ui:browser
npm run build:ui:nested
npm run test:ui:nested:browser
npm run test:ui:publication:browser
```

See [local acceptance](UI_MAIN_LOCAL_ACCEPTANCE.md) for external private asset
mounting. Public TH06 metadata and six matching runtime/DATA/font files from
`https://touhou.vip/` were retrieved and verified: 25,117,488 payload bytes, current
Runtime generation `67be4524066a23a17bd6fb084abf58899462447248331fb9081e66b27c0a7110`,
Package revision `0fdb4ee3acc78b2a`. Game bytes stay outside Git and the UI output.
Their hash/layout and HTTP mount checks passed; execution did not occur.

No PR, comments, merge, deployment, private data upload or production SW changes
are implied by this branch work. Unrelated reported security issues remain outside
this migration's approved changes.

## Final parity audit follow-through

Five concrete remaining capabilities were found by comparing original-main
callers against the complete new caller/build chain. They are not waived:

- Pre-module boot timeout/chunk failure recovery and route error presentation
- Epoch/intent-bound pre-start mobile-input and none/MIDI acknowledgments
- Real assembled-publication offline Host retention, without an invented Host;
  optional Release Catalog refresh must not block keep-current launch
- Explicit validated web-development Host acquisition and live Runtime mode,
  without relaxing published-generation attestation
- Room-scoped engine preflight (run MP Runtime without gameplay transport,
  require first frame, then safe close back to the same room). Current plan
  acquisition alone is not this check.

All five parity repairs are now implemented with targeted source coverage.
Engine preflight uses the same room/Runtime owners, an authenticated first-frame
requirement and private dry-run cleanup; ordinary game save guards remain.
The assembled-worker Host retention and six visible-game development fixtures
are model/source evidence, not real browser or native gameplay acceptance. Real native/browser evidence
remains separate from source or mocked protocol validation.

### Current visual review findings

The 187999b Chromium and mobile-viewport captures were reviewed for library,
settings, resources, Replay, saves, populated directory/create and room secondary
surfaces. The earlier primary-button contrast defect is fixed; no additional
concrete product geometry defect was found in the visible states. This does not
establish populated native file lists or physical-phone appearance. Child-view
captures sampled the 220ms entry fade, so evidence now waits for actual opacity 1.
The synthetic room fixture's long diagnostic URL expanded full-page mobile
captures, and its network capture omitted the dialog. Evidence-only fixes wrap
that diagnostic, capture the fixed viewport, assert settled dialog/overlay and
viewport bounds, and wait for retained portal removal between opens. Regenerated
captures still require review; no production visual change is implied by these
fixture corrections.

The 8d0a2e7 Chromium evidence was inspected for library, settings/resources/Replay/
saves, directory/create, and room/options/network views. This review found the
primary directory buttons incorrectly combining neutral and primary Tailwind
text colors, producing near-white text on pale pink. The working tree uses
exclusive variants and adds exact foreground assertions. Higher Help is visibly
above the library but was incorrectly aria-hidden; the repair targets actual
Radix mount/dismissal ownership, not its title or screenshot visibility.

The viewport assertion also sampled y=7.7829 during toolbar entry after a rounded
y=8 wait. It now waits for exact settled model/DOM geometry, retaining the exact
assertion and leaving default motion enabled. Header/footer donation tests now
operate on the visible library entry; direct product donation and higher-modal
interruption cases separately retain the underlying settings sheet.

## Final source parity checkpoint after 8d0a2e7

The combined source passes strict UI/test TypeScript, dependency boundaries,
830 UI service cases and 20 routing cases. Root/nested/harness builds, 15
publication cases per mount, TH20 hidden native-fixture build/type/8 identity
cases, 14 Python helper/observer cases and full core checks pass. The exact
published commit and subsequent CI remain the authority for browser results.

Restorations include main card/minimap gestures, notice edges, compact touch
editor/whole-scene motion, contextual input Help, room-options-only swipe close,
effective local OGG/MIDI semantics, boot recovery, pre-start warning scope,
validated offline/development Host paths and actual room engine preflight.
MP Replay and engine preflight did not call original input/audio warnings;
their existing explicit Start/dry-run boundaries remain rather than adding
new prompts. The obsolete progressive-OGG limitation text is removed.

Historical browser commands now target the current controls and actual
publication boundary. They retain unique native/relay/storage/performance
assertions and remain unverified where not executed. See the command inventory
for explicit inputs, including the portable two-scenario TH09 wrapper.

Nested build cache identity now includes mount, default non-root output is
isolated, and locking follows the output directory. The exact earlier failed
mount-only command passes without changing root artifact identity. Declared
root/index GET/HEAD readiness works with default Accept; missing JS/WASM/DATA
and resource namespace behavior remain bounded. No production was changed.
