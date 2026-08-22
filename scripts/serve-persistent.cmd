@echo off
setlocal

cd /d "%~dp0.."

:restart
"%ProgramFiles%\nodejs\node.exe" scripts\serve.mjs 8130 ..
timeout /t 2 /nobreak >nul
goto restart
