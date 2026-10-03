# Issue 21：键盘所有权修复与验证（2026-10-01）

## 范围与工作树

本次实现修复输入来源和生命周期，没有改玩家低速更新、联机包格式、
预测/回滚规则、观战协议或换面游戏逻辑。实现阶段使用四个独立工作树。
2026-10-01 用户要求停止测试并将修复合回原工作区：修复单独提交后合并，
保留目标分支已有历史、未提交改动和 artifacts，不再执行合并后测试。
没有 push 或 deploy；此前未通过或未执行的验收项仍保持原状态。

合入位置为 `eagler-touhou/main`、`eagler-common/main`，以及原工作区当前的
`th06-eagler/experiment/th06-replay-verifier`、
`th07-eagler/experiment/th07-replay-verifier`。没有切换两作的当前分支。

| 项目 | 工作树 / 分支 | 基线 |
| --- | --- | --- |
| Launcher | `worktrees/launcher-keyboard-ownership` / `fix/keyboard-ownership` | main `5ccc6744be6f06b0bda3576f4979e3f2b0e214f2` |
| TH06 | `worktrees/th06-keyboard-ownership` / `fix/th06-keyboard-ownership` | 本地当前适配 `cc803ceb33bb5d6bb61ba44880b8cf8deab7f206` |
| TH07 | `worktrees/th07-keyboard-ownership` / `fix/th07-keyboard-ownership` | 本地当前适配 `27b3b4cdbfd9b860c0d0d2f8891033b9e137ec9a` |
| common | `worktrees/common-keyboard-ownership` / `fix/browser-keyboard-ownership` | 两作所固定的 common `3d54af473a9b8b900bf4aadecc6a318cf6a49e35` |

根目录为 `D:\workspace\eagler`。TH06/TH07 使用当前本地适配基线，不能将
上述本地 SHA 当作已在 GitHub 或线上部署的版本。common 工作树特意从两作
固定的依赖提交开始，没有吸收原 common 工作区其他未完成改动。

## 代码证据与推断

Issue 报告不足以确认用户当时的浏览器、物理事件序列、游戏版本和输入来源。
因此下面的路径是最符合描述的代码解释，不等于已采集到现场根因。

1. Launcher 9/29 的 `418446c` 增加转发所有权，使游戏区 DOWN 后可以跨
   Launcher 控件发送 UP。分析时 main 仍优先用 `keyCode` 作身份：DOWN 为 16、
   UP 为 0 时身份变化；左右 Shift 也会共用 16。UP 落在控件上时可能被拒绝。
2. 游戏 shell 的旧实现按逻辑位和 location 存储按下状态。身份变化能留下
   owner；本地 9/29 修补会删除首个同位 owner，但不能准确处理双 Shift，且
   trainer keys 仍有独立身份问题。两作本地补丁也禁止孤立 Focus UP 产生脉冲。
3. `Controller::GetInput` 原来将 shell 输入和 SDL 键盘状态按位 OR。修正
   shell 松键仍可能被另一份 SDL 按下状态重新合入。本次真实浏览器测试
   强制留下 SDL Shift=1，而 shell 已松键，证明修复后最终 Focus 可以为 0。
   这证明该代码风险及修复效果，没有证明 Issue 用户现场也经历了 SDL 残留。
4. 低速由本帧输入的 Focus 位更新。换面重建玩家状态，不能消除外部
   浏览器 Map 的残留；随后新一帧采样能把残留再次同步给各席位。
   “跨面继续”的解释是输入源持续提供 Focus，不能据此认定玩家 isFocus
   本身是无法解除的开关。本次没有增加逐面无条件清空，以保留合法跨面按住。
5. 观战端使用确认的玩家帧，不写入玩家输入。短程 WS/RTC 实测观战
   输入隔离正常。观战者是否改变现场时序仍是推断，不能把观战认定为根因。
   本次没有改变网络预测对 Focus 的保留行为。

## 实现

- `HostedKeyboard` 为物理按键保存原始 DOWN，并按 target/game/epoch 隔离。
  UP 即使 code/keyCode/location 变化或落在 Launcher 控件上，也发送原 DOWN
  身份；左右 Shift 分别持有。Launcher 控件自身 DOWN、观战者和旧 epoch
  不产生游戏按键。blur/pagehide/hidden/resetRuntime 清理所有权。
- common 的 `browser/keyboard-owners.mjs` 是游戏端通用算法的唯一来源。
  两作 shell 内只保留生成的副本，由 `tools/sync-browser-keyboard.mjs --check`
  校验。这样无需更改旧依赖 pin 或增加运行时网络脚本依赖。
