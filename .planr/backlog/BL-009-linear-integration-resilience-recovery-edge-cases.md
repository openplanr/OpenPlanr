---
id: "BL-009"
title: "Linear integration — resilience, recovery, and edge-case hardening (adopt, stale-ID detection, type safety, orphan rescue)"
priority: "high"
tags: ["feature", "linear", "resilience", "recovery", "dx", "multi-phase"]
status: "open"
created: "2026-04-23"
updated: "2026-04-23"
---

# BL-009: Linear integration — resilience, recovery, and edge-case hardening

## Priority
HIGH

## Tags

- feature
- linear
- resilience
- recovery
- dx
- multi-phase

## Description

### Motivation

A hands-on dogfooding session on the **Modul-events** project surfaced a cluster of edge cases that every Linear-integrated team will hit sooner or later. The symptoms were:

- `planr linear push TASK-003` said **"Parent feature FEAT-003 has not been pushed"** — but it had been pushed, and the user could see the Linear issues. Local frontmatter had lost the `linearIssueId` fields. There was no recovery command; the only paths were (a) hand-edit frontmatter with UUIDs copied from Linear URLs, or (b) push again and create duplicates.
- `planr linear push EPIC-001` then failed with `Label "Feature" already exists in the workspace` because the workspace already had a capitalized `Feature` label and our label lookup matched case-sensitively.
- After working around the label issue, the same push succeeded but **created Linear stories with bodies like `As a ****, I want **** so that ****.`** — stub stories with empty role/goal/benefit rendered the template placeholders verbatim.
- One QT push crashed on invalid frontmatter, leaving an orphan Linear issue (`MUV-13`) with no local pointer because the create succeeded but the frontmatter write-back failed.
- `planr revise TASK-004` got demoted to `flag` but the audit log was the only way to see what the agent had proposed, and the terminal gave no next-step guidance.

Most of those have been fixed in the adjacent commits (null-stateId, label case, empty story body, revise flag guidance, rejected-proposal preservation). BL-009 catches what's left.

The underlying theme: **the Linear integration has a happy path that works well, but the recovery surface when that path fails is minimal.** Users who lose local state, push with incomplete artifacts, or inherit a project with existing Linear entities have no clean remediation — they either hand-edit YAML or create duplicates. This is the difference between a demo-quality integration and a production-quality one.

### Scope and provenance

- **Real gap:** every symptom above is reproducible and hit an actual user in a real repo.
- **Pre-existing:** no prior release had these recovery paths. BL-009 is additive — no breaking changes to the push/sync contract.
- **Blast radius:** improves resilience for **every** team using `planr linear`. Strongest impact on teams migrating an existing project into OpenPlanr, teams dogfooding across multiple machines, and CI-driven pushes where interactive recovery isn't available.
- **Complements:** BL-006 (`planr doctor`) covers generic artifact validation; BL-009 adds Linear-specific recovery. BL-008 (revise accuracy) covers a different surface. These three together complete the resilience story for v1.3.

### What "good" looks like (directional)

- A user who lost `.planr/` frontmatter state (forgot to commit, merge conflict, different machine) can run `planr linear adopt EPIC-001` and rebind to the existing Linear project/issues by title match — no duplicates created.
- A user who wrote `role: 42` (number) in a story frontmatter gets a clear `story US-007 has a non-string role field — expected string, got number` error at push time, not a stack trace from `.trim()`.
- Running `planr linear status` reveals when an artifact's stored `linearIssueId` references a Linear issue that's been **deleted in Linear** — the row shows `(deleted in Linear — run \`planr linear adopt US-007\` or clear the linearIssueId to re-push)` instead of silently failing the next push.
- An artifact with empty role/goal/benefit + empty acceptance criteria gets a warning at push time (`US-005 has no user-story fields filled in — pushing title-only`). Still pushes, but the user knows it's a stub.
- If a push creates a Linear issue but crashes before writing back to local frontmatter, the next push detects the orphan (by title match + timestamp) and adopts it rather than creating a duplicate.
- The test typecheck gap is closed — CI catches test-file TS errors that the main `tsc --noEmit` misses.

### Fix ladder (phased — each phase shippable independently)

#### Phase 1 — `planr linear adopt <artifactId>` (~2 days, ships first — the biggest user pain)

The command that gets users unstuck when local state has lost the Linear linkage.

