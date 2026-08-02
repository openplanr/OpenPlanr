# Linear workflow template

Reusable checklist and copy-paste blocks for new projects: **cycles**, **milestones (epics)**, and **issues** linked to GitHub.

---

## 1. Order of operations

1. **Workspace** — Estimation scale (e.g. Fibonacci), timezone, whether unestimated issues count as 1 point (team choice).
2. **Project** — Create project, paste **project description** (see §4), set **status**, **priority**, **lead**, **start** and **target** dates.
3. **Cycles** — Turn on the cadence you use (e.g. **2-week** cycles); name them consistently (e.g. `Sprint 2026-04 — <theme>`).
4. **Milestones** — One milestone per **epic**; set **name**, **target date**, and **description** (see §5).
5. **Issues** — Create issues; attach to **project** + **milestone** + **cycle**; set **estimate**; **link GitHub**; assign **assignee**.
6. **Roll-up check** — Sum of issue points (and hours if you track them) matches expectations for the epic/milestone.

---

## 2. Naming conventions

Pick one scheme and keep it across projects.

| Layer | Pattern | Example |
|--------|---------|---------|
| **Milestone (epic)** | `EPIC-###: <outcome>` | `EPIC-001: Commercial registration & CRM observability` |
| **Issue (deliverable)** | `<Outcome> (<scope>) -> #<github>` | `PaymentSummary: doc alignment (#26)` |
| **Cycle** | `<Type> <YYYY-MM> — <theme>` | `Sprint 2026-05 — Hardening` |

Optional labels: `Feature`, `Bug`, `Chore`, `Spike` — use sparingly.

---

## 3. Issue body template

Paste per issue:

```markdown
## Goal
One sentence: what "done" means.

## Scope
- In: …
- Out: …

## Estimate
- **Points:** X (Fibonacci)
- **Hours (planning):** ~Yh

## Links
- GitHub: org/repo#N

## Notes
(Optional) Dependencies, risks, spike vs committed work.
```

---

## 4. Project description template

```markdown
**<Project name>** is <one-line product/context>.

This project tracks work for <timeframe or theme>: <2–4 bullets of outcomes>.

**In scope:** …

**Out of scope:** …

**How we work:** Milestones = epics; issues link to GitHub; estimates in Fibonacci; cycles are <N>-week sprints.
```

---

## 5. Milestone (epic) template

**Name:** `EPIC-###: <short outcome-oriented title>`

**Target date:** `<date>`

**Description:**

```markdown
**Outcome:** <measurable result for users or ops>

**Included work:** <bullets mapping to the issues you will create>

**Success criteria:** <checklist or metrics>

**Dependencies:** <teams, vendors, envs>
```

---

## 6. Cycles

- **Length:** 2 weeks (typical).
- **Name:** `Sprint <YYYY-MM> — <theme>`.
- **Rule of thumb:** Pull in issues that **finish** in that window; oversized work is split or spans cycles with a clear first milestone inside the issue description.

---

## 7. Estimates

- **Linear:** Fibonacci **1–8**; cap large work at **8** or **split** issues.
- **Optional:** Put **~hours** in the issue body for capacity planning.
- **Epic/milestone:** Roll up = **sum of child issue points** (and hours if you use them).

---

## 8. GitHub linking

- Every Linear issue that maps to dev work: attach `org/repo#N`.
- Title can include `-> #N` for scanability.
- Prefer **one GitHub issue ↔ one Linear issue** unless you intentionally use a parent/sub-issue split.

---

## 9. Project checklist (copy as a project comment)

- [ ] Project description + dates
- [ ] Cycles created for the quarter / release
- [ ] Milestones = epics with target dates
- [ ] All issues: project, milestone, cycle, estimate, assignee, GitHub link
- [ ] Roll-up points (and hours) sanity check
