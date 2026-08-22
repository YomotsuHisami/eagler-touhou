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
- 桌面键盘、全屏和移动端触控；触控按键可拖动位置、调整大小、左右镜像和恢复默认，TH06/TH07 共用同一布局，横屏与竖屏分别保存；
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
- 仓库固定的 GNU Unifont 15.1.05（`dependencies/unifont-15.1.05/unifont-15.1.05.otf`）。桌面/Web/练习器与静态语言包准备默认共用这一字体，不再依赖系统 MS Gothic/Noto Sans。

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

打开 `http://127.0.0.1:8130/eagler-touhou/`。不能直接双击 `index.html`，因为游戏运行时、WASM、IDBFS 和跨页面协议都要求 HTTP(S) 环境。

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

服务器公开哪些语言、哪些作品允许用户开启 thprac，由 `deploy/server-features.json` 统一决定。服务器拥有者只需要维护这份 allowlist，例如：

```json
{
  "schema": "eagler-touhou/server-features/1",
  "games": {
    "th06": { "languages": ["ja", "lang_en", "lang_ru", "lang_zh-hans"], "thprac": true },
    "th07": { "languages": ["ja", "lang_en"], "thprac": false }
  }
}
```

`ja` 表示不需要下载包的原版日文。其它 `lang_*` 必须已经存在于对应的语言包 catalog 中。部署时即使语言包目录里还保存着更多语言，打包器也只会复制 allowlist 中的 ZIP 到公开目录，并把同一份列表写进 `games.json`；因此网站语言下拉框也只会出现服务器实际允许下载的语言。可用 `-FeatureConfig PATH` 指向另一份服务器清单。

`thprac` 同样按作品独立声明。设为 `true` 时部署脚本才以 `TH_ENABLE_THPRAC=ON` 编译该作 Web runtime，同时前端 Tools 才显示 thprac 开关；用户不开启时运行时保持普通原版行为。这样 TH07 之类尚未完成完整移植的作品可以继续保持不公开，而不影响 TH06。

要提供 TH06/TH07 的服务器语言包，先在准备阶段为每种语言生成一个确定性 ZIP，再把对应目录传给部署脚本。下面是 TH06 示例：

```powershell
$th06LanguagePacks = 'D:\Sites\th06-language-packs'
$th06Archives = @(
  'D:\Games\th06\紅魔郷CM.DAT', 'D:\Games\th06\紅魔郷ED.DAT',
  'D:\Games\th06\紅魔郷IN.DAT', 'D:\Games\th06\紅魔郷MD.DAT',
  'D:\Games\th06\紅魔郷ST.DAT', 'D:\Games\th06\紅魔郷TL.DAT'
) -join ';'
node .\scripts\prepare-th06-language-pack.mjs `
  --language lang_zh-hans `
  --output $th06LanguagePacks `
  --runtime-version auto `
  --thdat '..\dependencies\thtk-bin-12\thtk-bin-12\thdat.exe' `
  --thmsg '..\dependencies\thtk-bin-12\thtk-bin-12\thmsg.exe' `
  --archives $th06Archives

.\deploy\Prepare-eagler-touhou-server.ps1 `
  -Th06Directory 'D:\Games\th06' `
  -Th07Directory 'D:\Games\th07' `
  -Th06LanguagePacks $th06LanguagePacks `
  -OutputDirectory 'D:\Sites\eagler-touhou' `
  -Music midi,ogg
```

TH07 使用同一个准备器，但指定 `--game th07` 和 TH07 原版 `th07.dat`，部署时传 `-Th07LanguagePacks`：

```powershell
$th07LanguagePacks = 'D:\Sites\th07-language-packs'
node .\scripts\prepare-th06-language-pack.mjs `
  --game th07 `
  --language lang_en `
  --output $th07LanguagePacks `
  --runtime-version auto `
  --thdat '..\dependencies\thtk-bin-12\thtk-bin-12\thdat.exe' `
  --thmsg '..\dependencies\thtk-bin-12\thtk-bin-12\thmsg.exe' `
  --archive 'D:\Games\th07\th07.dat'

.\deploy\Prepare-eagler-touhou-server.ps1 `
  -Th06Directory 'D:\Games\th06' `
  -Th07Directory 'D:\Games\th07' `
  -Th07LanguagePacks $th07LanguagePacks `
  -OutputDirectory 'D:\Sites\eagler-touhou' `
  -Music midi,ogg