**CLI surface:**
```
planr linear adopt <artifactId>              # interactive: fetch + pick + confirm
planr linear adopt <artifactId> --id <uuid>  # direct bind by known Linear id
planr linear adopt EPIC-001 --cascade        # adopt epic + features + stories + tasklists in one go
planr linear adopt --all --dry-run           # report every artifact that could be adopted from matching Linear titles
```

**Resolution order:**
1. If `--id <uuid>` is given, verify the Linear entity exists, matches the artifact's kind (epic→project, feature→issue, story→sub-issue, task→tasklist, QT/BL→standalone issue) and write the id(s) to local frontmatter.
2. Otherwise, query Linear for candidates by title (case-insensitive, fuzzy match using Levenshtein ≤3 on the artifact title).
3. Present ranked matches: `[1] MOD-32 "Architecture Documentation for Registration Paths" (93% match)`. User picks the right one (or "none — create fresh via push").
4. For `--cascade`: walk the epic's feature/story/task tree and prompt per-level.

**Safety:**
- Dry-run shows the full rebind plan with the Linear URLs before any frontmatter writes.
- Idempotent: re-running against already-bound artifacts is a no-op with a dim confirmation line.
- Atomic per-artifact write (same atomic-write-service as push).
- Audit log entry records who adopted what + timestamp + confidence score.

**Acceptance criteria (Phase 1):**
1. `planr linear adopt EPIC-001` on the Modul-events scenario (Linear project exists, local epic has no `linearProjectId`) rebinds successfully in one run.
2. Fuzzy match handles typo drift: `"Architecture Documentation for Registration Paths"` (local) matches `"Architecture Documentation For Registration Paths"` (Linear, title-cased variant) above the 80% threshold.
3. `--cascade` rebinds epic + features + stories + tasklists, prompting once per unclear match.
4. `--dry-run` writes nothing locally and calls Linear read APIs only.
5. `--all` across ~50 artifacts completes in under 10 seconds with proper batching.
6. Running `planr linear push EPIC-001` after `adopt` does NOT create duplicates — the adopted ids are honored.
7. Tests: fixture with mismatched titles, direct-by-id path, cascade path, already-bound no-op path.

#### Phase 2 — Stale Linear ID detection + `planr linear status` enrichment (~1.5 days)

When an artifact's stored `linearIssueId` references an entity that's been deleted or archived in Linear, push hits confusing 404s on update. Make this visible before it bites.

**Changes:**
- Extend `planr linear status` to optionally verify each stored id exists in Linear (`--verify` flag; triggers one batched query per 50 ids).
- New note column values: `(deleted in Linear)`, `(archived in Linear)`, `(no access — check team membership)`.
- `planr linear push` auto-detects deleted-entity case on the 404 and emits a guided error: `Linear issue MUV-18 no longer exists. Run \`planr linear adopt US-007 --id <new-uuid>\` to rebind, or clear the linearIssueId frontmatter to re-push as a new issue.`
- Auto-recovery flag: `planr linear push --heal` transparently clears stale linearIssueIds and falls through to create. Default off — users should see the error first.

**Acceptance criteria (Phase 2):**
1. `planr linear status --verify` on a repo with a deleted Linear issue shows `(deleted in Linear)` in the note column.
2. `planr linear push <artifact>` with a stale id emits an actionable error pointing at `linear adopt` or `--heal`.
3. `--heal` flag converts stale-id pushes into creates with a visible warning per artifact.
4. Tests: fixture with deleted/archived/no-access scenarios; no false positives on valid ids.

#### Phase 3 — YAML type hardening across scope loaders (~1 day)

**Concrete risk:** a story frontmatter like `role: 42` (YAML parses as number) passes through `(sd.role as string) || ''` — the cast is type-level only, so at runtime `story.role` is `42`, and `story.role?.trim()` throws TypeError at body-formatter time. Current behavior: cryptic stack trace mid-push. Desired: guided error at load time.

**Changes:**
- Replace every `(sd.foo as string) || ''` in [src/services/linear/scope-loaders.ts](src/services/linear/scope-loaders.ts) with `toOptionalString(sd.foo) ?? ''`.
- Same treatment in [src/services/artifact-service.ts](src/services/artifact-service.ts) for the generic artifact parser where string-typed fields are read.
- Add a `validateArtifactFrontmatter(type, data)` function that checks required-field types before push and throws `Artifact ⟨id⟩ has a non-string ⟨field⟩ field — expected string, got ⟨actual-type⟩. Fix ⟨file⟩ and re-run.`
- Call the validator from the top of `runLinearPush` (before any API calls), same position as `requireFrontmatter` already does for QT/BL.

