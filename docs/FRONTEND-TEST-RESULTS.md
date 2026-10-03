# 本次前端改动验证记录

**v3 增量验证见 [UI-LAYER-SAVE-FIX.md](UI-LAYER-SAVE-FIX.md)。此前测试范围保留；本轮重新运行相关两套测试命令通过。**

## v2 追加：首次启动缺陷已修复

此前的相关测试先运行构建，未覆盖新解压且无编译缓存的首次启动，不能证明该场景通过。用户报错后已复现并修复，在独立无缓存目录验证直接启动、npm 离线预览、npm 模拟线上预览均通过。详细环境、范围和回归见 [BOOTSTRAP-FIX.md](BOOTSTRAP-FIX.md)。以下保留上一轮其他功能的记录。

日期：2026-10-03。输入基线：`6e266f0c78ca8f2d465c478733133fba835fca5b`。
环境：Linux 容器，Node.js 22.16.0、Chromium 144.0.7559.96。
测试使用上传项目中的锁定依赖；没有升级 npm 依赖版本，也没有重写 package-lock.json。

## 已执行并通过

| 验证 | 范围 |
|---|---|
| `npm run test:frontend` | 严格构建（56 TS 源文件）、产品目录、全局偏好、启动器生命周期、HTTP 路由、导入器 |
| `test-frontend-manifest.mjs` | 正式前端文件/模块清单，不把私有角色 PNG 当公开资源 |
| `test-dom-contract.mjs` | 336 HTML IDs，251 被引用 IDs，无缺失 |
| `test-browser-module-graph.mjs` | 浏览器模块依赖图 |
| `test-score-dat.mjs` | 成绩解析、损坏拒绝、常用机体、只读存档访问 |
| `scripts/audit-publication.mjs` | Git 源码候选发布审计；新增 CSS 和空 manifest 已列入精确白名单 |
| `git diff --check` | 无补丁空白错误 |

### 本地 HTTP

使用 Node 真实监听 loopback 与请求；上游只提供测试 metadata，不下载游戏。
`dev-lobby.html/css/mjs`、产品契约、共用角色契约及渲染模块均能提供。
拒绝私有/源码路径、外来 Host 与 POST；仅允许 GET/HEAD。
纯界面模式使用明确的 `local-ui-fixture` profile，页面明确提示不是游戏或真实联机环境。

### PNG 导入与映射

20 个角色、TH09 的16角色映射与 TH08 四个组合；用程序构造的 PNG 测试本地导入。
通过 dry-run 不写文件、完整导入、重复导入、同名歧义要求映射、目录越界拒绝、非 PNG 拒绝。
**没有把合成测试像素当成 DAIRI 艺术资源；作者原画未随本包分发，也未完成作者原画的实际构图验收。**

### Chromium 组件

`npm run test:frontend:browser` 通过。实际源码 DOM/CSS/模块，网络与 location 使用显式测试夹具。
不是完整 Launcher 端到端测试。

- 1440×1000 / 390×844：公告加载、空公告、失败提示、安全链接/不注入 HTML。
- 网站入口在五作前，使用 `touhou98`；本地字体加载后检查文字边界，无裁切或横向页面溢出。
- 多人按钮红色。
- 角色图片加载、缺图文字回退、TH08 双图与单人选择；Game info 无存档时不编造数据。
- 全部五作示例房间、单作筛选、创建必须选实际游戏、进入 TH08 房间、选机、准备、返回列表。
- 高级设置展开/收起有中间高度与透明度；快速反向开关、键盘 Enter/Space、系统/站点减少动画。
- 额外执行 Xvfb 有窗口模式：desktop `pointer:fine` 使用 0.42s/0.25s，touch 使用 0.20s/0.14s，均通过。

## 全库检查：没有通过，且不是本次引入

`npm run check` 首先在下列检查中失败：

```text
node tests/test-runtime-build-profiles.mjs
Error: runtime build th10 multiplayer variant must match product registry
```

另取 **未修改的原提交**，重新构建原来的53个 TS 文件，再运行同一测试，复现了完全相同的错误。
本次没有改动游戏 Runtime 构建配置或产品/MP 定义，避免混入不相关的跨项目规则修改。
全量检查因这里中止，不能声称剩余所有库级测试都已通过。PR 中应保留这条基线问题。

## 没有验证的范围

容器浏览器访问 loopback 返回 `ERR_BLOCKED_BY_ADMINISTRATOR`；未更改浏览器策略或绕过限制。
因此采用 Node 真实 HTTP 检查 + 离线浏览器组件，而不声称整站点按键链路 E2E 通过。
未验证 live 主站配置/所有真实 Runtime 的兼容性、远端双人联机、长期游戏性能、实体手机，以及导入具体 DAIRI 原画后的美术构图。

## 交付文件

包内提供完整源码和锁文件；可生成/下载的依赖、字体二进制、缓存、私有素材、游戏数据以及 `.git` 不在包内。
`setup:assets` 可复用原克隆中的字体、封面和图标；不是重新下载整个游戏项目。
`SOURCE-BASE.json` 记录基线和本次每个源码变更的 SHA-256，供独立 PR 工作树应用工具校验。
