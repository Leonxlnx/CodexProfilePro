param(
  [string]$ShortcutName = "CodexProfilePro"
)

$projectPath = $PSScriptRoot
$repoRoot = Split-Path -Parent $projectPath
$packagedExe = Join-Path $repoRoot "dist\win-unpacked\CodexProfilePro.exe"
$launcherPath = Join-Path $projectPath "launch-codex-profile-pro.ps1"
$powershellExe = Join-Path $env:WINDIR "System32\WindowsPowerShell\v1.0\powershell.exe"
$desktopPath = [Environment]::GetFolderPath("Desktop")
$shortcutPath = Join-Path $desktopPath "$ShortcutName.lnk"
$iconPath = Join-Path $projectPath "assets\profile.ico"

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
if (Test-Path -LiteralPath $packagedExe) {
  $shortcut.TargetPath = $packagedExe
  $shortcut.Arguments = ""
  $shortcut.WorkingDirectory = Split-Path -Parent $packagedExe
} else {
  $shortcut.TargetPath = $powershellExe
  $shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$launcherPath`""
  $shortcut.WorkingDirectory = $projectPath
}
$shortcut.IconLocation = "$iconPath,0"
$shortcut.Description = $ShortcutName
$shortcut.Save()

Write-Host "Shortcut created: $shortcutPath"
Write-Host "Right-click it and choose 'Pin to taskbar'."
