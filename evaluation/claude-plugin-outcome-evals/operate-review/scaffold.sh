#!/usr/bin/env bash
# Notes app plus the company's October metrics, incident log, roadmap and
# runway note, with four seeded problems and no retention measure.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
# shellcheck source=../_shared/notes-base.sh
source "$here/../_shared/notes-base.sh"

fixture_init
write_notes_base
commit_at 2026-09-01T09:00:00Z "feat: notes service with per-user notes"

mkdir -p company/metrics company/incidents
cat > company/README.md <<'EOF'
# Company notes

Operating files for Notes (the company). Updated monthly by the founders.

- `metrics/` monthly product metrics exported from the warehouse
- `incidents/` incident log
- `roadmap.md` current quarter's roadmap
- `runway.md` cash and burn

Team: Dana Reyes (CEO), Sam Lee (CTO), Mira Chen (head of product),
Leo Park (growth), two engineers on the sync service.
EOF
cat > company/metrics/2026-10.csv <<'EOF'
month,signups,activated,activation_rate,weekly_active_users,paying_teams,mrr_usd
2026-07,1150,472,0.410,3920,212,25440
2026-08,1200,492,0.410,4105,224,26880
2026-09,1250,513,0.410,4290,236,28320
2026-10,1310,440,0.336,4310,241,28920
EOF
cat > company/metrics/README.md <<'EOF'
# Metric definitions

- `activated`: signed up in the month and created three notes within seven days.
- `activation_rate`: `activated / signups`.
- `weekly_active_users`: average distinct users per week with at least one request.
- `paying_teams`: teams on a paid plan at month end.

The new onboarding flow shipped on 2026-10-01 for all new signups.
EOF
cat > company/incidents/2026-10.md <<'EOF'
# Incidents, October 2026

| Date       | Severity | Service | Duration | Impact                                           | Postmortem |
|------------|----------|---------|----------|--------------------------------------------------|------------|
| 2026-10-04 | Sev-2    | sync    | 3h 10m   | Edits failed to save for 22% of active users      | Draft      |
| 2026-10-15 | Sev-2    | gateway | 1h 30m   | 502 errors on sign-in for all users              | Done       |
| 2026-10-27 | Sev-2    | sync    | 2h 05m   | 40 notes lost edits made during the outage       | Not started |

September had no Sev-1 or Sev-2 incidents.
EOF
cat > company/roadmap.md <<'EOF'
# Roadmap, Q4 2026

1. Team workspaces: shared folders, roles and billing per workspace. Sam and
   both sync engineers, all quarter.
2. Dark mode. Mira, two weeks.
3. Mobile app beta (iOS first). Contractor, starts November.

Out of scope this quarter: anything not listed above.
EOF
cat > company/runway.md <<'EOF'
# Runway, end of October 2026

- Cash in bank: $1.40M.
- Net burn: $175k per month (was $150k in September; two hires started in
  October).
- Runway at current burn: 8 months.
- The board asked for at least 12 months of runway before we start raising.
EOF
commit_at 2026-11-01T09:00:00Z "docs: october operating files"

# shellcheck source=../_shared/probe.sh
source "$here/../_shared/probe.sh"
