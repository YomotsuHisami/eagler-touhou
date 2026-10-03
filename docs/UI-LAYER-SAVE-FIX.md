# v3：存档窗口与 Header 层级修复

日期：2026-10-03。基于完整源码 v2，保留此前的目录、公告、按钮、角色映射、离线预览和冷启动修复。

## 修复内容

- 删除 `fileOptions`、`mpFileOptions` 中旧的“存档”行及上传/下载按钮，不只是用 CSS 遮住。
- 继续使用统一存档库的添加、选择、逐项下载；录像下载/管理和单机/联机数据隔离不变。
- 删除 `app.mts` 中旧的隐藏下载按钮补丁及其 CSS。
- 给整个 `.main.library-layout.directory-layout` 明确的 `z-index:0` 和 `isolation:isolate`。
  Header 仍使用现有层级，不把菜单数值无限抬高。Game info、公告、iframe 大厅/房间及卡片动画均被约束在目录层内。
- 原生 `dialog.showModal()` 的顶层行为保留，设置与存档对话框不被 Header 盖住。
- 可选 Runtime 存储验收脚本改用存档库入口，移除对已删除按钮的依赖。

## 本轮验证

环境：Linux 容器、Node.js 22.16.0、npm 10.9.2、Chromium 144.0.7559.96。
依赖复用用户原上传 ZIP 中的锁定版本；未升级依赖或更改 package-lock.json。
ZIP 提取时丢失的 npm 原生工具执行权限只在测试环境恢复，不属于源码修改。

先失败再修复：

- `test-save-dialog.mjs` 用 v2 HTML 运行，发现两颗旧 save action 按钮并失败。
- `test-header-files.mjs` 用 v2 CSS 运行，Header 菜单项命中的是 `score-panel-toolbar`、`scorePanel` 或 `score-note`，复现截图遮挡。
- 同一回归切换至修复后的源码通过。

通过：

- `npm run test:frontend`：严格构建 56 个 TS 源文件、产品/偏好/生命周期、HTTP 路由、20 角色导入、存档窗口 DOM、三条空缓存首次启动路径。
- `npm run test:frontend:browser`：之前的高级设置动画、目录/公告/角色组件测试，以及新增 Header/存档窗口组件测试。
- 新测试覆盖 1440×1000、820×720、390×844，Game info、公告、大厅、房间四种父页面状态的菜单命中/实际点击；键盘展开/Escape；卡片变换期间的覆盖关系。
- 存档组件使用真实 DOM/组件和显式内存存储夹具，校验添加文件、选择、显示有效合成 TH06 成绩、下载逐字节一致。没有读取用户存档。
- 真实原生 iframe 测试父级层叠；iframe 内为明确的代表性内容，不是游戏或真实房间网络连接。
- `test-dom-contract.mjs`：335 个 HTML ID / 251 个被引用 ID，无缺失。
- `test-frontend-manifest.mjs`、`test-browser-module-graph.mjs`、`test-score-dat.mjs`。
- `test-runtime-storage-conformance.py` Python 语法编译；没有运行其真实 Runtime/IDBFS 验收。

## 验证边界

组件测试不是整站浏览器导航 E2E，不证明完整真实游戏或远端联机通过。
没有接入正式 Relay，没有游戏本体、作者原图或实体手机验证。
全库 TH10 基线检查失败的既有记录保留，不能把相关回归通过描述为全库 CI 通过。

## 交付

v3 ZIP 是累计完整源码，排除 `.git`、依赖、缓存、字体二进制、游戏资源、私人素材和存档。
`SOURCE-BASE.json` 更新到 v3 的全部文件校验值。`docs/REMOTE-PUSH.md` 说明如何从原克隆建立独立提交工作树，先推到自己的远程分支，之后再创建 PR。
