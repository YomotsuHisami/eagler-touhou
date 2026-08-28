# Eagler Touhou 跨平台架构收敛与重构执行规范

> 目的：给下一位 Agent 直接执行。  
> 本文不是历史复盘，也不是候选方案集合，而是本轮架构重构的目标规范。  
> 目标是得到一个在 iOS WebKit、Android Chromium/WebView/Via、桌面浏览器上都尽量稳定、简单、可维护的 Eagler Touhou。

---

## 1. 最高原则

本轮重构的最高优先级不是“架构统一”，而是：

1. **跨平台兼容性第一。**
2. **外部已有成熟、经过实际项目验证的路径优先。**
3. **Emscripten、Godot、浏览器标准能力已有成熟做法时，不自行重新设计同类基础设施。**
4. **能够删除一层，就不要新增另一层去修补这一层。**
5. **产品能力是硬要求，内部实现统一不是硬要求。**
6. **真实设备结果高于桌面模拟、静态 contract 和自动化结果。**
7. **iOS、Android、桌面允许采用不同的最小兼容路径，不为了形式统一增加风险。**
8. **不要把“技术上可以无感完成”误当成“产品必须无感完成”。**
9. **慎用自创协议、自创虚拟文件系统、自创浏览器生命周期协调层。**
10. **没有明确产品收益的复杂设计默认删除。**

一句话：

> **成熟路径优先于自创路径，兼容性优先于形式统一，简单路径优先于智能路径。**

---

# 2. 本轮真正需要保留的产品能力

以下是产品能力，不得因为架构简化而误删。

## 2.1 游戏可以远程获取

Launcher 能从服务器获取支持的 TH06 / TH07 游戏内容，并完成安装、更新和启动。

## 2.2 用户可以导入游戏内容

用户导入的游戏内容可以运行。

但注意：

> **不再要求“用户导入”和“远程下载”在内部架构上地位完全相同。**

真正要求只有：

> **导入的内容之后能够被识别，并继续接入远程更新。**

例如：

```text
用户导入 TH07 某版本
→ Launcher 识别游戏、版本或内容身份
→ 建立与官方远程 release line 的关联
→ 后续出现新版
→ 可以正常升级
```

至于导入和远程是否：

- 使用同一个 installer
- 使用同一个存储结构
- 使用同一种 metadata
- 使用同一个 transport
- 使用完全一样的 generation 生命周期

都不是产品要求。

哪个方案成熟、简单、兼容性高，就采用哪个。

## 2.3 已安装内容应可以离线运行

服务器不可用时，已完整安装的游戏仍应能运行。

不要为了实现离线运行，把 Service Worker 变成游戏 Runtime 的虚拟文件服务器。

## 2.4 存档必须可靠持久化

至少包括：

- 游戏存档 / score
- config
- replay
- 其他明确属于用户生成的数据

用户数据必须与游戏包版本解耦。

游戏更新、远程覆盖、重新导入、Runtime 更新都不能无故删除这些数据。

## 2.5 OGG 只保留一个非常简单的渐进目标

唯一产品要求：

```text
前两首 OGG 完整准备好
→ 允许进入游戏
→ 剩余 OGG 后台继续准备
```

后台资源：

```text
完整完成一首
→ 这一首可用
```

尚未完成：

```text
→ 不可用
```

不要增加：

- 半首流式使用
- 即将播放预测
- need-track 优先请求
- Runtime 主动抢资源
- OGG 调度协议
- 缺歌等待协议
- 为音乐单独建立复杂状态机
- 为“更聪明”而设计的动态优先级

目标就是：

> **下完了能用，没下完不用。**

## 2.6 App Shell 可以更新

但“无感热更新”不是硬要求。

允许：

```text
发现 Launcher/App Shell 更新
→ 当前没有运行游戏
→ reload 一次
```

如果游戏正在运行：

```text
→ 本局继续
→ 退出游戏后 reload
```

不要求旧页面、新 worker、新协议在运行中热交接。

---

# 3. 本轮应主动删除的设计

下面不是“实现细节优化”，而是应从架构目标中删除的设计。

---

## 3.1 删除：Package Service Worker 作为 Runtime 文件服务器

删除这种架构目标：

```text
Package Store
→ Service Worker
→ /__runtime__/...
→ synthetic HTTP Response
→ Runtime fetch
```

