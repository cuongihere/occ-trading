@echo off
setlocal
cd /d "%~dp0"
title OCC - Binance Futures API CHECK (READ ONLY)
echo.
echo Binance BTCUSDT Futures - CONNECT API READ ONLY
echo No real orders will be sent.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0CHECK_BINANCE.ps1"
pause
