@echo off
setlocal
cd /d "%~dp0"
title OCC Paper - Local Windows
set "NODE=%~dp0runtime\node.exe"
if not exist "%NODE%" goto missing_runtime
"%NODE%" -e "process.exit(Number(process.versions.node.split('.')[0]) >= 24 ? 0 : 1)"
if errorlevel 1 goto invalid_runtime
if not exist "server.mjs" goto missing_files
set "PORT=8080"
set "DATA_DIR=%~dp0data"
echo.
echo OCC PAPER - CHI MO PHONG, KHONG LENH THAT
echo Gia: Binance USD-M BTCUSDT perpetual. Khong co gia gia lap.
echo Mo trinh duyet: http://127.0.0.1:8080
echo Bam Bat dau trong giao dien de chay mo phong.
echo Giu cua so nay mo va may tinh khong ngu.
echo Dong trinh duyet KHONG dung chuong trinh. Ctrl+C de dung.
echo Khong mo them ban thu hai cung thu muc du lieu.
echo.
start "" /b powershell.exe -NoProfile -Command "Start-Sleep -Seconds 2; Start-Process 'http://127.0.0.1:8080'" 2>nul
"%NODE%" "server.mjs"
echo.
echo Chuong trinh da dung. Neu cong 8080 dang ban, dong ban OCC cu roi thu lai.
echo Neu trang khong tu mo, nhap http://127.0.0.1:8080 trong trinh duyet.
pause
exit /b
:missing_runtime
echo Thieu runtime\node.exe. Hay giai nen TOAN BO goi portable.
echo Khong can cai Node.js he thong. Khong tai node.exe tu nguon la.
pause
exit /b 1
:invalid_runtime
echo Runtime Node.js di kem khong chay duoc. Goi nay danh cho Windows x64.
echo Kiem tra da giai nen day du runtime. Khong tu bo qua canh bao bao mat.
pause
exit /b 1
:missing_files
echo Thieu server.mjs. Hay giai nen TOAN BO file ZIP vao mot thu muc truoc khi chay.
pause
exit /b 1
