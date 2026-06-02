param(
  [int]$Port = 8765
)

$ErrorActionPreference = "Stop"

$projectPath = $PSScriptRoot
$appUrl = "http://127.0.0.1:$Port/"
$syncPath = Join-Path $projectPath "sync-slopmeter-data.ps1"

if (Test-Path -LiteralPath $syncPath) {
  $powershellExe = Join-Path $env:WINDIR "System32\WindowsPowerShell\v1.0\powershell.exe"
  Start-Process -FilePath $powershellExe -ArgumentList @(
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-WindowStyle", "Hidden",
    "-File", "`"$syncPath`""
  ) -WindowStyle Hidden -WorkingDirectory $projectPath | Out-Null
}

function Get-ExecutablePath {
  param([string[]]$Paths)
  foreach ($path in $Paths) {
    if (Test-Path $path) {
      return $path
    }
  }
  return $null
}

function Get-BrowserPath {
  $paths = @(
    (Join-Path $env:ProgramFiles "Google\Chrome\Application\chrome.exe"),
    (Join-Path ${env:ProgramFiles(x86)} "Google\Chrome\Application\chrome.exe"),
    (Join-Path $env:LocalAppData "Google\Chrome\Application\chrome.exe"),
    (Join-Path ${env:ProgramFiles(x86)} "Microsoft\Edge\Application\msedge.exe"),
    (Join-Path $env:ProgramFiles "Microsoft\Edge\Application\msedge.exe")
  )
  return Get-ExecutablePath -Paths $paths
}

function Get-PythonCommand {
  $candidates = @("python", "python3", "py")
  foreach ($candidate in $candidates) {
    if (Get-Command $candidate -ErrorAction SilentlyContinue) {
      return $candidate
    }
  }
  return $null
}

if (-not (Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue | Where-Object { $_.State -eq "Listen" })) {
  $python = Get-PythonCommand
  if (-not $python) {
    throw "Python not found. Install Python 3 to run the local server."
  }

  $argList = @("-m", "http.server", "$Port", "--directory", $projectPath)
  Start-Process -FilePath $python -ArgumentList $argList -WindowStyle Hidden -WorkingDirectory $projectPath | Out-Null
}

Start-Sleep -Milliseconds 600

$browser = Get-BrowserPath
if ($browser) {
  $args = @("--app=$appUrl", "--new-window")
  Start-Process -FilePath $browser -ArgumentList $args -WorkingDirectory $projectPath | Out-Null
} else {
  Start-Process $appUrl | Out-Null
}
