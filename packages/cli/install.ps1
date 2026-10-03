param(
  [switch]$Minimal,
  [string]$Version = $(if ($env:OPENPLANR_VERSION) { $env:OPENPLANR_VERSION } else { 'latest' })
)

$ErrorActionPreference = 'Stop'

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  throw 'E_NODE_NOT_FOUND: OpenPlanr requires Node.js ^20.19.0 || ^22.13.0 || >=23.5.0. Install Node.js and rerun; it is never installed silently.'
}

& node -e 'const version = process.versions.node; const [major, minor, patch] = version.replace(/^v/u, String()).split(String.fromCharCode(46)).map(Number); process.exit(/^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u.test(version) && [major, minor, patch].every(Number.isSafeInteger) && ((major === 20 && minor >= 19) || (major === 22 && minor >= 13) || (major === 23 && minor >= 5) || major > 23) ? 0 : 1)'
if ($LASTEXITCODE -ne 0) {
  throw "E_NODE_VERSION: OpenPlanr requires Node.js ^20.19.0 || ^22.13.0 || >=23.5.0; found $(& node --version)."
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
