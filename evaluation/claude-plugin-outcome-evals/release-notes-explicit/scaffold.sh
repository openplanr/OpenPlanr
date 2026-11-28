#!/usr/bin/env bash
# Same fixture as its base case; this variant invokes the skill explicitly.
set -euo pipefail
exec bash "$(cd "$(dirname "$0")" && pwd)/../release-notes/scaffold.sh"
