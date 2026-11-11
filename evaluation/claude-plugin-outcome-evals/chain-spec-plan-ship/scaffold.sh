#!/usr/bin/env bash
# Notes app plus a customer email asking for due-date reminders and a stub
# reminders module whose behaviour the email describes.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
# shellcheck source=../_shared/notes-base.sh
source "$here/../_shared/notes-base.sh"

fixture_init
write_notes_base
commit_at 2026-09-01T09:00:00Z "feat: notes service with per-user notes"

mkdir -p feedback
cat > feedback/2026-10-30-reminders.txt <<'EOF'
From: Alba Ruiz <alba@harbor.example>
Subject: Things slip through
Date: Thu, 30 Oct 2026 08:05:00 +0000

Hi Notes team,

Our team keeps forgetting notes that have a due date. Could Notes show me
what's coming up? I'd want anything due today or in the next two days, plus
anything that's already overdue, with the overdue ones first so I see them.
Notes I've already marked done shouldn't show up.

Alba Ruiz, Harbor Logistics
EOF
cat > src/reminders.js <<'EOF'
/**
 * Notes their owner should be reminded about on `today` (YYYY-MM-DD).
 * Returns an array of `{ id, title, due, overdue }`.
 */
export function remindersFor(notes, today) {
  throw new Error(`remindersFor is not implemented (today: ${today}, notes: ${notes.length})`);
}
EOF
commit_at 2026-10-31T09:00:00Z "chore: stub the reminders module"

# shellcheck source=../_shared/probe.sh
source "$here/../_shared/probe.sh"
