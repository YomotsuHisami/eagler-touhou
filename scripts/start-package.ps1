param(
    [int]$Port = 28131,
    [switch]$NoOpen
)

$ErrorActionPreference = 'Stop'
$packageRoot = $PSScriptRoot
$project = Join-Path $packageRoot 'eagler-touhou'
$server = Join-Path $project 'scripts\serve.mjs'
$stateFile = Join-Path $packageRoot '.eagler-touhou-server.json'
$node = (Get-Command node.exe -ErrorAction Stop).Source

if ($Port -lt 1 -or $Port -gt 65535) {
    throw '端口必须在 1 到 65535 之间。'
}

if (Test-Path -LiteralPath $stateFile) {
    $state = Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json
    $existing = Get-CimInstance Win32_Process -Filter "ProcessId = $($state.ProcessId)" -ErrorAction SilentlyContinue
    if ($existing -and $existing.CommandLine -match 'serve\.mjs') {
        $url = "http://127.0.0.1:$($state.Port)/eagler-touhou/"
        if (-not $NoOpen) { Start-Process $url }
        Write-Output "eagler-touhou 已在运行：$url"
        exit 0
    }
    Remove-Item -LiteralPath $stateFile -Force
}

$process = Start-Process -FilePath $node -WorkingDirectory $project `
    -ArgumentList @($server, $Port) -WindowStyle Hidden -PassThru

try {
    $deadline = [DateTime]::UtcNow.AddSeconds(10)
    $url = "http://127.0.0.1:$Port/eagler-touhou/"
    do {
        Start-Sleep -Milliseconds 200
        if ($process.HasExited) {
            throw "服务器启动失败，退出代码：$($process.ExitCode)"
        }
        try {
            $response = Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec 2
        } catch {
            $response = $null
        }
    } until (($response -and $response.StatusCode -eq 200) -or [DateTime]::UtcNow -ge $deadline)

    if (-not $response -or $response.StatusCode -ne 200) {
        throw '服务器健康检查超时。'
    }

    @{ ProcessId = $process.Id; Port = $Port } |
        ConvertTo-Json | Set-Content -LiteralPath $stateFile -Encoding utf8
    if (-not $NoOpen) { Start-Process $url }
    Write-Output "eagler-touhou 已启动：$url"
} catch {
    if (-not $process.HasExited) { Stop-Process -Id $process.Id -Force }
    throw
}
