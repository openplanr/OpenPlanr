#!/usr/bin/env bash
# Notes app plus two customer emails asking to share notes with a team.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
# shellcheck source=../_shared/notes-base.sh
source "$here/../_shared/notes-base.sh"

fixture_init
write_notes_base
commit_at 2026-09-01T09:00:00Z "feat: notes service with per-user notes"

mkdir -p feedback
cat > feedback/2026-10-06-acme.txt <<'EOF'
From: Priya Nair <priya@acme.example>
Subject: Sharing runbooks with my team
Date: Mon, 6 Oct 2026 10:12:00 +0000

Hi,

We use Notes for our support team's runbooks. Right now only the person who
wrote a note can see it. Could I share a note with specific people on my team
so they can read it? I don't want them to be able to change it: the runbooks
need one owner.

Also, when someone leaves the team I need to be able to stop sharing with them.

Thanks,
Priya Nair, Acme Support
EOF
cat > feedback/2026-10-14-brightlane.txt <<'EOF'
From: Tom Okafor <tom@brightlane.example>
Subject: Re: feature requests
Date: Tue, 14 Oct 2026 16:40:00 +0000

Hello,

I keep pasting notes into chat so my two colleagues can see the latest
version. We'd love to share a note with a teammate and have them always see
the current version, not a copy that goes stale.

Being able to see who a note is shared with would help too.

Tom Okafor, Brightlane
EOF
commit_at 2026-10-15T09:00:00Z "docs: keep customer feedback on sharing"

# shellcheck source=../_shared/probe.sh
source "$here/../_shared/probe.sh"
