@echo off
chcp 65001 >nul
cd /d "%~dp0.."
set VER=1.2.6
set OUTDIR=%USERPROFILE%\Desktop\5duan

echo Checking gh auth...
gh auth status
if errorlevel 1 (
  echo Run: gh auth login --web
  exit /b 1
)

if "%~1"=="" (
  set REPO=
  for /f "tokens=*" %%i in ('gh repo view --json nameWithOwner -q .nameWithOwner 2^>nul') do set REPO=%%i
) else (
  set REPO=%~1
)

if "%REPO%"=="" (
  echo Creating repo sunshine-campus...
  gh repo create sunshine-campus --private --source=. --remote=origin --push
) else (
  echo Pushing to %REPO% ...
  git push -u origin HEAD
)

echo Creating GitHub Release v%VER% with APKs...
gh release create "v%VER%" --title "SunshineCampus %VER% (5 shells)" --notes-file "docs\release\5duan\使用说明.md" ^
  "%OUTDIR%\SunshineCampus-User-%VER%.apk" ^
  "%OUTDIR%\SunshineCampus-Admin-%VER%.apk" ^
  "%OUTDIR%\SunshineCampus-Rider-%VER%.apk" ^
  "%OUTDIR%\SunshineCampus-Shop-%VER%.apk" ^
  "%OUTDIR%\SunshineCampus-Stall-%VER%.apk"

echo Done.
gh release view "v%VER%" --web
