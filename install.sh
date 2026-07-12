#!/bin/sh
set -eu

MINIMAL=0
VERSION="${OPENPLANR_VERSION:-latest}"
SETUP_ARGS=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    --minimal)
      MINIMAL=1
      SETUP_ARGS="$SETUP_ARGS --minimal"
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
      SETUP_ARGS="$SETUP_ARGS $1"
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
  npm install --global --omit=optional "openplanr@$VERSION"
else
  npm install --global "openplanr@$VERSION"
fi

# shellcheck disable=SC2086
planr setup $SETUP_ARGS