Service Worker 可以继续存在，但职责仅限：

```text
App Shell cache
App Shell offline
App Shell update
```

它不得成为：

- 游戏 DATA 的文件服务器
- OGG 的文件服务器
- Package Store 的 HTTP 转换层
- Runtime 是否允许启动的必要条件

### 原因

该层会把游戏启动强行绑定到：

- worker install
- worker activate
- controller ownership
- controllerchange
- stale document
- old/new app.js
- Safari/WebKit worker 生命周期

这些都不是运行 TH06 / TH07 的业务必需条件。

---

## 3.2 删除：启动必须等待 Service Worker ready/active/controller

游戏启动不应依赖：

```text
navigator.serviceWorker.ready
registration.active
navigator.serviceWorker.controller
controllerchange
Service Worker capability handshake
```

即使 App Shell 的 SW 暂时不可用，只要当前 Launcher 和本地游戏内容完整，游戏仍应有能力启动。

---

## 3.3 删除：旧 Launcher 与新 Service Worker 的热协议迁移

不再设计：

```text
旧 Document
+ 旧 app.js
+ 新 active worker
+ 新 capability
+ 新协议
→ 尽量不刷新继续工作
```

改成最保守规则：

```text
版本不一致
→ 没有游戏运行
→ reload
```

运行中则延迟到退出。

---

## 3.4 删除：本地 Package 必须伪装成普通 HTTP 资源

删除这个隐含目标：

> 本地 IndexedDB 里的所有游戏文件都必须获得一个 URL，Runtime 再通过 fetch 像访问服务器一样访问它。

逻辑资源身份可以统一，例如：

```text
game = th07
resource = data
version = xxx
```

但本地与远程不要求使用同一种传输协议。

允许：

```text
远程
→ fetch
```

而本地：

```text
IndexedDB
→ ArrayBuffer
→ Runtime
```

**逻辑身份统一，不等于 transport 必须统一。**

---

## 3.5 删除：Package 自带一整套可执行 Runtime 是硬要求

不再要求每一个离线包或用户导入包都携带并执行自己的：

- Runtime HTML
- Runtime JS
- Runtime WASM

推荐目标：

```text
Launcher / App 管理受支持 Runtime
游戏内容声明自己需要的 Runtime ABI / game target
Launcher 选择兼容 Runtime
```

用户导入的核心应是“游戏内容”，而不是任意一套网页执行环境。

如果确实存在必须支持特殊 Runtime 的历史包，可以做迁移兼容，但不要继续把“Package 自带 Runtime”作为未来主架构。

### 用户可见代价

某个非常旧或特殊的导入包可能提示：

```text
需要更新 Launcher / Runtime 后才能运行
```

这是可以接受的。

---

## 3.6 删除：Blob URL 承担整个 Runtime HTML 页面导航

硬规则：

```text
Blob 可以作为字节资源载体
```

但不要再把：

```text
iframe.src = blob:PackageHTML
```

作为正式 Runtime 页面架构。

尤其不要重新建立多层：

```text
about:blank
→ blob document
→ nested blob iframe
```

历史上移动 WebView 已经证明这种 document navigation 不稳定且慢。

---

## 3.7 删除：所有资源必须使用同一种加载方式

不要为了“统一 Package object”而强迫：

- Runtime JS
- WASM
- DATA
- OGG
- 字体
- 语言
- 存档

走同一种浏览器加载机制。

它们性质不同，应允许使用最成熟的路径。

例如：

```text
Runtime JS/WASM
→ 标准网页 Runtime 资源路径

DATA
→ Emscripten 文件准备路径

OGG
→ 独立后台完整文件准备

save/config/replay
→ Emscripten IDBFS 或等价成熟持久化路径

字体
→ 浏览器/Runtime 已验证路径
```

存储层可以统一，消费方式不要求统一。

---

## 3.8 删除：Runtime 可以把 Package Store 当成长期在线文件系统

Runtime 启动后，不应随意直接查询 Package Store。

目标是：

```text
Launcher / host 负责准备资源
Runtime 使用已经准备好的资源
```

OGG 允许后台增加，但仍由外部准备完成后交给 Runtime。

Runtime 不需要知道：

- Package Store
- generation 安装进度
- 下载来源
- Service Worker
- 本地还是远程

---

## 3.9 删除：安装、更新和运行必须形成一个复杂的交错状态机

