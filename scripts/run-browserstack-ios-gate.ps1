[CmdletBinding()]
param(
  [string]$Device,
  [string]$OsVersion,
  [ValidateSet('th06', 'th07')]
  [string]$Game = 'th07',
  [ValidateSet('midi', 'ogg-stream', 'ogg-full', 'none')]
  [string]$Music = 'none'
)

$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($Device)) {
  $Device = Read-Host 'BrowserStack device name, for example iPhone 15 Pro Max'
}
if ([string]::IsNullOrWhiteSpace($OsVersion)) {
  $OsVersion = Read-Host 'BrowserStack iOS version, for example 17'
}
if ([string]::IsNullOrWhiteSpace($Device) -or [string]::IsNullOrWhiteSpace($OsVersion)) {
  throw 'Device and iOS version are required.'
}

$browserStackUser = Read-Host 'BrowserStack Username'
$secureAccessKey = Read-Host 'BrowserStack Access Key' -AsSecureString
$accessKeyPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureAccessKey)
$exitCode = 1

try {
  $accessKey = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($accessKeyPointer)
  if ([string]::IsNullOrWhiteSpace($browserStackUser) -or [string]::IsNullOrWhiteSpace($accessKey)) {
    throw 'BrowserStack Username and Access Key are required.'
  }

  $env:BROWSERSTACK_USERNAME = $browserStackUser
  $env:BROWSERSTACK_ACCESS_KEY = $accessKey
  & npm run test:browserstack:ios -- "--browserstack-device=$Device" "--browserstack-os-version=$OsVersion" "--game=$Game" "--music=$Music"
  $exitCode = $LASTEXITCODE
} finally {
  Remove-Item Env:BROWSERSTACK_USERNAME -ErrorAction SilentlyContinue
  Remove-Item Env:BROWSERSTACK_ACCESS_KEY -ErrorAction SilentlyContinue
  if ($accessKeyPointer -ne [IntPtr]::Zero) {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($accessKeyPointer)
  }
  $accessKey = $null
  $secureAccessKey = $null
}

exit $exitCode
