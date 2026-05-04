@echo off
setlocal
cd /d "%~dp0"
powershell -ExecutionPolicy Bypass -File "%~dp0sync-data.ps1"
echo.
echo Sync finished. Press any key to close.
pause >nul
