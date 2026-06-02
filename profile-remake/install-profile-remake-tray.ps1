param(
  [string]$ShortcutName = "Codex Profile Remake Tray"
)

$ErrorActionPreference = "Stop"

$projectPath = $PSScriptRoot
$trayPath = Join-Path $projectPath "tray-profile-remake.ps1"
$iconPath = Join-Path $projectPath "assets\profile.ico"
$powershellExe = Join-Path $env:WINDIR "System32\WindowsPowerShell\v1.0\powershell.exe"
$startupPath = [Environment]::GetFolderPath("Startup")
$shortcutPath = Join-Path $startupPath "$ShortcutName.lnk"

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $powershellExe
$shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$trayPath`""
$shortcut.WorkingDirectory = $projectPath
$shortcut.IconLocation = "$iconPath,0"
$shortcut.Description = "Codex Profile Remake tray launcher"
$shortcut.Save()

Start-Process -FilePath $powershellExe -ArgumentList @(
  "-NoProfile",
  "-ExecutionPolicy", "Bypass",
  "-WindowStyle", "Hidden",
  "-File", "`"$trayPath`""
) -WindowStyle Hidden -WorkingDirectory $projectPath | Out-Null

Write-Host "Tray launcher installed: $shortcutPath"
Write-Host "The icon should appear in the Windows tray overflow, under the up-arrow."
