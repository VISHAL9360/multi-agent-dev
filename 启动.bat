@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ========================================
echo   MACA 多智能体协同开发助手
echo ========================================
echo.
echo 正在安装依赖...
call npm install
echo.
echo 启动中...
echo.
npx tsx tui.ts
pause
