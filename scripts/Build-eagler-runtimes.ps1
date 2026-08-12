[CmdletBinding()]
param(
    [string] $EmsdkDirectory,
    [string] $CMake,
    [string] $Ninja,
    [int] $Parallel = 6
)

$ErrorActionPreference = 'Stop'
$project = Split-Path $PSScriptRoot -Parent
$workspace = Split-Path $project -Parent
if (-not $EmsdkDirectory) { $EmsdkDirectory = Join-Path $workspace 'toolchains\emsdk' }
$emsdk = (Resolve-Path -LiteralPath $EmsdkDirectory).Path
$emcmake = Join-Path $emsdk 'upstream\emscripten\emcmake.exe'
if (-not (Test-Path -LiteralPath $emcmake -PathType Leaf)) { throw "emcmake not found: $emcmake" }
$env:EM_CONFIG = Join-Path $emsdk '.emscripten'

function Find-BuildTool([string] $Value, [string] $Name, [string] $VisualStudioPattern) {
    if ($Value) { return (Get-Command $Value -ErrorAction Stop).Source }
    $command = Get-Command $Name -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }
    $vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
    if (Test-Path -LiteralPath $vswhere -PathType Leaf) {
        $match = & $vswhere -latest -products * -find $VisualStudioPattern | Select-Object -First 1
        if ($match) { return $match }
    }
    throw "$Name not found; pass -$Name with its executable path"
}
$CMake = Find-BuildTool $CMake 'CMake' 'Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\cmake.exe'
$Ninja = Find-BuildTool $Ninja 'Ninja' 'Common7\IDE\CommonExtensions\Microsoft\CMake\Ninja\ninja.exe'

foreach ($game in @('th06', 'th07')) {
    $source = Join-Path $workspace "$game-eagler"
    if (-not (Test-Path -LiteralPath (Join-Path $source 'CMakeLists.txt') -PathType Leaf)) {
        throw "Runtime source not found: $source"
    }
    $build = Join-Path $source 'build-web-eagler-default'
    & $emcmake $CMake -S $source -B $build -G Ninja "-DCMAKE_MAKE_PROGRAM=$Ninja" `
        -DCMAKE_BUILD_TYPE=Release -DTH_WEB_MUSIC=BASE -DTH_WEB_SHARED_FONT=ON -DTH_EXTERNAL_ASSETS=ON
    if ($LASTEXITCODE -ne 0) { throw "$game Web configure failed: $LASTEXITCODE" }
    & $CMake --build $build --parallel $Parallel
    if ($LASTEXITCODE -ne 0) { throw "$game Web build failed: $LASTEXITCODE" }
}

Write-Host 'TH06 and TH07 Web runtimes are ready.'
