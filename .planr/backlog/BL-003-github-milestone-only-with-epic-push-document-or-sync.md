---
id: "BL-003"
title: "GitHub milestone: only --epic push creates/assigns; single epic push has no milestone — document or fix"
priority: "high"
tags: ["github", "dx", "docs", "cli"]
status: "open"
created: "2026-04-19"
updated: "2026-04-19"
---

# BL-003: GitHub milestone: only `--epic` push creates/assigns; single epic push has no milestone — document or fix

## Priority
HIGH

## Tags

- github
- dx
- docs
- cli

## Description

### Problem (observed in production)

Teams using OpenPlanr with `planr github push` expect **epic issues** on GitHub to show a **Milestone** when that was the norm for earlier epics. In practice:

- **Epic issue #163** (EPIC-003) showed **No milestone** after push.
- **Epic issue #118** (EPIC-002) showed a milestone in the GitHub sidebar.

That inconsistency looks like a regression or a bug in Planr, but it is **mostly explained by which push command was used**, not random GitHub behavior.

### Root cause (current implementation)

In [`src/cli/commands/github.ts`](../../src/cli/commands/github.ts), a GitHub milestone is **created** (`ensureMilestone`) and **passed into `createIssue`** only when the user runs:

```bash
planr github push --epic EPIC-003
```

That flow builds `milestoneTitle` as `` `${epicId}: ${epic title}` ``, ensures the milestone exists, collects all artifacts under the epic, and passes the same milestone to **every** pushed issue (epic + features + stories + tasks + quick tasks as applicable).

If the user runs a **single-artifact** push instead:

```bash
planr github push EPIC-003
```

then `opts.epic` is unset, `milestoneTitle` stays **undefined**, and the epic issue is created/updated **without** a milestone — even though the artifact is an epic. Labels and body sync; **milestone does not**.

So: **same CLI, two different outcomes**, depending on `EPIC-003` vs `--epic EPIC-003`. That is easy to miss because both “feel” like “push the epic.”

`planr github push` does **not** read a `githubMilestone` (or similar) field from epic frontmatter today; milestone is entirely driven by the **`--epic` batch push** path.

### Why #118 could differ from #163

Without access to the exact commands used on each repo:

- **#118** may have been pushed with **`--epic EPIC-002`** (or milestone set manually / via GitHub Projects automation once).
- **#163** may have been pushed with **`planr github push EPIC-003`** only, or milestone creation failed once (`Could not create milestone, pushing without it`).

### Acceptance criteria (choose direction in implementation)

1. **Documentation (minimum):** [`docs/CLI.md`](../../docs/CLI.md) and `planr github push --help` clearly state that **milestones are applied only when using `--epic <id>`**, not when passing a lone epic id; include a one-line “if you want the epic + children on the same milestone, use `--epic`.”
2. **UX improvement (optional but valuable):** When the pushed artifact id resolves to type **epic**, either:
   - automatically apply the same milestone behavior as `--epic` for that epic (create/ensure milestone + assign), **or**
   - print a **warning**: “Epic pushed without `--epic`; GitHub milestone was not set. Use `planr github push --epic EPIC-…` to create the milestone and assign all work under this epic.”
3. **Optional future:** support `githubMilestone` (or epic-linked milestone) in frontmatter for advanced teams (out of scope unless prioritized).

### Out of scope

- Replacing GitHub Projects automation; this backlog item is about **Planr CLI behavior and docs**, not org-wide project rules.

### References

- Code: `registerGitHubCommand` → `push` action, branches `opts.epic` vs single `artifactId`.
- Real-world confusion: EPIC-003 / GitHub #163 vs EPIC-002 / #118 (Modul-University-Vienna/Modul).

---

_Promote to agile hierarchy: `planr backlog promote BL-003 --story` or `planr backlog promote BL-003 --quick`_
_Close when done: `planr backlog close BL-003`_
