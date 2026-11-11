#!/usr/bin/env bash
# A notes app with one vague product intent and no specification.
set -euo pipefail

export GIT_AUTHOR_NAME=Fixture GIT_AUTHOR_EMAIL=fixture@example.invalid
export GIT_COMMITTER_NAME=Fixture GIT_COMMITTER_EMAIL=fixture@example.invalid
export GIT_AUTHOR_DATE=2026-01-05T09:00:00Z GIT_COMMITTER_DATE=2026-01-05T09:00:00Z

mkdir -p docs src
cat > docs/product-intent.md <<'EOF'
# Product intent

People lose track of notes they wrote weeks ago. We want notes to "come back"
when they matter again, maybe reminders, maybe resurfacing related notes,
something lightweight. It should not feel like a to-do app.
EOF
cat > src/notes.js <<'EOF'
export function createNote(title, body) {
  return { title: title.trim(), body, createdAt: new Date(0).toISOString() };
}
EOF

git init -q -b main
git add .
git commit -q -m "docs: capture the resurfacing notes intent"