不再追求：

```text
generation 一边安装
Runtime 一边读取
版本一边切换
旧资源还在 lazy read
```

尽量让状态边界清晰。

核心游戏内容：

```text
完整、可验证
→ 才成为可启动版本
```

OGG 是唯一明确允许后台继续补齐的资源类别之一，因为产品明确要求“两首后启动”。

---

## 3.10 删除：远程下载与用户导入必须完全同权

这是最新产品需求修正。

旧目标：

```text
remote == import
```

删除。

新目标：

```text
imported content
→ 可识别
→ 可运行
→ 可以继续接受远程更新
```

内部是否完全同权不重要。

因此不要为了“同权”强迫建立：

- 同一个 installer
- 同一个 transport
- 同一个 generation 状态
- 同一个 object pipeline
- 同一种来源抽象

如果统一恰好简单，可以统一。

如果不统一更成熟、更稳，就不要统一。

---

# 4. 推荐的最终架构

不要重新发明完整架构。

以成熟 Emscripten/Web 游戏路径为基础，尽量收敛到：

```text
                 Eagler Touhou Launcher
                         │
             ┌───────────┴───────────┐
             │                       │
       Remote content            User import
             │                       │
             │                 identify / validate
             │                       │
             └───────────┬───────────┘
                         │
                 Local game storage
                         │
                  selected version
                         │
                         ▼
                 Runtime preparation
                         │
             ┌───────────┼────────────┐
             │           │            │
            DATA      first 2 OGG   required assets
             │           │            │
             └───────────┴────────────┘
                         │
                  Emscripten FS
                         │
                      callMain
                         │
                    first-frame
                         │
               remaining OGG background
                         │
              complete file → Runtime FS
```

用户数据独立：

```text
Runtime FS
   ↕
IDBFS / 等价成熟持久层
   ↕
IndexedDB

save
config
replay
```

App Shell：

```text
Service Worker
   │
   ├─ cache App Shell
   ├─ offline App Shell
   └─ update App Shell
```

与游戏资源路径分离。

---

# 5. Runtime 方向

## 5.1 不要重写 Emscripten Runtime

TH06 / TH07 本身已经是 Emscripten/WASM 项目。

优先复用：

- Emscripten FS
- MEMFS
- IDBFS
- Module 生命周期
- 标准 JS/WASM 启动方式
- 当前已经稳定的 SDL/WebGL 路径

不要为了 Package 统一再套一层自创 Runtime filesystem。

## 5.2 DATA

目标是让 DATA 以最直接、最成熟、最少浏览器中间层的方式进入 Emscripten 看到的文件系统。

优先调查并采用：

- Emscripten 标准 preload/file API
- Runtime 启动前直接 materialize
- 已有 generated DATA loader 能否做最小改造

避免：

```text
IndexedDB
→ fake URL
→ SW
→ Response
→ stream
→ DATA loader
```

如果现有 Emscripten generated loader 可以通过最小注入接收已有 bytes，则优先复用，而不是创建新 filesystem。

---

# 6. OGG 最终要求

这是硬产品要求，但实现必须极简。

## 6.1 启动 barrier

```text
OGG 1 完整
OGG 2 完整
→ 两首均可被 Runtime 使用
→ 允许进入游戏
```

不要求剩余 OGG 完成。

## 6.2 后台补齐

进入游戏后：

```text
OGG 3 下载完成
→ 可用

OGG 4 下载完成
→ 可用

...
```

没有额外智能调度。

## 6.3 尚未完成的 OGG

```text
未完成
→ 就当不存在
```

不要：

- partial playback
- range merge
- 预测
- Runtime 阻塞等待
- 抢占
- 动态 priority
- need-track protocol

## 6.4 导入 OGG

如果用户导入内容中已经存在某首完整 OGG，则直接视为已准备资源。

如果缺失，则可以继续由远程更新补齐。

---

# 7. 远程更新与用户导入

## 7.1 导入识别

导入时只需要获得足够的信息用于：

```text
这是哪个游戏
这是哪个兼容版本/内容身份
它可以关联到哪个远程更新线
```

识别方法可以是：

- manifest
- known file hashes
- DATA identity
- package metadata
- 其他成熟可靠方式

不要为了通用性设计复杂 package dialect。

## 7.2 后续更新

导入后：

