@echo off
chcp 65001 >nul
cd /d "%~dp0.."

REM Load .env.capgo if present
if exist ".env.capgo" (
  for /f "usebackq tokens=1,* delims==" %%a in (".env.capgo") do (
    if not "%%a"=="" if not "%%a"=="#" set "%%a=%%b"
  )
)

if "%CAPGO_API_KEY%"=="" (
  echo Missing CAPGO_API_KEY
  echo 1^) Register https://capgo.app/register
  echo 2^) Copy .env.capgo.example -^> .env.capgo and fill CAPGO_API_KEY
  exit /b 1
)

echo [1/3] login...
call npx --yes @capgo/cli@latest login "%CAPGO_API_KEY%"
if errorlevel 1 exit /b 1

echo [2/3] add app sunshine-campus if needed...
call npx --yes @capgo/cli@latest app add sunshine-campus --icon "" 2>nul
call npx --yes @capgo/cli@latest app list

echo.
echo [3/3] Put the Capgo App ID into .env.capgo as:
echo   CAPGO_APP_ID=xxxxxxxx
echo   VITE_CAPGO_APP_ID=xxxxxxxx
echo Then rebuild APKs so the native shell embeds the id.
echo.
echo Done.
exit /b 0