**Acceptance criteria (Phase 3):**
1. A story with `role: 42` in YAML produces a typed error at push time with the file path, not a stack trace.
2. A story with `role: null` is treated the same as `role: ""` (empty, renders no "As a" sentence per today's fix).
3. A story with `role: true` (boolean) produces a typed error.
4. No regression on valid artifacts — all existing tests pass.
5. New fixture-based tests cover each type-coercion edge case per artifact kind.

#### Phase 4 — Orphan Linear entity detection on push (~1 day)

**Failure mode:** `createIssue` succeeds in Linear, then `updateArtifactFields` fails locally (disk full, git conflict, permission error). Linear has the entity, local has no pointer. Next push creates a duplicate, and the orphan lives forever.

**Changes:**
- Before every create call in `pushOneFeatureAndDescendants` / `pushOneStoryUnderFeature` / `pushOneQuickTaskWithContext` / `pushOneBacklogItemWithContext`, query Linear for an existing entity with the exact same title + same parent (project for features, feature-issue for stories). If found: reuse its id instead of creating a new one.
- One exception: quick tasks in a standalone project have no parent → weaker dedup; match on title + type-label.
- Emit a visible warning when dedup kicks in: `US-007: adopted existing Linear issue MUV-42 (title-match) instead of creating a duplicate. Local linearIssueId was missing — check your git state.`
- Keep `planr linear adopt` as the intentional recovery command; Phase 4's auto-dedup is a guardrail, not a replacement.

**Acceptance criteria (Phase 4):**
1. Push where Linear already has an entity with the same title + parent reuses the existing id instead of creating a duplicate.
2. The warning line is visible in normal output, not just `--verbose`.
3. Tests: fixture with pre-existing duplicate, negative case (same title on different parents — should create), idempotency (re-run still does nothing).
4. No regression on normal first-time-push — dedup kicks in only when an existing Linear entity matches AND local frontmatter has no id.

#### Phase 5 — Empty-artifact push warnings (~0.5 day)

Stub artifacts push silently today. Users want to know when they're pushing skeletal content before it lands in Linear.

**Changes:**
- New `warnSkeletal(artifact, warnings)` helper invoked from each push path.
- Warnings emitted (non-blocking):
  - Story: role/goal/benefit + acceptanceCriteria all empty → `US-005 will push title-only — no user-story fields filled in.`
  - Feature: overview empty + no functional requirements → `FEAT-007 will push title-only — no overview or requirements.`
  - Epic: all frontmatter content fields empty → same.
  - QT: no tasks in body + no prose → `QT-015 has no tasks or content — Linear issue will be title-only.`
  - Task: no checkbox lines in body → `TASK-009 has no tasks — Linear tasklist will be empty.`
- `--strict` flag promotes warnings to errors (CI-friendly gate).

**Acceptance criteria (Phase 5):**
1. Each artifact kind emits the expected warning when its required content is empty.
2. `--strict` promotes warnings to errors and exits non-zero.
3. No warnings on fully-filled artifacts (no noise).
4. Tests per kind + fixture for the `--strict` path.

#### Phase 6 — Test typecheck gate (~0.5 day)

The repo's `tsconfig.json` excludes `tests/` entirely. Tests never get typechecked by the CLI — errors only show in IDE. Today we hit TS2493 (`mock.calls[0]`) and TS2352 (`unknown` casts) in tests that `tsc --noEmit` never reported.

**Changes:**
- Add `tsconfig.tests.json` that extends the main config and includes both `src/**/*.ts` and `tests/**/*.ts`.
- Add `npm run typecheck:tests` that runs `tsc -p tsconfig.tests.json --noEmit`.
- Add to `lint-staged` so pre-commit runs it.
- Fix the pre-existing TS errors in `tests/integration/sync-command.test.ts`, `tests/linear-service-errors.test.ts`, `tests/unit/artifact-service.test.ts`, `tests/unit/generator-factory.test.ts`, `tests/unit/markdown.test.ts` (all flagged by our recent audit).

**Acceptance criteria (Phase 6):**
1. `npm run typecheck:tests` runs clean after fixing the pre-existing errors.
2. Pre-commit hook catches any new test-file type errors before commit.
3. CI job runs both `typecheck` (src only) and `typecheck:tests` (src + tests).

#### Phase 7 — Multi-team label disambiguation (~0.5 day)

Today's workspace-wide label fallback picks the FIRST match. If a Linear workspace has two `feature` labels (one per team), we might adopt the wrong team's label. Rare but worth handling.

**Changes:**
- On workspace-wide label fallback, prefer labels owned by the target team first; if the team's copy doesn't exist, only then accept the cross-team match.
- Log the decision: `Adopting cross-team label "Feature" (owned by team Backend). If you want a team-scoped label for Frontend, delete/rename the existing label or rename your typeLabels config.`
- Config escape hatch: `linear.typeLabels.feature: "feature-planr"` lets users sidestep the collision entirely.

**Acceptance criteria (Phase 7):**
1. When both team + cross-team `feature` labels exist, push prefers the team-scoped one.
2. When only a cross-team `feature` label exists, the warning line is emitted before adoption.
3. `linear.typeLabels` override creates a disambiguated new label name.
4. Tests: fixtures for team-preferred, cross-team-only, and config-override paths.

### Out of scope (deferred to future backlog items)

- **LSP-style real-time validation in editors** — IDEs would flag frontmatter issues inline. Nice but separate workstream.
- **Bi-directional YAML schema migration** — auto-upgrading older frontmatter field names to canonical ones. Partial coverage via BL-006 `planr doctor --fix`.
- **Linear team moves** — an issue moved between Linear teams. Would need a specific recovery path. File only if users report it.
- **Multi-workspace support** — one local project pushing to multiple Linear workspaces. Current design assumes one workspace. Not in v1.3.

### Size estimate (multi-week)

Total: **~7–9 engineer-days** across 7 phases, each independently shippable.

| Phase | Days | Value |
|---|---|---|
| 1 — `planr linear adopt` | 2 | Biggest user pain — recovers lost frontmatter state |
| 2 — Stale-ID detection + `--heal` | 1.5 | Catches deleted/archived Linear entities before they bite |
| 3 — YAML type hardening | 1 | Turns runtime crashes into guided errors |
| 4 — Orphan dedup on push | 1 | Guardrail against create-after-failed-writeback duplicates |
| 5 — Empty-artifact warnings | 0.5 | User knows when they're pushing stubs |
| 6 — Test typecheck gate | 0.5 | Closes the IDE/CLI error gap |
| 7 — Multi-team label preference | 0.5 | Defensive against cross-team label collisions |

Release as a series of patch versions (one per phase). Phase 1 is the highest-leverage slice — ship it first, on its own, so users stuck today get relief within days.

### Quick-task generation note

When promoting BL-009 to a QT via `planr backlog promote BL-009 --quick`, tasks should cover:
- The exact phase order above (ship Phase 1 on its own; don't bundle).
- **Adopt command's fuzzy-match algorithm** (Levenshtein ≤3 on titles, 80% confidence threshold) and the `--id` direct-binding path as a separate subtask.
- **Stale-ID detection's batching** (one `client.issues({filter: {id: {in: [...]}}})` per 50 ids) to keep `status --verify` fast on large repos.
- **YAML type hardening's test matrix** — one fixture per (artifact kind × invalid type) combination: number, boolean, null, array, object.
- **Orphan dedup's parent-scoping** — stories dedup must respect feature parent; task lists must respect feature; QT/BL dedup is weaker (standalone project only).
- **Warnings vs. errors** — Phase 5's default is non-blocking; `--strict` promotes; Phase 3's type errors are always blocking.
- **Phase 6 fixes** — list the specific pre-existing test errors to fix as separate subtasks, not a catchall "fix all tests."
- Reference implementation patterns:
  - [ensureIssueLabel](src/services/linear-service.ts) — case-insensitive + workspace-wide pattern for `linear adopt` title matching
  - [buildStoryIssueBody](src/services/linear/body-formatters.ts) — empty-field suppression pattern for Phase 5 warnings
  - [fetchLinearIssueStateNames](src/services/linear-service.ts) — batched read pattern for Phase 2 verify
  - [requireFrontmatter](src/services/linear/scope-loaders.ts) — pre-flight validation pattern for Phase 3

Expected QT length: ~45–55 subtasks across 7 task groups. Recommend `planr quick promote` to a story only after Phase 1 ships and dogfoods cleanly on a real repo.

---
_Promote to agile hierarchy: `planr backlog promote BL-009 --story` or `planr backlog promote BL-009 --quick`_
_Close when done: `planr backlog close BL-009`_
