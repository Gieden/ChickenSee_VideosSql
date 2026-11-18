@echo off
setlocal

set "SCRIPT_DIR=%~dp0"
set "PROJECT_ROOT=%~dp0.."
set "SUPERVISOR_SCRIPT=%SCRIPT_DIR%run-chickensee.ps1"
set "DESKTOP_APP=%SCRIPT_DIR%chickensee_desktop.py"

if not exist "%SUPERVISOR_SCRIPT%" (
    echo ChickenSee startup supervisor not found: "%SUPERVISOR_SCRIPT%"
    exit /b 1
)

REM 1. Start the background services supervisor (worker, API, sync-agent)
start "" powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "%SUPERVISOR_SCRIPT%"

REM 2. Launch ChickenSee Control Center GUI window if not already open
powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -Command ^
  "$running = Get-CimInstance Win32_Process -Filter \"Name LIKE 'python%'\" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -match 'chickensee_desktop\.py' }; if (-not $running) { $pyw = (Get-Command pythonw.exe -ErrorAction SilentlyContinue).Source; if ($pyw) { Start-Process -FilePath $pyw -ArgumentList '\"%DESKTOP_APP%\"' -WorkingDirectory '%PROJECT_ROOT%' } else { Start-Process -FilePath 'python.exe' -ArgumentList '\"%DESKTOP_APP%\"' -WorkingDirectory '%PROJECT_ROOT%' -WindowStyle Hidden } }"

exit /b 0
