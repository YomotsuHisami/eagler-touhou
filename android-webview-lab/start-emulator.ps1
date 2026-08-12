param(
    [string]$AvdName = "Eagler_Touhou_API35"
)

$ErrorActionPreference = "Stop"
$env:ANDROID_SDK_ROOT = "D:\Android\Sdk"
$env:ANDROID_HOME = "D:\Android\Sdk"
$env:ANDROID_AVD_HOME = "D:\Android\Avd"
$env:ANDROID_USER_HOME = "D:\Android\UserHome"
$env:ANDROID_EMULATOR_HOME = "D:\Android\UserHome"
$env:GRADLE_USER_HOME = "D:\Android\Gradle"

$adb = Join-Path $env:ANDROID_SDK_ROOT "platform-tools\adb.exe"
$emulator = Join-Path $env:ANDROID_SDK_ROOT "emulator\emulator.exe"
$online = & $adb devices | Select-String '^emulator-5554\s+device$'
if (-not $online) {
    Start-Process -FilePath $emulator -ArgumentList @(
        "-avd", $AvdName,
        "-gpu", "host",
        "-no-boot-anim",
        "-netdelay", "none",
        "-netspeed", "full"
    )
}

for ($attempt = 0; $attempt -lt 60; $attempt++) {
    $online = & $adb devices | Select-String '^emulator-5554\s+device$'
    if ($online -and ((& $adb -s emulator-5554 shell getprop sys.boot_completed).Trim() -eq "1")) {
        & $adb -s emulator-5554 shell getprop ro.build.version.release
        exit 0
    }
    Start-Sleep -Seconds 5
}

throw "Android emulator did not finish booting within five minutes"
