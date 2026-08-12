# eagler-touhou

`eagler-touhou` 是《东方红魔乡》和《东方妖妖梦》可移植 Web 构建的独立浏览器宿主。它负责游戏选择、音频资源、移动端触控、存档和 Replay 管理；游戏逻辑仍由两个独立的 C++/WebAssembly 项目运行。

> 本项目是非官方爱好者工程，与上海爱丽丝幻乐团、ZUN 及游戏发行方不存在隶属、授权、认可或赞助关系。使用者必须合法持有相应游戏，并仅可在个人、非商业环境中使用本项目进行怀旧与研究；不得利用本项目在互联网上上传、托管、共享或以其他任何形式分发原版游戏数据、音乐、美术及其他受版权保护的资源。本项目不授予任何原版游戏内容的使用或再分发许可。

## 上游项目与致谢

本项目建立在以下两个项目的成果之上：

### [GensokyoClub/th06](https://github.com/GensokyoClub/th06)

提供《东方红魔乡》的反编译与可移植源码基础。本项目具体基于其 [`portable`](https://github.com/GensokyoClub/th06/tree/portable) 分支，分叉基线为 [`9a1c50b`](https://github.com/GensokyoClub/th06/commit/9a1c50b3e7821f2e32e0ff35de7e618216d796e5)；TH06 Web 运行时在此基础上继续开发为 `eagler` 分支。

### [some100/th07](https://github.com/some100/th07)

提供《东方妖妖梦》的反编译、跨平台移植与 Web 构建基础。本项目具体基于其 [`reallyportable`](https://github.com/some100/th07/tree/reallyportable) 分支，分叉基线为 [`9775193`](https://github.com/some100/th07/commit/97751939e47f6d83971fa6225c7ff2cb46ebb77c)；TH07 Web 运行时在此基础上继续开发为 `eagler` 分支。

没有以上作者与贡献者长期公开积累的成果，`eagler-touhou` 无从建立。谨向他们致谢。SDL、Emscripten、webaudio-tinysynth、fflate 等基础设施及其许可信息见 [THIRD_PARTY.md](THIRD_PARTY.md)。

## 功能

- TH06、TH07 单页启动与独立运行路由；
- 原版 `score.dat` 导入、导出；
- 原版 `.rpy` 和 ZIP Replay 管理；
- MIDI、WAV、OGG 三种音乐模式，OGG 支持优先曲目启动和后台下载；
- 桌面键盘、全屏和移动端触控；
- 基于 IDBFS 的浏览器持久化；
- `eagler-touhou/1` 宿主/游戏消息协议。

## 仓库布局

将三个仓库检出到同一工作区。两个游戏运行时必须使用各自的 `eagler` 分支：

```powershell
mkdir eagler-touhou-workspace
cd .\eagler-touhou-workspace
git clone https://github.com/YomotsuHisami/eagler-touhou.git
git clone --branch eagler https://github.com/YomotsuHisami/th06.git th06-eagler
git clone --branch eagler https://github.com/YomotsuHisami/th07.git th07-eagler
git -C .\th06-eagler submodule update --init vendored/SDL vendored/SDL_image vendored/SDL_ttf
git -C .\th07-eagler submodule update --init vendored/SDL vendored/SDL_image vendored/SDL_ttf
git -C .\th06-eagler\vendored\SDL_ttf submodule update --init external/freetype external/plutosvg external/plutovg
git -C .\th07-eagler\vendored\SDL_ttf submodule update --init external/freetype external/plutosvg external/plutovg
```

最终目录结构如下：

```text
workspace/
├─ eagler-touhou/
├─ th06-eagler/
├─ th07-eagler/
└─ toolchains/emsdk/
```

宿主不链接游戏源码。开发模式下，`games.json` 指向两个相邻仓库的 Web 构建；私有部署脚本则把运行时和管理员提供的游戏资源复制到一个独立输出目录。

## 开发环境

当前自动化脚本以 Windows PowerShell 为准，需要：

- Node.js 20 或更新版本；
- CMake 和 Ninja；
- 已安装并激活的 Emscripten SDK；
- Python 3；
- 生成 OGG 时需要 `deploy/requirements.txt` 中的 Python 依赖；
- 合法安装的 TH06、TH07 游戏文件；
- Windows 日文字体，例如 `%WINDIR%\Fonts\msgothic.ttc`。

首次安装前端依赖：

```powershell
npm install --ignore-scripts
npm run vendor
npm run check
```

从 `eagler-touhou` 目录执行不含原版资源的源码构建检查：

```powershell
.\scripts\Build-eagler-runtimes.ps1 `
  -EmsdkDirectory '..\toolchains\emsdk'
```

该模式固定输出到两个游戏仓库的 `build-web-eagler-external`，不能直接供开发网页启动游戏。脚本默认从 `PATH` 使用 `cmake` 和 `ninja`；需要指定路径时可传入 `-CMake` 与 `-Ninja`。

本地开发需要显式嵌入合法持有的游戏资源，输出到 `build-web-eagler-default`：

```powershell
.\scripts\Build-eagler-runtimes.ps1 `
  -EmsdkDirectory '..\toolchains\emsdk' `
  -EmbedLocalAssets
```

默认从 `..\th06-eagler\assets` 和 `..\th07-eagler\assets` 读取资源；也可分别传入 `-Th06AssetDirectory` 与 `-Th07AssetDirectory`。构建产生的 `.data` 等文件仅限本机使用，不得提交或分发。

两种构建用途必须保持目录隔离。不要在同一构建目录中来回切换 `TH_EXTERNAL_ASSETS`：CMake 会复用缓存，外置资源构建将不包含游戏档案，而开发网页的 `games.json` 只指向 `build-web-eagler-default`。

启动本地开发服务器：

```powershell
cd .\eagler-touhou
npm start
```

打开 `http://127.0.0.1:8130/eagler-touhou/`。不能直接双击 `index.html`，因为游戏运行时、WASM、IDBFS 和跨页面协议都要求 HTTP 环境。

### 故障排查：声音和输入初始化后游戏立即退出

典型表现是 TH06、TH07 无法进入标题界面。运行日志先显示 DirectSound、DirectInput 已正常初始化，随后出现 `error : ... is not found`、声音文件无法读取、纹理或动画数据损坏等错误。此时通常不是声音或输入设备故障，而是运行时没有取得原版游戏档案。

本项目有两种互斥的 Web 构建：

- `TH_EXTERNAL_ASSETS=OFF`：把合法持有的本地游戏档案打入 `.data`，供 `build-web-eagler-default` 本地开发使用；
- `TH_EXTERNAL_ASSETS=ON`：不包含原版游戏档案，只用于 `build-web-eagler-external` 的公开源码编译检查，不能单独启动游戏。

如果曾在 `build-web-eagler-default` 上执行 `-DTH_EXTERNAL_ASSETS=ON`，CMake 会把这个选择保存在该目录的 `CMakeCache.txt` 中。后续增量编译仍会产出 HTML、JS、WASM，但生成的运行时不再引用包含游戏档案的 `.data`；开发网页继续指向这个目录时，就会在完成声音和输入初始化后因缺少资源退出。

确认两个本地开发构建均为 `OFF`：

```powershell
Select-String '..\th06-eagler\build-web-eagler-default\CMakeCache.txt' -Pattern '^TH_EXTERNAL_ASSETS:'
Select-String '..\th07-eagler\build-web-eagler-default\CMakeCache.txt' -Pattern '^TH_EXTERNAL_ASSETS:'
```

若结果为 `ON`，从 `eagler-touhou` 目录重新生成本地可玩构建：

```powershell
.\scripts\Build-eagler-runtimes.ps1 `
  -EmsdkDirectory '..\toolchains\emsdk' `
  -EmbedLocalAssets
```

完成后确认 `build-web-eagler-default` 中相应的 `.data` 文件已重新生成，再强制刷新网页以绕过旧运行时缓存。不要通过复制或提交 `.data` 解决该问题；这些文件包含原版游戏资源，仅限本机或获授权的私有部署使用。

预防规则：公开源码构建只能写入 `build-web-eagler-external`，本地可玩构建只能写入 `build-web-eagler-default`。不得在同一 CMake 构建目录中切换 `TH_EXTERNAL_ASSETS`。

## 从原版文件生成私有部署

公开仓库不应包含原版 `.dat`、`.data`、WAV、OGG、MIDI、Replay、完整字体或用户存档。服务器管理员必须在自己的机器上生成部署目录。

示例目录：

```text
D:\Games\th06\
  紅魔郷CM.DAT ... 紅魔郷TL.DAT
  bgm\th06_01.wav ... th06_17.wav

D:\Games\th07\
  th07.dat
  thbgm.dat
```

完整生成 MIDI + OGG 部署：

```powershell
cd .\eagler-touhou
python -m pip install -r .\deploy\requirements.txt
.\deploy\Prepare-eagler-touhou-server.ps1 `
  -Th06Directory 'D:\Games\th06' `
  -Th07Directory 'D:\Games\th07' `
  -OutputDirectory 'D:\Sites\eagler-touhou' `
  -Music midi,ogg
```

需要同时提供原始 WAV 模式时使用 `-Music midi,ogg,wav`；仅提供 MIDI 时使用 `-Music midi`。

脚本会：

1. 校验原版资源和字体；
2. 将私有游戏资源复制到临时管理目录；
3. 从空构建目录编译 TH06、TH07 WebAssembly；
4. 按需转换并校验 OGG；
5. 生成可直接托管的目录和 `deployment.json` SHA-256 清单；
6. 运行部署完整性检查；
7. 删除包含中间私有资源的管理目录。

输出目录结构：

```text
deployment/
├─ deployment.json
├─ eagler-touhou/
├─ games/th06/
├─ games/th07/
└─ shared/
```

把该目录作为站点根目录提供，然后访问 `/eagler-touhou/`。

## Web 服务器要求

- `.wasm` 使用 `application/wasm`；
- `.js` 使用 JavaScript MIME 类型；
- `.data`、`.wasm`、`.js`、`.css`、`.html` 和字体建议启用 Brotli 或 Gzip；
- 带 `v` 查询参数的资源可设置长期不可变缓存；
- 未带版本号的 HTML 和 JSON 应保留 ETag 或 Last-Modified 条件校验；
- 不要给资源响应附加会阻止 iframe、WASM 或音频加载的 CSP。

项目自带服务器可用于验证生产目录：

```powershell
node .\scripts\serve.mjs 8130 'D:\Sites\eagler-touhou'
```

## 验证

```powershell
npm run check
npm run test:shell
npm run test:server
npm run audit:publish
node .\scripts\verify-server-build.mjs 'D:\Sites\eagler-touhou'
```

`audit:publish` 会拒绝公开项目中的游戏数据、音乐、录像、完整字体、大型生成文件，以及两个游戏源码仓库中被 Git 跟踪的私有资源。

## 存档和 Replay

存档以原版 `score.dat` 原样导入、导出。导入成功后宿主会卸载正在运行的旧实例并返回启动页，避免游戏继续使用导入前的内存状态。

Replay 保持原始 `.rpy` 字节；ZIP 仅作为批量传输容器。Replay 管理器支持下载、改名和删除。

## 引用、素材与许可

主要引用项目和第三方许可证见 [THIRD_PARTY.md](THIRD_PARTY.md)。界面素材来源及发布注意事项见 [ASSETS.md](ASSETS.md)，网页中也提供[关于页](about.html)。
