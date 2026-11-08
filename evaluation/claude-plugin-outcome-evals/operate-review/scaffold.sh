#!/usr/bin/env bash
# Notes app plus the company's October operating files (metrics, incidents,
# accounts, roadmap, runway, contracts): six seeded problems, two red herrings
# and no retention measure.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
# shellcheck source=../_shared/notes-base.sh
source "$here/../_shared/notes-base.sh"

fixture_init
write_notes_base
commit_at 2026-09-01T09:00:00Z "feat: notes service with per-user notes"

mkdir -p company/metrics company/incidents company/customers
cat > company/README.md <<'EOF'
# Company notes

Operating files for Notes (the company). Updated monthly by the founders.

- `metrics/` monthly product metrics exported from the warehouse
- `incidents/` incident log
- `customers/` largest accounts and what they told us
- `roadmap.md` current quarter's roadmap
- `runway.md` cash and burn
- `contracts.md` signed supplier contracts

Team: Dana Reyes (CEO), Sam Lee (CTO), Mira Chen (head of product),
Leo Park (growth), two engineers on the sync service.
EOF
cat > company/metrics/2026-10.csv <<'EOF'
month,signups,activated,activation_rate,weekly_active_users,paying_teams,mrr_usd
2026-07,1150,472,0.410,3920,212,25440
2026-08,1200,492,0.410,3550,224,26880
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

This export ran on 2026-11-09, so every October signup has had its full seven
days to activate.

Weekly active users dip every August while most of our customers' staff are on
summer holiday; August 2025 was 11% below July 2025 and recovered in September.
The August 2026 dip followed the same pattern and recovered in September.
EOF
cat > company/incidents/2026-10.md <<'EOF'
# Incidents, October 2026

| Date       | Severity | Service    | Duration | Impact                                                    | Postmortem  |
|------------|----------|------------|----------|-----------------------------------------------------------|-------------|
| 2026-10-04 | Sev-2    | sync       | 3h 10m   | Edits failed to save for 22% of active users               | Draft       |
| 2026-10-09 | Sev-3    | monitoring | 40m      | 312 pages from a misconfigured disk alert; no user impact | Done        |
| 2026-10-27 | Sev-2    | sync       | 2h 05m   | 40 notes lost edits made during the outage                | Not started |

The 9 October alert had its threshold corrected the same day; its postmortem
has no open action items and the alert has not fired since.

September had no Sev-1 or Sev-2 incidents.
EOF
cat > company/customers/accounts.csv <<'EOF'
team,plan,mrr_usd,renewal_date,note
Brightline Legal,enterprise,6900,2026-12-15,see notes.md
Harbor Schools,team,1200,2027-03-01,
Okafor & Wu,team,960,2027-01-20,
Pinecone Clinics,team,840,2027-05-10,
All other teams (237),team,19020,,monthly plans
EOF
cat > company/customers/notes.md <<'EOF'
# Account notes

- 2026-10-20, Brightline Legal (account owner: Dana): their IT lead wrote that
  they will not renew on 15 December unless we support single sign-on (SSO)
  by then. Their contract is annual.
- 2026-10-12, Harbor Schools: happy with the product, asked about dark mode.
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
  October). Burn covers payroll, hosting and tools; it does not include
  contracts that have not started yet.
- Runway at current burn: 8 months.
- The board asked for at least 12 months of runway before we start raising.
EOF
cat > company/contracts.md <<'EOF'
# Signed contracts

| Supplier    | Work                  | Cost              | Term                      | Signed     |
|-------------|-----------------------|-------------------|---------------------------|------------|
| Kite Studio | Mobile app beta (iOS) | $22,000 per month | 6 months from 2026-11-01  | 2026-10-25 |
| Hostwell    | Hosting               | Usage based       | Monthly, included in burn | 2025-03-02 |
EOF
commit_at 2026-11-09T09:00:00Z "docs: october operating files"

# shellcheck source=../_shared/probe.sh
source "$here/../_shared/probe.sh"
