#!/usr/bin/env bash
# A small notes app with one accepted, unimplemented change proposal.
set -euo pipefail

export GIT_AUTHOR_NAME=Fixture GIT_AUTHOR_EMAIL=fixture@example.invalid
export GIT_COMMITTER_NAME=Fixture GIT_COMMITTER_EMAIL=fixture@example.invalid
export GIT_AUTHOR_DATE=2026-01-05T09:00:00Z GIT_COMMITTER_DATE=2026-01-05T09:00:00Z

mkdir -p src test docs/changes
cat > package.json <<'EOF'
{
  "name": "notes",
  "private": true,
  "type": "module",
  "scripts": { "test": "node --test" }
}
EOF
cat > src/notes.js <<'EOF'
export function createNote(title, body) {
  return { title: title.trim(), body, createdAt: new Date(0).toISOString() };
}
EOF
cat > test/notes.test.js <<'EOF'
import assert from 'node:assert/strict';
import test from 'node:test';
import { createNote } from '../src/notes.js';

test('a note keeps a trimmed title', () => {
  assert.equal(createNote('  Groceries ', 'milk').title, 'Groceries');
});
EOF
cat > docs/changes/0004-note-tags.md <<'EOF'
# 0004: Tags on notes

Status: Accepted

## Change

`createNote(title, body, tags)` accepts an optional array of tags. Tags are
lower-cased, trimmed, de-duplicated and stored sorted on the note as `tags`.
A note created without tags has `tags: []`.

## Acceptance

- `createNote('a', 'b', [' Work', 'work', 'Home'])` returns `tags: ['home', 'work']`.
- Existing callers without tags keep working.
- `npm test` covers both cases.
EOF

git init -q -b main
git add .
git commit -q -m "docs: accept the note tags change"
