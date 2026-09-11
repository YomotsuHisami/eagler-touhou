export const UI_LOCALES = Object.freeze(["zh-CN", "en"] as const);
export const UI_LOCALE_STORAGE_KEY = "eagler-touhou-ui-locale-v1";

type UiMessageEntry = readonly [key: string, zhCN: string, english: string];

// One tuple owns both translations, so a new key cannot silently exist in only
// one locale. Keys describe meaning rather than copying the Chinese source.
const entries = [
  ["site.documentTitle", "网页上的东方原作 ~ EAGLER TOUHOU", "Original Touhou Games on the Web ~ EAGLER TOUHOU"],
  ["site.description", "进入网站就能玩的东方原作游戏启动器 / 联机平台，提供了高刷新率适配、触控适配、汉化、thprac 以及原版联机 Mod。", "A browser-playable launcher and multiplayer platform for original Touhou games, with high-refresh-rate support, touch controls, translations, thprac, and multiplayer mods for the original games."],
  ["filter.aria", "游戏分类", "Game categories"],
  ["filter.all", "全部", "All"],
  ["filter.original", "原版", "Original"],
  ["filter.multiplayer", "联机", "Multiplayer"],
  ["ui.language", "界面语言", "Interface language"],
  ["ui.language.menu", "语言", "Language"],
  ["ui.language.zhCN", "简体中文", "Simplified Chinese"],
  ["ui.language.en", "English", "English"],
  ["preload.aria", "正在加载 EAGLER TOUHOU", "Loading EAGLER TOUHOU"],
  ["notice.aria", "网站公告", "Site announcement"], ["notice.label", "公告", "Notice"], ["notice.close", "关闭公告", "Close announcement"],
  ["notice.dismissForever", "不再显示", "Don't show again"],
  ["nav.siteInfo", "站点信息", "Site information"],
  ["nav.lessMotion", "更少动画", "Less motion"],
  ["nav.motionLessTitle", "减少页面装饰动画", "Reduce decorative motion"],
  ["nav.motionFullTitle", "恢复完整页面动画", "Restore full page motion"],
  ["nav.changelog", "更新日志", "Changelog"],
  ["nav.oldSiteMigration", "存档恢复", "Save recovery"],
  ["nav.faq", "常见问题", "FAQ"],
  ["nav.about", "关于", "About"],
  ["nav.more", "更多", "More"],
  ["nav.changelogPart1", "更新", "Release"], ["nav.changelogPart2", "日志", "notes"],
  ["nav.oldSitePart1", "存档", "Save"], ["nav.migrationPart2", "恢复", "recovery"],
  ["game.title.th06mp", "东方红魔乡 联机版", "Touhou 6 Multiplayer"],
  ["game.title.th07mp", "东方妖妖梦 联机版", "Touhou 7 Multiplayer"],
  ["th08.maintenance.warning", "警告", "Warning"],
  ["th08.maintenance.upstream", "该版本的上游本身就存在大量问题，代码质量也并不高。", "This version already inherits many upstream problems, and its code quality is not high."],
  ["th08.maintenance.support", "我们可能不会对该版本进行维护。请在反馈问题时注意。", "We may not maintain this version. Please keep this in mind when reporting issues."],
  ["th08.maintenance.replay", "（Replay 会炸。上游就炸。）", "(Replay playback desyncs. It is already broken upstream.)"],
  ["settings.title", "设置", "Settings"],
  ["settings.shareSingleplayer", "共用单机设置", "Share single-player settings"],
  ["settings.shareSingleplayerHint", "开启时，语言、音乐、显示和触控设置与单机同步；存档和录像始终独立。", "When enabled, language, music, display, and touch settings follow single-player; saves and replays remain separate."],
  ["settings.save", "存档", "Save"], ["settings.replay", "录像", "Replay"],
  ["settings.download", "下载", "Download"], ["settings.import", "上传", "Import"],
  ["settings.manage", "管理", "Manage"], ["settings.language", "语言", "Language"],
  ["settings.gameLanguage", "游戏语言", "Game language"], ["settings.music", "音乐", "Music"],
  ["gameLanguage.ja", "日本語(原版)", "Japanese (original)"], ["gameLanguage.zhHans", "中文（简体）", "Simplified Chinese"],
  ["gameLanguage.zhHant", "中文（繁體）", "Traditional Chinese"], ["gameLanguage.en", "English", "English"], ["gameLanguage.ru", "Русский", "Русский"],
  ["settings.musicMode", "音乐模式", "Music mode"],
  ["settings.music.oggStream", "ogg(流式解码，避免切歌时卡顿)", "OGG (streaming decode; avoids track-change stutter)"],
  ["settings.music.oggFull", "ogg(全量解码，避免音频卡顿)", "OGG (full decode; avoids audio stutter)"],
  ["settings.music.none", "无", "None"], ["settings.frameLimit", "锁定 60 帧", "Lock to 60 FPS"],
  ["settings.frameLimitHint", "如果帧数在游玩时经常严重波动，那么必须启用该选项，否则会造成严重的输入延迟。", "If the frame rate often fluctuates badly, enable this option or input latency may become severe."],
  ["settings.appleNotice", "苹果用户注意", "Apple users"],
  ["settings.localPlayerVisibility", "增强本机玩家可见性", "Enhance local player visibility"],
  ["settings.localPlayerVisibilityHint", "在游戏区域中使用白色定位线标出本机玩家。", "Show the local player with a white guide line in the game area."],
  ["settings.mobile", "触控适配", "Touch support"], ["settings.touchEnabled", "启用触摸功能", "Enable touch controls"],
  ["settings.touchLayout", "触控按键布局", "Touch control layout"],
  ["settings.touchLayoutShared", "位置和大小由 TH06 / TH07 共用", "Position and size are shared by TH06 / TH07"],
  ["settings.edit", "编辑", "Edit"], ["settings.alwaysHitbox", "始终显示判定点", "Always show hitbox"],
  ["settings.focusHitbox", "低速时显示判定点", "Show hitbox while focused"],
  ["settings.magnifier", "放大镜", "Magnifier"],
  ["settings.magnifierHint", "允许在游戏过程中通过双指手势放大游戏画面。", "Use a two-finger gesture to magnify the game during play."],
  ["settings.magnifierConflict", "与双指低速不兼容。", "Not compatible with two-finger focus."],
  ["settings.thpracHint", "高级练习器", "Advanced practice tool"],
  ["settings.builtin", "内置", "Built-in"], ["settings.webAudioUnavailable", "当前浏览器不支持 Web Audio，仅可使用无音乐模式", "This browser does not support Web Audio; only music-off mode is available"],
  ["settings.thpracUnavailableMultiplayer", "联机版使用不含 thprac 的独立 Runtime", "Multiplayer uses a separate Runtime without thprac"],
  ["action.start", "启动游戏", "Start game"], ["action.startMultiplayer", "启动 LAN 联机", "Start LAN multiplayer"],
  ["action.importGameData", "导入游戏资源", "Import game data"], ["action.import", "导入", "Import"],
  ["action.back", "返回", "Back"], ["action.close", "关闭", "Close"], ["action.cancel", "取消", "Cancel"],
  ["action.confirm", "确定", "Confirm"], ["action.backgroundDownload", "后台下载", "Download in background"],
  ["action.retry", "重试", "Retry"], ["action.reset", "复位", "Reset"], ["action.save", "保存", "Save"],
  ["action.exit", "退出", "Exit"], ["action.replay", "重播", "Replay"], ["action.rename", "改名", "Rename"],
  ["action.delete", "删除", "Delete"], ["action.openLink", "打开链接", "Open link"],
  ["action.watchReplay", "观赏 Replay", "Watch Replay"],
  ["action.download", "下载", "Download"],
  ["action.retrySave", "重试保存", "Retry save"],
  ["action.leaveAnyway", "仍然退出", "Exit anyway"],
  ["action.stayInGame", "留在游戏", "Stay in game"],
  ["fullscreen.autoBlocked", "浏览器阻止自动全屏：{reason}", "The browser blocked automatic fullscreen: {reason}"],
  ["fullscreen.unsupported", "当前浏览器不支持网页全屏", "This browser does not support webpage fullscreen"],
  ["fullscreen.switchFailed", "无法切换全屏：{reason}", "Could not switch fullscreen: {reason}"],
  ["replay.renamePrompt", "输入新的录像文件名", "Enter a new replay filename"],
  ["replay.deleteConfirm", "录像「{name}」将被永久删除。\n\n此操作无法撤销。", "Replay “{name}” will be permanently deleted.\n\nThis cannot be undone."],
  ["replay.downloadFailed", "录像下载失败：{reason}", "Replay download failed: {reason}"],
  ["replay.operationFailed", "录像操作失败：{reason}", "Replay operation failed: {reason}"],
  ["replay.deleteFailed", "录像删除失败：{reason}", "Replay deletion failed: {reason}"],
  ["touch.layoutSaved", "保存成功：触控布局已保存", "Saved: touch layout persisted"],
  ["touch.layoutSessionOnly", "布局已应用，但未能保存到浏览器；请稍后重试", "Layout applied for this session, but browser persistence failed; try again later"],
  ["touch.layoutSavedStatus", "已保存跨游戏触控布局", "Shared touch layout saved"],
  ["touch.layoutDefaultSavedStatus", "已保存默认触控布局", "Default touch layout saved"],
  ["touch.layoutSessionOnlyStatus", "触控布局已应用到本次会话，但浏览器未能持久保存", "Touch layout applied for this session, but could not be persisted"],
  ["touch.layoutEditorClosed", "已退出触控布局编辑", "Exited touch layout editor"],
  ["touch.editorStatus", "触控布局编辑：拖动按键调整位置，滑杆或右下角按钮调整大小", "Touch layout editor: drag controls to move them; use the slider or lower-right handle to resize"],
  ["touch.viewportEditStatus", "调整游戏画面位置：左右拖动画面，完成后返回按键布局", "Adjust game viewport: drag left or right, then return to the control layout when finished"],
  ["touch.previewUnavailable", "触控布局预览区域尚未就绪", "The touch-layout preview is not ready yet"],
  ["touch.settingsMissing", "触控布局设置面板缺失", "The touch-layout settings panel is unavailable"],
  ["touch.draftUnavailable", "触控布局草稿不可用", "The touch-layout draft is unavailable"],
  ["touch.editWhileRunning", "请先退出正在运行的游戏，再编辑触控布局", "Exit the running game before editing the touch layout"],
  ["touch.orientationUnsupported", "当前浏览器不支持网页方向锁定", "This browser does not support webpage orientation locking"],
  ["touch.orientationRequested", "已请求系统切换到{orientation}", "Requested system rotation to {orientation}"],
  ["touch.orientationFailed", "切换失败，请查看右上角问号菜单中的横竖屏说明。", "Rotation failed. See the orientation instructions in the help menu at the upper right."],
  ["touch.restoreViewport", "已恢复{orientation}游戏画面默认位置，保存后生效", "Restored the default {orientation} game viewport; save to apply it"],
  ["touch.restoreLayoutConfirm", "当前{orientation}布局中的未保存调整将被清除。", "Unsaved changes in the current {orientation} layout will be cleared."],
  ["touch.restoreLayoutToast", "已恢复{orientation}默认布局，保存后生效", "Restored the default {orientation} layout; save to apply it"],
  ["touch.warningSummary", "提示：{issues}。仍可保存，但实机可能容易误触。", "Warning: {issues}. You can still save, but the layout may be easy to mis-tap on a real device."],
  ["touch.warningSeparator", "；", "; "],
  ["touch.restoreDefault", "恢复默认", "Restore default"],
  ["dialog.saveSyncFailed", "浏览器未能确认存档已经持久保存。\n\n{reason}\n\n可以重试保存、留在游戏中，或明确放弃本次尚未保存的更改。", "The browser could not confirm that the save was persisted.\n\n{reason}\n\nYou can retry saving, stay in the game, or explicitly exit without the unpersisted changes."],
  ["package.imported", "游戏包已导入（{count} 个文件）；之后将从本地启动。", "Game package imported ({count} files); future launches will use the local package."],
  ["package.importedReady", "游戏包已导入，可以启动游戏", "Game package imported; the game is ready to start"],
  ["package.importing", "正在校验并安装游戏包…", "Validating and installing game package…"],
  ["package.continuing", "游戏包导入完成，正在继续之前的操作…", "Game package imported; continuing the previous action…"],
  ["package.readyNextLaunch", "游戏已就绪；新导入的游戏包将在下次启动时使用", "Game is already ready; the newly imported package will be used on the next launch"],
  ["package.localLaunching", "游戏包导入完成，正在从本地启动…", "Game package imported; starting from local storage…"],
  ["package.importServerMissing", "{reason}\n当前服务器没有可回退的游戏文件，请重新导入有效的游戏包。", "{reason}\nThis server has no fallback game files; import a valid game package again."],
  ["package.importStorageFailed", "{reason}\n本地导入未完成；服务器下载仍会继续。", "{reason}\nLocal import did not complete; the server download will continue."],
  ["package.importInvalid", "{reason}\n请导入有效的游戏包 ZIP 或兼容数据包；版本较旧本身不会被拒绝，服务器下载仍会继续。", "{reason}\nImport a valid game-package ZIP or compatible data pack. Older versions are not rejected solely for age; the server download will continue."],
  ["package.manualImportIntro", "请选择要导入的本地游戏包。已安装游戏时，导入新包会更新本地版本。", "Choose a local game package to import. If a game is already installed, importing another package updates the local version."],
  ["package.needImport", "需要导入本地游戏包", "A local game package is required"],
  ["package.downloadCancelledImport", "下载已取消，可以导入本地游戏包", "Download cancelled; you can import a local game package"],
  ["package.resourceFailureLocal", "启动资源请求失败：{reason}\n网页启动器本身仍在运行，可以改用本地游戏包。", "Startup resource request failed: {reason}\nThe launcher is still running; you can use a local game package instead."],
  ["package.resourceFailureStatus", "资源加载失败，可改用本地游戏包", "Resource loading failed; you can use a local game package"],
  ["package.noLaunchableLocal", "当前没有可启动的本地游戏资源。", "No launchable local game data is available."],
  ["package.fallbackLinkTitle", "查看备用游戏下载链接和提取码", "View the fallback game-package download link and code"],
  ["package.fallbackLinkUnavailableTitle", "当前服务器未提供备用游戏下载链接", "This server does not provide a fallback game-package download link"],
  ["package.fallbackLinkUnavailable", "当前服务器未提供备用下载链接", "No fallback download link is available from this server"],
  ["package.manualImportReason", "{reason}\n请选择本地游戏包导入；如果服务器提供了备用下载地址，也可以点击「打开链接」取得游戏包。", "{reason}\nChoose a local game package to import. If the server provides a fallback download address, you can also use Open link to get the package."],
  ["package.manualCancelledReason", "已取消从服务器下载游戏资源。", "Game-data download from the server was cancelled."],
  ["package.importServerOnly", "{reason}\n当前服务器只提供启动器，不提供游戏文件。已安装的游戏仍可直接启动；没有安装时，请导入本地游戏包。", "{reason}\nThis server provides only the launcher, not game files. Installed games can still start normally; otherwise, import a local game package."],
  ["package.fallbackWaitOrImport", "{reason}\n你可以继续等待；如果当前下载太慢，也可以点击「打开链接」取得游戏包后导入。手动导入的本地版本不会被服务器自动替换，只有你主动选择更新时才会更新。", "{reason}\nYou can keep waiting. If the current download is too slow, use Open link to get and import the package. A manually imported local version is not replaced automatically; it changes only when you explicitly update it."],
  ["package.firstByteTimeout", "10 秒内没有收到游戏数据的第一个有效字节。服务器资源下载似乎没有正常开始。", "No valid game-data byte arrived within 10 seconds. The server download does not appear to have started correctly."],
  ["package.downloadSlow", "游戏数据仍在加载，当前速度可能较慢。", "Game data is still loading; the current transfer may be slow."],
  ["package.downloadStartTimeout", "20 秒内仍没有收到游戏数据，服务器资源下载似乎没有正常开始。", "No game data arrived within 20 seconds. The server download does not appear to have started correctly."],
  ["package.updateAvailableLocal", "服务器有新版游戏资源。你当前导入的本地版本仍然可以直接启动。", "A newer game package is available from the server. Your imported local version can still be started directly."],
  ["package.updateAvailableRemote", "服务器有新版游戏资源。当前版本仍然可以直接启动。", "A newer game package is available from the server. The current version can still be started directly."],
  ["package.updateNow", "立即更新", "Update now"],
  ["package.keepCurrent", "继续当前版本", "Keep current version"],
  ["package.cancelUpdate", "取消更新", "Cancel update"],
  ["package.updatingLocal", "正在更新本地游戏…", "Updating local game package…"],
  ["package.updatingRemote", "检测到服务器新版，正在更新游戏…", "A newer server package was found; updating game…"],
  ["package.updatingLocalProgress", "正在更新本地游戏… {completed}/{total}", "Updating local game package… {completed}/{total}"],
  ["package.updatingRemoteProgress", "正在更新游戏… {completed}/{total}", "Updating game… {completed}/{total}"],
  ["package.updated", "游戏资源已更新。", "Game resources updated."],
  ["package.updateCancelled", "已取消更新，继续使用当前版本。", "Update cancelled; continuing with the current version."],
  ["package.updateFailed", "游戏资源更新失败，继续使用当前版本：{reason}", "Game-resource update failed; continuing with the current version: {reason}"],
  ["transfer.musicDownloading", "正在下载音乐…", "Downloading music…"],
  ["transfer.oggMusic", "OGG 音乐", "OGG music"],
  ["transfer.languageDownloading", "正在下载语言包…", "Downloading language pack…"],
  ["transfer.language", "语言包", "Language pack"],
  ["transfer.loading", "正在加载…", "Loading…"],
  ["transfer.gameResources", "游戏资源", "Game resources"],
  ["transfer.waitingServer", "等待服务器响应…", "Waiting for server response…"],
  ["transfer.preparing", "正在准备…", "Preparing…"],
  ["transfer.requesting", "正在请求…", "Requesting…"],
  ["transfer.waiting", "等待响应", "Waiting for response"],
  ["transfer.preparingShort", "正在准备", "Preparing"],
  ["transfer.languageFailed", "语言包下载失败", "Language-pack download failed"],
  ["transfer.languageFailedDetail", "语言包下载失败\n{reason}", "Language-pack download failed\n{reason}"],
  ["transfer.oggFailed", "OGG 下载失败（{count} 个）\n当前音频：MIDI\n当前正在播放 MIDI，并非 OGG 音质", "OGG download failed ({count} files)\nCurrent audio: MIDI\nMIDI is playing instead of OGG audio"],
  ["transfer.musicComplete", "音乐下载完成", "Music download complete"],
  ["transfer.musicPreparing", "正在准备音乐…", "Preparing music…"],
  ["transfer.localOgg", "本地 OGG", "Local OGG"],
  ["transfer.musicReady", "音乐已就绪", "Music ready"],
  ["transfer.localOggPartialFailed", "部分本地 OGG 准备失败：{reason}", "Some local OGG tracks could not be prepared: {reason}"],
  ["transfer.retryingOgg", "正在重试 OGG 下载…", "Retrying OGG download…"],
  ["transfer.received", "{amount} 已接收", "{amount} received"],
  ["transfer.receiving", "正在接收…", "Receiving…"],
  ["transfer.requestCount", "{count} 个请求", "{count} request(s)"],
  ["transfer.resourceFallback", "资源", "resource"],
  ["transfer.fetchingGameInfo", "正在获取游戏信息…", "Fetching game information…"],
  ["transfer.versionDescriptor", "获取 {game} 版本描述", "Fetching {game} version descriptor"],
  ["transfer.gameDownloading", "正在下载游戏资源…", "Downloading game resources…"],
  ["transfer.runtimeDownloading", "正在下载运行组件…", "Downloading runtime components…"],
  ["transfer.runtimeScript", "{game} 运行脚本", "{game} runtime script"],
  ["transfer.runtimePage", "{game} 运行页面", "{game} runtime page"],
  ["transfer.resourceDownloading", "正在下载资源…", "Downloading resources…"],
  ["transfer.font", "字体 {file}", "Font {file}"],
  ["transfer.packageDownloading", "正在下载游戏包…", "Downloading game package…"],
  ["transfer.serverRequesting", "正在请求服务器…", "Requesting server…"],
  ["touch.layoutDiscardConfirm", "退出将丢弃当前未保存的触控布局修改。", "Exiting will discard unsaved touch-layout changes."],
  ["touch.discardChanges", "放弃修改", "Discard changes"],
  ["file.importSaveOverwrite", "导入将覆盖当前游戏已有的存档。", "Importing will overwrite the current game save."],
  ["file.continueImport", "继续导入", "Continue import"],
  ["file.kind.save", "存档", "save"], ["file.kind.replay", "录像", "replay"],
  ["file.exportPreparing", "正在准备导出{kind}…", "Preparing {kind} export…"],
  ["file.exporting", "正在导出{kind}…", "Exporting {kind}…"],
  ["file.noReplayToExport", "没有可导出的录像", "There are no replays to export"],
  ["file.exportDownloadStarted", "已开始下载原版{kind}", "Original {kind} download started"],
  ["file.exported", "已导出原版{kind}", "Original {kind} exported"],
  ["file.missingSavePrompt", "当前还没有 score.dat。是否现在导入存档？", "There is no score.dat yet. Import a save now?"],
  ["file.missingReplayPrompt", "当前还没有录像。是否现在导入录像？", "There are no replays yet. Import one now?"],
  ["file.selectImport", "选择导入文件", "Choose import file"],
  ["file.exportFailed", "导出{kind}失败：{reason}", "Failed to export {kind}: {reason}"],
  ["file.emptyImport", "不能导入空文件", "Cannot import an empty file"],
  ["file.importTooLarge", "导入文件超过 128 MiB 限制", "Import exceeds the 128 MiB limit"],
  ["file.importing", "正在导入…", "Importing…"],
  ["file.replaySlotsExhausted", "用户录像槽已用尽", "No user replay slots are available"],
  ["file.zipUnsafePath", "ZIP 包含无效路径", "ZIP contains an invalid path"],
  ["file.zipDuplicatePath", "ZIP 包含重复路径", "ZIP contains duplicate paths"],
  ["file.chooseSave", "请选择原版 .dat 存档", "Choose an original .dat save file"],
  ["file.chooseReplay", "请选择 .rpy / .rpyx 录像或录像 ZIP", "Choose an .rpy / .rpyx replay or replay ZIP"],
  ["file.importNoFiles", "文件包中没有可导入的文件", "The package contains no importable files"],
  ["file.importDuplicatePaths", "文件包中存在重复路径", "The package contains duplicate paths"],
  ["file.importStoredTooLarge", "单个文件超过 64 MiB 限制", "A file exceeds the 64 MiB storage limit"],
  ["file.importArchiveExpandedTooLarge", "录像 ZIP 解压后的录像总量超过 128 MiB 限制", "The replays in the ZIP exceed the 128 MiB expanded-size limit"],
  ["file.zipComponentMissing", "ZIP 组件没有加载", "ZIP support is not loaded"],
  ["file.saveVerifyFailed", "存档写入后未能从浏览器持久存储完整读回", "The saved file could not be read back intact from browser storage"],
  ["file.importedRestart", "已导入 {count} 个文件；点击「启动游戏」重新启动后生效", "Imported {count} file(s); restart with Start Game to apply them"],
  ["runtime.invalidFileContent", "Runtime 返回了无效的文件内容", "Runtime returned invalid file content"],
  ["runtime.invalidFileList", "Runtime 返回了无效的文件列表", "Runtime returned an invalid file list"],
  ["runtime.invalidFileEntry", "Runtime 返回了无效的文件条目", "Runtime returned an invalid file entry"],
  ["replay.dropSingle", "请一次拖入一个 .rpy、.rpyx 或 .zip 文件", "Drop one .rpy, .rpyx, or .zip file at a time"],
  ["replay.dropType", "只接受 .rpy / .rpyx 或录像 ZIP", "Only .rpy / .rpyx files or replay ZIPs are accepted"],
  ["replay.importFailed", "录像导入失败：{reason}", "Replay import failed: {reason}"],
  ["status.errorReason", "错误：{reason}", "Error: {reason}"],
  ["replay.nameEmpty", "录像文件名不能为空", "Replay filename cannot be empty"],
  ["replay.nameInvalid", "文件名必须符合 {prefix}_01.rpy / .rpyx 或 {prefix}_ud0000.rpy / .rpyx", "Filename must match {prefix}_01.rpy / .rpyx or {prefix}_ud0000.rpy / .rpyx"],
  ["replay.nameExists", "已存在同名录像", "A replay with that name already exists"],
  ["multiplayer.title", "联机", "Multiplayer"], ["multiplayer.createRoom", "创建房间", "Create room"],
  ["multiplayer.or", "或", "or"], ["multiplayer.roomCode", "房间号", "Room code"],
  ["multiplayer.roomCodePlaceholder", "输入房间号", "Enter room code"],
  ["multiplayer.joinRoom", "加入房间", "Join room"], ["multiplayer.roomAria", "联机房间", "Multiplayer room"],
  ["multiplayer.host", "房主", "Host"], ["multiplayer.you", "我", "You"], ["multiplayer.join", "加入", "Join"],
  ["multiplayer.spectators", "旁观者", "Spectators"], ["multiplayer.spectate", "旁观", "Spectate"],
  ["multiplayer.joinSpectator", "加入旁观", "Spectate"], ["multiplayer.leaveSpectator", "离开旁观", "Leave spectator mode"],
  ["multiplayer.name", "昵称", "Name"], ["multiplayer.namePlaceholder", "未命名", "Unnamed"],
  ["multiplayer.nameAria", "联机昵称", "Multiplayer name"], ["multiplayer.spectating", "观战中", "Spectating"],
  ["multiplayer.chooseSeat", "选择座位加入游戏", "Choose a seat to join the game"],
  ["multiplayer.previousCharacter", "上一个角色", "Previous character"],
  ["multiplayer.nextCharacter", "下一个角色", "Next character"], ["multiplayer.leaveSeat", "离开座位", "Leave seat"],
  ["multiplayer.copyRoomCode", "复制房间号", "Copy room code"], ["multiplayer.copyHint", "点击复制", "Click to copy"],
  ["multiplayer.ready", "准备", "Ready"], ["multiplayer.readyDone", "已准备", "Ready"],
  ["multiplayer.waitHost", "等待房主", "Waiting for host"], ["multiplayer.waitReady", "等待准备", "Waiting for players"],
  ["multiplayer.players", "游戏人数", "Players"], ["multiplayer.difficulty", "当前难度:", "Difficulty:"],
  ["multiplayer.settingsHint", "只有当前 P1 可以修改房间设置。", "Only the current P1 can change room settings."],
  ["multiplayer.ownerMissing", "P1 空缺 - 暂无房主", "P1 empty - no host"],
  ["multiplayer.ownerLocalHint", "你当前坐在 P1，可以修改房间设置。影响对局的修改会要求所有玩家重新准备。", "You are in P1 and can change room settings. Match-affecting changes require everyone to ready again."],
  ["multiplayer.ownerRemoteHint", "只有当前 P1 可以修改房间设置。P1 空缺时任何玩家都可以坐上去成为房主。", "Only P1 can change room settings. If P1 is empty, any player can take it and become host."],
  ["multiplayer.syncingMembers", "正在同步房间成员", "Synchronizing room members"],
  ["multiplayer.reconnecting", "连接中断 - 正在自动重连", "Connection lost - reconnecting automatically"],
  ["multiplayer.youAreHost", "你是当前房主 - P1", "You are the host - P1"],
  ["multiplayer.takeHostSeat", "P1 空缺时可直接入座成为房主", "Take the empty P1 seat to become host"],
  ["multiplayer.playerReconnecting", "该玩家连接中断，正在等待重连", "This player disconnected; waiting for reconnection"],
  ["multiplayer.unnamedSpectator", "未命名旁观者", "Unnamed spectator"],
  ["multiplayer.nameOneTimeHint", "昵称只能设置一次，保存后不可修改", "Your nickname can be saved only once and cannot be changed later"],
  ["multiplayer.connectingRoom", "连接房间中", "Connecting to room"], ["multiplayer.spectatorSeat", "旁观席", "Spectator seat"],
  ["multiplayer.notSeated", "未入座", "Not seated"], ["multiplayer.syncingState", "正在同步成员状态", "Synchronizing member state"],
  ["multiplayer.waitSpectatorStream", "已进入旁观席；只有开局前登记的旁观者可以观看本局", "Spectator seat joined; only spectators registered before the match starts can watch this match"],
  ["multiplayer.chooseSeatOrSpectate", "选择 P 位加入游戏，或主动进入旁观席", "Choose a P seat to play, or join as a spectator"],
  ["multiplayer.startGame", "开始游戏", "Start game"],
  ["multiplayer.gameSettings", "游戏设置", "Game settings"], ["multiplayer.connection", "联机连接", "Multiplayer connection"],
  ["multiplayer.connectingPeers", "正在连接其他玩家…", "Connecting to other players…"],
  ["multiplayer.waitingPath", "正在等待网络路径就绪。", "Waiting for a network path."],
  ["dialog.closeNotice", "关闭提示", "Close notice"], ["dialog.closeError", "关闭错误信息", "Close error message"],
  ["dialog.confirmTitle", "确认吗？", "Are you sure?"], ["changelog.title", "更新日志", "Changelog"],
  ["changelog.close", "关闭更新日志", "Close changelog"], ["changelog.loading", "正在读取更新日志…", "Reading changelog…"],
  ["changelog.empty", "暂无更新日志。", "No changelog is available."],
  ["changelog.readFailed", "更新日志读取失败：{reason}。请刷新页面后重试。", "Failed to read the changelog: {reason}. Please refresh and try again."],
  ["apple.close", "关闭苹果高刷新率提示", "Close high-refresh-rate notice"],
  ["apple.faqAria", "苹果设备高刷新率常见问题", "Apple high-refresh-rate FAQ"],
  ["apple.highRefreshQuestion", "如何启用高刷新率？", "How do I enable a high refresh rate?"],
  ["apple.highRefreshIntro", "由于浏览器策略，WebKit 用户可能需要：", "Because of browser policies, WebKit users may need to:"],
  ["apple.highRefreshPath", "设置 → Safari → 高级 → Feature Flags / 功能开关", "Settings → Safari → Advanced → Feature Flags"],
  ["apple.highRefreshStep", "找到 Prefer Page Rendering Updates near 60fps，把它关闭，再刷新网页。", "Find Prefer Page Rendering Updates near 60fps, turn it off, and refresh the page."],
  ["apple.highRefreshResult", "这样可能可以解锁 WebKit 下的高刷新率。", "This may unlock a high refresh rate in WebKit."],
  ["apple.lowFpsQuestion", "如何解决游戏被锁定在 30 帧？", "How do I fix the game being locked to 30 FPS?"],
  ["apple.lowPowerStep", "请关闭 iPhone 的低电量模式，然后刷新网页。", "Turn off iPhone Low Power Mode, then refresh the page."],
  ["replay.manager", "录像管理", "Replay manager"], ["replay.dropHint", "拖放 .RPY / .RPYX / .ZIP 到此处导入", "Drop an .RPY / .RPYX / .ZIP here to import"],
  ["replay.fileCount", "{count} 个文件", "{count} file(s)"], ["replay.fileCountZero", "0 个文件", "0 files"],
  ["replay.import", "上传录像", "Import replay"], ["replay.loading", "正在读取录像…", "Reading replay…"],
  ["replay.empty", "暂无录像文件", "No replay files"], ["replay.readFailed", "录像读取失败", "Failed to read replay"],
  ["player.preparing", "准备中…", "Preparing…"], ["player.oggNotReady", "OGG 尚未就绪", "OGG not ready"],
  ["player.oggFallback", "该音乐的 OGG 还未下载好，已回落至 MIDI", "This track's OGG is not ready; falling back to MIDI"],
  ["player.loading", "正在加载…", "Loading…"], ["player.gameData", "游戏资源", "Game data"],
  ["player.cancelDownload", "取消下载", "Cancel download"], ["package.label", "游戏包", "Game package"],
  ["package.importTitle", "导入游戏包", "Import game package"],
  ["package.unavailable", "当前游戏资源暂时不可用。你可以稍后重试，或导入本地游戏包。", "Game data is temporarily unavailable. Try again later or import a local game package."],
  ["package.installing", "正在校验并安装游戏包…", "Validating and installing game package…"],
  ["package.closeImport", "关闭导入游戏包窗口", "Close import game package window"],
  ["package.downloadLink", "下载链接", "Download link"], ["package.downloadTitle", "游戏包下载", "Game package download"],
  ["package.closeLink", "关闭游戏数据下载链接窗口", "Close game data download link window"],
  ["package.openLinkAria", "打开游戏数据下载链接", "Open game data download link"],
  ["package.link", "链接", "Link"], ["package.codeHint", "提取码 / 提示", "Code / hint"], ["common.none", "无", "None"],
  ["touch.reserved", "帮助 / 全屏", "Help / fullscreen"], ["touch.editorTitle", "触控布局", "Touch layout"],
  ["touch.landscape", "横屏", "Landscape"], ["touch.portrait", "竖屏", "Portrait"],
  ["touch.selected", "选中了 {control}", "Selected {control}"],
  ["touch.editorInstruction", "拖动调整位置，拉动滑杆或右下角按钮调整大小。", "Drag to move; use the slider or lower-right button to resize."],
  ["touch.sharedLayout", "多作共用该横竖屏布局。", "This landscape/portrait layout is shared by all games."],
  ["touch.separateLayouts", "横屏和竖屏会分别保存！", "Landscape and portrait are saved separately!"],
  ["touch.dragWindow", "拖动此处移动窗口", "Drag here to move the window"], ["touch.size", "大小", "Size"],
  ["touch.switchOrientation", "切换横竖屏", "Switch orientation"], ["touch.restoreDirection", "恢复本方向默认", "Restore this orientation"],
  ["touch.settingsAria", "触控设置", "Touch settings"], ["touch.movement", "移动方法", "Movement method"],
  ["touch.movement.touch", "触摸（推荐）", "Touch (recommended)"], ["touch.movement.unlimited", "触摸（作弊，不限速）", "Touch (cheat, unlimited speed)"],
  ["touch.movement.joystick", "轮盘", "Joystick"], ["touch.movement.joystickFree", "轮盘（无方向限制）", "Joystick (free direction)"],
  ["touch.focusMethod", "低速方法", "Focus method"], ["touch.focus.hold", "按钮（按住时低速）", "Button (hold to focus)"],
  ["touch.focus.toggle", "按钮（按下时切换状态）", "Button (tap to toggle)"], ["touch.focus.twoFinger", "双指", "Two fingers"],
  ["touch.doubleTapBomb", "双击 Bomb", "Double-tap Bomb"], ["touch.doubleTapBombHint", "在同一位置快速双击以使用 Bomb。", "Double-tap the same place to use a Bomb."],
  ["touch.thpracButtons", "thprac 按键", "thprac buttons"], ["touch.thpracButtonsHint", "显示模拟鼠标、作弊菜单和 Tab 按键。", "Show mouse emulation, cheat menu, and Tab buttons."],
  ["touch.sensitivity", "触控灵敏度", "Touch sensitivity"],
  ["touch.sensitivityHint", "手指拖动距离与自机目标移动距离的比例。在背景拖动可以预览效果。", "Ratio between finger movement and the player's target movement. Drag the background to preview."],
  ["touch.sensitivityPresets", "触控灵敏度档位", "Touch sensitivity presets"], ["touch.custom", "自定义", "Custom"],
  ["touch.customSensitivity", "自定义灵敏度", "Custom sensitivity"], ["touch.viewportPosition", "游戏画面位置", "Game viewport position"],
  ["touch.viewportHint", "仅可水平调整，横屏和竖屏分别保存。", "Horizontal adjustment only; landscape and portrait are saved separately."],
  ["touch.adjustViewport", "＋ 调整游戏画面", "＋ Adjust game viewport"], ["touch.adjustDone", "调整完成", "Done"],
  ["touch.leftControls", "左手触控按键", "Left-side touch controls"], ["touch.focus", "低速", "Focus"],
  ["touch.holdFocus", "按住低速", "Hold to focus"], ["touch.tapToggle", "点按切换", "Tap to toggle"], ["touch.fire", "开火", "Fire"],
  ["touch.joystickAria", "移动轮盘", "Movement joystick"], ["touch.escapeAria", "返回或暂停", "Back or pause"],
  ["touch.escapeTitle", "ESC：返回或暂停", "ESC: back or pause"], ["touch.mouse", "模拟鼠标", "Mouse emulation"],
  ["touch.cheatMenu", "作弊菜单", "Cheat menu"], ["touch.invincible", "无敌", "Invincible"],
  ["touch.infiniteLives", "无限残机", "Infinite lives"], ["touch.infiniteBombs", "无限 Bomb", "Infinite Bombs"],
  ["touch.infinitePower", "无限火力", "Infinite power"], ["touch.timeLock", "时间锁", "Time lock"],
  ["touch.autoBomb", "自动 Bomb", "Auto Bomb"], ["touch.enemyBgm", "敌方 BGM", "Enemy BGM"],
  ["help.open", "打开帮助", "Open help"], ["help.close", "关闭帮助", "Close help"], ["help.title", "帮助", "Help"],
  ["help.manualLandscape", "手动横屏", "Manual landscape"], ["help.orientationSummary", "屏幕没有自动旋转时", "When the screen does not rotate automatically"],
  ["help.iphoneFullscreen", "iPhone 全屏游玩", "Play fullscreen on iPhone"], ["help.iphoneFullscreenSummary", "隐藏 Safari 导航栏", "Hide the Safari navigation bar"],
  ["help.turnPhone", "把手机横过来。是的，物理上先把手机横过来。", "Turn your phone sideways first."],
  ["help.systemRotate", "点击右下角出现的系统旋转按钮。", "Tap the system rotation button at the lower right."],
  ["help.rotateImageAlt", "手机横过来后点击右下角系统旋转按钮的操作示意图", "How to tap the system rotation button after turning the phone sideways"],
  ["help.iosSafariShare", "Safari 浏览器打开本站", "Open this site in Safari"],
  ["help.iosSafariShareStep", "轻点「更多」→「共享」。如果标签页布局是「底部」或「顶部」，直接轻点「共享」。", "Tap More → Share. With the Bottom or Top tab layout, tap Share directly."],
  ["help.iosAddHome", "添加到主屏幕", "Add to Home Screen"],
  ["help.iosAddHomeStep", "向下滚动，轻点「添加到主屏幕」。如果没有这一项：滚到列表底部 →「编辑操作」→ 添加「添加到主屏幕」。", "Scroll down and tap Add to Home Screen. If it is missing, go to the bottom → Edit Actions → add Add to Home Screen."],
  ["help.iosWebApp", "作为网页 App 打开", "Open as Web App"],
  ["help.iosWebAppStep", "打开「作为网页 App 打开」，轻点「添加」。以后从主屏幕图标进入，即可隐藏 Safari 导航栏。", "Enable Open as Web App and tap Add. Launch it from the Home Screen icon later to hide Safari's navigation bar."],
  ["help.gameControls", "游戏操作", "Game controls"], ["help.gameControlsSummary", "键盘 / 手柄的基础操作", "Basic keyboard / controller controls"],
  ["help.gameControlsIntro", "东方 STG 的基础操作很固定；使用手柄时，可在游戏内 Option 中调整按键。", "Touhou STG controls are consistent; controller bindings can be changed in the in-game Options menu."],
  ["help.arrowKeys", "方向键", "Arrow keys"], ["help.moveSelect", "移动自机；菜单中选择", "Move the player; select in menus"],
  ["help.fireConfirm", "射击 / 确认", "Shoot / confirm"], ["help.bombCancel", "Bomb / 取消", "Bomb / cancel"],
  ["help.focusMove", "按住低速移动，并显示判定点", "Hold to focus and show the hitbox"], ["help.pauseBack", "暂停游戏 / 返回上一级", "Pause / go back"],
  ["help.skipDialogue", "快速跳过对话", "Fast-forward dialogue"],
  ["help.gameControlsNote", "精细避弹时优先使用低速；看清自机中心的判定点，比盯着角色立绘更重要。", "Use focus for precise dodging; watch the hitbox at the player's center rather than the character art."],
  ["help.inGame", "游戏中", "In game"], ["help.focusSummary", "移动与低速操作", "Movement and focus controls"],
  ["help.focusTwoFingerSummary", "移动时，用第二指按住进入低速", "While moving, hold a second finger to focus"],
  ["help.focusTwoFingerLabel", "＋ 第二指按住", "＋ Hold second finger"],
  ["help.focusToggleSummary", "移动时，点按「低速」按钮切换状态", "While moving, tap Focus to toggle"],
  ["help.focusToggleLabel", "点按「低速」切换", "Tap Focus to toggle"], ["help.toggle", "切换", "Toggle"],
  ["help.focusHoldSummary", "移动时，按住「低速」按钮", "While moving, hold the Focus button"],
  ["help.hold", "按住", "Hold"], ["help.holdFocus", "按住「低速」", "Hold Focus"], ["help.menu", "菜单中", "In menus"],
  ["help.menuSummary", "滑动选择，单击确认，两指点按返回", "Slide to select, tap to confirm, two-finger tap to go back"],
  ["help.tapConfirm", "单击确认", "Tap to confirm"], ["help.slideConfirm", "滑动选择，再单击确认", "Slide to select, then tap to confirm"],
  ["help.twoFingerBack", "两指点按返回", "Two-finger tap to go back"], ["help.dialogue", "对话中", "In dialogue"],
  ["help.dialogueSummary", "长按可以快速跳过对话", "Long-press to fast-forward dialogue"],
  ["help.dialogue1", "……今晚的月色真漂亮", "…The moon is beautiful tonight"], ["help.dialogue2", "红茶已经凉了", "The tea has gone cold"],
  ["help.dialogue3", "那边似乎有声音", "There seems to be a sound over there"], ["help.dialogue4", "总之，继续前进吧", "Anyway, let's keep going"],
  ["help.thpracSummary", "分段练习与作弊菜单", "Segment practice and cheat menu"],
  ["help.thpracIntro", "开启 thprac 后，从 Practice 进入练习器，可直接选择关卡段落、Boss 或符卡，并设置初始残机、Bomb、火力等参数。", "After enabling thprac, enter it from Practice to choose stage sections, bosses, or spell cards and set starting lives, Bombs, power, and more."],
  ["help.tracker", "打开 / 关闭练习统计 Tracker", "Open / close the practice Tracker"], ["help.cheatMenu", "打开 / 关闭作弊菜单", "Open / close the cheat menu"],
  ["help.thpracControls", "操作 thprac 菜单中的控件", "Operate controls in the thprac menu"],
  ["help.thpracFeatures", "无敌、无限资源、时间锁、自动 Bomb、BGM 等辅助功能", "Invincibility, infinite resources, time lock, Auto Bomb, BGM, and other tools"],
  ["help.thpracReplayDesktop", "thprac 练习录像包含额外练习参数，播放时请保持 thprac 开启。", "thprac practice replays include extra practice parameters; keep thprac enabled during playback."],
  ["help.thpracReplayMobile", "在「触控设置」中启用 thprac 按键集合后，即可使用模拟鼠标、作弊菜单、Tab 与 F1–F7。thprac 练习录像包含额外练习参数，播放时请保持 thprac 开启。", "Enable the thprac button set in Touch settings to use mouse emulation, cheat menu, Tab, and F1–F7. Keep thprac enabled when playing practice replays."],
  ["player.switchLandscape", "切换到横屏", "Switch to landscape"], ["player.switchPortrait", "切换到竖屏", "Switch to portrait"],
  ["player.switchOrientationTitle", "切换屏幕方向", "Switch screen orientation"],
  ["player.restoreViewportAria", "恢复游戏画面原位置和大小", "Restore the game's original position and size"],
  ["player.restoreViewportTitle", "恢复原位置和大小", "Restore original position and size"], ["player.rotate", "旋转", "Rotate"],
  ["player.enterFullscreen", "进入全屏", "Enter fullscreen"], ["player.exitFullscreen", "退出全屏", "Exit fullscreen"],
  ["player.enterFullscreenTitle", "进入全屏（Alt+Enter）", "Enter fullscreen (Alt+Enter)"],
  ["player.exitFullscreenTitle", "退出全屏（Alt+Enter）", "Exit fullscreen (Alt+Enter)"],
  ["diagnostics.aria", "运行诊断", "Runtime diagnostics"], ["diagnostics.browser", "浏览器 {value}", "Browser {value}"],
  ["diagnostics.environment", "环境 {value}", "Environment {value}"], ["diagnostics.audio", "音频 {value}", "Audio {value}"],
  ["diagnostics.graphics", "显卡 {value}", "Graphics {value}"], ["diagnostics.maxGap", "最大间隔 {value}", "Maximum gap {value}"],
  ["status.selectGame", "选择游戏后即可启动", "Select a game to start"], ["status.running", "运行中", "Running"],
  ["status.loading", "正在加载…", "Loading…"], ["status.waitingResponse", "等待响应", "Waiting for response"],
  ["status.connectionFailed", "连接失败", "Connection failed"], ["status.requestTimeout", "请求超时", "Request timed out"],
  ["status.deviceOffline", "设备离线", "Device is offline"],
  ["status.connectionRestored", "服务器连接已恢复，正在重新检查网站和游戏更新…", "Server connection restored; checking site and game updates…"],
  ["status.siteUpdateAfterExit", "网站已有更新，退出游戏后自动应用。", "A site update is ready and will be applied after you exit the game."],
  ["status.applyingSiteUpdate", "网站已有更新，正在自动应用…（若本文字出现 3 秒以上，请手动刷新）", "A site update is ready and is being applied… (If this message remains for more than 3 seconds, please refresh manually.)"],
  ["status.remoteUnavailable", "无法连接到远程服务器（{reason}）", "Cannot connect to the remote server ({reason})"],
  ["status.updateCheckFailed", "网站更新检查失败（{reason}）", "Site update check failed ({reason})"],
  ["status.selectedProduct", "已选择 {product}", "Selected {product}"], ["status.switchedProduct", "已切换至 {product}", "Switched to {product}"],
  ["status.shareSettings", "联机模式已共用单机设置", "Multiplayer now shares single-player settings"],
  ["status.separateSettings", "联机模式已改用独立设置", "Multiplayer now uses separate settings"],
  ["status.roomCreated", "已创建房间 {code}", "Room {code} created"], ["status.roomJoined", "已加入房间 {code}", "Joined room {code}"],
  ["status.roomLeft", "已离开联机房间", "Left the multiplayer room"], ["status.enterRoomCode", "请输入房间号", "Enter a room code"],
  ["status.roomCodeCopied", "房间号已复制，可以发给好友", "Room code copied; you can send it to a friend"],
  ["status.roomCode", "房间号：{code}", "Room code: {code}"], ["status.noSpectators", "暂无旁观", "No spectators"],
  ["status.noReplay", "暂无录像文件", "No replay files"], ["status.readingReplay", "正在读取录像…", "Reading replay…"],
  ["status.replayReadFailed", "录像读取失败", "Failed to read replays"],
  ["touch.controlHidden", "{control} 按键不可见", "The {control} button is not visible"],
  ["touch.controlOverlap", "{first} 与 {second} 重叠较多", "{first} overlaps {second} too much"],
  ["touch.controlReserved", "{control} 靠近帮助 / 全屏按钮区域", "{control} is too close to the Help / fullscreen area"],
] as const satisfies readonly UiMessageEntry[];

