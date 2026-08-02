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
  printf '%s\n' 'E_NODE_NOT_FOUND: OpenPlanr requires Node.js 20 or newer.' >&2
  printf '%s\n' 'Install Node.js, then rerun this installer. Node.js is never installed silently.' >&2
  exit 1
fi

NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
if [ "$NODE_MAJOR" -lt 20 ]; then
  printf '%s\n' "E_NODE_VERSION: OpenPlanr requires Node.js 20+; found $(node --version)." >&2
  exit 1
fi

if [ "$MINIMAL" -eq 1 ]; then
  npm install --global --omit=optional --no-audit --no-fund --loglevel=error "openplanr@$VERSION"
else
  npm install --global --no-audit --no-fund --loglevel=error "openplanr@$VERSION"
fi

INSTALLED_VERSION=$(planr --version)
printf '\n%s\n\n' "OpenPlanr $INSTALLED_VERSION installed successfully."
printf '%s\n' 'Next:'
printf '%s\n' '  cd /path/to/your/project'
if [ "$MINIMAL" -eq 1 ]; then
  printf '%s\n' '  planr setup --minimal'
else
  printf '%s\n' '  planr setup'
fi
