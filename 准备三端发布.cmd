@echo off
chcp 65001 >nul
cd /d "%~dp0"
call npm run release:prepare
if errorlevel 1 (
  echo Preparation failed. No release has been published.
  pause
  exit /b 1
)
echo.
echo Review local files in .release-out before publishing.
pause
