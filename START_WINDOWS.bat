@echo off
setlocal
cd /d "%~dp0"
title OCC Paper - Local Portable
echo.
echo ===============================================
echo   OCC PAPER - WINDOWS x64 PORTABLE
echo   No real orders. No Binance API keys.
echo ===============================================
echo.
if not exist "server.mjs" goto missing_files
if not exist "BOOTSTRAP_RUNTIME.ps1" goto missing_files
echo Checking portable runtime in application folder...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0BOOTSTRAP_RUNTIME.ps1"
if errorlevel 1 goto bootstrap_failed
set "NODE=%~dp0runtime\node.exe"
if not exist "%NODE%" goto bootstrap_failed
if not defined PORT set "PORT=8080"
set "DATA_DIR=%~dp0data"
echo.
echo Dashboard: http://127.0.0.1:%PORT%
echo Simulation starts PAUSED; click Bat dau only when ready.
echo Leave this console open and keep the computer awake.
echo Data is kept inside .\data\ and will not be removed.
echo Press Ctrl+C to stop the server safely.
echo.
start "" /b powershell.exe -NoProfile -Command "Start-Sleep -Seconds 3; Start-Process 'http://127.0.0.1:%PORT%'" 2>nul
"%NODE%" "server.mjs"
echo.
echo OCC server stopped. If port is occupied close the previous OCC window.
pause
exit /b %ERRORLEVEL%
:bootstrap_failed
echo.
echo Could not prepare the bundled runtime. Nothing was installed system-wide.
echo Check network access (first launch), disk space, and folder write access.
pause
exit /b 1
:missing_files
echo Missing application files. Extract the entire ZIP into one writable folder.
pause
exit /b 1
