# Example: Full Sprint Cycle

A worked scenario covering sprint creation, loading, mid-sprint tracking, and close with retrospective.

---

## The ask

> **User:** "Start a 2-week sprint and load it with our highest-priority tasks. I want to check in mid-sprint, then close it cleanly at the end."

---

## Day 0 — create the sprint

```bash
planr sprint create --name "Sprint 12" --duration 2w --yes
# → Created .planr/sprints/SPRINT-012-sprint-12.md
# → Start: 2026-04-24   End: 2026-05-08
```

## Day 0 — load tasks

**Option A — AI auto-select** (recommended once 2–3 sprints of history exist):

```bash
planr sprint add --auto --yes
# AI considers past velocity + task priorities + sprint capacity
```

**Option B — explicit:**

```bash
planr sprint add TASK-001 TASK-002 QT-007 QT-011 --yes
```

Claude reads the sprint file and confirms the loaded tasks before continuing.

---

## Day 7 — mid-sprint check-in

```bash
planr sprint status
```

Expected output:

```
Sprint 12  (2026-04-24 → 2026-05-08)  7 days remaining

  TASK-001  Implement Google OAuth       ██████████░░░░░░░░  55%
  TASK-002  Session management           ████████░░░░░░░░░░  40%
  QT-007    Fix login redirect           ████████████████████ 100%
  QT-011    Update rate-limit config     ██████░░░░░░░░░░░░  30%

Overall: 55% complete  |  Velocity (projected): 7.2 pts/sprint
```

Generate a mid-sprint stakeholder report:

```bash
planr report sprint --sprint SPRINT-012 --yes
# → .planr/reports/2026-05-01-sprint-report.md
```

---

## Day 14 — close the sprint

```bash
planr sprint status                     # final review
planr sprint close --yes
```

On close, OpenPlanr:

1. Marks the sprint `closed`
2. Lists incomplete tasks as carry-over candidates
3. Prompts for a retrospective note (appended to the sprint file)
4. Computes final velocity and stores it for future `--auto` calculations

Claude surfaces the carry-over list to the user and asks which items should move to the next sprint.

---

## Day 14 — start the next sprint with carry-over

```bash
planr sprint create --name "Sprint 13" --duration 2w --yes
planr sprint add TASK-002 QT-011 --yes   # the items that didn't finish
planr sprint add --auto --yes            # top up remaining capacity with AI
```

---

## Generated sprint file (excerpt)

```markdown
---
id: "SPRINT-012"
name: "Sprint 12"
duration: "2w"
startDate: "2026-04-24"
endDate: "2026-05-08"
status: "closed"
tasks: ["TASK-001", "TASK-002", "QT-007", "QT-011"]
velocity: 8
---

# Sprint 12

## Goal
Ship Google OAuth + session management for the auth rewrite.

## Tasks
- [x] TASK-001  Implement Google OAuth          (8 pts)
- [ ] TASK-002  Session management              (5 pts — 60% — carry over)
- [x] QT-007    Fix login redirect              (2 pts)
- [ ] QT-011    Update rate-limit config        (3 pts — 30% — carry over)

## Retrospective

### Went well
- OAuth shipped on time; the template for OAuth flows speeds up future providers.

### To improve
- TASK-002 was under-scoped; session refresh turned into a bigger cross-cutting change.

### Actions
- Break session work into smaller stories before the next sprint.
```

---

## Claude's summary at close

> **Sprint 12 closed.** Final velocity: **8 points** (vs. 12 planned).
>
> **Shipped:** TASK-001 (OAuth), QT-007 (login redirect fix).
> **Carry-over:** TASK-002 (session management, 60%), QT-011 (rate-limit config, 30%).
>
> I've drafted a retro note summarizing the session scope miss. Want me to spin up
> Sprint 13 and load it with the two carry-overs plus `--auto` to fill capacity?

---

## Notes for the agent

- Only one sprint can be active at a time — running `sprint create` with an active sprint will fail. Close or confirm with the user first.
- `--auto` requires AI to be configured and meaningful history (>= 2 closed sprints) to be useful.
- For the very first sprint in a project, use explicit IDs — velocity data isn't there yet.
- Push sprint progress to GitHub / Linear with `planr github push` or `planr linear push` once sprints are loaded.
