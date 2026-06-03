param(
  [string]$ShortcutName = "CodexProfilePro Tray"
)

$ErrorActionPreference = "Stop"

$projectPath = $PSScriptRoot
$repoRoot = Split-Path -Parent $projectPath
$packagedExe = Join-Path $repoRoot "dist\win-unpacked\CodexProfilePro.exe"
$trayPath = Join-Path $projectPath "tray-codex-profile-pro.ps1"
$iconPath = Join-Path $projectPath "assets\profile.ico"
$powershellExe = Join-Path $env:WINDIR "System32\WindowsPowerShell\v1.0\powershell.exe"
$startupPath = [Environment]::GetFolderPath("Startup")
$shortcutPath = Join-Path $startupPath "$ShortcutName.lnk"

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
if (Test-Path -LiteralPath $packagedExe) {
  $shortcut.TargetPath = $packagedExe
  $shortcut.Arguments = "--hidden"
  $shortcut.WorkingDirectory = Split-Path -Parent $packagedExe
} else {
  $shortcut.TargetPath = $powershellExe
  $shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$trayPath`""
  $shortcut.WorkingDirectory = $projectPath
}
$shortcut.IconLocation = "$iconPath,0"
$shortcut.Description = "CodexProfilePro tray launcher"
$shortcut.Save()

if (Test-Path -LiteralPath $packagedExe) {
  Start-Process -FilePath $packagedExe -ArgumentList @("--hidden") -WindowStyle Hidden -WorkingDirectory (Split-Path -Parent $packagedExe) | Out-Null
} else {
  Start-Process -FilePath $powershellExe -ArgumentList @(
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-WindowStyle", "Hidden",
    "-File", "`"$trayPath`""
  ) -WindowStyle Hidden -WorkingDirectory $projectPath | Out-Null
}

Write-Host "Tray launcher installed: $shortcutPath"
Write-Host "The icon should appear in the Windows tray overflow, under the up-arrow."
