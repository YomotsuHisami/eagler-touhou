[CmdletBinding()]
param(
    [Parameter(Mandatory)] [string] $SiteDirectory,
    [Parameter(Mandatory)] [string] $OutputArchive,
    [Parameter(Mandatory)] [string] $LinuxNodeArchive
)

$ErrorActionPreference = 'Stop'
$project = Split-Path $PSScriptRoot -Parent
$site = (Resolve-Path -LiteralPath $SiteDirectory).Path
$manifest = Join-Path $site 'deployment.json'
$nodeArchive = (Resolve-Path -LiteralPath $LinuxNodeArchive).Path
if ([IO.Path]::GetFileName($nodeArchive) -notmatch '^node-v22\..*-linux-x64\.tar\.xz$') {
    throw "Expected an official Node 22 Linux x64 tar.xz archive: $nodeArchive"
}
if (-not (Test-Path -LiteralPath $manifest -PathType Leaf)) {
    throw "Site package does not contain deployment.json: $site"
}

& node (Join-Path $project 'scripts\verify-server-build.mjs') $site
if ($LASTEXITCODE -ne 0) { throw "Site package verification failed: $LASTEXITCODE" }

$archive = [IO.Path]::GetFullPath($OutputArchive)
$archiveParent = Split-Path $archive -Parent
if (-not (Test-Path -LiteralPath $archiveParent)) {
    New-Item -ItemType Directory -Path $archiveParent -Force | Out-Null
}
$staging = Join-Path $archiveParent ('.first-install-bundle-' + [guid]::NewGuid().ToString('N'))
try {
    New-Item -ItemType Directory -Path $staging | Out-Null
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'linux-first-install') -Destination (Join-Path $staging 'installer') -Recurse
    Copy-Item -LiteralPath $site -Destination (Join-Path $staging 'site') -Recurse
    $relay = Join-Path $staging 'relay'
    New-Item -ItemType Directory -Path $relay | Out-Null
    Copy-Item -LiteralPath (Join-Path $project '..\th07-eagler\tools\netplay\lan-relay.cjs') -Destination $relay
    Copy-Item -LiteralPath (Join-Path $project '..\th07-eagler\tools\netplay\render-coturn-config.cjs') -Destination $relay
    $relayModules = Join-Path $relay 'node_modules'
    New-Item -ItemType Directory -Path $relayModules | Out-Null
    Copy-Item -LiteralPath (Join-Path $project '..\th07-eagler\tools\netplay\node_modules\ws') -Destination $relayModules -Recurse
    $runtime = Join-Path $staging 'runtime'
    New-Item -ItemType Directory -Path $runtime | Out-Null
    Copy-Item -LiteralPath $nodeArchive -Destination (Join-Path $runtime 'node-linux-x64.tar.xz')
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'linux-first-install\README.md') -Destination (Join-Path $staging 'HOST-README.md')
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'linux-first-install\config.env.example') -Destination (Join-Path $staging 'config.env.example')
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'linux-first-install\config.external-ws.example') -Destination (Join-Path $staging 'config.external-ws.example')
    if (Test-Path -LiteralPath $archive) { Remove-Item -LiteralPath $archive -Force }
    if ($archive.EndsWith('.zip', [StringComparison]::OrdinalIgnoreCase)) {
        Compress-Archive -Path (Join-Path $staging '*') -DestinationPath $archive -CompressionLevel Optimal
    } else {
        & tar.exe -czf $archive -C $staging .
        if ($LASTEXITCODE -ne 0) { throw "Unable to create bundle archive: $LASTEXITCODE" }
    }
    Write-Host "First-install bundle ready: $archive"
} finally {
    if (Test-Path -LiteralPath $staging) { Remove-Item -LiteralPath $staging -Recurse -Force }
}
