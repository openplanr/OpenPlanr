param(
  [ValidateSet('auto', 'claude', 'codex', 'cursor', 'all')]
  [string]$Runtime = 'auto',
  [ValidateSet('user', 'project', 'both')]
  [string]$Scope = 'both',
  [switch]$Minimal,
  [string]$Version = $(if ($env:OPENPLANR_VERSION) { $env:OPENPLANR_VERSION } else { 'latest' }),
  [switch]$Yes,
  [switch]$DryRun
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

$installArgs = @('install', '--global')
if ($Minimal) { $installArgs += '--omit=optional' }
$installArgs += "openplanr@$Version"
& npm @installArgs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$setupArgs = @('setup', '--runtime', $Runtime, '--scope', $Scope)
if ($Minimal) { $setupArgs += '--minimal' }
if ($Yes) { $setupArgs += '--yes' }
if ($DryRun) { $setupArgs += '--dry-run' }
& planr @setupArgs
exit $LASTEXITCODE
