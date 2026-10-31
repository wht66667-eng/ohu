@echo off
chcp 65001 >nul
cd /d "%~dp0"
title 海大课表一键同步
echo ============================================================
echo  海大课表一键同步（抓取端）
echo ------------------------------------------------------------
echo  流程：登录 WebVPN -^> 自动跳教务 -^> 登录教务 -^> 自动爬课表
echo  抓到的课表会写入应用 public\last-snapshot.json，
echo  并自动打开课表页 http://localhost:43123/?sync=1 完成入库。
echo.
echo  提示：请确保课表页所在的前端已在运行
echo        （在 xm-main 目录执行 npm run dev，端口 43123）；
echo        脚本检测到未运行时会尝试自动拉起一次。
echo ============================================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [x] 未检测到 Node.js，请先安装 Node 18 及以上版本。
  pause
  exit /b 1
)

if not exist "node_modules\puppeteer-core" (
  echo [*] 首次运行，正在安装依赖（puppeteer-core）…
  call npm install
  if errorlevel 1 (
    echo [x] 依赖安装失败，请检查网络后重试。
    pause
    exit /b 1
  )
)

call npm run sync
echo.
echo [*] 脚本已结束。若上方提示未写入页面，请手动打开：
echo     http://localhost:43123/?sync=1
pause