- 游戏端已知左右侧、Arrow/Numpad 别名分别计数；UP 完全丢失物理信息时
  清掉同一逻辑组，避免任意删除一个后永久留下另一个。
  代价是这种无法区分的事件可能使另一个仍物理按住的同组键暂时停止，
  新 DOWN 可以恢复。身份明确的事件不受此规则影响。
- Web shell 成为键盘唯一来源；桌面及旧 shell 继续使用 SDL fallback。
  游戏手柄、触摸、联机/replay override 仍按原流程工作。
- C++ `ResetKeyboard` 调用 shell 全量 reset，清 Map、trainer Map 和输出。
  取消的旧 repeat/UP 不会重新激活；只抑制曾观察到的取消输入，空启动 reset
  和连续只有 UP 的 vendor taps 仍可用。Focus 从不合成孤立 UP 脉冲。
- trainer 延迟 UP 固定原 session，避免延时回调进入新 epoch。

## 验证结果

已通过：Launcher 53 个 TypeScript 源构建；common 所有权及生成一致性；
两作实际 shell 行为测试；完整 shell 协议执行（含 C++ reset hook 对隐藏 Map
的清理）；Hosted Keyboard、触摸协议、测试归属及公共源码政策。
两作普通版及联机版的 Controller 均已编译，联机版重新链接候选 shell。

浏览器为本机 headless Microsoft Edge。每种组合均为三个独立玩家 context
及一个观战 context，加载真正的游戏 WASM，使用实际 Launcher 编译后按键
处理器及传输模块。不是完整 Launcher 页面端到端验收，也不是移动设备实测。

| 游戏 / 路径 | 3P + 1 spectator | 所有参与者确认帧 300 哈希 |
| --- | --- | --- |
| TH06 / WS relay | 通过 | `dc56268725910c36` |
| TH07 / WS relay | 通过 | `185ac91fe578350a` |
| TH06 / RTC | 通过 | `57e6ca10a9fd294d` |
| TH07 / RTC | 通过 | `dbe6dd3d684b08d5` |

表中哈希仅证明该次运行同一帧的各参与者一致。各运行输入按墙钟触发，
不能比较不同运行的哈希。最终证据文件如重新运行会更新。

每组直接读取三个玩家及观战的每席位 `g_CurFrameGameInputs` 和 `isFocus`，
包含 P3 身份变化跨控件 UP、P2/P3 双 Shift 两种释放顺序、原生身份变化、
真实 native DOWN 后故意留下 SDL Shift、pagehide 取消、旧 repeat/UP、
重新按下、C++ ResetKeyboard 及观战输入隔离。

构建验证为增量验证：复用基线其他对象及私人游戏数据，只重新编译影响的
Controller 并链接候选 shell、测试探针。探针源码在 Launcher tests/fixtures，
不加入发布目标；这不是 clean build 或 release，也没有发布数据文件。

完整 `npm run check` 未全部通过：`test-adapter-capabilities.mjs` 在基线
app.mts 就有 16 个禁止的产品 ID 字面量，本次未更改该部分。
继续执行其后的检查，66 项通过；`test-runtime-generations.mjs` 因 Windows
创建 symlink 的 EPERM 失败。没有降低断言或改产品代码绕过失败。

自然换面验证未通过验收。一次长测错误地使用 `netplayStageTransition`；
该选项位于 `scriptedTestMask`，强制禁用物理输入。运行到约 frame 11250
还发生 remote input timeout，未进入第二面。该尝试不能证明本修复的换面
行为，已从自动物理输入回归中移除，不作为通过项。超时原因尚未诊断。

## 可执行复现与回归矩阵

对 TH06、TH07 分别执行。旧版复现与修复验收使用独立产物；切勿混用旧 JS
和新 shell/WASM。设备人工矩阵至少包含桌面 Edge 及报告者原外接键盘环境。

