[CmdletBinding()]
param(
    [string] $Th06Directory,
    [string] $Th07Directory,
    [string] $Th08Directory,
    [string] $Th10Directory,
    [string] $Th08Build,
    [string] $Th10Build,
    [string] $RuntimeRelease,
    [Parameter(Mandatory)] [string] $OutputDirectory,
    [string[]] $Music = @('midi', 'ogg'),
    [string] $FontFile,
    [string] $VanillaFontFile,
    [string] $Python = 'python',
    [string] $PythonEnvironmentDirectory,
    [string] $GeneratedCacheDirectory,
    [string] $EmsdkDirectory,
    [string] $CMake,
    [string] $Ninja,
    [string] $Th06LanguagePacks,
    [string] $Th07LanguagePacks,
    [string] $ThtkThanm,
    [string] $ArtworkDirectory,
    [string] $FeatureConfig,
    [string] $HostManifest,
    [string[]] $Games = @('th06', 'th07', 'th08', 'th10'),
    [string] $Profile = 'web-validation-package',
    [switch] $SuppressCompletionSummary
)

$ErrorActionPreference = 'Stop'
$script:SiteProgressId = 6300
$script:SiteProgressTotal = 4

function Write-SiteBuildStage {
    param(
        [Parameter(Mandatory = $true)][int] $Step,
        [Parameter(Mandatory = $true)][string] $Status
    )
    $percent = [Math]::Max(0, [Math]::Min(99, [int](($Step - 1) * 100 / $script:SiteProgressTotal)))
    Write-Progress -Id $script:SiteProgressId -Activity 'Static site assembly' `
        -Status "[$Step/$($script:SiteProgressTotal)] $Status" -PercentComplete $percent
    Write-Host "[Site $Step/$($script:SiteProgressTotal)] $Status"
}

Import-Module (Join-Path $PSScriptRoot 'lib\python-environment.psm1') -Force
$project = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
Import-Module (Join-Path $PSScriptRoot 'lib\workspace-layout.psm1') -Force
$workspaceLayout = Get-EaglerWorkspaceLayout -ProjectRoot $project
$workspace = $workspaceLayout.Root
$FontFile = if ($FontFile) { $FontFile } else { Get-EaglerWorkspacePath $workspaceLayout 'dependencies' 'unifont-15.1.05\unifont-15.1.05.otf' }
$VanillaFontFile = if ($VanillaFontFile) { $VanillaFontFile } else { Join-Path $env:WINDIR 'Fonts\msgothic.ttc' }
$featureConfigPath = if ($FeatureConfig) {
    (Resolve-Path -LiteralPath $FeatureConfig).Path
} else {
    (Resolve-Path -LiteralPath (Join-Path $project 'host\config\site-features.default.json')).Path
}
$artworkOverride = if ($ArtworkDirectory) { (Resolve-Path -LiteralPath $ArtworkDirectory).Path } else { $null }
$featureSettings = Get-Content -LiteralPath $featureConfigPath -Raw | ConvertFrom-Json
if ($featureSettings.schema -ne 'eagler-touhou/server-features/1' -or -not $featureSettings.games) {
    throw "Invalid server feature config: $featureConfigPath"
}
$configuredResourceMode = if ($null -ne $featureSettings.resourceMode) { [string]$featureSettings.resourceMode } else { 'hosted' }
if ($configuredResourceMode -notin @('hosted', 'import')) {
    throw "Invalid resourceMode in server feature config: $featureConfigPath"
}
$resourceMode = $configuredResourceMode
$Games = @($Games | ForEach-Object { $_ -split ',' } | ForEach-Object { $_.Trim().ToLowerInvariant() } | Where-Object { $_ })
if ($Games.Count -eq 0 -or @($Games | Select-Object -Unique).Count -ne $Games.Count -or @($Games | Where-Object { $_ -notin @('th06', 'th07', 'th08', 'th10') }).Count) {
    throw 'Games must be a non-empty unique subset of th06, th07, th08 and th10'
}
$selectedPreloadGames = @($Games | Where-Object { $_ -in @('th06', 'th07') })
$selectedHasTh08 = $Games -contains 'th08'
$selectedHasTh10 = $Games -contains 'th10'
if ($null -ne $featureSettings.gameDataFallback) {
    $fallbackUrl = [string]$featureSettings.gameDataFallback.url
    if (-not $fallbackUrl -or $fallbackUrl -notmatch '^https://') {
        throw "Invalid gameDataFallback.url in server feature config: $featureConfigPath"
    }
    if ($null -ne $featureSettings.gameDataFallback.hint -and $featureSettings.gameDataFallback.hint -isnot [string]) {
        throw "Invalid gameDataFallback.hint in server feature config: $featureConfigPath"
    }
}
if ($null -ne $featureSettings.netplayRelay) {
    $relayUrl = [string]$featureSettings.netplayRelay
    if (-not $relayUrl -or $relayUrl -notmatch '^wss?://') {
        throw "Invalid netplayRelay in server feature config: $featureConfigPath"
    }
}
foreach ($game in $selectedPreloadGames) {
    $entry = $featureSettings.games.$game
    if (-not $entry -or $null -eq $entry.thprac -or -not $entry.languages -or @($entry.languages).Count -eq 0) {
        throw "Invalid $($game.ToUpperInvariant()) server feature entry"
    }
    $seen = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach ($language in @($entry.languages)) {
        $id = [string]$language
        if ($id -notmatch '^(?:ja|lang_[a-z0-9]+(?:-[a-z0-9]+)*)$' -or -not $seen.Add($id)) {
            throw "Invalid $($game.ToUpperInvariant()) language allowlist entry: $id"
        }
    }
}
$output = [IO.Path]::GetFullPath($OutputDirectory)
$outputParent = Split-Path $output -Parent
$temporaryRoot = Join-Path $outputParent '.tmp'
$stagingRoot = Join-Path $temporaryRoot ((Split-Path $output -Leaf) + '.admin-' + [guid]::NewGuid().ToString('N'))
if ($output -eq [IO.Path]::GetPathRoot($output) -or $output -eq $workspace) {
    throw "Unsafe output directory: $output"
}
$runtimeReleasePath = if ($RuntimeRelease) { (Resolve-Path -LiteralPath $RuntimeRelease).Path } else { $null }
if ($runtimeReleasePath) {
    & node (Join-Path $project 'scripts\verify-runtime-release.mjs') $runtimeReleasePath
    if ($LASTEXITCODE -ne 0) { throw "Runtime Release verification failed: $LASTEXITCODE" }
}

function Resolve-RuntimeBuildPlan(
    [string] $Game,
    [string] $Variant,
    [bool] $Thcrap,
    [bool] $Thprac,
    [string] $AssetRoot,
    [AllowEmptyString()] [string] $RuntimeExtension
) {
    $resolver = Join-Path $project 'scripts\resolve-runtime-build.mjs'
    $resolverArgs = @(
        $resolver,
        "--game=$Game",
        "--variant=$Variant",
        "--thcrap=$($Thcrap.ToString().ToLowerInvariant())",
        "--thprac=$($Thprac.ToString().ToLowerInvariant())",
        "--asset-root=$AssetRoot",
        "--runtime-extension=$RuntimeExtension"
    )
    $json = & node @resolverArgs
    if ($LASTEXITCODE -ne 0) { throw "$Game/$Variant Runtime build profile resolution failed: $LASTEXITCODE" }
    return $json | ConvertFrom-Json
}

if ($resourceMode -eq 'import') {
    if (-not $HostManifest) {
        throw "$resourceMode requires -HostManifest pointing to a verified hosted host-manifest.json"
    }
    $hostManifestPath = (Resolve-Path -LiteralPath $HostManifest).Path
    $importArtwork = $artworkOverride
    if (-not $importArtwork) {
        $hostArtwork = Join-Path (Split-Path $hostManifestPath -Parent) 'assets'
        if (Test-Path -LiteralPath $hostArtwork -PathType Container) { $importArtwork = $hostArtwork }
    }
    # App-managed Runtime artifacts are part of the Launcher publication in
    # every resource mode. Import therefore reuses the already-built,
    # locally verified Runtime artifacts instead of compiling from original
    # game assets or expecting imported packs to provide executable Runtime.
    $runtimeBuilds = @{}
    if (-not $runtimeReleasePath) {
        $runtimeSpecs = @()
        if ($Games -contains 'th06') {
            $runtimeBuilds.th06 = Get-EaglerWorkspacePath $workspaceLayout 'th06' 'build-web-eagler-thprac-test'
            $runtimeBuilds.th06Multiplayer = Get-EaglerWorkspacePath $workspaceLayout 'th06' 'build-web-netplay-th06'
            $runtimeSpecs += ,@($runtimeBuilds.th06, 'th06')
            $runtimeSpecs += ,@($runtimeBuilds.th06Multiplayer, 'th06')
        }
        if ($Games -contains 'th07') {
            $runtimeBuilds.th07 = Get-EaglerWorkspacePath $workspaceLayout 'th07' 'build-web-eagler-thprac'
            $runtimeBuilds.th07Multiplayer = Get-EaglerWorkspacePath $workspaceLayout 'th07' 'build-web-th07-netplay'
            $runtimeSpecs += ,@($runtimeBuilds.th07, 'th07')
            $runtimeSpecs += ,@($runtimeBuilds.th07Multiplayer, 'th07')
        }
        if ($selectedHasTh08) {
            $runtimeBuilds.th08 = if ($Th08Build) { (Resolve-Path -LiteralPath $Th08Build).Path } else { Get-EaglerWorkspacePath $workspaceLayout 'th08' 'build-eagler' }
            if (-not (Test-Path -LiteralPath (Join-Path $runtimeBuilds.th08 'runtime-files.json') -PathType Leaf)) {
                throw "Prepared TH08 Runtime directory manifest not found: $(Join-Path $runtimeBuilds.th08 'runtime-files.json')"
            }
            $runtimeSpecs += ,@($runtimeBuilds.th08, 'th08')
        }
        if ($selectedHasTh10) {
            if (-not $Th10Build) { throw 'Import mode without -RuntimeRelease requires -Th10Build when th10 is selected' }
            $runtimeBuilds.th10 = (Resolve-Path -LiteralPath $Th10Build).Path
            if (-not (Test-Path -LiteralPath (Join-Path $runtimeBuilds.th10 'runtime-files.json') -PathType Leaf)) {
                throw "Prepared TH10 Runtime directory manifest not found: $(Join-Path $runtimeBuilds.th10 'runtime-files.json')"
            }
            $runtimeSpecs += ,@($runtimeBuilds.th10, 'th10')
        }
        foreach ($runtime in $runtimeSpecs) {
            if ($runtime[1] -in @('th08', 'th10')) {
                continue
            }
            foreach ($extension in @('html', 'js', 'wasm')) {
                $runtimeFile = Join-Path $runtime[0] ("$($runtime[1]).$extension")
                if (-not (Test-Path -LiteralPath $runtimeFile -PathType Leaf)) {
                    throw "Prepared App Runtime artifact not found: $runtimeFile"
                }
            }
        }
    }
    $nodeArgs = @(
        (Join-Path $project 'scripts\package-server.mjs'),
        "--output=$output",
        "--feature-config=$featureConfigPath",
        "--host-manifest=$hostManifestPath",
        "--games=$([string]::Join(',', $Games))",
        "--profile=$Profile"
    )
    if ($importArtwork) { $nodeArgs += "--artwork-dir=$importArtwork" }
    if ($runtimeReleasePath) {
        $nodeArgs += "--runtime-release=$runtimeReleasePath"
    } elseif ($Games -contains 'th06') {
        $nodeArgs += "--th06-build=$($runtimeBuilds.th06)"
        $nodeArgs += "--th06-multiplayer-build=$($runtimeBuilds.th06Multiplayer)"
    }
    if (-not $runtimeReleasePath -and $Games -contains 'th07') {
        $nodeArgs += "--th07-build=$($runtimeBuilds.th07)"
        $nodeArgs += "--th07-multiplayer-build=$($runtimeBuilds.th07Multiplayer)"
    }
    if (-not $runtimeReleasePath -and $selectedHasTh08) { $nodeArgs += "--th08-build=$($runtimeBuilds.th08)" }
    if (-not $runtimeReleasePath -and $selectedHasTh10) { $nodeArgs += "--th10-build=$($runtimeBuilds.th10)" }
    & node @nodeArgs
    if ($LASTEXITCODE -ne 0) { throw "$resourceMode server packaging failed: $LASTEXITCODE" }
    & node (Join-Path $project 'scripts\verify-server-build.mjs') $output
    if ($LASTEXITCODE -ne 0) { throw "$resourceMode server verification failed: $LASTEXITCODE" }
    Write-Host "$resourceMode deployment base is ready: $output"
    Write-Host "Players must import a complete game-content pack before launch. App Runtime is published with the Launcher."
    return
}

if (($Games -contains 'th06') -and -not $Th06Directory) { throw "Hosted resource mode requires -Th06Directory when th06 is selected" }
if (($Games -contains 'th07') -and -not $Th07Directory) { throw "Hosted resource mode requires -Th07Directory when th07 is selected" }
if ($selectedHasTh08 -and -not $Th08Directory) { throw "Hosted resource mode requires -Th08Directory when th08 is selected" }
if ($selectedHasTh10 -and -not $Th10Directory) { throw "Hosted resource mode requires -Th10Directory when th10 is selected" }
$th06Source = if ($Games -contains 'th06') { (Resolve-Path -LiteralPath $Th06Directory).Path } else { $null }
$th07Source = if ($Games -contains 'th07') { (Resolve-Path -LiteralPath $Th07Directory).Path } else { $null }
$th08Source = if ($selectedHasTh08) { (Resolve-Path -LiteralPath $Th08Directory).Path } else { $null }
$th10Source = if ($selectedHasTh10) { (Resolve-Path -LiteralPath $Th10Directory).Path } else { $null }
$th08Build = if ($selectedHasTh08 -and -not $runtimeReleasePath) {
    if ($Th08Build) { (Resolve-Path -LiteralPath $Th08Build).Path } else { Get-EaglerWorkspacePath $workspaceLayout 'th08' 'build-eagler' }
} else { $null }
$th10Build = if ($selectedHasTh10 -and -not $runtimeReleasePath) {
    if (-not $Th10Build) { throw 'Hosted mode without -RuntimeRelease requires -Th10Build when th10 is selected' }
    (Resolve-Path -LiteralPath $Th10Build).Path
} else { $null }
$font = (Resolve-Path -LiteralPath $FontFile).Path
$vanillaFont = (Resolve-Path -LiteralPath $VanillaFontFile).Path
$Music = @($Music | ForEach-Object { $_ -split ',' } | ForEach-Object { $_.Trim().ToLowerInvariant() } | Where-Object { $_ })
foreach ($mode in $Music) {
    if ($mode -notin @('midi', 'ogg', 'wav')) { throw "Unsupported music mode: $mode" }
}

trap {
    if ($stagingRoot -and (Test-Path -LiteralPath $stagingRoot)) {
        Remove-Item -LiteralPath $stagingRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
    throw $_
}

$th06Archives = @('紅魔郷CM.DAT', '紅魔郷ED.DAT', '紅魔郷IN.DAT', '紅魔郷MD.DAT', '紅魔郷ST.DAT', '紅魔郷TL.DAT')
$required = @($font, $vanillaFont)
if ($Games -contains 'th06') { $required += $th06Archives | ForEach-Object { Join-Path $th06Source $_ } }
if ($Games -contains 'th07') { $required += Join-Path $th07Source 'th07.dat' }
if ($selectedHasTh08) { $required += Join-Path $th08Source 'th08.dat' }
if ($selectedHasTh10) { $required += Join-Path $th10Source 'th10.dat' }
if ($Music -contains 'wav' -or $Music -contains 'ogg') {
    if ($Games -contains 'th06') { $required += 1..17 | ForEach-Object { Join-Path $th06Source ('bgm\th06_{0:d2}.wav' -f $_) } }
    if ($Games -contains 'th07') { $required += Join-Path $th07Source 'thbgm.dat' }
    if ($selectedHasTh08) { $required += Join-Path $th08Source 'thbgm.dat' }
}
foreach ($path in $required) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Required original resource not found: $path" }
}
if ($selectedHasTh08 -and -not $runtimeReleasePath) {
    $runtimeManifest = Join-Path $th08Build 'runtime-files.json'
    if (-not (Test-Path -LiteralPath $runtimeManifest -PathType Leaf)) {
        throw "Prepared TH08 Runtime directory manifest not found: $runtimeManifest"
    }
}
if ($selectedHasTh10 -and -not $runtimeReleasePath -and -not (Test-Path -LiteralPath (Join-Path $th10Build 'runtime-files.json') -PathType Leaf)) {
    throw "Prepared TH10 Runtime directory manifest not found: $(Join-Path $th10Build 'runtime-files.json')"
}

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
$emsdk = $null
$emcmake = $null
$cmake = $null
$ninja = $null
if ($selectedPreloadGames.Count -gt 0 -and -not $runtimeReleasePath) {
    $emsdk = if ($EmsdkDirectory) { (Resolve-Path -LiteralPath $EmsdkDirectory).Path } else { Get-EaglerWorkspacePath $workspaceLayout 'toolchains' 'emsdk' }
    $emcmake = Join-Path $emsdk 'upstream\emscripten\emcmake.exe'
    if (-not (Test-Path -LiteralPath $emcmake -PathType Leaf)) { throw "emcmake not found: $emcmake" }
    $cmake = Find-BuildTool $CMake 'CMake' 'Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\cmake.exe'
    $ninja = Find-BuildTool $Ninja 'Ninja' 'Common7\IDE\CommonExtensions\Microsoft\CMake\Ninja\ninja.exe'
}
$thpracPortableCMake = Get-EaglerWorkspacePath $workspaceLayout 'thprac' 'portable\cmake\AttachReallyportable.cmake'
if (-not $runtimeReleasePath -and @($selectedPreloadGames | Where-Object { [bool]$featureSettings.games.$_.thprac }).Count -gt 0 -and -not (Test-Path -LiteralPath $thpracPortableCMake -PathType Leaf)) {
    throw "Reallyportable thprac CMake adapter not found: $thpracPortableCMake"
}

if (-not (Test-Path -LiteralPath $temporaryRoot)) { New-Item -ItemType Directory -Path $temporaryRoot -Force | Out-Null }
if (Test-Path -LiteralPath $stagingRoot) { Remove-Item -LiteralPath $stagingRoot -Recurse -Force }
$privateAssets = Join-Path $stagingRoot 'private-assets'
$th06Assets = Join-Path $privateAssets 'th06'
$th07Assets = Join-Path $privateAssets 'th07'
$generated = if ($GeneratedCacheDirectory) {
    [IO.Path]::GetFullPath($GeneratedCacheDirectory)
} else {
    Join-Path $stagingRoot 'generated'
}
New-Item -ItemType Directory -Path $generated -Force | Out-Null
$hostArtwork = Join-Path $stagingRoot 'host-artwork'
$deploymentPythonRoot = if ($PythonEnvironmentDirectory) { [IO.Path]::GetFullPath($PythonEnvironmentDirectory) } else { Join-Path $project '.cache\maintainer-python' }
$uiPython = Resolve-DeploymentPython -Python $Python -EnvironmentDirectory $deploymentPythonRoot `
    -RequirementsPath (Join-Path $project 'host\requirements.txt') -RequiredModules @('PIL') `
    -RequirePrivateEnvironment:$([bool]$PythonEnvironmentDirectory)
Write-SiteBuildStage 1 'Preparing artwork and shared assets'
$artworkArgs = @(
    (Join-Path $project 'scripts\prepare-host-artwork.py'),
    "--output=$hostArtwork",
    "--games=$([string]::Join(',', $Games))"
)
if ($Games -contains 'th06') { $artworkArgs += "--th06-dir=$th06Source" }
if ($Games -contains 'th07') { $artworkArgs += "--th07-dir=$th07Source" }
if ($selectedHasTh08) { $artworkArgs += "--th08-dir=$th08Source" }
if ($selectedHasTh10) { $artworkArgs += "--th10-dir=$th10Source" }
if ($selectedHasTh10 -and $ThtkThanm) {
    $thanmForArtwork = (Resolve-Path -LiteralPath $ThtkThanm).Path
    $thdatForArtwork = Join-Path (Split-Path $thanmForArtwork -Parent) 'thdat.exe'
    if (-not (Test-Path -LiteralPath $thdatForArtwork -PathType Leaf)) {
        throw "TH10 artwork extraction requires thdat.exe next to ThtkThanm: $thdatForArtwork"
    }
    $artworkArgs += "--thdat=$thdatForArtwork", "--thanm=$thanmForArtwork"
}
if ($artworkOverride) { $artworkArgs += "--override-dir=$artworkOverride" }
& $uiPython @artworkArgs
if ($LASTEXITCODE -ne 0) { throw "Host artwork preparation failed: $LASTEXITCODE" }
if ($Games -contains 'th06') {
    New-Item -ItemType Directory -Path $th06Assets -Force | Out-Null
    Copy-Item -LiteralPath $font -Destination (Join-Path $th06Assets 'unifont.otf')
    Copy-Item -LiteralPath $vanillaFont -Destination (Join-Path $th06Assets 'msgothic.ttc')
    foreach ($name in $th06Archives) { Copy-Item -LiteralPath (Join-Path $th06Source $name) -Destination (Join-Path $th06Assets $name) }
}
if ($Games -contains 'th07') {
    New-Item -ItemType Directory -Path $th07Assets -Force | Out-Null
    Copy-Item -LiteralPath $font -Destination (Join-Path $th07Assets 'unifont.otf')
    Copy-Item -LiteralPath $vanillaFont -Destination (Join-Path $th07Assets 'msgothic.ttc')
    Copy-Item -LiteralPath (Join-Path $th07Source 'th07.dat') -Destination (Join-Path $th07Assets 'th07.dat')
}

$th10DataAssets = $null
if ($selectedHasTh10) {
    $th10DataAssets = Join-Path $generated 'th10'
    $th10ContentScript = Get-EaglerWorkspacePath $workspaceLayout 'th10' 'scripts\prepare-eagler-content.mjs'
    & node $th10ContentScript "--original=$th10Source" "--output=$th10DataAssets"
    if ($LASTEXITCODE -ne 0) { throw "TH10 content preparation failed: $LASTEXITCODE" }
}
if (($Games -contains 'th06') -and ($Games -contains 'th07')) {
    if ($ThtkThanm) {
        $thanm = (Resolve-Path -LiteralPath $ThtkThanm).Path
        $hitboxStage = Join-Path $stagingRoot 'hitbox-extract'
        $hitboxAnm = Join-Path $hitboxStage 'etama.anm'
        New-Item -ItemType Directory -Path $hitboxStage -Force | Out-Null
        & $uiPython (Join-Path $project 'scripts\touhou_formats.py') extract-pbg4-entry `
            --archive (Join-Path $th07Source 'th07.dat') --entry 'etama.anm' --output $hitboxAnm
        if ($LASTEXITCODE -ne 0) { throw 'TH07 etama.anm extraction for the TH06 focus-hitbox failed.' }
        Push-Location $hitboxStage
        try {
            & $thanm -x $hitboxAnm 'data/etama/etama2.png'
            if ($LASTEXITCODE -ne 0) { throw 'thtk thanm failed to extract the TH06 focus-hitbox texture.' }
        } finally {
            Pop-Location
        }
        $hitboxPng = Join-Path $hitboxStage 'data\etama\etama2.png'
        if (-not (Test-Path -LiteralPath $hitboxPng -PathType Leaf)) {
            throw 'thtk thanm did not produce the TH06 focus-hitbox texture.'
        }
        Copy-Item -LiteralPath $hitboxPng -Destination (Join-Path $th06Assets 'eagler-hitbox.png') -Force
    } else {
        & $Python (Join-Path $project 'scripts\touhou_formats.py') extract-th07-texture `
            --archive (Join-Path $th07Source 'th07.dat') --anm 'etama.anm' `
            --texture 'data/etama/etama2.png' --output (Join-Path $th06Assets 'eagler-hitbox.png')
        if ($LASTEXITCODE -ne 0) {
            Write-Warning 'TH06 focus-hitbox extraction failed; it will remain disabled unless the selected Runtime DATA layout requires that file.'
            Remove-Item -LiteralPath (Join-Path $th06Assets 'eagler-hitbox.png') -Force -ErrorAction SilentlyContinue
        }
    }
}

