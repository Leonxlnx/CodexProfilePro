param(
  [string]$SourceDirectory = (Join-Path $env:USERPROFILE "Downloads")
)

$ErrorActionPreference = "Stop"

$projectPath = $PSScriptRoot
$targetPath = Join-Path $projectPath "slopmeter.json"
$fastExporterPath = Join-Path $projectPath "fast-codex-usage-export.mjs"
$myCodexTokensPath = Join-Path $env:LOCALAPPDATA "Programs\MyCodexTokens\MyCodexTokens.exe"
$bundledSlopmeterPath = Join-Path $env:LOCALAPPDATA "Programs\MyCodexTokens\resources\app\node_modules\slopmeter\dist\cli.js"
$patterns = @(
  "mycodextokens-codex-usage.json",
  "*codex*usage*.json",
  "*slopmeter*.json"
)

function Invoke-FastCodexExport {
  if (-not (Test-Path -LiteralPath $fastExporterPath) -or -not (Get-Command node -ErrorAction SilentlyContinue)) {
    return $false
  }

  & node $fastExporterPath $targetPath
  if ($LASTEXITCODE -ne 0) {
    return $false
  }

  $json = Get-Content -LiteralPath $targetPath -Raw | ConvertFrom-Json
  if (-not $json.providers) {
    throw "Fast exporter wrote invalid JSON: $targetPath"
  }

  Write-Host "Generated fresh fast Codex usage JSON: $targetPath"
  return $true
}

if (Invoke-FastCodexExport) {
  return
}

function Invoke-BundledSlopmeterExport {
  if (-not (Test-Path -LiteralPath $myCodexTokensPath) -or -not (Test-Path -LiteralPath $bundledSlopmeterPath)) {
    return $false
  }

  $previousElectronRunAsNode = $env:ELECTRON_RUN_AS_NODE
  $env:ELECTRON_RUN_AS_NODE = "1"

  try {
    Push-Location $env:USERPROFILE
    & $myCodexTokensPath $bundledSlopmeterPath --codex --dark --format json --output $targetPath
    if ($LASTEXITCODE -ne 0) {
      return $false
    }

    $json = Get-Content -LiteralPath $targetPath -Raw | ConvertFrom-Json
    if (-not $json.providers) {
      throw "Bundled slopmeter wrote invalid JSON: $targetPath"
    }

    Write-Host "Generated fresh slopmeter JSON: $targetPath"
    return $true
  } finally {
    Pop-Location
    if ($null -eq $previousElectronRunAsNode) {
      Remove-Item Env:\ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
    } else {
      $env:ELECTRON_RUN_AS_NODE = $previousElectronRunAsNode
    }
  }
}

if (Invoke-BundledSlopmeterExport) {
  return
}

$candidate = $null
foreach ($pattern in $patterns) {
  $candidate = Get-ChildItem -LiteralPath $SourceDirectory -Filter $pattern -File -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1

  if ($candidate) {
    break
  }
}

if (-not $candidate) {
  Write-Host "No slopmeter/codex usage export found in $SourceDirectory"
  return
}

$json = Get-Content -LiteralPath $candidate.FullName -Raw | ConvertFrom-Json
if (-not $json.providers) {
  throw "Latest candidate is not a slopmeter export: $($candidate.FullName)"
}

$shouldCopy = -not (Test-Path -LiteralPath $targetPath)
if (-not $shouldCopy) {
  $target = Get-Item -LiteralPath $targetPath
  $shouldCopy = $candidate.LastWriteTimeUtc -gt $target.LastWriteTimeUtc -or $candidate.Length -ne $target.Length
}

if ($shouldCopy) {
  Copy-Item -LiteralPath $candidate.FullName -Destination $targetPath -Force
  Write-Host "Synced $($candidate.FullName) -> $targetPath"
} else {
  Write-Host "Already current: $targetPath"
}
