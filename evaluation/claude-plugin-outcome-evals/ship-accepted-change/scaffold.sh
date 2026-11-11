#!/usr/bin/env bash
# Notes app with one accepted, unimplemented change: tags on notes.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
# shellcheck source=../_shared/notes-base.sh
source "$here/../_shared/notes-base.sh"

fixture_init
write_notes_base
commit_at 2026-09-01T09:00:00Z "feat: notes service with per-user notes"

mkdir -p docs/changes
cat > docs/changes/0004-note-tags.md <<'EOF'
# 0004: Tags on notes

Status: Accepted (2026-10-22)

## Change

`createNote(title, body, { due, tags })` accepts an optional `tags` array.
Tags are trimmed, lower-cased, de-duplicated and stored sorted on the note as
`tags`. Empty tags are dropped. A note created without tags has `tags: []`.
Passing `tags` that is not an array of strings throws a `TypeError`.

`POST /notes` accepts `tags` in the request body, and the created note in the
response includes them.

## Acceptance

- `createNote('a', 'b', { tags: [' Work', 'work', 'Home'] }).tags` is
  `['home', 'work']`.
- Existing callers without tags keep working and get `tags: []`.
- `POST /notes` with `{"title": "a", "tags": ["Home"]}` returns `tags: ["home"]`.
- `POST /notes` with `{"title": "a", "tags": "home"}` returns 400.
- `npm test` covers these cases.
EOF
commit_at 2026-10-22T09:00:00Z "docs: accept the note tags change"

# shellcheck source=../_shared/probe.sh
source "$here/../_shared/probe.sh"
