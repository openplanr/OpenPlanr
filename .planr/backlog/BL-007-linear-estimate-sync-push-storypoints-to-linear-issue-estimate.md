---
id: "BL-007"
title: "Linear estimate sync: push storyPoints/estimatedHours to Linear's issue estimate field"
priority: "high"
tags: ["feature", "linear", "estimation", "integration", "sync"]
status: "promoted"
created: "2026-04-23"
updated: "2026-04-23"
---

# BL-007: Linear estimate sync — push storyPoints to Linear's issue estimate

## Priority

HIGH

## Tags

- feature
- linear
- estimation
- integration
- sync

## Description

### Motivation

OpenPlanr's `planr estimate` command writes rich estimation metadata to artifact frontmatter (`storyPoints`, `estimatedHours`, `complexity`, `riskFactors`, `planrEstimateSnapshot`). Linear has a native **Issue estimation** field that teams use for sprint/cycle planning — Fibonacci, linear, exponential, or t-shirt scales. Today, `planr linear push` ignores every OpenPlanr estimate field: Linear issues land with no estimate, so teams have to re-estimate by hand. When a team has **Issue estimation enabled** in Linear, this is pure friction.

Same spirit as the BL → QT → Linear integration work shipped in PR #79: honor what the user has already authored locally and make Linear reflect it.

### Scope and provenance

- **Real gap:** OpenPlanr already has the data, Linear already has the field, the push just doesn't wire them together.
- **Pre-existing:** No prior release wrote estimates to Linear. This is additive, not a fix.
- **Blast radius:** Applies to every artifact type that gets pushed (FEAT / US / TASK / QT / BL) when Linear's team has issue estimation enabled. Teams with estimation disabled see zero change (feature gates on team config).
- **Not yet in scope:** pull direction (Linear → OpenPlanr). One-way push first; bidirectional after we learn how teams want conflicts resolved.

### What "good" looks like (directional)

- After `planr linear push QT-002`, if the QT has `storyPoints: 3` in frontmatter and the team has Fibonacci estimation enabled, the resulting Linear issue shows `Estimate: 3` in its sidebar.
- If the team has estimation disabled (`issueEstimationType: "notUsed"`), push logs a debug note and skips the estimate field — no errors, no warnings spam.
- If the team uses a scale that doesn't accept the OP value (e.g., t-shirt or Linear's `exponential` where `3` isn't valid), snap to the nearest allowed value and log once per run so the user can see what got sent.
- Updates are idempotent: re-pushing the same QT without changing frontmatter must not flip Linear's estimate.
- `planr linear push --dry-run` plan output shows the estimate that will be sent (or "skipped — team has estimation disabled").

### Acceptance criteria

1. `planr linear push` fetches the team's `issueEstimationType` once per run (co-located with the existing team-workflow-states fetch; one extra round-trip is fine, not per-issue).
2. Pushes the `estimate` field on create AND update for every pushable artifact type (FEAT / US / TASK / QT / BL) when:
   - the team has estimation enabled, AND
   - the frontmatter has a mappable value (`storyPoints` primarily; fall back to `estimatedPoints` for back-compat with older snapshots).
3. Scale mapping rules:
   - `fibonacci` (default): accept `{0, 1, 2, 3, 5, 8, 13, 21}`; snap to nearest when OP value isn't on the scale.
   - `linear`: accept `{0, 1, 2, 3, 4, 5}`; snap.
   - `exponential`: accept `{0, 1, 2, 4, 8, 16}`; snap.
   - `tShirt`: skip with one-per-run warning (no reliable numeric → XS/S/M/L/XL mapping; defer to explicit config if demand arises).
   - `notUsed`: skip silently.
4. Like `stateId`, omit the `estimate` field on update when unmapped — never send explicit `null` (matches the null-stateId regression fix pattern).
5. `planr linear status` doesn't need to change (no new column), but the `planr linear sync` summary line mentions estimate coverage.
6. Tests lock in:
   - Fibonacci snap: OP `4` → Linear `5`, OP `7` → Linear `8`.
   - Team `notUsed` → no estimate sent, no warning spam.
   - Team `tShirt` → skipped with single warning (log once per run, not per artifact).
   - Re-push of unchanged QT → `updateIssue` receives no `estimate` property (idempotent).
   - BL with no `storyPoints` frontmatter → no estimate sent; push otherwise succeeds.

### Out of scope (defer to separate backlogs)

- **Pull side (Linear → local):** decide conflict resolution when Linear and OP disagree on estimate. Needs UX thought.
- **Hours sync:** OP has `estimatedHours` but Linear has no native hours field. Could go in description footer or a custom label; not in this slice.
- **Complexity sync:** OP has low/medium/high; Linear has no equivalent. Skip.
- **Custom scale config override** (e.g., `linear.estimateSnap: "ceil"`): defer until someone asks.

### Size estimate

~4–6 hours end to end:

- 1 new helper in `linear-service.ts` to fetch `team.issueEstimationType` (mirrors `fetchTeamWorkflowStates` pattern).
- 1 pure function `resolveEstimateForPush(localValue, scale)` with scale-aware snapping.
- Wire into `pushOne*` paths in `linear-push-service.ts` (same 4 call sites as the stateId resolver).
- ~6–8 new tests in `tests/linear-push-standalone.test.ts` or a new `tests/linear-estimate-sync.test.ts`.
- Docs: extend the status-sync section of `docs/CLI.md` with an "Estimate sync" subsection.

### Quick-task generation note

When promoting to `planr backlog promote BL-007 --quick`, tasks should cover: team config fetch + caching pattern reuse, the pure snap function with unit tests for each scale, wiring into each of the four push call sites (FEAT/US/TASK/QT/BL), dry-run plan visibility, and regression tests for the idempotent re-push path. Mirror the no-nulls idempotency rule from the stateId fix.

---
_Promote to agile hierarchy: `planr backlog promote BL-007 --story` or `planr backlog promote BL-007 --quick`_
_Close when done: `planr backlog close BL-007`_

> **Promoted** to QT-004 on 2026-04-23.
