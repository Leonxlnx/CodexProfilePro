param(
  [string]$ShortcutName = "CodexProfilePro"
)

$projectPath = $PSScriptRoot
$launcherPath = Join-Path $projectPath "launch-codex-profile-pro.ps1"
$powershellExe = Join-Path $env:WINDIR "System32\WindowsPowerShell\v1.0\powershell.exe"
$desktopPath = [Environment]::GetFolderPath("Desktop")
$shortcutPath = Join-Path $desktopPath "$ShortcutName.lnk"
$iconPath = Join-Path $projectPath "assets\profile.ico"

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $powershellExe
$shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$launcherPath`""
$shortcut.WorkingDirectory = $projectPath
$shortcut.IconLocation = "$iconPath,0"
$shortcut.Description = $ShortcutName
$shortcut.Save()

Write-Host "Shortcut created: $shortcutPath"
Write-Host "Right-click it and choose 'Pin to taskbar'."