$musicSet = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
$Music | ForEach-Object { [void] $musicSet.Add($_) }
[void] $musicSet.Add('midi')
Write-SiteBuildStage 2 'Preparing music payloads'
if ($musicSet.Contains('ogg')) {
    $converterPython = Resolve-DeploymentPython -Python $Python -EnvironmentDirectory $deploymentPythonRoot `
        -RequirementsPath (Join-Path $project 'host\requirements.txt') -RequiredModules @('soundfile') `
        -RequirePrivateEnvironment:$([bool]$PythonEnvironmentDirectory)
    if ($Games -contains 'th06') {
        & $converterPython (Join-Path $project 'scripts\convert_bgm_ogg.py') `
            --game th06 --original-dir $th06Source --output (Join-Path $generated 'th06\bgm')
        if ($LASTEXITCODE -ne 0) { throw "TH06 OGG conversion failed. Install host/requirements.txt into the selected Python environment." }
    }
    if ($Games -contains 'th07') {
        & $converterPython (Join-Path $project 'scripts\convert_bgm_ogg.py') `
            --game th07 --original-dir $th07Source --output (Join-Path $generated 'th07\bgm-ogg')
        if ($LASTEXITCODE -ne 0) { throw "TH07 OGG conversion failed. Install host/requirements.txt into the selected Python environment." }
    }
    if ($selectedHasTh08) {
        & $converterPython (Join-Path $project 'scripts\convert_bgm_ogg.py') `
            --game th08 --original-dir $th08Source --output (Join-Path $generated 'th08\bgm-ogg')
        if ($LASTEXITCODE -ne 0) { throw "TH08 OGG conversion failed. Install host/requirements.txt into the selected Python environment." }
    }
}

$buildPreloadGames = if ($runtimeReleasePath) { @() } else { $selectedPreloadGames }
$ninjaArgument = if ($buildPreloadGames.Count -gt 0) { '-DCMAKE_MAKE_PROGRAM=' + $ninja } else { $null }
if ($buildPreloadGames.Count -gt 0) { $env:EM_CONFIG = Join-Path $emsdk '.emscripten' }
$builds = @{}
foreach ($game in $buildPreloadGames) {
    $build = Join-Path $stagingRoot "build-$game"
    $assetRoot = if ($game -eq 'th06') { $th06Assets } else { $th07Assets }
    $featureEntry = $featureSettings.games.$game
    $downloadableLanguages = @($featureEntry.languages | Where-Object { $_ -ne 'ja' })
    $languagePackPath = if ($game -eq 'th06') { $Th06LanguagePacks } else { $Th07LanguagePacks }
    if ($downloadableLanguages.Count -gt 0 -and -not $languagePackPath) {
        throw "$($game.ToUpperInvariant()) server feature config requests translated languages, but no language-pack directory was provided"
    }
    $thcrapEnabled = $downloadableLanguages.Count -gt 0
    $thpracEnabled = [bool]$featureEntry.thprac
    $runtimeExtension = if ($thpracEnabled) { $thpracPortableCMake } else { '' }
    $plan = Resolve-RuntimeBuildPlan $game 'normal' $thcrapEnabled $thpracEnabled $assetRoot $runtimeExtension
    $source = Get-EaglerWorkspacePath $workspaceLayout $plan.workspaceRepository
    $configureArguments = @('-S', $source, '-B', $build, '-G', 'Ninja')
    if ($ninjaArgument) { $configureArguments += $ninjaArgument }
    $configureArguments += @($plan.cmakeArguments)
    & $emcmake $cmake @configureArguments
    if ($LASTEXITCODE -ne 0) { throw "$game Web configure failed: $LASTEXITCODE" }
    & $cmake --build $build --parallel 6
    if ($LASTEXITCODE -ne 0) { throw "$game Web build failed: $LASTEXITCODE" }
    $builds[$game] = $build
}

# Each game publishes a second binary from its own source tree. Multiplayer
# shares the normal Runtime's DATA/layout and localization policy, while thprac
# stays out of the network-owned binary entirely.
$multiplayerBuilds = @{}
foreach ($game in $buildPreloadGames) {
    $build = Join-Path $stagingRoot "build-$game-multiplayer"
    $featureEntry = $featureSettings.games.$game
    $downloadableLanguages = @($featureEntry.languages | Where-Object { $_ -ne 'ja' })
    $thcrapEnabled = $downloadableLanguages.Count -gt 0
    $assetRoot = if ($game -eq 'th06') { $th06Assets } else { $th07Assets }
    $plan = Resolve-RuntimeBuildPlan $game 'multiplayer' $thcrapEnabled $false $assetRoot ''
    $source = Get-EaglerWorkspacePath $workspaceLayout $plan.workspaceRepository
    $configureArguments = @('-S', $source, '-B', $build, '-G', 'Ninja')
    if ($ninjaArgument) { $configureArguments += $ninjaArgument }
    $configureArguments += @($plan.cmakeArguments)
    & $emcmake $cmake @configureArguments
    if ($LASTEXITCODE -ne 0) { throw "$game multiplayer Web configure failed: $LASTEXITCODE" }
    & $cmake --build $build --parallel 6
    if ($LASTEXITCODE -ne 0) { throw "$game multiplayer Web build failed: $LASTEXITCODE" }
    $multiplayerBuilds[$game] = $build
}

Write-SiteBuildStage 3 'Packaging the static site'
$nodeArgs = @(
    (Join-Path $project 'scripts\package-server.mjs'),
    "--output=$output",
    "--font=$font",
    "--vanilla-font=$vanillaFont",
    "--music=$([string]::Join(',', $musicSet))",
    "--feature-config=$featureConfigPath",
    "--artwork-dir=$hostArtwork",
    "--games=$([string]::Join(',', $Games))",
    "--profile=$Profile"
)
if ($runtimeReleasePath) {
    $nodeArgs += "--runtime-release=$runtimeReleasePath"
}
if (-not $runtimeReleasePath -and $Games -contains 'th06') {
    $nodeArgs += "--th06-build=$($builds.th06)"
    $nodeArgs += "--th06-multiplayer-build=$($multiplayerBuilds.th06)"
}
if ($Games -contains 'th06') {
    $nodeArgs += "--th06-assets=$th06Source"
    $nodeArgs += "--th06-data-assets=$th06Assets"
}
if (-not $runtimeReleasePath -and $Games -contains 'th07') {
    $nodeArgs += "--th07-build=$($builds.th07)"
    $nodeArgs += "--th07-multiplayer-build=$($multiplayerBuilds.th07)"
}
if ($Games -contains 'th07') {
    $nodeArgs += "--th07-assets=$th07Source"
}
if ($selectedHasTh08) {
    if (-not $runtimeReleasePath) { $nodeArgs += "--th08-build=$th08Build" }
    $nodeArgs += "--th08-assets=$th08Source"
}
if ($selectedHasTh10) {
    if (-not $runtimeReleasePath) { $nodeArgs += "--th10-build=$th10Build" }
    $nodeArgs += "--th10-assets=$th10Source"
    $nodeArgs += "--th10-data-assets=$th10DataAssets"
}
if ($musicSet.Contains('ogg')) {
    if ($Games -contains 'th06') { $nodeArgs += "--th06-ogg=$(Join-Path $generated 'th06')" }
    if ($Games -contains 'th07') { $nodeArgs += "--th07-ogg=$(Join-Path $generated 'th07')" }
    if ($selectedHasTh08) { $nodeArgs += "--th08-ogg=$(Join-Path $generated 'th08')" }
    if ($selectedHasTh10) { $nodeArgs += "--th10-ogg=$th10DataAssets" }
}
if (($Games -contains 'th06') -and $Th06LanguagePacks) { $nodeArgs += "--th06-language-packs=$((Resolve-Path -LiteralPath $Th06LanguagePacks).Path)" }
if (($Games -contains 'th07') -and $Th07LanguagePacks) { $nodeArgs += "--th07-language-packs=$((Resolve-Path -LiteralPath $Th07LanguagePacks).Path)" }
& node @nodeArgs
if ($LASTEXITCODE -ne 0) { throw "Server packaging failed: $LASTEXITCODE" }
Write-SiteBuildStage 4 'Verifying the generated site'
& node (Join-Path $project 'scripts\verify-server-build.mjs') $output
if ($LASTEXITCODE -ne 0) { throw "Server verification failed: $LASTEXITCODE" }

Remove-Item -LiteralPath $stagingRoot -Recurse -Force
Write-Progress -Id $script:SiteProgressId -Activity 'Static site assembly' -Completed
if (-not $SuppressCompletionSummary) {
    Write-Host "Deployment is ready: $output"
    Write-Host "Serve this directory as a static site and open /."
}
