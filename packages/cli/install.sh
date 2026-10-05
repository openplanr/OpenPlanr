#!/bin/sh
set -eu

MINIMAL=0
VERSION="${OPENPLANR_VERSION:-latest}"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --minimal)
      MINIMAL=1
      ;;
    --version)
      shift
      if [ "$#" -eq 0 ]; then
        printf '%s\n' 'E_VERSION_REQUIRED: --version requires a value.' >&2
        exit 2
      fi
      VERSION="$1"
      ;;
    *)
      printf '%s\n' "E_INSTALL_OPTION: Unknown installer option: $1" >&2
      exit 2
      ;;
  esac
  shift
done

if ! command -v node >/dev/null 2>&1; then
  printf '%s\n' 'E_NODE_NOT_FOUND: OpenPlanr requires Node.js ^20.19.0 || ^22.13.0 || >=23.5.0.' >&2
  printf '%s\n' 'Install Node.js, then rerun this installer. Node.js is never installed silently.' >&2
  exit 1
fi

if ! node -e 'const version = process.versions.node; const [major, minor, patch] = version.replace(/^v/u, String()).split(String.fromCharCode(46)).map(Number); process.exit(/^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u.test(version) && [major, minor, patch].every(Number.isSafeInteger) && ((major === 20 && minor >= 19) || (major === 22 && minor >= 13) || (major === 23 && minor >= 5) || major > 23) ? 0 : 1)'; then
  printf '%s\n' "E_NODE_VERSION: OpenPlanr requires Node.js ^20.19.0 || ^22.13.0 || >=23.5.0; found $(node --version)." >&2
  exit 1
fi

if [ "$MINIMAL" -eq 1 ]; then
  npm install --global --omit=optional --no-audit --no-fund --loglevel=error "openplanr@$VERSION"
else
  npm install --global --no-audit --no-fund --loglevel=error "openplanr@$VERSION"
fi

INSTALLED_VERSION=$(openplanr --version)
printf '\n%s\n\n' "OpenPlanr $INSTALLED_VERSION installed successfully."
printf '%s\n' 'Next:'
printf '%s\n' '  cd /path/to/your/project'
if [ "$MINIMAL" -eq 1 ]; then
  printf '%s\n' '  openplanr setup --minimal'
else
  printf '%s\n' '  openplanr setup'
fi
