param(
  [int]$Port = 8765
)

$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$projectPath = $PSScriptRoot
$launcherPath = Join-Path $projectPath "launch-profile-remake.ps1"
$syncPath = Join-Path $projectPath "sync-slopmeter-data.ps1"
$iconPath = Join-Path $projectPath "assets\profile.ico"
$powershellExe = Join-Path $env:WINDIR "System32\WindowsPowerShell\v1.0\powershell.exe"

$createdNew = $false
$mutex = New-Object System.Threading.Mutex($true, "Local\CodexProfileRemakeTray", [ref]$createdNew)
if (-not $createdNew) {
  exit 0
}

function Open-ProfileApp {
  $args = @(
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-WindowStyle", "Hidden",
    "-File", "`"$launcherPath`"",
    "-Port", "$Port"
  )

  Start-Process -FilePath $powershellExe -ArgumentList $args -WindowStyle Hidden -WorkingDirectory $projectPath | Out-Null
}

function Sync-ProfileData {
  if (Test-Path -LiteralPath $syncPath) {
    Start-Process -FilePath $powershellExe -ArgumentList @(
      "-NoProfile",
      "-ExecutionPolicy", "Bypass",
      "-WindowStyle", "Hidden",
      "-File", "`"$syncPath`""
    ) -WindowStyle Hidden -WorkingDirectory $projectPath | Out-Null
  }
}

Sync-ProfileData

$notifyIcon = New-Object System.Windows.Forms.NotifyIcon
$notifyIcon.Icon = New-Object System.Drawing.Icon($iconPath)
$notifyIcon.Text = "Codex Profile Remake"
$notifyIcon.Visible = $true

$menu = New-Object System.Windows.Forms.ContextMenuStrip
$openItem = $menu.Items.Add("Open profile")
$openItem.Add_Click({ Open-ProfileApp })

$restartItem = $menu.Items.Add("Open / refresh")
$restartItem.Add_Click({ Open-ProfileApp })

$syncItem = $menu.Items.Add("Sync data now")
$syncItem.Add_Click({
  Sync-ProfileData
  Open-ProfileApp
})

$separator = New-Object System.Windows.Forms.ToolStripSeparator
$menu.Items.Add($separator) | Out-Null

$exitItem = $menu.Items.Add("Exit")
$exitItem.Add_Click({
  $notifyIcon.Visible = $false
  $notifyIcon.Dispose()
  [System.Windows.Forms.Application]::Exit()
})

$notifyIcon.ContextMenuStrip = $menu
$notifyIcon.Add_MouseClick({
  param($sender, $event)
  if ($event.Button -eq [System.Windows.Forms.MouseButtons]::Left) {
    Open-ProfileApp
  }
})

$syncTimer = New-Object System.Windows.Forms.Timer
$syncTimer.Interval = 60 * 60 * 1000
$syncTimer.Add_Tick({ Sync-ProfileData })
$syncTimer.Start()

try {
  [System.Windows.Forms.Application]::Run()
} finally {
  if ($syncTimer) {
    $syncTimer.Stop()
    $syncTimer.Dispose()
  }
  if ($notifyIcon) {
    $notifyIcon.Visible = $false
    $notifyIcon.Dispose()
  }
  if ($mutex) {
    $mutex.ReleaseMutex()
    $mutex.Dispose()
  }
}
