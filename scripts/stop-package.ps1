$ErrorActionPreference = 'Stop'
$packageRoot = $PSScriptRoot
$stateFile = Join-Path $packageRoot '.eagler-touhou-server.json'

if (-not (Test-Path -LiteralPath $stateFile)) {
    Write-Output 'eagler-touhou 没有由启动脚本运行。'
    exit 0
}

$state = Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json
$process = Get-CimInstance Win32_Process -Filter "ProcessId = $($state.ProcessId)" -ErrorAction SilentlyContinue

if ($process -and $process.Name -eq 'node.exe' -and $process.CommandLine -match 'serve\.mjs') {
    Stop-Process -Id $state.ProcessId
    Write-Output 'eagler-touhou 已停止。'
} else {
    Write-Output '记录的服务器进程已经结束；未停止任何其他进程。'
}

Remove-Item -LiteralPath $stateFile -Force
