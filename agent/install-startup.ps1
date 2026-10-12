$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$BatPath = Join-Path $ScriptDir "start-agent.bat"
$VbsPath = Join-Path $ScriptDir "start-agent-silent.vbs"

# 1. Create a silent VBS launcher so it runs in the background without keeping a CMD window open
$VbsContent = @"
Set WshShell = CreateObject("WScript.Shell")
WshShell.Run chr(34) & "$($BatPath.Replace('\', '\\'))" & chr(34), 0
Set WshShell = Nothing
"@

[System.IO.File]::WriteAllText($VbsPath, $VbsContent)

# 2. Add shortcut to Windows Startup folder
$StartupFolder = [Environment]::GetFolderPath("Startup")
$ShortcutPath = Join-Path $StartupFolder "ChickenSeeAgent.lnk"

$WshShell = New-Object -ComObject WScript.Shell
$Shortcut = $WshShell.CreateShortcut($ShortcutPath)
$Shortcut.TargetPath = "wscript.exe"
$Shortcut.Arguments = "`"$VbsPath`""
$Shortcut.WorkingDirectory = $ScriptDir
$Shortcut.Description = "ChickenSee Local Sync Agent"
$Shortcut.Save()

Write-Host ""
Write-Host "==========================================================" -ForegroundColor Green
Write-Host " [SUCCESS] ChickenSee Agent registered for Auto-Start!" -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Green
Write-Host "Shortcut created at:"
Write-Host "  $ShortcutPath" -ForegroundColor Cyan
Write-Host ""
Write-Host "The agent will now automatically run silently in the background"
Write-Host "whenever Windows boots or you log in."
Write-Host "==========================================================" -ForegroundColor Green
Write-Host ""
