> 本地 frontend-redesign 源码包：先阅读 [本地运行与测试](LOCAL-DEVELOPMENT.md)、[角色素材导入](docs/DAIRI_ART.md) 和 [PR 提交说明](docs/FRONTEND-PR.md)。

<h1 align="center">
  <img src="docs/assets/eagler-touhou-wordmark.svg" alt="EAGLER TOUHOU" width="312">
</h1>

<div align="center">
  <p>简体中文 | <a href="README.en.md">English</a></p>
  <p>一个旨在<strong>极大降低玩家入门门槛</strong>的，东方 Project 官方游戏、同人游戏及其工具、联机 Mod 的<strong> Web 适配计划</strong>。</p>
  <p>
    <a href="https://qm.qq.com/q/eeUrxIltug?from=tim"><img src="https://img.shields.io/badge/QQ%20Group-1124121427-12B7F5?logo=tencentqq" alt="QQ Group 1124121427"></a>
    <img src="https://img.shields.io/badge/Node.js-%3E%3D22-43853d" alt="Node.js >=22">
    <img src="https://img.shields.io/badge/Python-3-3776ab" alt="Python 3">
    <a href="LICENSE"><img src="https://img.shields.io/badge/License-GPL--3.0--or--later-blue.svg" alt="License: GPL-3.0-or-later"></a>
  </p>
  <p><a href="https://github.com/YomotsuHisami/eagler-touhou/blob/main/docs/README.md">开发文档 📄</a>&nbsp;|&nbsp;<a href="https://touhou.vip/">立刻体验 🎮</a></p>
</div>

## 概要

该计划至少保证：用户能使用**任何设备，无门槛地**游玩。

在保证原游戏体验的基础上（包括保留原游戏的一些 Bug），

1. 提供高刷新率、触控适配（直触移动、菜单手势）、STG 社区热门工具（thcrap、thprac）。
2. 提供以预测回滚为主，输入延迟为辅，高延迟鲁棒性优秀的多人联机实现。
3. 提供一套能实时更新的，能管理触控布局、存档 & REPLAY 的，设备离线后也能运行的 Web App。
4. 提供一个完全无门槛，只需点点按钮就可以快速联机的联机大厅。
5. 有一个更新速度快，维护热情高，广为接受意见和批评的开发组。

## 目录

