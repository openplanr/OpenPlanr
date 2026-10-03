$ErrorActionPreference = 'Stop'

if ($PSVersionTable.PSVersion.Major -ne 5 -or $PSVersionTable.PSVersion.Minor -ne 1) {
  throw 'This fixture verifies Windows PowerShell 5.1 native argument handling.'
}

$source = [System.IO.File]::ReadAllText((Join-Path $PSScriptRoot '..\..\install.ps1'))
$match = [regex]::Match($source, "& node -e '([^']+)'")
if (-not $match.Success) { throw 'The installer Node.js guard was not found.' }
$guard = $match.Groups[1].Value

$cases = @(
  @{ Version = '18.20.8'; Supported = $false },
  @{ Version = '20.0.0'; Supported = $false },
  @{ Version = '20.18.9'; Supported = $false },
  @{ Version = '20.19.0'; Supported = $true },
  @{ Version = '20.20.2'; Supported = $true },
  @{ Version = '21.7.0'; Supported = $false },
  @{ Version = '21.99.0'; Supported = $false },
  @{ Version = '22.12.9'; Supported = $false },
  @{ Version = '22.13.0'; Supported = $true },
  @{ Version = '23.4.9'; Supported = $false },
  @{ Version = '23.5.0'; Supported = $true },
  @{ Version = '24.0.0'; Supported = $true },
  @{ Version = '26.0.0'; Supported = $true },
  @{ Version = '22'; Supported = $false },
  @{ Version = '22.13'; Supported = $false },
  @{ Version = '22.13.0-rc.1'; Supported = $false },
  @{ Version = '022.13.0'; Supported = $false },
  @{ Version = ('22.13.0' + [char]10); Supported = $false },
  @{ Version = 'NaN.13.0'; Supported = $false },
  @{ Version = '9007199254740992.0.0'; Supported = $false },
  @{ Version = '22.9007199254740992.0'; Supported = $false },
  @{ Version = '22.13.9007199254740992'; Supported = $false },
  @{ Version = '22.013.0'; Supported = $false },
  @{ Version = '22.13.00'; Supported = $false },
  @{ Version = '22.13.0+build.1'; Supported = $false },
  @{ Version = '22.13.0.1'; Supported = $false },
  @{ Version = 'v022.13.0'; Supported = $false },
  @{ Version = 'v22.13.0-rc.1'; Supported = $false },
  @{ Version = '20.19.0-rc.1'; Supported = $false },
  @{ Version = '23.5.0-rc.1'; Supported = $false },
  @{ Version = '24.0.0-rc.1'; Supported = $false },
  @{ Version = 'v22.13.0'; Supported = $true }
)

foreach ($case in $cases) {
  # Only the version injection is quote-free; the actual guard crosses the native boundary unchanged.
  $versionCodes = (($case.Version.ToCharArray() | ForEach-Object { [int]$_ }) -join ',')
  $probe = "Object.defineProperty(process.versions, String.fromCharCode(110,111,100,101), { value: String.fromCharCode($versionCodes) }); $guard"
  & node -e $probe
  $expected = $(if ($case.Supported) { 0 } else { 1 })
  if ($LASTEXITCODE -ne $expected) {
    throw "Installer guard for $($case.Version) exited $LASTEXITCODE; expected $expected."
  }
  Write-Output "PASS $($case.Version): supported=$($case.Supported)"
}
