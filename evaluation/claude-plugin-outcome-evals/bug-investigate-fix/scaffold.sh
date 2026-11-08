#!/usr/bin/env bash
# Notes app whose due dates render a day early west of UTC, plus the bug report.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
# shellcheck source=../_shared/notes-base.sh
source "$here/../_shared/notes-base.sh"

fixture_init
write_notes_base
commit_at 2026-09-01T09:00:00Z "feat: notes service with per-user notes"

mkdir -p docs
cat > docs/bug-report.md <<'EOF'
# Due dates show a day early

Reported by: support, 2026-10-28

Since we moved the service to the Oregon hosts (the servers there run with
`TZ=America/Los_Angeles`), customers say every due date shows one day earlier
than the date they saved. The EU deployment does not have the problem.

Steps:

1. `POST /notes` with `{"title": "Taxes", "due": "2026-03-10"}`.
2. `GET /notes/<id>` for the new note.

Expected `"due": "2026-03-10"`. Actual `"due": "2026-03-09"`.
EOF
commit_at 2026-10-28T09:00:00Z "docs: record the due date bug report"

# shellcheck source=../_shared/probe.sh
source "$here/../_shared/probe.sh"
