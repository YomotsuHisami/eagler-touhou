# 首次启动修复记录（2026-10-03）

## 问题与原因

原完整源码包没有附带 `.cache/build`（该目录应由本机构建生成）。
`lib/frontend-manifest.mjs` 同时静态导入了已编译的 `product-catalog`，
并在模块正文中调用 `ensureLauncherBuild()`。首次启动会先执行静态依赖，
因此还没进入构建步骤，就因缺少编译后的契约模块退出。

这不是缺少 npm 包；也不是字体准备失败。之前 `test:frontend` 会先运行构建，
因此通过它不能证明新解压、尚未构建的包能够直接启动。上一轮的首次启动验证遗漏了这个条件。

## 修复

在 `ensureLauncherBuild()` 完成后，用动态导入加载 `PRODUCT_GAMES`。
不手工伪造 `assets/contracts` 文件、不放宽协议校验、不更换依赖或锁文件。
直接执行预览脚本、`preview:offline` 和 `preview:local` 都沿用这个初始化顺序。

## 已执行的验证

环境：Linux 容器，Node.js 22.16.0 / npm 10.9.2。
依赖使用用户原上传项目中已安装的锁定版本；本轮没有重新从 npm 注册表安装依赖。
字体通过 `setup-local-assets.mjs` 从原上传文件中核对并复制，未打包分发。

- 原包的空缓存首次启动：复现相同 `Cannot find module ... assets/contracts/product-catalog.mjs`。
- 原包先 `npm run build:launcher` 再启动：构建 56 个 TypeScript 源文件；首页、五作配置、大厅及模块请求均返回 HTTP 200。
- 新增 `tests/test-local-preview-cold-start.mjs`：每次在独立临时源码目录删除测试目录自身的构建缓存；确认生成模块不存在后才启动。
- 同一个冷启动回归在修复前失败，在修复后通过。
- 直接 `node eagler-local-preview.mjs --offline=true`：通过。
- `npm run preview:offline`：通过。
- `npm run preview:local` 接隔离的本地模拟上游：通过；上游仅有两个配置请求，没有下载游戏。
- 每条路径检查 11 个真实本地 HTTP 路由，包括首页、脚本、CSS、Service Worker、大厅和独立契约模块；五作目录齐全。
- `npm run test:frontend`：包含新增冷启动回归，全套通过。

这些是源码构建和 Node HTTP 集成验证，不是整站浏览器 E2E、真实游戏运行或双人联机验收。
没有改变之前明确保留的全库 TH10 基线检查失败结论。

## 原包的立即恢复命令

```bash
npm run build:launcher && npm run preview:offline
```

修正版已自动处理构建顺序，新解压后不必手动补这一行。
新包没有 `.git`、`node_modules`、缓存、字体二进制、游戏数据或 DAIRI 原图。
