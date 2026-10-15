$ErrorActionPreference = "Stop"

$StartupFolder = [Environment]::GetFolderPath("Startup")
$Shortcuts = @(
    (Join-Path $StartupFolder "ChickenSee.lnk"),
    (Join-Path $StartupFolder "ChickenSeeAgent.lnk")
)

foreach ($Shortcut in $Shortcuts) {
    if (Test-Path $Shortcut) {
        Remove-Item -Path $Shortcut -Force
        Write-Host "Removed startup shortcut: $Shortcut"
    }
}

Write-Host "ChickenSee will no longer start automatically at sign-in."
Write-Host "The ChickenSee Control Center desktop shortcut is left in place."
Write-Host "Already-running services are not stopped by this command."
