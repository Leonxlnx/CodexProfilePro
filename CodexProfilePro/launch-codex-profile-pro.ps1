$ErrorActionPreference = "Stop"

$projectPath = $PSScriptRoot
$repoRoot = Split-Path -Parent $projectPath
$packagedExe = Join-Path $repoRoot "dist\win-unpacked\CodexProfilePro.exe"
$localUsagePath = Join-Path $projectPath "slopmeter.json"
$appDataUsageDir = Join-Path $env:APPDATA "codex-profile-pro"
$appDataUsagePath = Join-Path $appDataUsageDir "slopmeter.json"

function Test-UsageFileEmpty {
  param([string]$Path)

  if (-not (Test-Path -LiteralPath $Path)) {
    return $true
  }

  try {
    $json = Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
    $provider = @($json.providers)[0]
    return (-not $provider) -or (-not $provider.daily) -or ($provider.daily.Count -eq 0)
  } catch {
    return $true
  }
}

function Sync-AppDataSeed {
  if (-not (Test-Path -LiteralPath $localUsagePath)) {
    return
  }

  New-Item -ItemType Directory -Force -Path $appDataUsageDir | Out-Null
  if (Test-UsageFileEmpty -Path $appDataUsagePath) {
    Copy-Item -LiteralPath $localUsagePath -Destination $appDataUsagePath -Force
  }
}

Sync-AppDataSeed

if (Test-Path -LiteralPath $packagedExe) {
  Start-Process -FilePath $packagedExe -WorkingDirectory (Split-Path -Parent $packagedExe) | Out-Null
  return
}

$npm = Get-Command npm -ErrorAction SilentlyContinue
if (-not $npm) {
  throw "CodexProfilePro.exe was not found and npm is not available. Build with 'npm run dist:win' or install the release build."
}

Start-Process -FilePath $npm.Source -ArgumentList @("start") -WorkingDirectory $repoRoot | Out-Null
