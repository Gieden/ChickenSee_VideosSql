$StartupFolder = [Environment]::GetFolderPath("Startup")
$ShortcutPath = Join-Path $StartupFolder "ChickenSeeAgent.lnk"

if (Test-Path $ShortcutPath) {
    Remove-Item $ShortcutPath -Force
    Write-Host "Removed ChickenSee Agent from Windows Startup." -ForegroundColor Yellow
} else {
    Write-Host "No ChickenSee Agent startup shortcut found." -ForegroundColor DarkGray
}
