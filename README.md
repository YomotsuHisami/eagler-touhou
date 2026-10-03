> 本地 frontend-redesign 源码包：先阅读 [本地运行与测试](LOCAL-DEVELOPMENT.md)、[角色素材导入](docs/DAIRI_ART.md) 和 [PR 提交说明](docs/FRONTEND-PR.md)。

<h1 align="center">
  <img src="docs/assets/eagler-touhou-wordmark.svg" alt="EAGLER TOUHOU" width="312">
</h1>

<div align="center">
  <p>简体中文 | <a href="README.en.md">English</a></p>
  <p>一个在 Web 上运行东方 Project 原作的<strong>游戏启动器</strong>和<strong>联机平台</strong>。</p>
  <p>
    <a href="https://qm.qq.com/q/eeUrxIltug?from=tim"><img src="https://img.shields.io/badge/QQ%20Group-1124121427-12B7F5?logo=tencentqq" alt="QQ Group 1124121427"></a>
    <img src="https://img.shields.io/badge/Node.js-%3E%3D22-43853d" alt="Node.js >=22">
    <img src="https://img.shields.io/badge/Python-3-3776ab" alt="Python 3">
    <a href="LICENSE"><img src="https://img.shields.io/badge/License-GPL--3.0--or--later-blue.svg" alt="License: GPL-3.0-or-later"></a>
  </p>
  <p><a href="https://github.com/YomotsuHisami/eagler-touhou/blob/main/docs/README.md">开发文档 📄</a>&nbsp;|&nbsp;<a href="https://touhou.vip/">立刻体验 🎮</a></p>
</div>

## 概要

在保证原作体验的基础上，提供触控适配与个性化布局、STG 社区热门工具、存档和 Replay 管理、多人联机大厅。

在安全上下文条件下，启动器网页**可以被离线运行**。在玩家离线或服务器宕机时，玩家即使刷新了页面也可以使用 Service Worker 提供的缓存文件正常进行游戏。

## 详细功能

### 完整的原作体验

![Eagler Touhou 启动器与游戏管理界面](docs/assets/readme/launcher.webp)

- 允许用户在浏览器中运行 TH06、TH07、TH08、TH09 和 TH10，并提供导入导出存档、Replay 等文件的界面。
- TH09 使用独立的 C++/SDL3 Runtime，当前不提供 thprac；构建和发布需要部署者自行提供原版 `th09.dat`、字体表与 19 首预处理 OGG。参见 `scripts/prepare-th09-content.mjs` 和 TH09 仓库的 `web:eagler` 构建脚本。

