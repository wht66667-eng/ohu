@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Starting Ohhu administration: http://127.0.0.1:43123/admin
call npm run dev -- --host 127.0.0.1 --open /admin
pause
