@echo off
chcp 65001 >nul
cd /d "%~dp0.."

REM 用 PowerShell 注入 .env.capgo（cmd for /f 在本机偶发读不到）
for /f "usebackq delims=" %%L in (`powershell -NoProfile -Command "Get-Content '.env.capgo' | Where-Object { $_ -match '^\s*[^#].*=' } | ForEach-Object { $_.Trim() }"`) do (
  for /f "tokens=1,* delims==" %%A in ("%%L") do set "%%A=%%B"
)

if "%CAPGO_API_KEY%"=="" (
  echo Missing CAPGO_API_KEY in .env.capgo
  exit /b 1
)

if "%CAPGO_SUPA_HOST%"=="" set CAPGO_SUPA_HOST=https://sb.capgo.app
if "%CAPGO_SUPA_ANON%"=="" set CAPGO_SUPA_ANON=sb_publishable_T8kEcJpf9PbGYLkArVCLHA_lAE0Hb0T
if "%CAPGO_APP_ID%"=="" set CAPGO_APP_ID=com.sunshinecampus.app
if "%VITE_CAPGO_APP_ID%"=="" set VITE_CAPGO_APP_ID=%CAPGO_APP_ID%

set CHANNEL=%~1
if "%CHANNEL%"=="" set CHANNEL=production

echo [1/2] build web app...
call npm run build:app
if errorlevel 1 exit /b 1

echo [2/2] upload %CAPGO_APP_ID% channel=%CHANNEL% ...
set NODE_OPTIONS=--dns-result-order=ipv4first
set NODE_USE_ENV_PROXY=1
if not defined HTTP_PROXY set HTTP_PROXY=http://127.0.0.1:7897
if not defined HTTPS_PROXY set HTTPS_PROXY=http://127.0.0.1:7897
call npx --yes @capgo/cli@latest bundle upload "%CAPGO_APP_ID%" -a "%CAPGO_API_KEY%" -c "%CHANNEL%" -b 1.2.7 -p dist-app --supa-host "%CAPGO_SUPA_HOST%" --supa-anon "%CAPGO_SUPA_ANON%" --no-code-check
if errorlevel 1 exit /b 1

echo Uploaded OK.
exit /b 0