```text
local imported installation
→ remote catalog identifies newer compatible release
→ download needed replacement/update content
→ activate updated version
```

不要求“导入内容永远保留 import 身份”。

第一次成功更新后，它完全可以转换成标准远程安装状态。

这反而通常更简单。

## 7.3 不碰用户数据

任何：

- 导入
- 更新
- Runtime 更新
- 游戏内容替换

都不能直接覆盖 save/config/replay 存储域。

---

# 8. Service Worker 的最终职责

保留 Service Worker 是可以的，但职责必须非常窄：

```text
/eagler-touhou/index.html
app.js
styles.css
静态 Launcher assets
```

用于：

- App Shell offline
- 更新检查
- cache

禁止继续扩展为：

- Package filesystem
- Runtime server
- OGG server
- IndexedDB proxy
- DATA bridge
- Runtime capability gate

如果某个浏览器 Service Worker 有故障：

> 已安装游戏不应仅因为 SW 状态异常而无法启动。

---

# 9. iOS / Android / Desktop 平台原则

## 9.1 iOS WebKit

真实 iPhone/iPad 是最高风险平台。

原则：

- 少 iframe lifecycle 技巧
- 少 blob document navigation
- 少 Service Worker 关键依赖
- 少 MessageChannel/跨 context 数据协议
- 少浏览器状态组合
- 使用标准 Emscripten/DOM/Web API
- iOS 专有 workaround 必须限定在 iOS

已有 direct-touch 若确实解决 WebKit 多点触控问题，可以保留。

不要为了“输入统一”把 Android 一起切过去。

## 9.2 Android

Android Chrome / Via / WebView 应尽量继续成熟原路径。

尤其避免：

- 重建 Response.body
- nested blob document
- 为 iOS workaround 改写 Android 正常路径

## 9.3 Desktop

桌面浏览器可以拥有更多能力，但不能成为架构设计基准。

桌面 PASS 不能证明 iOS/Android PASS。

---

# 10. 存档和退出

保持成熟的：

```text
Runtime 活着
→ final persistent sync
→ sync 完成
→ 发 exit
→ Launcher 关闭 Player
```

不要恢复：

```text
Runtime 已 exit
→ Launcher 再 RPC 请求 sync
```

游戏数据版本和用户存档必须分离。

如果使用 Emscripten IDBFS 已经能满足需求，就继续使用，不要为了“统一 Package Store”把存档迁进去。

---

# 11. 更新 UX

删除“必须无感更新”的要求。

推荐：

### 没有运行游戏

```text
发现 Launcher 更新
→ 完成必要更新
→ reload
```

### 正在运行游戏

```text
发现更新
→ 记录 pending update
→ 不影响本局
→ 退出游戏
→ reload
```

用户可见代价只是偶尔刷新一次页面。

这是可以接受的。

---

# 12. 明确非目标

下一位 Agent 不要重新把这些当目标：

- 所有来源底层完全统一
- 所有平台走完全相同代码路径
- 所有资源都必须 URL 化
- 所有资源都必须 fetch
- Package 必须携带 Runtime
- 本地资源必须伪装成服务器资源
- Runtime 必须可以随时访问 Package Store
- Service Worker 必须参与游戏启动
- 旧 App 与新 SW 必须无 reload 热交接
- OGG 必须智能调度
- 安装和游戏运行必须高度并发
- 为未来未知需求预先设计复杂抽象

---

# 13. 下一位 Agent 的执行顺序

必须先做架构删除，再做新路径。

不要在旧架构上继续补 patch。

## Phase 0 - 保存现状

1. 读取现有 handoff/history。
2. 记录当前工作树。
3. 不 reset / checkout / restore / clean。
4. 不删除用户已有 dirty 工作。
5. 找出最后一个真实设备能进游戏的旧启动链作为对照。
6. 记录当前 r69x WebKit 启动链仅用于理解，不继续加层。

## Phase 1 - 划清三个存储域

明确代码中的三个域：

```text
A. Launcher/App Shell
B. immutable game content
C. mutable user data
```

禁止再混合。

## Phase 2 - Service Worker 退出 Package Runtime

删除 Runtime 启动对：

- SW readiness
- controller
- capability
- /__runtime__/
- Package synthetic Response

的硬依赖。

SW 退回 App Shell。

这是第一优先级。

## Phase 3 - Runtime 收敛

