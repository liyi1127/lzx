@echo off
setlocal

cd /d "%~dp0"
set "PORT=3000"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Please install Node.js first.
  pause
  exit /b 1
)

powershell -NoProfile -Command "try { Invoke-WebRequest -UseBasicParsing -Uri 'http://localhost:%PORT%/' -TimeoutSec 2 ^| Out-Null; exit 0 } catch { exit 1 }" >nul 2>nul
if errorlevel 1 (
  start "Teacher Survey Server" cmd /k "cd /d ""%~dp0"" && node server.js"
  timeout /t 2 >nul
)

start "" "http://localhost:%PORT%/admin"
exit /b 0
