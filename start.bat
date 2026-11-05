@echo off
title Church Overlay
cd /d "%~dp0"

rem Use the node.exe in this folder if there is one (for running from a pendrive),
rem otherwise the Node.js installed on this computer.
set "NODE=node"
if exist "%~dp0node.exe" set "NODE=%~dp0node.exe"

"%NODE%" -v >nul 2>&1
if errorlevel 1 (
  echo Node.js was not found.
  echo Put node.exe in this folder, or install Node.js from https://nodejs.org
  pause
  exit /b 1
)

rem Open the control panel once the server has had a moment to start.
start "" cmd /c "timeout /t 2 >nul & start http://localhost:5500/control.html"
echo Church Overlay is running. Keep this window open during the service.
echo Close it to stop.
echo.
"%NODE%" server.js
pause
