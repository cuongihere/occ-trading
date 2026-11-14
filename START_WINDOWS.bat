@echo off
setlocal
cd /d "%~dp0"
title OCC BTCUSDT Futures
echo.
echo ========================================
echo   OCC BTCUSDT FUTURES - WINDOWS PORTABLE
echo   BINANCE REAL TRADING - NOT PAPER
echo ========================================
echo.
if not exist "server.mjs" goto missing_files
if not exist "BOOTSTRAP_RUNTIME.ps1" goto missing_files
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0BOOTSTRAP_RUNTIME.ps1"
if errorlevel 1 goto bootstrap_failed
set "NODE=%~dp0runtime\node.exe"
if not exist "%NODE%" goto bootstrap_failed
if not defined PORT set "PORT=8080"
set "DATA_DIR=%~dp0data"
echo Open: http://127.0.0.1:%PORT%/binance
echo Live AUTO is OFF at application startup.
echo Saved Futures/Square keys are protected with Windows DPAPI.
echo Preserve the data folder when updating.
echo Press Ctrl+C to stop safely.
start "" /b powershell.exe -NoProfile -Command "Start-Sleep -Seconds 3; Start-Process 'http://127.0.0.1:%PORT%/binance'" 2>nul
"%NODE%" "server.mjs"
echo.
echo OCC Futures stopped. Check any open positions directly on Binance.
pause
exit /b %ERRORLEVEL%
:bootstrap_failed
echo Runtime bootstrap failed. No trade orders submitted by launcher.
pause
exit /b 1
:missing_files
echo Missing application files. Extract the complete Windows ZIP.
pause
exit /b 1
