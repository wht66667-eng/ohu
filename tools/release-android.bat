@echo off
chcp 65001 >nul
node "%~dp0release-android.mjs" --shell user %*
exit /b %errorlevel%

