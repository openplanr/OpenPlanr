#!/usr/bin/env bash
# Notes app plus an accepted note-sharing spec with five numbered requirements.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
# shellcheck source=../_shared/notes-base.sh
source "$here/../_shared/notes-base.sh"
# shellcheck source=../_shared/sharing-spec.sh
source "$here/../_shared/sharing-spec.sh"

fixture_init
write_notes_base
commit_at 2026-09-01T09:00:00Z "feat: notes service with per-user notes"
write_sharing_spec
commit_at 2026-10-20T09:00:00Z "docs: accept the note sharing spec"

# shellcheck source=../_shared/probe.sh
source "$here/../_shared/probe.sh"
