#!/usr/bin/env bash
# Notes app with file persistence and migrations, the sharing spec, and a draft
# plan that has four defects and two sound tasks.
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
or `null`. Tokens are 32 random bytes from `crypto.randomBytes`, hex encoded.
Unit tests in `test/shares.test.js` cover create, find and unknown tokens.
Estimate: 0.5 day.

### 2. Persist share links

Save share records in `data/notes.json` as a new top-level `shares` array, read
and written by `src/persist.js` alongside `notes`. Estimate: 0.5 day.

### 3. Create-link route

Add `POST /notes/:id/shares` to `src/server.js`. Look the note up with
`store.get(id)`, return 404 if it does not exist, otherwise call
`shares.create(note.id)` and return `{ token }` with status 201.
Estimate: 0.5 day.

### 4. Everything else for sharing

Add `GET /shared/:token`, enforce read-only access, add expiry with 410
responses, return consistent errors for every share route, handle tokens in
logs, and write an end-to-end test suite covering every share route and error
case. Estimate: 6 days.

### 5. Document share links

Add the share routes to the API table in `README.md`, with one example request
and response for each. Estimate: 0.25 day.

## Order

1, then 2, then 3, then 4, then 5.
EOF
commit_at 2026-10-24T09:00:00Z "docs: draft the note sharing plan"

# shellcheck source=../_shared/probe.sh
source "$here/../_shared/probe.sh"