```

可重复执行准备命令来追加 `lang_zh-hant`、`lang_en` 等语言；是否真正公开由 `server-features.json` 决定。运行时仍只下载用户实际选中的单个 ZIP，并按 runtime 版本和 SHA-256 缓存；不在游戏运行期间访问 thcrap 服务器。如果某作 allowlist 只含 `ja`，可以不提供该作语言包目录，部署脚本会以 `TH_ENABLE_THCRAP=OFF` 构建严格日文基线。

准备环境先安装 `deploy/requirements.txt`。准备器默认收集该语言补丁实际使用的字符，从仓库固定的 GNU Unifont 15.1.05 生成单个 OTF 子集，并丢弃上游补丁附带的其他字体；Linux 服务器只分发已生成的 ZIP。`--font-file` / `--font-name` 仅保留为显式开发覆盖入口，正式发布按项目契约使用 Unifont。可用 `--font-python PATH` 指定安装了 FontTools 的 Python。上游已经预渲染成 PNG 的文字不会因换字体参数而自动重绘，必须按对应 textimage/ANM 源契约单独处理。

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

### 完整离线导入包

正式对外提供的故障兜底包应使用 v2 STORE ZIP，而不是旧的“只有 DATA / OGG”数据包。v2 包从**已经完成的 production staging**生成，因此会把同一部署版本真正使用的资源绑定在一起：当前作品的 runtime HTML / JS / WASM、`.data`、OGG、`msgothic.ttc`、`unifont.otf`，以及该部署公开的全部非日文语言包。页面已经打开后，即使随后完全断网，用户导入这个 ZIP 也应能从 IndexedDB 走完整启动链进入游戏；不依赖 Cache Storage、HTTP 缓存或语言包恰好提前下载过。

```powershell
npm run package:offline-game -- D:\Sites\eagler-touhou th06
npm run package:offline-game -- D:\Sites\eagler-touhou th07
```

`scripts/package-offline-game.mjs` 会重新校验 production runtime、DATA、字体、已重定向到当前 runtimeVersion 的语言包，以及 OGG 的大小/SHA-256，并以 ZIP method 0（STORE）生成正式首版 `eagler-touhou/offline-game-pack/1`。DATA/OGG-only 的 `game-data-pack/1` 是另一种精简包 schema，不包含 runtime、字体或语言包，**不能作为“完整离线启动”保证**。

在线启动时，实际发生的语言包网络下载必须与 GAME DATA / OGG 一样进入左上角传输窗口，显示下载量、速度与 ETA；不得在 GAME DATA 显示完成后静默继续下载语言包。完整离线包中的语言包直接从本地 IndexedDB 读取，因此不会出现网络下载阶段。

## Web 服务器要求

- 公网正式入口应使用 HTTPS；若 TLS 在 CDN/反向代理层终止，源站内部继续使用 HTTP 回源是允许的；
- `.wasm` 使用 `application/wasm`；
- `.js` 使用 JavaScript MIME 类型；
- `.data`、`.wasm`、`.js`、`.css`、`.html` 和字体建议启用 Brotli 或 Gzip；
- 带 `v` 查询参数的 JS、WASM、DATA、CSS 和字体可设置长期不可变缓存；运行时 HTML 应始终重新验证；
- 未带版本号的 HTML、JS、WASM、DATA 和 JSON 应保留 ETag 或 Last-Modified 条件校验，不能长期缓存；
- CDN 缓存键必须保留查询参数，至少必须保留 `v`；若 CDN 忽略查询参数，不同版本仍会命中同一个缓存对象，版本化 URL 将失效；
- 不要给资源响应附加会阻止 iframe、WASM 或音频加载的 CSP。

发布目录仍应保持原子完整，避免用户在上传中途拿到互不匹配的 JS、WASM 或 DATA。正确流程是：

1. 在正式目录之外生成并验证完整 staging；
2. 以同一文件系统中的目录重命名或符号链接切换完成原子发布；
3. 按实际镜像/CDN服务的发布方式手工更新完整版本；本项目不再维护 mtime 继承、自动哈希差集刷新或预热逻辑；
4. 更新完成后从玩家实际访问的域名运行远端验收，核对 `deployment.json`、字节数和 SHA-256。

## 游戏数据备用下载地址

网页的游戏数据网络下载如果在 10 秒内没有收到首字节，或 20 秒内仍未完成，会解锁**手工导入**。部署者还可以在自己的 `server-features.json` 中提供一个完全可选、与供应商无关的外部备用地址：

```json
{
  "schema": "eagler-touhou/server-features/1",
  "gameDataFallback": {
    "url": "https://example.invalid/downloads",
    "hint": "提取码：example"
  },
  "games": { "...": "..." }
}
```

`url` 可以指向任意 HTTPS 云盘、对象存储或独立下载站；`hint` 只是给玩家看的可选说明，可用于显示提取码等信息。默认仓库配置不提供任何外部地址，因此 Eagler 不绑定特定云盘或上传工具。网页只负责打开这个地址，绝不会自动从第三方下载 ZIP；玩家仍需下载文件后通过浏览器文件选择器自行导入。

仓库提供了内容级远端验收器：

```powershell
npm run verify:deployed -- https://example.invalid/
```

它会校验整个 `deployment.json`、TH06/TH07 带版本号的 HTML/JS/WASM/DATA、共享字体、网页入口资源、全部音乐资源及关键缓存头。源站目录完整性检查不能替代这一步。

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
npm run verify:deployed -- https://example.invalid/
```

