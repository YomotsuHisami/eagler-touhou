# UI 重建：本地启动与 B 阶段验收

适用分支：`experiment/ui-rebuild`。这是实验样板，整体重建仍未完成。
本指南对应源码基线 `9da69de042ed200c33eeaa1061cc0c102f856b77`；后续纯文档提交不改变该源码。

## 1. 环境与隔离

- Git、Node.js **24**（项目最低要求 22.22.0）、npm；能够安装锁文件依赖
- 支持 WebGL2、WebAssembly、IndexedDB 的桌面浏览器，允许在本机 loopback 地址运行游戏
- 自己合法持有的、与当前 Runtime/Package 描述匹配的 TH06 数据、字体和 Runtime 发布文件。仓库不包含这些私有资源
- 用新的浏览器测试配置文件和独立的 `http://127.0.0.1:4173` 来源；不要用正式站来源，不要清理正式站存储
- 当前预览不注册 Service Worker。先检查该测试来源无旧 Service Worker 控制；有则换新的测试配置文件或未使用的端口。不要修改正式站的缓存或 Service Worker

以下命令用于**新目录**，已有工作树不要 reset、clean 或覆盖：

```sh
git clone --single-branch --branch experiment/ui-rebuild https://github.com/YomotsuHisami/eagler-touhou.git eagler-touhou-ui-test
cd eagler-touhou-ui-test
git status --short
git rev-parse HEAD
npm ci --ignore-scripts
npm run build:launcher
npm run vendor
npm run check:ui
```

`check:ui` 包含类型、边界、服务与导航测试，以及最终 UI 构建。
这些安装/构建步骤与已通过的 UI CI 一致；上述 clone 需按仓库权限使用自己的正常 Git 登录。
仅看 UI 时可直接执行 `npm run preview:ui`，但缺少游戏文件不能验收真实 Runtime。

## 2. 私有资源放在仓库外

准备独立绝对路径，例如 Windows 的 `D:\private\th06-preview`，或 Linux/macOS 的 `/absolute/private/th06-preview`：

```text
th06-preview/
  host-manifest.json
  runtime-manifest.json
  th06.package.json
  games/th06/th06.data
  shared/msgothic.ttc
  shared/unifont.otf
  runtime/th06/<release-id>/...（manifest 指向的 HTML、JS、WASM 等文件）
```

这是已检查的资源布局示例；路径、字节数、SHA-256、版本和依赖必须以你的匹配 manifest/package 为准。不能只把原版 EXE 放进来。不要修改哈希来跳过校验；缺失文件应补齐匹配版本。音乐或其它可选资源未准备时，记录缺失范围，不能声称完整音频验收。

```sh
node scripts/serve-ui.mjs --port=4173 --assets-root="/absolute/private/th06-preview"
```

Windows 同一命令将 `--assets-root` 替换为自己的绝对路径。保持终端运行，用同一台电脑打开 `http://127.0.0.1:4173/games/th06`。服务器只绑定 loopback；此命令不能让手机访问电脑，也没有公网发布功能。

预览只挂载约定的资源路径，支持 Range；不存在的 JS/WASM/字体返回 404，不回退首页。资源目录不要包含凭据、个人文件或用户存档，也不要提交到 Git。测试仅进入 TH06 单机，避免无意连接 manifest 中的线上联机服务。

可用另一个终端先做 HTTP 检查：

```sh
curl -I http://127.0.0.1:4173/th06.package.json
curl -I http://127.0.0.1:4173/games/th06/th06.data
curl -I http://127.0.0.1:4173/runtime/missing.wasm
curl -I http://127.0.0.1:4173/ui-ownership.json
curl -H "Accept: text/html" -I http://127.0.0.1:4173/games/th06/help
```

期望依次为 200、200、404、404、200；Windows PowerShell 可用 `curl.exe`。HTTP 成功仅证明文件可送达。

## 3. B 阶段人工验收清单

