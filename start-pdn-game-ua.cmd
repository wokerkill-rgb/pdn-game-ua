@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required to start PDN Game UA.
  echo Install Node.js or build the desktop version with Tauri later.
  pause
  exit /b 1
)

start "PDN Game UA" http://127.0.0.1:4173/
node server.js
