# thcrap / thprac 运行时契约

Eagler 宿主与两款 reallyportable 游戏之间只共享运行时数据，不链接对方源码。

## thcrap

1. 宿主请求 `GET /api/thcrap/{game}/{language}/manifest.json`。
2. 服务器从补丁仓库读取 `repo.js`、`patch.js`、`files.js` 和资源，逐个校验 thcrap 的 CRC32。
3. 服务器把 `.jdiff` 编译为原游戏的 `msg*.dat` / `end*.end`，把 `spells.js`、`stages.js`、`musiccmt.js`、`themes.js` 编译为 `ETL1` 本地化表；图片保持原格式。
4. 宿主必须在调用游戏的 `Module.callMain()` 之前，将清单中每个资源下载并写入其 `targetPath`。只有 `runtimeReady: true` 的清单可以启动。

运行时只约定 `/thcrap/th06/` 或 `/thcrap/th07/` 文件树，不知道语言 ID、仓库 URL、缓存位置或服务器实现。未安装翻译包时，文件查找自动回退到原版归档。

部分语言包还会提供 `th06/th06.js` 之类的字体偏好。服务器将其规范化为 `localization/options.json` 供宿主读取，但 thcrap 只给字体名称，不分发字体文件；宿主需要选择自身可合法提供、覆盖相应 Unicode 字形的字体。资源编译成功不等同于该字体已经具备全部字形。

## thprac

宿主在调用 `Module.callMain()` 前设置：

```js
Module.eaglerOptions.thpracSession = {
  schema: "eagler-touhou/thprac-session/1",
  game: "th06", // 或 th07
  params: { stage: 0, warp: 1, life: 8, bomb: 8, power: 128 }
};
```

两作会自动将 practice 参数写入原版录像旁的 `.rpy.thprac.json`，播放时自动读取。TH06 另导出 `_EaglerThpracSaveReplaySlot(slot)`，供宿主请求在运行中保存 1..99 号录像；调用后宿主仍负责同步 IDBFS。

当前已实现粗粒度关卡跳转、直接帧跳转、初始资源/分数/Rank（TH07 含樱点）以及 practice 录像元数据。上游 thprac 依赖特定原版 ECL 字节偏移的逐符卡起点、多阶段符卡、对话开关和 TH06 帕秋莉假机体尚未移植，因此不得在界面上标记为可用。
