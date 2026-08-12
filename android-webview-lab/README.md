# Eagler Touhou WebView Lab

最小 Android WebView 调试壳。默认打开 `http://touhou.vip/eagler-touhou/`，并始终启用 WebView DevTools 调试。

构建：

```powershell
.\build.ps1
```

启动 D 盘 AVD：

```powershell
.\start-emulator.ps1
```

向模拟器安装并传入其他 URL：

```powershell
D:\Android\Sdk\platform-tools\adb.exe -s emulator-5554 install -r .\out\webview-lab-debug.apk
D:\Android\Sdk\platform-tools\adb.exe -s emulator-5554 shell am start -n vip.touhou.webviewlab/.MainActivity --es url http://10.0.2.2:8130/eagler-touhou/
```

Chrome DevTools 中打开 `chrome://inspect/#devices`，即可连接 `vip.touhou.webviewlab` 的 WebView。