| 场景 | 执行步骤 | 预期 / 当前证据 |
| --- | --- | --- |
| 原始触发 | 3P，P3 Shift DOWN 在游戏区；不触发 blur，向 Launcher button 发 UP：key=Shift、code=Unidentified、keyCode=0、location=0 | P3 Focus 从 1 到 0，三玩家/观战一致；两作 WS/RTC 已通过 |
| 原生触发 | Runtime ShiftLeft DOWN/location=1；UP code=Unidentified/key=Shift/location=0 | 0 held、0 Focus pulse，最终 Focus=0；已通过 |
| 双 Shift | 两个 Shift DOWN；先左后右、先右后左释放，UP location=0 但 code 保留侧别 | 首次释放仍 Focus=1，最后释放 Focus=0；已通过 |
| 无物理身份 | 双 Shift DOWN 后发送 Unidentified/Shift/location=0 UP | 同组全部退役，没有任意残留；shell/common/Launcher 行为测试通过 |
| 第二输入源 | 在 canvas 真正按 Shift；仅向 Runtime window 发送未知身份 UP，让 SDL 保持 Shift=1 | 最终 Focus=0，SDL 不能重新 OR 回去；两作 WS/RTC 已通过 |
| 取消生命周期 | Z 或 Shift DOWN 后 blur/pagehide/hidden；发送旧 repeat 和旧 UP，再发送 fresh DOWN | 取消后保持中性，新按下恢复；行为测试及 pagehide 联机通过 |
| reset 的隐藏 Map | Shift/F1 DOWN，调用 ResetKeyboard；再按 Z 触发发布 | Shift/F1 不重现，Z 正常；完整 shell 和 C++ 联机 reset 通过 |
| vendor 只有 UP | 空启动 reset 后连续发送两个 KeyZ UP，各次之间消耗 pulse | 两次都产生 Shoot tap；Focus UP 无 pulse；两作 shell 通过 |
| Arrow + Numpad | ArrowUp 与 Numpad8 同时 DOWN，释放一个，再释放另一个 | 两个所有权独立；common/两作 shell 已通过 |
| session/观战 | 按下后切换 epoch；旧 UP 不进入新游戏。观战端重复 DOWN/UP | 新 epoch 中性；玩家输入不受观战影响；行为及观战联机通过 |
| 已松键跨面 | 正常 3P + 观战游戏，P2/P3 放开 Shift，确认高速，打完第一面，进入第二面 | 始终 Focus=0；自然流程尚待人工验收 |
| 合法持键跨面 | 相同游戏，P3 一直按住 Shift 通过换面；进第二面后释放 | 持有时 Focus=1，释放后=0；自然流程尚待人工验收 |
| 移动/真实外接键盘 | 用报告者设备重复原始触发、双 Shift、失焦及跨面，保存实际 DOWN/UP 字段 | 尚未执行；DOM 合成事件不能替代设备差异 |
| 正常版/输入组合 | 普通单人实玩 Shift+移动、手柄 Focus、触摸 Focus；禁用浏览器 hook 的旧 shell 检查 SDL fallback | 普通 Controller 编译及触摸协议通过；实机组合待测 |

## 重跑命令

下面在 Launcher 修复工作树执行，需要现有基线构建、私人游戏资源、
Python Playwright 与本机 Edge。探针只能用于本地验证。

```powershell
$w = 'D:\workspace\eagler'
$py = 'C:\Python314\python.exe'
$ninja = 'C:\Program Files (x86)\Microsoft Visual Studio\18\BuildTools\Common7\IDE\CommonExtensions\Microsoft\CMake\Ninja\ninja.exe'
node scripts/build-launcher.mjs --force
node ../common-keyboard-ownership/tests/browser-keyboard-owners.test.mjs
node ../common-keyboard-ownership/tools/sync-browser-keyboard.mjs --check ../th06-keyboard-ownership/resources/shell.html ../th07-keyboard-ownership/resources/shell.html
node ../th06-keyboard-ownership/tests/keyboard-focus-release-test.cjs
node ../th07-keyboard-ownership/tests/keyboard-focus-release-test.cjs
$env:EAGLER_TEST_TH06_SHELL = "$w\worktrees\th06-keyboard-ownership\resources\shell.html"
$env:EAGLER_TEST_TH07_SHELL = "$w\worktrees\th07-keyboard-ownership\resources\shell.html"
node tests/test-shell-protocol.mjs
node tests/test-hosted-key-release.mjs
node tests/test-touch-runtime-protocol.mjs
& $py tests/support/build-keyboard-candidates.py --th06-baseline "$w\th06-eagler\build-web-release-multiplayer" --th07-baseline "$w\th07-eagler\build-web-release-multiplayer" --th06-candidate "$w\worktrees\th06-keyboard-ownership" --th07-candidate "$w\worktrees\th07-keyboard-ownership" --ninja $ninja
& $py tests/test-keyboard-ownership-browser.py --workspace $w --th06-runtime ../th06-keyboard-ownership/artifacts/validation/keyboard-ownership/runtime --th07-runtime ../th07-keyboard-ownership/artifacts/validation/keyboard-ownership/runtime --route ws --output .cache/keyboard-validation/browser-ws.json
& $py tests/test-keyboard-ownership-browser.py --workspace $w --th06-runtime ../th06-keyboard-ownership/artifacts/validation/keyboard-ownership/runtime --th07-runtime ../th07-keyboard-ownership/artifacts/validation/keyboard-ownership/runtime --route rtc --output .cache/keyboard-validation/browser-rtc.json
```

本地详细证据：Launcher `.cache/keyboard-validation` 中的 browser-ws.json、
browser-rtc.json、check-serial.log、remaining-checks.json；两作
`artifacts/validation/keyboard-ownership/runtime/incremental-build-evidence.json`
和 `normal/compile-evidence.json`。没有将这些本机产物和游戏数据列入源码。
