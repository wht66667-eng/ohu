@echo off
chcp 65001 >nul
cd /d "%~dp0"
call npm run ota:prepare
if errorlevel 1 (
  echo Preparation failed. See the error above.
  pause
  exit /b 1
)
echo.
echo Local files: .ota-out\prepared
echo Nothing has been uploaded.
pause
