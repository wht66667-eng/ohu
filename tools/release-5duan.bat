@echo off
chcp 65001 >nul
REM Compatibility entry: the project now has student and administrator APKs.
node "%~dp0release-android.mjs" --shell both %*
exit /b %errorlevel%

