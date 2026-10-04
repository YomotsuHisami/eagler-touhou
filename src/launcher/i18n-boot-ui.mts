/** Shared by the pre-module recovery card and the Framework route boundary. */
export const bootUiEntries = [
  ['boot.title', '启动器未能载入', 'Launcher could not load'],
  ['boot.timeout', '启动器没有在预期时间内准备完成。请重新加载页面。', 'The launcher did not become ready in time. Please reload the page.'],
  ['boot.script', '有一项启动文件未能载入。请检查网络后重新加载。', 'A startup file could not load. Check your connection and reload.'],
  ['boot.javascript', '启动器初始化时遇到错误。请重新加载页面。', 'The launcher encountered an error while starting. Please reload the page.'],
  ['boot.hint', '如果仍然失败，请复制诊断信息并反馈。此操作不会清除已安装的游戏或存档。', 'If this keeps happening, copy the diagnostics to report it. This does not clear installed games or saves.'],
  ['boot.details', '查看诊断信息', 'View diagnostics'],
  ['boot.copy', '复制诊断信息', 'Copy diagnostics'],
  ['boot.copied', '已复制', 'Copied'],
  ['boot.copyFailed', '无法自动复制，请选中诊断信息并手动复制。', 'Could not copy automatically. Select the diagnostics and copy them manually.'],
  ['boot.reload', '重新加载', 'Reload'],
  ['boot.routeTitle', '页面未能载入', 'This page could not load'],
  ['boot.routeError', '显示此页面时遇到错误。请重新加载页面。', 'An error occurred while showing this page. Please reload the page.'],
  ['boot.notFound', '找不到此页面，请检查网址。', 'This page could not be found. Please check the address.'],
] as const;
