@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ========================================================
echo   MACA: Enterprise Multi-Agent Collaborative Architecture
echo ========================================================
echo.
echo Installing dependencies...
call npm install
echo.
echo Launching Interactive TUI Console...
echo.
npx tsx tui-pro.ts
pause
