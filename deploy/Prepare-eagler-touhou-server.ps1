[CmdletBinding()]
param(
    [Parameter(Mandatory)] [string] $Th06Directory,
    [Parameter(Mandatory)] [string] $Th07Directory,
    [Parameter(Mandatory)] [string] $OutputDirectory,
    [string[]] $Music = @('midi', 'ogg'),
    [string] $FontFile = "$env:WINDIR\Fonts\msgothic.ttc",
    [string] $Python = 'python',
    [string] $EmsdkDirectory,
    [string] $CMake,
    [string] $Ninja
)

$ErrorActionPreference = 'Stop'
$project = Split-Path $PSScriptRoot -Parent
$workspace = Split-Path $project -Parent
$th06Source = (Resolve-Path -LiteralPath $Th06Directory).Path
$th07Source = (Resolve-Path -LiteralPath $Th07Directory).Path
$font = (Resolve-Path -LiteralPath $FontFile).Path
$output = [IO.Path]::GetFullPath($OutputDirectory)
$stagingRoot = "$output.admin-staging"
$Music = @($Music | ForEach-Object { $_ -split ',' } | ForEach-Object { $_.Trim().ToLowerInvariant() } | Where-Object { $_ })
foreach ($mode in $Music) {
    if ($mode -notin @('midi', 'ogg', 'wav')) { throw "Unsupported music mode: $mode" }
}

if ($output -eq [IO.Path]::GetPathRoot($output) -or $output -eq $workspace) {
    throw "Unsafe output directory: $output"
}
trap {
    if (Test-Path -LiteralPath $stagingRoot) { Remove-Item -LiteralPath $stagingRoot -Recurse -Force -ErrorAction SilentlyContinue }
    throw
}

$th06Archives = @('紅魔郷CM.DAT', '紅魔郷ED.DAT', '紅魔郷IN.DAT', '紅魔郷MD.DAT', '紅魔郷ST.DAT', '紅魔郷TL.DAT')
$required = @($font, (Join-Path $th07Source 'th07.dat'))
$required += $th06Archives | ForEach-Object { Join-Path $th06Source $_ }
if ($Music -contains 'wav' -or $Music -contains 'ogg') {
    $required += 1..17 | ForEach-Object { Join-Path $th06Source ('bgm\th06_{0:d2}.wav' -f $_) }
    $required += Join-Path $th07Source 'thbgm.dat'
}
foreach ($path in $required) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Required original resource not found: $path" }
}

$emsdk = if ($EmsdkDirectory) { (Resolve-Path -LiteralPath $EmsdkDirectory).Path } else { Join-Path $workspace 'toolchains\emsdk' }
$emcmake = Join-Path $emsdk 'upstream\emscripten\emcmake.exe'
if (-not (Test-Path -LiteralPath $emcmake -PathType Leaf)) { throw "emcmake not found: $emcmake" }
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
$cmake = Find-BuildTool $CMake 'CMake' 'Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\cmake.exe'
$ninja = Find-BuildTool $Ninja 'Ninja' 'Common7\IDE\CommonExtensions\Microsoft\CMake\Ninja\ninja.exe'

if (Test-Path -LiteralPath $stagingRoot) { Remove-Item -LiteralPath $stagingRoot -Recurse -Force }
$privateAssets = Join-Path $stagingRoot 'private-assets'
$th06Assets = Join-Path $privateAssets 'th06'
$th07Assets = Join-Path $privateAssets 'th07'
$generated = Join-Path $stagingRoot 'generated'
New-Item -ItemType Directory -Path $th06Assets, $th07Assets, $generated -Force | Out-Null
Copy-Item -LiteralPath $font -Destination (Join-Path $th06Assets 'msgothic.ttc')
Copy-Item -LiteralPath $font -Destination (Join-Path $th07Assets 'msgothic.ttc')
foreach ($name in $th06Archives) { Copy-Item -LiteralPath (Join-Path $th06Source $name) -Destination (Join-Path $th06Assets $name) }
Copy-Item -LiteralPath (Join-Path $th07Source 'th07.dat') -Destination (Join-Path $th07Assets 'th07.dat')

