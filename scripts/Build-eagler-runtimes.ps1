[CmdletBinding()]
param(
    [string] $EmsdkDirectory,
    [string] $CMake,
    [string] $Ninja,
    [switch] $EmbedLocalAssets,
    [string] $Th06AssetDirectory,
    [string] $Th07AssetDirectory,
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

if (-not $EmbedLocalAssets -and ($Th06AssetDirectory -or $Th07AssetDirectory)) {
    throw 'Asset directories require -EmbedLocalAssets'
}
$assetDirectories = @{}
if ($EmbedLocalAssets) {
    if (-not $Th06AssetDirectory) { $Th06AssetDirectory = Join-Path $workspace 'th06-eagler\assets' }
    if (-not $Th07AssetDirectory) { $Th07AssetDirectory = Join-Path $workspace 'th07-eagler\assets' }
    $assetDirectories.th06 = (Resolve-Path -LiteralPath $Th06AssetDirectory).Path
    $assetDirectories.th07 = (Resolve-Path -LiteralPath $Th07AssetDirectory).Path
}

foreach ($game in @('th06', 'th07')) {
    $source = Join-Path $workspace "$game-eagler"
    if (-not (Test-Path -LiteralPath (Join-Path $source 'CMakeLists.txt') -PathType Leaf)) {
        throw "Runtime source not found: $source"
    }
    # Source-only and playable development builds must never share a CMake cache.
    # Reconfiguring one directory between TH_EXTERNAL_ASSETS=ON/OFF leaves the
    # development host pointing at a runtime with no game archives.
    $buildName = if ($EmbedLocalAssets) { 'build-web-eagler-default' } else { 'build-web-eagler-external' }
    $externalAssets = if ($EmbedLocalAssets) { 'OFF' } else { 'ON' }
    $build = Join-Path $source $buildName
    $configureArguments = @(
        '-S', $source, '-B', $build, '-G', 'Ninja', "-DCMAKE_MAKE_PROGRAM=$Ninja",
        '-DCMAKE_BUILD_TYPE=Release', '-DTH_WEB_MUSIC=BASE', '-DTH_WEB_SHARED_FONT=ON',
        "-DTH_EXTERNAL_ASSETS=$externalAssets"
    )
    if ($EmbedLocalAssets) {
        $assetVariable = if ($game -eq 'th06') { 'TH06_ASSET_ROOT' } else { 'TH07_ASSET_ROOT' }
        $configureArguments += "-D${assetVariable}=$($assetDirectories[$game])"
    }
    & $emcmake $CMake @configureArguments
    if ($LASTEXITCODE -ne 0) { throw "$game Web configure failed: $LASTEXITCODE" }
    & $CMake --build $build --parallel $Parallel
    if ($LASTEXITCODE -ne 0) { throw "$game Web build failed: $LASTEXITCODE" }
}

$kind = if ($EmbedLocalAssets) { 'playable local development' } else { 'source-only external-assets' }
Write-Host "TH06 and TH07 $kind Web runtimes are ready."
