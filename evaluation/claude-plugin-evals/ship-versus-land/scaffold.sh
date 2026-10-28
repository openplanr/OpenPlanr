#!/usr/bin/env bash
# A notes library whose feature branch holds a finished, tested change.
set -euo pipefail

export GIT_AUTHOR_NAME=Fixture GIT_AUTHOR_EMAIL=fixture@example.invalid
export GIT_COMMITTER_NAME=Fixture GIT_COMMITTER_EMAIL=fixture@example.invalid
export GIT_AUTHOR_DATE=2026-01-05T09:00:00Z GIT_COMMITTER_DATE=2026-01-05T09:00:00Z

mkdir -p src test
cat > package.json <<'EOF'
{
  "name": "notes",
  "version": "1.2.0",
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
cat > CHANGELOG.md <<'EOF'
# Changelog

## 1.2.0

- Trim note titles.
EOF

git init -q -b main
git add .
git commit -q -m "chore: release 1.2.0"

git checkout -q -b feat/note-tags
export GIT_AUTHOR_DATE=2026-01-06T09:00:00Z GIT_COMMITTER_DATE=2026-01-06T09:00:00Z
cat > src/notes.js <<'EOF'
export function createNote(title, body, tags = []) {
  const normalized = [...new Set(tags.map((tag) => tag.trim().toLowerCase()))].sort();
  return { title: title.trim(), body, tags: normalized, createdAt: new Date(0).toISOString() };
}
EOF
cat > test/notes.test.js <<'EOF'
import assert from 'node:assert/strict';
import test from 'node:test';
import { createNote } from '../src/notes.js';

test('tags are trimmed, lower-cased, de-duplicated and sorted', () => {
  assert.deepEqual(createNote('a', 'b', [' Work', 'work', 'Home']).tags, ['home', 'work']);
});

test('a note without tags has none', () => {
  assert.deepEqual(createNote('a', 'b').tags, []);
});
EOF
git add .
git commit -q -m "feat: add tags to notes"