$musicSet = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
$Music | ForEach-Object { [void] $musicSet.Add($_) }
[void] $musicSet.Add('midi')
if ($musicSet.Contains('ogg')) {
    $converterPython = $Python
    & $Python -c 'import soundfile' 2>$null
    if ($LASTEXITCODE -ne 0) {
        $venv = Join-Path $project '.deploy-python'
        $converterPython = Join-Path $venv 'Scripts\python.exe'
        if (-not (Test-Path -LiteralPath $converterPython -PathType Leaf)) {
            & $Python -m venv $venv
            if ($LASTEXITCODE -ne 0) { throw "Unable to create the private deployment Python environment." }
        }
        & $converterPython -m pip install --disable-pip-version-check -r (Join-Path $PSScriptRoot 'requirements.txt')
        if ($LASTEXITCODE -ne 0) { throw "Unable to install the private OGG conversion dependency." }
    }
    & $converterPython (Join-Path $workspace 'th06-eagler\scripts\convert_bgm_ogg.py') `
        --input (Join-Path $th06Source 'bgm') --output (Join-Path $generated 'th06\bgm')
    if ($LASTEXITCODE -ne 0) { throw "TH06 OGG conversion failed. Install deploy/requirements.txt into the selected Python environment." }
    & $converterPython (Join-Path $workspace 'th07-eagler\scripts\convert_bgm_ogg.py') `
        --archive (Join-Path $th07Source 'th07.dat') --pcm (Join-Path $th07Source 'thbgm.dat') `
        --output (Join-Path $generated 'th07\bgm-ogg')
    if ($LASTEXITCODE -ne 0) { throw "TH07 OGG conversion failed. Install deploy/requirements.txt into the selected Python environment." }
}

$env:EM_CONFIG = Join-Path $emsdk '.emscripten'
$ninjaArgument = '-DCMAKE_MAKE_PROGRAM=' + $ninja
$builds = @{}
foreach ($game in @('th06', 'th07')) {
    $source = Join-Path $workspace "$game-eagler"
    $build = Join-Path $stagingRoot "build-$game"
    $assetArgument = if ($game -eq 'th06') { '-DTH06_ASSET_ROOT=' + $th06Assets } else { '-DTH07_ASSET_ROOT=' + $th07Assets }
    & $emcmake $cmake -S $source -B $build -G Ninja $ninjaArgument -DCMAKE_BUILD_TYPE=Release -DTH_WEB_MUSIC=BASE -DTH_WEB_SHARED_FONT=ON -DTH_ENABLE_THCRAP=OFF -DTH_ENABLE_THPRAC=OFF $assetArgument
    if ($LASTEXITCODE -ne 0) { throw "$game Web configure failed: $LASTEXITCODE" }
    & $cmake --build $build --parallel 6
    if ($LASTEXITCODE -ne 0) { throw "$game Web build failed: $LASTEXITCODE" }
    $builds[$game] = $build
}

$nodeArgs = @(
    (Join-Path $project 'scripts\package-server.mjs'),
    "--output=$output",
    "--th06-build=$($builds.th06)", "--th07-build=$($builds.th07)",
    "--th06-assets=$th06Source", "--th07-assets=$th07Source",
    "--font=$font",
    "--music=$([string]::Join(',', $musicSet))"
)
if ($musicSet.Contains('ogg')) {
    $nodeArgs += "--th06-ogg=$(Join-Path $generated 'th06')"
    $nodeArgs += "--th07-ogg=$(Join-Path $generated 'th07')"
}
& node @nodeArgs
if ($LASTEXITCODE -ne 0) { throw "Server packaging failed: $LASTEXITCODE" }
& node (Join-Path $project 'scripts\verify-server-build.mjs') $output
if ($LASTEXITCODE -ne 0) { throw "Server verification failed: $LASTEXITCODE" }

Remove-Item -LiteralPath $stagingRoot -Recurse -Force
Write-Host "Deployment is ready: $output"
Write-Host "Serve this directory as a static site and open /eagler-touhou/."
