param(
    [string]$SdkRoot = "D:\Android\Sdk",
    [string]$JavaHome = "C:\Program Files\BellSoft\LibericaJDK-21",
    [string]$KeyStore = "D:\Android\UserHome\debug.keystore"
)

$ErrorActionPreference = "Stop"
$buildTools = Join-Path $SdkRoot "build-tools\35.0.0"
$androidJar = Join-Path $SdkRoot "platforms\android-36\android.jar"
$projectDir = $PSScriptRoot
$outDir = Join-Path $projectDir "out"
$classesDir = Join-Path $outDir "classes"
$dexDir = Join-Path $outDir "dex"
$classesJar = Join-Path $outDir "classes.jar"
$unsignedApk = Join-Path $outDir "webview-lab-unsigned.apk"
$alignedApk = Join-Path $outDir "webview-lab-aligned.apk"
$finalApk = Join-Path $outDir "webview-lab-debug.apk"

Remove-Item -LiteralPath $outDir -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $classesDir, $dexDir | Out-Null

& (Join-Path $JavaHome "bin\javac.exe") `
    -encoding UTF-8 `
    -source 8 `
    -target 8 `
    -classpath $androidJar `
    -d $classesDir `
    (Join-Path $projectDir "src\vip\touhou\webviewlab\MainActivity.java")
if ($LASTEXITCODE -ne 0) { throw "javac failed: $LASTEXITCODE" }

& (Join-Path $JavaHome "bin\jar.exe") cf $classesJar -C $classesDir .
if ($LASTEXITCODE -ne 0) { throw "class jar failed: $LASTEXITCODE" }

& (Join-Path $buildTools "d8.bat") `
    --lib $androidJar `
    --min-api 26 `
    --output $dexDir `
    $classesJar
if ($LASTEXITCODE -ne 0) { throw "d8 failed: $LASTEXITCODE" }

& (Join-Path $buildTools "aapt2.exe") link `
    -I $androidJar `
    --manifest (Join-Path $projectDir "AndroidManifest.xml") `
    --min-sdk-version 26 `
    --target-sdk-version 35 `
    --version-code 1 `
    --version-name 0.1.0 `
    -o $unsignedApk
if ($LASTEXITCODE -ne 0) { throw "aapt2 failed: $LASTEXITCODE" }

& (Join-Path $JavaHome "bin\jar.exe") uf $unsignedApk -C $dexDir "classes.dex"
if ($LASTEXITCODE -ne 0) { throw "jar failed: $LASTEXITCODE" }

& (Join-Path $buildTools "zipalign.exe") -f 4 $unsignedApk $alignedApk
if ($LASTEXITCODE -ne 0) { throw "zipalign failed: $LASTEXITCODE" }

if (-not (Test-Path -LiteralPath $KeyStore)) {
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $KeyStore) | Out-Null
    & (Join-Path $JavaHome "bin\keytool.exe") `
        -genkeypair -v `
        -keystore $KeyStore `
        -storepass android `
        -alias androiddebugkey `
        -keypass android `
        -dname "CN=Android Debug,O=Android,C=US" `
        -keyalg RSA `
        -keysize 2048 `
        -validity 10000
    if ($LASTEXITCODE -ne 0) { throw "keytool failed: $LASTEXITCODE" }
}

& (Join-Path $buildTools "apksigner.bat") sign `
    --ks $KeyStore `
    --ks-pass pass:android `
    --key-pass pass:android `
    --out $finalApk `
    $alignedApk
if ($LASTEXITCODE -ne 0) { throw "apksigner failed: $LASTEXITCODE" }

& (Join-Path $buildTools "apksigner.bat") verify --verbose $finalApk
if ($LASTEXITCODE -ne 0) { throw "APK verification failed: $LASTEXITCODE" }

Get-Item -LiteralPath $finalApk
