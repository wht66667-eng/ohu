@echo off
chcp 65001 >nul
cd /d "%~dp0"
call npm run release:android
if errorlevel 1 (
  echo Build failed. See the error above; no new release is ready.
  pause
  exit /b 1
)
echo.
echo Local files: .release-out\apk
pause
