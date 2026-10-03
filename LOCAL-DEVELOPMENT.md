# 本地运行：frontend-redesign 完整源码包

修订版 v3：在 v2 和此前全部修改之上，移除重复存档上传行，并修复 Header 菜单与 Game info / 大厅 / 房间的层叠冲突。仍保留无构建缓存时的首次启动修复。预览会先生成本地编译模块，再载入产品配置；详见 [启动修复记录](docs/BOOTSTRAP-FIX.md)。

本包基于 `YomotsuHisami/eagler-touhou` 的 `frontend-redesign`，提交
`6e266f0c78ca8f2d465c478733133fba835fca5b`。源码包不是另一份 Git 历史；不要在解压目录重新 `git init` 后向上游提 unrelated-history PR。

## 包含什么

完整前端源码、依赖锁文件、现有 Host/Runtime 接口代码、这次修改、预览服务、测试和导入工具。
不包含 `.git`、`node_modules`、缓存、游戏本体/音乐、私人数据、字体二进制或 DAIRI 原图。
字体输入由准备命令从你的现有克隆复制；没有现有文件时才从固定上游提交获取并检查 SHA-256。
原来的 Linux 项目目录不删除、不重置、不覆盖。

## 第一次运行（Arch / Bash）

解压 ZIP 到 `~/Projects/`，得到新文件夹 `eagler-touhou-frontend-complete-v3`。

```bash
cd "$HOME/Projects/eagler-touhou-frontend-complete-v3"
node scripts/setup-local-assets.mjs --from="$HOME/Projects/eagler-touhou-frontend-complete"
npm ci --ignore-scripts
npm run preview:offline
```

上述三步逐条成功后再执行下一步；均不需要 sudo。Node.js 要求 >=22；你的 Node 24 / npm 12 满足要求。
从旧目录复制的只有核对过的字体、封面和图标，不会复制旧代码、存档、浏览器数据或密码。

浏览器打开 `http://127.0.0.1:8137/`。终端保持运行，停止按 Ctrl+C。
`preview:offline` 是明确标注的纯界面模式，不访问主站、不批量下载游戏；没有封面时有本地占位，不代表游戏文件已准备好。
没有导入角色 PNG 时会显示角色名和“立绘未导入”，不是破图。

## 接入线上资源

先按 Ctrl+C 停止纯界面服务，再运行：

```bash
npm run preview:local
```

同样打开 `http://127.0.0.1:8137/`，必要时 Ctrl+Shift+R 刷新。
前端来自本地；Host/Release/Runtime 配置来自 `https://touhou.vip/` 并按当前分支协议校验。
图片和游戏大文件按需从资源站读取，不会启动就镜像五个游戏。不要误用原来 `EAGLER_DEVELOPMENT_GAMES=th08 npm start` 的单游戏开发命令。
本地服务不转发 Cookie/Authorization，不开放到局域网或公网。

线上配置较新、资源站无法访问或资源授权不可用时，启动可能报错；不要关掉协议校验。用纯界面模式继续测试布局，并保留错误信息。
**当前 `dev-lobby` 依然是本地示例，不连接正式 Relay，不能和真实玩家联机。**
游戏 Runtime 与线上文件的完整兼容性、实际长时间运行不在这次验证范围内。

端口占用时：

```bash
node eagler-local-preview.mjs --offline=true --port=8138
```

换端口意味着新的浏览器 Origin，存档/缓存不会自动共享。
修改源码后 Ctrl+C 停止并重新启动；模块会增量构建。不是热更新服务。

## 导入 DAIRI 角色立绘

先阅读 [DAIRI_ART.md](docs/DAIRI_ART.md)。通过作者页面自行取得素材并解压，然后：

```bash
npm run portraits:import -- --from="$HOME/Downloads/dairi" --dry-run
npm run portraits:import -- --from="$HOME/Downloads/dairi"
```

将示例路径改成真实解压目录。导入只复制 PNG 到被 Git 忽略的 `private-assets/dairi/`，不修改作者原文件。
导入后在浏览器 Ctrl+Shift+R；联机卡片和 Game info 共用这些图片。
缺图不是通过伪造统计解决的：无存档时保留空状态，有统计时按最常用机体选图。

## 自动检查

```bash
npm run test:frontend
```

包含严格构建、产品目录/全局设置/生命周期、真实 Node HTTP 路由和安全限制、20 角色导入与映射测试。

可选 Chromium 组件测试：

```bash
npm run test:frontend:browser
```

使用本机 Chromium/Chrome，不额外下载浏览器；找不到时：

```bash
EAGLER_TEST_CHROMIUM=/usr/bin/chromium npm run test:frontend:browser
```

这个测试是离线 DOM/组件验证，不是整站联机端到端测试。
在有图形桌面的 Linux 上测试真实鼠标动画：

```bash
EAGLER_TEST_HEADFUL=1 node tests/browser/test-global-settings-disclosure.mjs
```

全库 `npm run check` 当前存在**基线已能复现**的 TH10 runtime-build 配置一致性错误；详见
[FRONTEND-TEST-RESULTS.md](docs/FRONTEND-TEST-RESULTS.md)。不要把本次相关测试通过写成全库 CI 通过。

## 手动验收顺序

1. Header → 设置 → 高级/触控设置；慢开关、快速连续开关、Enter/Space，减少动画时应立即开关。
2. 目录第一项 Eagler Touhou → 网站公告；刷新按钮，安全的公告链接；其他五作保持原有 Game info。
3. 游戏信息页多人按钮为红色。站点卡片进入多人大厅显示全部五作示例房间；选具体作品只显示该作。
4. 全部房间中创建房间必须选真实游戏；加入/创建后目录切到实际作品。房间锁定时不能切到网站入口。
5. 导入后 TH08 组队显示两人，单人模式只显示所选成员；TH09 16 名角色匹配；Game info 空状态/最常用机体切图。
6. 桌面与窄窗口检查横向溢出、字体裁切、返回/前进、公告→大厅→返回；再检查存档/录像入口没有串作品。

## 先推送远程，之后再开 PR

完整步骤见 [REMOTE-PUSH.md](docs/REMOTE-PUSH.md)。本包包含截至 v3 的累计源码改动；不要把 ZIP 上传仓库，也不要只提交这轮两项修复。建立新 worktree 后直接应用本包的完整变更清单。

阅读 [FRONTEND-PR.md](docs/FRONTEND-PR.md)。推荐在独立工作树应用本包的变更，不覆盖你已有的本地修改。

## v3 手动验收

- Game info / 网站公告 / 本地大厅 / 房间，以及卡片切换期间：Header 右侧更多菜单应该完整显示并能点击。
- 存档 / 录像：上方保留添加、选择、下载存档，下方只有录像操作；单机与多人都不再有重复的“存档 / 上传”行。
- 本包不读取或清除浏览器存档。相同浏览器下继续使用 `127.0.0.1:8137`；不用清空站点数据。
- 本地 DAIRI 图片仍不在 ZIP 或 Git 提交清单内。此前已导入时，保留旧目录的 `private-assets/dairi/`，可通过导入工具在新工作区重新导入作者素材。