`audit:publish` 会拒绝公开项目中的游戏数据、音乐、录像、完整字体、大型生成文件，以及两个游戏源码仓库中被 Git 跟踪的私有资源。

## HTTP → HTTPS 玩家数据迁移

仓库提供单文件 `migrate.html`。迁移阶段应让旧 HTTP origin 和新 HTTPS origin **同时保留可访问**，玩家从旧 HTTP 的 `/eagler-touhou/migrate.html` 发起迁移；该页面会打开 HTTPS 下同一路径作为接收端。迁移数据只通过浏览器 `postMessage` 在两个页面之间传递，不上传到服务器。

迁移器会复制 TH06 `/savesth06`、TH07 `/savesth07` 的 IDBFS 存档/Replay、Eagler Touhou 的 localStorage 设置、Emscripten `EM_PRELOAD_CACHE` 中已经下载的 `.data`、`eagler-touhou-local-assets-v1` 中用户导入的 DATA/OGG，以及名称以 `eagler-touhou-` 开头的 Cache Storage（用于兼容旧版导入与语言包）。普通在线播放 OGG 位于浏览器自身的 HTTP cache，网页无法可靠枚举，因此不迁移，会在 HTTPS 下按需重新缓存。

不要在迁移窗口开始时立即启用 HSTS 或把 HTTP 全站无条件 301/308 到 HTTPS；否则旧 HTTP origin 的脚本无法运行，也就无法读取旧浏览器存储。应先保留一段迁移期，之后再收紧 HTTP 重定向/HSTS。

切换 HTTPS 后、正式通知玩家迁移前，必须同时对旧 HTTP 与新 HTTPS 跑迁移窗口验收：

```powershell
npm run verify:migration-cutover -- http://example.invalid/ https://example.invalid/
```

该检查要求两边的 `/eagler-touhou/migrate.html` 都直接返回 200、内容完全一致、HTML MIME 正确且不会被长期缓存；迁移窗口期间 HTTPS 也不得发送 HSTS。这样可以防止 CDN/反向代理把 HTTP migrate 提前重定向或把旧 origin 永久升级掉。

## 存档和 Replay

存档以原版 `score.dat` 原样导入、导出。导入成功后宿主会卸载正在运行的旧实例并返回启动页，避免游戏继续使用导入前的内存状态。

Replay 保持原始 `.rpy` 字节；ZIP 仅作为批量传输容器。Replay 管理器支持下载、改名和删除。

## 引用、素材与许可

主要引用项目和第三方许可证见 [THIRD_PARTY.md](THIRD_PARTY.md)。界面素材来源及发布注意事项见 [ASSETS.md](ASSETS.md)，网页中也提供[关于页](about.html)。