本地只测试 TH09 时，可将 `EAGLER_DEVELOPMENT_GAMES=th09`、`EAGLER_TH09_CONTENT_DIR` 指向 `prepare-th09-content.mjs` 的输出目录，并用 `EAGLER_DEVELOPMENT_VANILLA_FONT`、`EAGLER_DEVELOPMENT_UNICODE_FONT` 指定本地字体。这样开发服务器只为 TH09 生成 Host Manifest，不要求同时编译其余游戏；正式发布仍需完整的 Runtime Release 与 Host 资源。
- 存档、Replay 等完全和原版互通。
- 力求完美体验。解决了原 portable 分支中出现的 弹幕抖动、弹幕运动不流畅、闪烁、单线程切换音乐卡顿、手机卡顿 等大量问题。
- 优化非常好，至少能在骁龙 660 上稳定 90Hz 运行。
- 支持高刷新率（>60Hz）。\[感谢 [reallyportable](https://github.com/some100/th07/tree/reallyportable)\]

### 触控适配

![可调整位置、大小、灵敏度和低速操作方式的触控布局](docs/assets/readme/touch-controls.webp)

- 触摸轨迹 = 游戏人物移动轨迹。提供直接触摸、无限速直接触摸，除此之外，还提供轮盘等移动方式。\[感谢 [reallyportable](https://github.com/some100/th07/tree/reallyportable)\]
- 触控布局自定义。触控按键可以随意拖动、缩放（60% ~ 180%）。
- 提供放大镜，允许玩家在游戏中即时地用双指缩放手势去放大游戏画面。再也不怕看不清弹幕了（x
- 可以保存触控 Replay，并且直接记录输入到游戏里的触摸轨迹。
- 触控菜单手势。\[by [reallyportable](https://github.com/some100/th07/tree/reallyportable)\]
- 触控灵敏度。
- 可以调整游戏画面的默认位置。
- 提供按住按钮、切换按钮和双指操作等低速方式。

### STG 社区热门工具

![在浏览器中使用 thprac 练习菜单](docs/assets/readme/stg-community-tools.webp)

#### thprac

- 适配 [thprac](https://github.com/touhouworldcup/thprac) 的所有功能。
- 支持在触控设备上使用模拟鼠标，并提供打开 Tab Tracker 和作弊菜单的模拟按键。（F12 WIP）

#### thcrap 多语言

- 理论上支持 [thcrap 语言仓库](https://srv.thpatch.net/) 里的所有语言包。
- 服务器可以按作品指定语言包。你可以往里面加一堆奇怪的语言包，玩家只下载他选中的那个。

### 多人联机大厅

![支持玩家与旁观者的多人联机大厅](docs/assets/readme/multiplayer-lobby.webp)

- 提供 TH06MP 和 TH07MP，均基于 [TH07MP 的规则](https://github.com/sbrik1111/th07_multi_player)。
- 提供了一个大厅，支持创建房间后输入房间号加入、选择角色和难度（包括 Extra 和 Phantasm）、玩家都准备后再开始、旁观者。
- 支持暂停后按 R 或者手动重开本局。
- 可以保存多人 Replay。
- 优先使用 WebRTC，也可以通过 WebSocket Relay 连接。
- 支持旁观。旁观者不占玩家席位，只能观看，不会参与游戏状态（但不能中途进入旁观）。
- 单人和多人的存档和 Replay 相互隔离，不过允许共用设置。

### 游戏包与离线运行

- 可以从站点安装游戏包，也可以导入自己合法持有的游戏包 ZIP；
- 游戏包安装后保存在浏览器本地，游戏数据、OGG、字体和语言包可以分别管理；运行组件由站点统一提供；
- 在 HTTPS 或可信 loopback 等安全上下文中，已经安装的游戏和启动器可以离线运行；
- 玩家导入的原版游戏数据不会上传服务器，只会保存在浏览器本地。

部署者可以根据资源和带宽条件选择三种模式：

- **Hosted**：站点直接提供启动器、运行组件和全部游戏资源。玩家可以直接安装，部署最集中，站点需要承担全部资源流量；
- **External**：用户站点提供启动器和运行组件，游戏大文件由单独的完整资源站或 CDN 提供。玩家仍可直接安装，前端服务器无需承担大文件流量；
- **Import**：站点只提供启动器和运行组件，不发布原版游戏数据。玩家导入自己合法持有的游戏包 ZIP，适合没有 CDN 流量预算或不希望托管原版资源的部署者。

三种模式共用同一套前端、浏览器本地游戏包和离线运行能力。完整部署方法见[自托管指南](docs/SELF_HOSTING.md)。

## 常见问题
详见 [常见问题](docs/FAQ.md) 。

## 许可证

本项目采用 [GNU General Public License v3.0 or later](LICENSE)。

完整的第三方来源、素材归属和许可信息见 [THIRD_PARTY.md](THIRD_PARTY.md) 与 [ASSETS.md](ASSETS.md)。

## 星标历史

[![Star History Chart](https://api.star-history.com/chart?repos=yomotsuhisami/eagler-touhou&type=date&legend=top-left)](https://www.star-history.com/?repos=yomotsuhisami%2Feagler-touhou&type=date&legend=top-left)
