@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

echo ==========================================
echo   NetSplit - build Windows app
echo ==========================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js is not installed.
  echo Install it from https://nodejs.org/ ^(LTS^) and run this file again.
  pause
  exit /b 1
)

echo [1/2] Installing dependencies...
call npm install
if errorlevel 1 (
  echo [ERROR] npm install failed.
  pause
  exit /b 1
)

echo.
echo [2/2] Building the Windows app...
call npm run dist:win
if errorlevel 1 (
  echo [ERROR] Build failed.
  pause
  exit /b 1
)

echo.
echo ==========================================
echo   Done! Files created in the "release" folder:
dir /b release\*.exe 2>nul
echo ==========================================
start "" "%~dp0release"
pause
