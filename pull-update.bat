@echo off
setlocal
cd /d "%~dp0"

echo ========================================================
echo   ChickenSee OptiPlex Safe Git Pull & Update Utility
echo ========================================================

echo [1/3] Fetching latest updates from GitHub (origin/main)...
git fetch origin main

echo [2/3] Clearing local runtime file conflicts (queue_status.json / db / cache)...
git checkout -- data/results/queue_status.json tsconfig.tsbuildinfo 2>nul
git stash --include-untracked >nul 2>nul
git reset --hard origin/main

echo [3/3] Re-generating machine-specific startup shortcuts...
if exist "%~dp0startup\install-startup.ps1" (
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0startup\install-startup.ps1"
)

echo.
echo ========================================================
echo   Update complete! Latest code is now active on OptiPlex.
echo ========================================================
pause
