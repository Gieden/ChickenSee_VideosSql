@echo off
setlocal
cd /d "%~dp0"

REM Ensure unified local-storage folder structure exists inside the project root
if not exist "%~dp0local-storage\videos" mkdir "%~dp0local-storage\videos"
if not exist "%~dp0local-storage\results" mkdir "%~dp0local-storage\results"
if not exist "%~dp0local-storage\logs" mkdir "%~dp0local-storage\logs"
if not exist "%~dp0Archive" mkdir "%~dp0Archive"

REM 1. Launch background supervisor (analytics.worker + analytics.api + sync-agent)
if exist "%~dp0startup\run-chickensee.ps1" (
    start "" powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "%~dp0startup\run-chickensee.ps1"
)

REM 2. Launch ChickenSee Control Center Desktop GUI if not already open
where pythonw.exe >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    start "" pythonw.exe "%~dp0startup\chickensee_desktop.py"
) else (
    start "" python.exe "%~dp0startup\chickensee_desktop.py"
)

exit /b 0
