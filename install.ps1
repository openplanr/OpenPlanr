param(
  [switch]$Minimal,
  [string]$Version = $(if ($env:OPENPLANR_VERSION) { $env:OPENPLANR_VERSION } else { 'latest' })
)

$ErrorActionPreference = 'Stop'

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  throw 'E_NODE_NOT_FOUND: OpenPlanr requires Node.js 20 or newer. Install Node.js and rerun; it is never installed silently.'
}

$nodeMajor = [int]((& node -p "process.versions.node.split('.')[0]").Trim())
if ($nodeMajor -lt 20) {
  throw "E_NODE_VERSION: OpenPlanr requires Node.js 20+; found $(& node --version)."
}

$installArgs = @('install', '--global', '--no-audit', '--no-fund', '--loglevel=error')
if ($Minimal) { $installArgs += '--omit=optional' }
$installArgs += "openplanr@$Version"
& npm @installArgs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$installedVersion = (& planr --version).Trim()
Write-Host "`nOpenPlanr $installedVersion installed successfully.`n"
Write-Host 'Next:'
Write-Host '  cd C:\path\to\your\project'
if ($Minimal) { Write-Host '  planr setup --minimal' } else { Write-Host '  planr setup' }