记录 commit、系统、浏览器版本、设备、显示刷新率、是否启用系统减少动态效果，并保留控制台错误、截图/录屏和性能记录。默认动画保持开启；失败项保留 FAIL，无法执行写 NOT RUN。

1. 游戏库 → TH06 设置 → 帮助/资源/Replay 子窗口 → 返回；父窗口和库滚动位置保留。关闭按钮、Esc、Back 一致；Forward、直接链接和刷新也可用
2. 打开一半立即关闭，连续切换窗口，快速 Back/Forward；无过时窗口复活、重复历史条目、焦点丢失或遮罩卡住。首次须知和捐赠窗口也覆盖
3. 安装匹配 TH06 资源后启动真正游戏；观察实际游戏画面和输入，进入可操作场景。不能把测试 iframe、静态截图或“下载完成”算启动成功
4. 游戏运行时打开/关闭帮助和设置、调整窗口尺寸；同一个 Runtime iframe 保持，不重新启动游戏，不出现两份实例或双重存档写入
5. 退出按存档确认流程完成，再进入检查测试存档。保存失败时游戏应保留，显式放弃才退出；仅有自动化故障注入通过时注明这一范围
6. 在两个真实入口使用同一设置表单，核对单机/多人配置身份没有混用。联机未运行则单独标未验证，不能从单机成功推断
7. 收集同环境旧/新截图及默认动画帧时间、长任务记录；观察连续操作，不能只用平均 FPS 或首页分数判断流畅

**手机型号、系统和目标浏览器尚未确定。** 桌面移动视口和 Playwright WebKit 都不能代替真机 Safari/手机验收。loopback 预览不解决手机访问；另行明确获准的本地测试网络/设备方式后，再测横竖屏、软键盘、触控、默认动效和真实游戏，不为此擅自发布站点或扩展网络暴露。

## 4. 已有证据与尚未完成

源码基线 `9da69de` 的[核心 CI](https://github.com/YomotsuHisami/eagler-touhou/actions/runs/37158539087)和 [UI CI](https://github.com/YomotsuHisami/eagler-touhou/actions/runs/37158538756)均通过：93 项浏览器用例通过、3 项 Firefox 旧界面 WebGL2 门槛显式跳过；真实 React RuntimeHost 接合**合成协议 fixture**的测试通过。私有 TH06 文件已做哈希/HTTP 交付检查。真实 TH06 游戏交互和手机性能尚未验收。

- **A 基线：部分完成。** 已核对版本、产品契约、旧/新截图与导航边界；目标手机基线缺失
- **B 样板：进行中。** 组件、导航、服务和合成 Runtime 回归通过；等待本指南的真实游戏闭环和设备体验证据
- **C 全功能迁移：未完成。** 不以已有局部页面替代逐项能力迁移验收
- **D 发布/离线：未完成。** 本预览未验收 PWA 更新、离线、回退或完整自托管切换
- **E 切换/清理：未开始。** 未合并、未部署，旧入口保留

### 尚存架构例外

Framework Mode 保持，React Router 锁定 **8.4.0**。导航适配器目前使用 `UNSAFE_DataRouterContext`、`Router.state`、`Router.subscribe`，后两项在类型声明中同样是 private。它们用于 React 渲染前的即时导航/异步结果失效判断；当前公开 Framework 接口未找到等价同步订阅。改用 Data Mode 并不会把这些 API 变成公开接口。此例外尚未解决，升级必须重跑导航回归并复核，不能把测试通过当作架构验收完成。详见 [UI_REBUILD.md](UI_REBUILD.md#framework-api-boundary)。

需要复跑完整自动化时：

```sh
npm run check
npm run check:ui
npx playwright install --with-deps chromium firefox webkit
npm run test:ui:browser
```

浏览器安装可能需要操作系统依赖安装权限；被策略拒绝时记录阻碍，不绕过。合成 RuntimeHost 的专门测试及环境变量见 [UI 工作流](../.github/workflows/ui-rebuild.yml)。所有自动化均不能替代上述真实游戏和真机验证。