export type UiLocale = typeof UI_LOCALES[number];
export type UiMessageKey = typeof entries[number][0];
export type UiMessageParams = Readonly<Record<string, unknown>>;

const entryKeys = new Set<UiMessageKey>(entries.map(([key]) => key));

function buildCatalog(index: 1 | 2): Readonly<Record<UiMessageKey, string>> {
  return Object.freeze(Object.fromEntries(entries.map(entry => [entry[0], entry[index]]))) as Readonly<Record<UiMessageKey, string>>;
}

export const UI_MESSAGES = Object.freeze({
  "zh-CN": buildCatalog(1),
  en: buildCatalog(2),
});

let currentLocale: UiLocale = "zh-CN";
let bound = false;

function safeStorage(): Storage | null { try { return globalThis.localStorage; } catch { return null; } }
export function isUiLocale(value: unknown): value is UiLocale {
  return value === "zh-CN" || value === "en";
}
export function isUiMessageKey(value: unknown): value is UiMessageKey {
  return typeof value === "string" && entryKeys.has(value as UiMessageKey);
}
export function resolveUiLocale(value: unknown): UiLocale { return /^zh(?:-|$)/i.test(String(value || "")) ? "zh-CN" : "en"; }
export function detectUiLocale(): UiLocale {
  try { const saved = safeStorage()?.getItem(UI_LOCALE_STORAGE_KEY); if (isUiLocale(saved)) return saved; } catch {}
  for (const value of globalThis.navigator?.languages || [globalThis.navigator?.language]) if (value) return resolveUiLocale(value);
  return "zh-CN";
}
export function getUiLocale(): UiLocale { return currentLocale; }
export function t(key: UiMessageKey, params: UiMessageParams = {}): string {
  const value = UI_MESSAGES[currentLocale][key] ?? UI_MESSAGES["zh-CN"][key];
  if (value == null) {
    globalThis.console?.warn?.(`Missing UI translation: ${String(key)}`);
    return String(key);
  }
  return String(value).replace(/\{([A-Za-z0-9_]+)\}/g, (_, name: string) => String(params[name] ?? `{${name}}`));
}
function translatedValue(key: string | undefined): string | null {
  if (!isUiMessageKey(key)) {
    if (key) globalThis.console?.warn?.(`Missing UI translation: ${key}`);
    return null;
  }
  return t(key);
}
export function applyStaticTranslations(root: ParentNode | null | undefined = globalThis.document): void {
  if (!root?.querySelectorAll) return;
  for (const element of root.querySelectorAll<HTMLElement>("[data-i18n]")) {
    const value = translatedValue(element.dataset.i18n);
    if (value != null) element.textContent = value;
  }
  const bindings = [["aria-label", "i18nAriaLabel"], ["title", "i18nTitle"], ["placeholder", "i18nPlaceholder"], ["alt", "i18nAlt"], ["content", "i18nContent"]] as const;
  for (const [attribute, property] of bindings) {
    const selector = `[data-${property.replace(/[A-Z]/g, value => `-${value.toLowerCase()}`)}]`;
    for (const element of root.querySelectorAll<HTMLElement>(selector)) {
      const value = translatedValue(element.dataset[property]);
      if (value != null) element.setAttribute(attribute, value);
    }
  }
}
export function setUiLocale(value: unknown, { persist = true, notify = true }: { persist?: boolean; notify?: boolean } = {}): UiLocale {
  currentLocale = resolveUiLocale(value);
  if (persist) { try { safeStorage()?.setItem(UI_LOCALE_STORAGE_KEY, currentLocale); } catch {} }
  if (typeof document !== "undefined") {
    document.documentElement.lang = currentLocale;
    document.documentElement.dataset.uiLocale = currentLocale;
    const select = document.querySelector<HTMLSelectElement>("#uiLanguageSelect");
    if (select) select.value = currentLocale;
    applyStaticTranslations(document);
  }
  if (notify && typeof window !== "undefined") window.dispatchEvent(new CustomEvent("eagler-ui-locale-change", { detail: { locale: currentLocale } }));
  return currentLocale;
}
export function initUiLocale(): UiLocale {
  setUiLocale(detectUiLocale(), { persist: false, notify: false });
  const select = document.querySelector<HTMLSelectElement>("#uiLanguageSelect");
  if (select && !bound) {
    bound = true;
    select.addEventListener("change", () => setUiLocale(select.value));
  }
  return currentLocale;
}
export function validateUiCatalogs(): UiMessageKey[] {
  const keys = entries.map(([key]) => key);
  if (new Set(keys).size !== keys.length) throw new Error("UI translation keys must be unique");
  for (const [key, zh, english] of entries) if (!key || !zh || !english) throw new Error(`Incomplete UI translation: ${key}`);
  return [...keys];
}
