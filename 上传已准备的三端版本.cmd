@echo off
chcp 65001 >nul
cd /d "%~dp0"
call npm run release:publish
if errorlevel 1 (
  echo Upload did not complete. See the error above and verify online versions.
  pause
  exit /b 1
)
echo Upload finished. Verify the website and both mobile updates.
pause
