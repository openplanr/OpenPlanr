#!/usr/bin/env bash
# Notes app with file persistence and migrations, the sharing spec, and a draft
# plan with eight seeded defects and four sound decoys.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
# shellcheck source=../_shared/notes-base.sh
source "$here/../_shared/notes-base.sh"
# shellcheck source=../_shared/sharing-spec.sh
source "$here/../_shared/sharing-spec.sh"

fixture_init
write_notes_base
commit_at 2026-09-01T09:00:00Z "feat: notes service with per-user notes"

mkdir -p migrations data
cat > src/persist.js <<'EOF'
import { readFileSync, writeFileSync } from 'node:fs';
import { migrations } from '../migrations/index.js';

export const SCHEMA_VERSION = 2;

export function load(path) {
  let data = JSON.parse(readFileSync(path, 'utf8'));
  for (const migration of migrations) {
    if (data.schemaVersion < migration.version) data = migration.up(data);
  }
  if (data.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(`${path} has schemaVersion ${data.schemaVersion}; expected ${SCHEMA_VERSION}`);
  }
  return data;
}

export function save(path, data) {
  writeFileSync(path, `${JSON.stringify({ ...data, schemaVersion: SCHEMA_VERSION }, null, 2)}\n`);
}
EOF
cat > migrations/002-add-done.js <<'EOF'
export default {
  version: 2,
  up(data) {
    return {
      ...data,
      schemaVersion: 2,
      notes: data.notes.map((note) => ({ done: false, ...note })),
    };
  },
};
EOF
cat > migrations/index.js <<'EOF'
import addDone from './002-add-done.js';

export const migrations = [addDone];
EOF
cat > data/notes.json <<'EOF'
{
  "schemaVersion": 2,
  "notes": []
}
EOF
cat >> README.md <<'EOF'

## Stored data

Notes are saved to `data/notes.json` by `src/persist.js`. Every change to the
stored shape ships a migration in `migrations/` and bumps `SCHEMA_VERSION`, so
existing files keep loading after an upgrade.
EOF
commit_at 2026-09-20T09:00:00Z "feat: persist notes to disk with versioned migrations"

write_sharing_spec
commit_at 2026-10-20T09:00:00Z "docs: accept the note sharing spec"

mkdir -p docs/plans
cat > docs/plans/note-sharing.md <<'EOF'
# Plan: note sharing by link (draft)

Spec: `docs/specs/note-sharing.md`. Author: Sam Lee. Review requested before work starts.

## Tasks

### 1. Share store

Add `src/shares.js` with `create(noteId)`, which stores `{ token, noteId,
createdAt }` and returns the token, and `find(token)`, which returns the record
or `null`. Tokens are short and readable:
`Math.random().toString(36).slice(2, 10)`. Unit tests in `test/shares.test.js`
cover create, find and unknown tokens. Estimate: 0.5 day.

### 2. Persist share links

Save share records in `data/notes.json` as a new top-level `shares` array, read
and written by `src/persist.js` alongside `notes`. Estimate: 0.5 day.

### 3. Create-link route

Add `POST /notes/:id/shares` to `src/server.js`. Look the note up with
`store.get(id)`, return 404 if it does not exist, otherwise call
`shares.create(note.id)` and return `{ token }` with status 201.
Estimate: 0.5 day.

### 4. Read-through-link route

Add `GET /shared/:token` to `handle` in `src/server.js`, as a new branch after
the existing `/notes` path match. Look the token up with `shares.find`; an
unknown token returns 404, and a link older than 7 days returns 410. Otherwise
respond with `present(note)`, like the other read routes. The route is
GET-only, and no other route accepts a token, so links stay read-only.
Estimate: 1 day.

### 5. Errors through the existing helpers

Share routes report errors by throwing `HttpError` (404 for an unknown token,
410 for an expired one), which `handle` already turns into a JSON error body
with `sendJson`. No new error format. Estimate: 0.25 day.

### 6. Hardening and end-to-end tests

Keep tokens out of logs, retry persistence failures, rate-limit link reads,
and write an end-to-end suite covering every share route and error case.
Estimate: 6 days.

### 7. Document share links

Add the share routes to the API table in `README.md`, with one example request
and response for each. Estimate: 0.25 day.

## Design notes

- A link always shows the note as it is now, so edits made after the link was
  created are visible to anyone holding it.
- Expired share records stay in `data/notes.json`. Expiry is checked when a
  token is read; there is no cleanup job.

## Order

1, 2, 3, 4, 5, 6, 7.
EOF
commit_at 2026-10-24T09:00:00Z "docs: draft the note sharing plan"

# shellcheck source=../_shared/probe.sh
source "$here/../_shared/probe.sh"