选择外部成熟方案中最贴近当前 Emscripten build 的方式：

```text
game bytes
→ Emscripten FS / generated preload-compatible path
→ callMain
```

优先最小修改当前 generated runtime。

不要建立“Package Installer 2”。

## Phase 4 - 导入路径简化

不追求 import/remote 同权。

目标只做：

```text
import
→ identify
→ usable local installation
→ attach remote update identity
```

如果导入后第一次远程更新最简单的方式是直接转换成标准远程安装，就这样做。

## Phase 5 - OGG 极简 progressive

只实现：

```text
first 2 ready
→ launch

remaining complete
→ usable
```

除此之外不增加资源协议。

## Phase 6 - 用户数据

确认：

- save
- config
- replay

继续独立持久化。

升级游戏不会清空。

## Phase 7 - 删除旧兼容层

新路径实际运行后，删除不再需要的：

- Package SW Runtime routes
- capability handoff
- old carrier fallbacks
- obsolete page-memory bridges
- synthetic local HTTP layers
- 不再使用的 Blob document carrier
- 为这些路径服务的状态/UI/测试

不要让旧路径长期和新路径并存。

---

# 14. 验收标准

不能只以 build success 为准。

验收层级：

```text
1. static / contract
2. Chromium desktop
3. Firefox desktop
4. WebKit automation
5. Android Chrome
6. Android WebView / Via
7. real iPhone / iPad WebKit
```

真实设备优先。

## 必须验证

### TH06 / TH07

- 首次远程安装
- 第二次离线启动
- 用户导入
- 导入后远程更新
- DATA 正常
- 前两首 OGG 后启动
- 后续 OGG 后台逐首变为可用
- 存档写入
- 退出
- 重启后存档存在
- 更新游戏后存档仍存在

### iOS

至少验证：

- Launcher 打开
- Runtime 打开
- first-frame
- 正常游戏
- 多点触控
- 退出
- 存档
- 第二次启动
- App Shell 更新后的 reload 行为

### Android

至少验证：

- Chrome
- 当前主要真机
- Via 或目标 WebView 路径
- 不因 iOS workaround 回归

---

# 15. 成功后的目标状态

最终的 Eagler Touhou 不应该再让人描述成：

> 一个由 Package Store、Service Worker、虚拟 URL、Runtime carrier、page-memory bridge、capability handshake 等多层组成的浏览器运行平台。

而应该能够简单描述成：

> **一个普通的 Emscripten Touhou Web Runtime，加一个负责安装/更新游戏内容的 Launcher，以及一个独立可靠的用户存档层。**

远程游戏：

```text
下载
→ 本地可用内容
→ Runtime
```

导入游戏：

```text
导入
→ 识别
→ 本地可用
→ 后续可以远程升级
```

游戏运行：

```text
必要资源准备
→ 前两首 OGG 准备
→ callMain
→ 游戏
→ 剩余 OGG 后台完成后可用
```

用户数据：

```text
save/config/replay
→ 独立持久化
```

App 更新：

```text
必要时 reload
```

没有其他隐藏的架构要求。

---

# 16. 给下一位 Agent 的最终指令

**不要继续修补当前复杂 Package Runtime 启动链。**

本轮工作是一次主动的架构收敛：

1. 保留真正需要的产品能力。
2. 删除为了“统一”“无感”“智能”“未来扩展”而出现的基础设施。
3. 优先回到 Emscripten/Godot/成熟 Web 游戏项目验证过的常规路径。
4. 不新造 Package Installer。
5. 不新造 Runtime filesystem。
6. 不新造资源调度协议。
7. 不让 Service Worker 再成为游戏 Runtime 的依赖。
8. 不要求 import/remote 内部同权，只保证导入后能够接受远程更新。
9. OGG 只做“前两首先准备，其余完整一首可用一首”。
10. 所有跨平台决策都以真实 iOS/Android 结果为最终依据。

如果一个新方案需要新增很多状态、协议、fallback 或浏览器生命周期协调代码，先停止实现并重新检查：

> **外部成熟项目是不是已经有更简单的办法。**

最终目标不是“最先进的浏览器 Package 系统”。

最终目标是：

> **一个简单、稳定、可离线、可更新、可导入、存档可靠，并且在 iOS、Android、桌面浏览器上真正容易运行的 Eagler Touhou。**