- [仓库](#仓库)
- [Runtime 适配](#runtime-适配)
  - [完整的原作体验](#完整的原作体验)
  - [触控适配](#触控适配)
  - [STG 社区热门工具](#stg-社区热门工具)
  - [多人游戏](#多人游戏)
- [启动器](#启动器)
  - [游戏与文件管理](#游戏与文件管理)
  - [多人联机大厅](#多人联机大厅)
  - [游戏包与离线运行](#游戏包与离线运行)
- [自托管](#自托管)
- [常见问题](#常见问题)
- [许可证](#许可证)
- [星标历史](#星标历史)

## 仓库

| 描述 | 仓库 | 起源 | `eagler-touhou/1` | 高刷新率 | 多语言 | thprac | 联机 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 东方红魔乡 1.02h | [th06/eagler](https://github.com/YomotsuHisami/th06/tree/eagler) | [GensokyoClub/th06/portable](https://github.com/GensokyoClub/th06/tree/portable) | ✅ | ✅ | ✅ | ✅ | ✅ |
| 东方妖妖梦 1.00b | [th07/eagler](https://github.com/YomotsuHisami/th07/tree/eagler) | [some100/th07/reallyportable](https://github.com/some100/th07/tree/reallyportable)<br>[sbrik1111/th07_multi_player/main](https://github.com/sbrik1111/th07_multi_player/tree/main) | ✅ | ✅ | ✅ | ✅ | ✅ |
| 东方永夜抄 1.00d | [th08/eagler](https://github.com/YomotsuHisami/th08/tree/eagler)<br>[th08/experiment/th08-multiplayer](https://github.com/YomotsuHisami/th08/tree/experiment/th08-multiplayer) | [th08/main](https://github.com/YomotsuHisami/th08/tree/main) | ✅ | ✅ | ✅ | ✅ | ✅ |
| 东方花映塚 1.50a | [th09/eagler](https://github.com/YomotsuHisami/th09/tree/eagler)<br>[th09/experiment/th09-multiplayer](https://github.com/YomotsuHisami/th09/tree/experiment/th09-multiplayer) | [th09/main](https://github.com/YomotsuHisami/th09/tree/main) | ✅ | ❌ | ✅ | ❌ | ✅ |
| 东方风神录 1.00a | [th10/eagler](https://github.com/YomotsuHisami/th10/tree/eagler)<br>[th10/experiment/th10-multiplayer](https://github.com/YomotsuHisami/th10/tree/experiment/th10-multiplayer) | [th10/portable](https://github.com/YomotsuHisami/th10/tree/portable) | ✅ | ✅ | ✅ | ✅ | ✅ |
| 东方地灵殿 1.00a（适配并测试中） | [th11/eagler](https://github.com/YomotsuHisami/th11/tree/eagler) | [th11/main](https://github.com/YomotsuHisami/th11/tree/main) | — | — | — | — | — |
| 东方锦上京 1.00c（适配并测试中） | [Goan114/th20/eagler](https://github.com/Goan114/th20/tree/eagler) | [Oracatt/Touhou20/main](https://github.com/Oracatt/Touhou20/tree/main) | — | — | — | — | — |
| 共享 Runtime 基础设施 | [eagler-common/main](https://github.com/YomotsuHisami/eagler-common/tree/main) | — | — | — | — | — | — |
| 启动器与联机平台 | [eagler-touhou/main](https://github.com/YomotsuHisami/eagler-touhou/tree/main) | — | — | — | — | — | — |

✅ 已适配，❌ 未提供，— 不适用或尚未确认。

`eagler-touhou/1` 是 eagler-touhou 的基本协议。详见[开发文档中的 Runtime 接入说明](docs/ADAPTING_A_GAME.md#6-eagler-touhou1-shell-lifecycle)。

## Runtime 适配

### 完整的原作体验

- 在浏览器中运行游戏，支持键盘、手柄和触控操作。
- 支持原版存档和 Replay 的导入导出。原版格式可以记录的输入保持和原版互通；原版格式无法记录的适配输入使用扩展数据。
- 力求完美体验。解决了原 portable 分支中出现的 弹幕抖动、弹幕运动不流畅、闪烁、单线程切换音乐卡顿、手机卡顿 等大量问题。
- 支持高刷新率（>60Hz），TH09 除外。\[感谢 [reallyportable](https://github.com/some100/th07/tree/reallyportable)\]

不同作品的适配情况有所不同，见上面的表格。

### 触控适配

![可调整位置、大小、灵敏度和低速操作方式的触控布局](docs/assets/readme/touch-controls.webp)

- 触摸轨迹 = 游戏人物移动轨迹。提供直接触摸、无限速直接触摸，除此之外，还提供轮盘等移动方式。\[感谢 [reallyportable](https://github.com/some100/th07/tree/reallyportable)\]
- 触控布局自定义。触控按键可以随意拖动、缩放（60% ~ 180%）。
- 横屏和竖屏可以分别保存布局。
- 提供放大镜，允许玩家在游戏中即时地用双指缩放手势去放大游戏画面。再也不怕看不清弹幕了（x
- 触控输入也可以记录和回放 Replay。
- 触控菜单手势。\[by [reallyportable](https://github.com/some100/th07/tree/reallyportable)\]
- 触控灵敏度。
- 可以调整游戏画面的默认位置。
- 提供按住按钮、切换按钮和双指操作等低速方式。

### STG 社区热门工具

![在浏览器中使用 thprac 练习菜单](docs/assets/readme/stg-community-tools.webp)

#### thprac

- 为 TH06、TH07、TH08 和 TH10 适配 [thprac](https://github.com/touhouworldcup/thprac)。
- 支持在触控设备上操作练习菜单，并提供打开 Tab Tracker 和作弊菜单的模拟按键。
- TH09 不提供 thprac。

#### thcrap 多语言

- 提供 [thcrap](https://srv.thpatch.net/) 语言包适配。
- 服务器可以按作品指定语言包。你可以往里面加一堆奇怪的语言包，玩家只下载他选中的那个。
- 具体可用语言取决于作品的适配情况和站点提供的语言包。

### 多人游戏

- 提供 TH06MP、TH07MP、TH08MP、TH09MP 和 TH10MP。
- TH06MP 和 TH07MP 均基于 [TH07MP 的规则](https://github.com/sbrik1111/th07_multi_player)。
- TH06MP、TH07MP、TH08MP 和 TH10MP 支持 2～3 人，TH09MP 支持 2 人。
- 支持暂停后按 R 或者手动重开本局。
- 可以保存多人 Replay。
- 单人和多人的存档和 Replay 相互隔离，不过允许共用设置。

## 启动器

### 游戏与文件管理

![Eagler Touhou 启动器与游戏管理界面](docs/assets/readme/launcher.webp)

- 提供统一的游戏入口，可以选择作品并启动对应的 Runtime。
- 提供导入导出存档、Replay 等文件的界面。
- 管理已经安装的游戏包，以及游戏数据、OGG、字体和语言包。

### 多人联机大厅

![支持玩家与旁观者的多人联机大厅](docs/assets/readme/multiplayer-lobby.webp)

- 提供了一个大厅，支持创建房间后输入房间号加入、选择角色和难度、玩家都准备后再开始、旁观者。
- 可选角色和难度取决于作品，包括对应作品的 Extra 和 Phantasm。
- 优先使用 WebRTC，也可以通过 WebSocket Relay 连接。
- 支持旁观。旁观者不占玩家席位，只能观看，不会参与游戏状态（但不能中途进入旁观）。

### 游戏包与离线运行

- 可以从站点安装游戏包，也可以导入自己合法持有的游戏包 ZIP。
- 游戏包安装后保存在浏览器本地，游戏数据、OGG、字体和语言包可以分别管理；运行组件由站点统一提供。
- 玩家导入的原版游戏数据不会上传服务器，只会保存在浏览器本地。

在 HTTPS 或可信 loopback 等安全上下文条件下，已经安装的游戏和启动器**可以被离线运行**。在玩家离线或服务器宕机时，玩家即使刷新了页面也可以使用本地保存的文件正常进行游戏。

## 自托管

部署者可以根据资源和带宽条件选择三种模式：

- **Hosted**：站点直接提供启动器、运行组件和全部游戏资源。玩家可以直接安装，部署最集中，站点需要承担全部资源流量。
- **External**：用户站点提供启动器和运行组件，游戏大文件由单独的完整资源站或 CDN 提供。玩家仍可直接安装，前端服务器无需承担大文件流量。
- **Import**：站点只提供启动器和运行组件，不发布原版游戏数据。玩家导入自己合法持有的游戏包 ZIP，适合没有 CDN 流量预算或不希望托管原版资源的部署者。

三种模式共用同一套前端、浏览器本地游戏包和离线运行能力。完整部署方法见[自托管指南](docs/SELF_HOSTING.md)。

## 常见问题

详见[常见问题](docs/FAQ.md)。

## 许可证

本仓库采用 [GNU General Public License v3.0 or later](LICENSE)。各游戏 Runtime 的许可证见对应仓库。

完整的第三方来源、素材归属和许可信息见 [THIRD_PARTY.md](THIRD_PARTY.md) 与 [ASSETS.md](ASSETS.md)。

## 星标历史

[![Star History Chart](https://api.star-history.com/chart?repos=yomotsuhisami/eagler-touhou&type=date&legend=top-left)](https://www.star-history.com/?repos=yomotsuhisami%2Feagler-touhou&type=date&legend=top-left)
