$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$RunnerPath = Join-Path $PSScriptRoot "run-chickensee.ps1"
$DesktopAppPath = Join-Path $PSScriptRoot "chickensee_desktop.py"
$AgentDir = Join-Path $ProjectRoot "agent"
$Python = (Get-Command python -ErrorAction Stop).Source
$Node = (Get-Command node -ErrorAction Stop).Source
$PythonWindowed = Join-Path (Split-Path -Parent $Python) "pythonw.exe"
$StartupFolder = [Environment]::GetFolderPath("Startup")
$ShortcutPath = Join-Path $StartupFolder "ChickenSee.lnk"
$DesktopShortcutPath = Join-Path ([Environment]::GetFolderPath("Desktop")) "ChickenSee Control Center.lnk"

if (-not (Test-Path $RunnerPath -PathType Leaf)) {
    throw "Startup supervisor not found: $RunnerPath"
}
if (-not (Test-Path $DesktopAppPath -PathType Leaf)) {
    throw "ChickenSee desktop app not found: $DesktopAppPath"
}
if (-not (Test-Path $PythonWindowed -PathType Leaf)) {
    throw "Python's windowed launcher was not found: $PythonWindowed"
}
if (-not (Test-Path (Join-Path $ProjectRoot "custom_poultry.pt") -PathType Leaf)) {
    throw "Custom model weights are missing from the repository root."
}
if (-not (Test-Path (Join-Path $AgentDir "node_modules") -PathType Container)) {
    throw "Sync-agent packages are missing. Run 'npm ci' from $AgentDir first."
}
$DirectoriesFile = Join-Path $AgentDir "directories.json"
if (-not (Test-Path $DirectoriesFile -PathType Leaf)) {
    throw "Watched folders are not configured. Open ChickenSee Control Center and add video folders first."
}
$DirectoryConfig = Get-Content $DirectoriesFile -Raw | ConvertFrom-Json
$WatchedDirectories = @($DirectoryConfig.directories)
if ($WatchedDirectories.Count -eq 0) {
    throw "No watched folders are configured. Add at least one folder in ChickenSee Control Center."
}
foreach ($Directory in $WatchedDirectories) {
    if (-not (Test-Path $Directory -PathType Container)) {
        throw "A configured watched folder does not exist: $Directory"
    }
}
& $Python -c "import cv2, fastapi, psutil, sqlalchemy, tkinter, ultralytics, uvicorn"
if ($LASTEXITCODE -ne 0) {
    throw "Analytics packages are missing. Run 'python -m pip install -r analytics\requirements.txt' from $ProjectRoot."
}
& $Node --version | Out-Null
if ($LASTEXITCODE -ne 0) {
    throw "Node.js could not be started: $Node"
}
Push-Location $AgentDir
try {
    & $Node --input-type=module -e "import('chokidar'); import('@vercel/blob')"
    $NodePackageExitCode = $LASTEXITCODE
}
finally {
    Pop-Location
}
if ($NodePackageExitCode -ne 0) {
    throw "Sync-agent packages could not be loaded. Run 'npm ci' from $AgentDir."
}

$Shell = New-Object -ComObject WScript.Shell
$Shortcut = $Shell.CreateShortcut($ShortcutPath)
$Shortcut.TargetPath = (Get-Command powershell.exe -ErrorAction Stop).Source
$Shortcut.Arguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$RunnerPath`""
$Shortcut.WorkingDirectory = $ProjectRoot
$Shortcut.Description = "Start ChickenSee sync agent and analytics services at sign-in"
$Shortcut.Save()

$DesktopShortcut = $Shell.CreateShortcut($DesktopShortcutPath)
$DesktopShortcut.TargetPath = $PythonWindowed
$DesktopShortcut.Arguments = "`"$DesktopAppPath`""
$DesktopShortcut.WorkingDirectory = $ProjectRoot
$DesktopShortcut.Description = "ChickenSee local analysis and sync control center"
$DesktopShortcut.Save()

$LegacyShortcut = Join-Path $StartupFolder "ChickenSeeAgent.lnk"
if (Test-Path $LegacyShortcut) {
    Remove-Item -Path $LegacyShortcut -Force
}

Write-Host "ChickenSee will start automatically when this Windows user signs in." -ForegroundColor Green
Write-Host "Startup shortcut: $ShortcutPath"
Write-Host "Desktop app shortcut: $DesktopShortcutPath"
Write-Host "Service logs are written under the configured ChickenSee local storage logs folder."
