#!/usr/bin/env bash
# A small web app with one design brief and no design yet.
set -euo pipefail

export GIT_AUTHOR_NAME=Fixture GIT_AUTHOR_EMAIL=fixture@example.invalid
export GIT_COMMITTER_NAME=Fixture GIT_COMMITTER_EMAIL=fixture@example.invalid
export GIT_AUTHOR_DATE=2026-01-05T09:00:00Z GIT_COMMITTER_DATE=2026-01-05T09:00:00Z

mkdir -p docs src
cat > docs/design-brief.md <<'EOF'
# Design brief: invite teammates

A workspace owner invites teammates by email right after creating a workspace.

- Users: first-time workspace owners on desktop (1280 px) and phone (375 px).
- Goal: send at least one invite without leaving onboarding.
- Content: up to five email fields, a role picker (Member or Admin), a
  "Skip for now" link and a "Send invites" button.
- Open question: one form, a step-by-step flow, or a share link first.
  We want to compare distinct directions before choosing one.
EOF
cat > src/onboarding.html <<'EOF'
<main><h1>Your workspace is ready</h1><a href="/home">Go to workspace</a></main>
EOF

git init -q -b main
git add .
git commit -q -m "docs: add the invite teammates design brief"
