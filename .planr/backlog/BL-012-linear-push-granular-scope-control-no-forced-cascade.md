---
id: "BL-012"
title: "linear push: granular scope control — no forced cascade, link when descendants push later"
priority: "high"
tags: ["feature", "linear", "push", "ux", "scope-control"]
status: "open"
created: "2026-04-25"
updated: "2026-04-25"
---

# BL-012: linear push — granular scope control (no forced cascade)

## Priority
HIGH

## Tags

- feature
- linear
- push
- ux
- scope-control

## Description

### The problem

Real user feedback from dogfooding:

> The CLI has no flag to push a feature without its stories — pushing FEAT-006 cascades to all 4 of its stories, pushing FEAT-007 cascades to all 8. Dry-run confirmed.
>
> We need users to be able to push each artifact as separate but if they push stories of a feature later they should be linked. So they can push a task only, a feature only, or a story only if they want.

Today's behavior, baked into [`pushOneFeatureAndDescendants`](src/services/linear-push-service.ts:379):

```
planr linear push FEAT-006   →  creates FEAT-006 + cascades into every US under it + the merged tasklist
planr linear push EPIC-001   →  cascades to all features + all stories + all tasklists
```

There is no way to say "just push the feature; I'll push the stories later." Yet a story pushed *after* its parent feature is already in Linear should naturally link to it via `parentId` — the linkage logic exists, it just isn't reachable from a "feature-only" entry point.

### What "good" looks like

Three independent push verbs, mirroring the artifact hierarchy:

```bash
planr linear push EPIC-001              # epic only — creates the project, no features/stories
planr linear push EPIC-001 --cascade    # current behavior, opt-in
planr linear push FEAT-006              # feature only — sub-issue of epic's project
planr linear push FEAT-006 --cascade    # current behavior, opt-in
planr linear push US-014                # story only — sub-issue of FEAT-006's Linear issue (auto-links via stored linearIssueId on the parent)
planr linear push TASK-009              # tasklist for one task file only — sub-issue of its feature
```

**Late linkage** — the existing logic already handles this correctly when the parent has been pushed first:
- `pushOneStoryUnderFeature` reads `featureIssueId` from the parent's frontmatter (`linearIssueId`) and sends `parentId` to Linear → story becomes a sub-issue
- `pushOneTaskListForFeature` does the same
- So once we expose granular entry points, late-pushed children link to their already-pushed parent automatically

The user's mental model: **push is a per-artifact verb.** Cascade is opt-in for "I want to ship the whole subtree."

### Proposed CLI surface

```bash
planr linear push <artifactId>                # push only this artifact (default — flip current behavior)
planr linear push <artifactId> --cascade      # also push descendants (today's default, but now explicit)
planr linear push <artifactId> --push-parents # already exists; pushes ancestors if not in Linear
planr linear push EPIC-001 --children-only    # everything under the epic but not the epic itself (rare; useful when epic was pushed manually)
```

**Behavior matrix:**

| Command | Pushes |
|---|---|
| `push EPIC-001` | EPIC project only |
| `push EPIC-001 --cascade` | EPIC + every FEAT + every US + every tasklist |
| `push FEAT-006` | FEAT issue only (linked to epic's project, no stories) |
| `push FEAT-006 --cascade` | FEAT + its stories + its tasklist |
| `push FEAT-006 --push-parents --cascade` | EPIC + FEAT + stories + tasklist |
| `push US-014` | Story sub-issue (linked to feature's Linear issue) |
| `push US-014 --push-parents` | Pushes EPIC + FEAT first if missing, then this story |
| `push TASK-009` | Tasklist for one task file (linked to feature) |

The default flip (cascade → opt-in) is the **breaking change**. Worth a major version bump? Or keep cascade as default and add a `--no-cascade` / `--this-only` flag to opt into the granular behavior. The latter is safer for existing users.

### Recommended approach: opt-in non-cascade

Add `--no-cascade` (alias `--this-only`) instead of flipping the default. Existing scripts continue to work; users who want granular control opt in:

```bash
planr linear push FEAT-006 --no-cascade       # feature only
planr linear push EPIC-001 --no-cascade       # project only
planr linear push US-014                      # story only — leaf, naturally non-cascade
```

`--no-cascade` is a no-op for leaf artifacts (US, TASK, QT, BL) since they have nothing to cascade.

### Acceptance criteria

1. `planr linear push FEAT-006 --no-cascade` creates only the feature's Linear issue. No stories, no tasklists touched. Plan output (`--dry-run`) shows exactly 1 row.
2. `planr linear push EPIC-001 --no-cascade` creates only the project. No features touched.
3. `planr linear push US-014` (when FEAT-006 already in Linear) creates the story as a sub-issue of FEAT-006's issue — `parentId` set correctly.
4. `planr linear push US-014 --push-parents` (when neither EPIC nor FEAT in Linear) cascades up the chain: pushes EPIC → FEAT → then the story.
5. `--no-cascade` and `--cascade` are mutually exclusive — combining errors out with a clear message.
6. Existing default (no `--no-cascade`) behavior is preserved bit-for-bit. Regression tests cover this.
7. Dry-run output for granular push lists only the artifact(s) it would touch — no phantom rows.
8. Tests:
   - FEAT-only push when stories already exist locally but `--no-cascade` is set → only feature pushed.
   - Story-only push when parent FEAT is in Linear → story linked correctly.
   - Story-only push when parent FEAT is NOT in Linear → actionable error pointing at `--push-parents`.
   - EPIC `--no-cascade` then later FEAT push → FEAT links to epic's project.

### `--push-parents` redefinition (composes with `--no-cascade`)

Today's `--push-parents` cascades sideways through ancestors — pushing TASK-004 with `--push-parents` ends up pushing FEAT-006 **plus all FEAT-006's other stories** (because the parent push routes through `pushFeatureScope` → `pushOneFeatureAndDescendants`). That's more than "what's needed to attach this artifact."

The principle going forward: **`--push-parents` pushes only the ancestor chain — never the ancestors' other children.**

| Command | Pushes |
|---|---|
| `push TASK-004 --push-parents` (FEAT-006 not in Linear) | EPIC + FEAT-006 + TaskList. **No stories.** |
| `push US-014 --push-parents` (parents not in Linear) | EPIC + FEAT-006 + US-014. **No sibling stories. No tasklist.** |
| `push FEAT-006 --push-parents` (EPIC not in Linear) | EPIC + FEAT-006. **No stories. No tasklist.** |
| `push FEAT-006 --push-parents --cascade` | EPIC + FEAT-006 + stories + tasklist (cascade explicitly opted into) |

This is the cleanest mental split:
- **`--push-parents`** = upward attachment only (ancestors)
- **`--cascade`** = downward propagation (descendants — current default for FEAT/EPIC, becomes opt-in only via `--no-cascade`)
- **`--no-cascade`** = "this artifact only" (mutually exclusive with `--cascade`)

The two flags compose orthogonally: `--push-parents` controls upward, `--cascade` (or `--no-cascade`) controls downward. The user's TASK-004 case (push the task + its parent feature, skip the feature's other stories) becomes natural: `planr linear push TASK-004 --push-parents`.

**Backward-compat note:** users who previously ran `planr linear push TASK-004 --push-parents` and got "feature + all stories" silently shipped will now get just "feature" — this is a behavior change. Recommend documenting in a release note. Anyone who actually wanted the stories adds `--cascade` to the command.

### Out of scope (deferred)

- **Selective cascade** — "push FEAT-006 and only US-014, US-015 under it." Could add `--include US-014,US-015` later. Not v1.
- **Bulk granular push** — `planr linear push FEAT-006 FEAT-007 FEAT-008 --no-cascade`. Multi-id arg already isn't supported on push; out of scope here.
- **Per-task-file Linear issues** — today multiple TASK-NNN files under one feature merge into one Linear TaskList issue. Pushing TASK-004 always touches the merged issue containing every sibling task file's checkboxes. Breaking that aggregation (one TASK-NNN = one Linear issue) is a separate design choice — see the deferred-TASK notes in BL-007 / QT-004 §3.5. BL-012 keeps the aggregation behavior unchanged.

### Size estimate

~3–4 hours end to end:
- Add `--no-cascade` flag to `planr linear push` CLI ([src/cli/commands/linear.ts](src/cli/commands/linear.ts)).
- Thread `noCascade: boolean` through `LinearPushOptions` ([src/services/linear-push-service.ts:117](src/services/linear-push-service.ts:117)).
- Branch in `pushOneFeatureAndDescendants` to skip the `for (const st of sf.stories)` loop and the `pushOneTaskListForFeature` call when `noCascade` is set.
- Branch in `pushEpicScope` to skip the feature loop when `noCascade` is set.
- Validate `--cascade` and `--no-cascade` mutual exclusion at the CLI layer.
- ~6–8 new tests covering the matrix above.
- Docs: extend [docs/CLI.md](docs/CLI.md) `planr linear push` section with the new flag and the late-linkage explanation.

### Why this matters

- **Iterative authoring** — teams plan a feature first, only later flesh out its stories. Forcing the whole subtree to ship together blocks the "publish early, refine later" flow.
- **Mistake recovery** — a story has a typo; user wants to push just that story's fix to Linear without re-shipping the parent feature's body, labels, milestone, etc.
- **CI granularity** — automated workflows often push a single artifact per commit (e.g. "push the artifact whose ID appears in the PR title"). Today they accidentally cascade.
- **Mental model alignment** — every other CLI verb in OpenPlanr operates per-artifact: `planr feature update FEAT-006` doesn't update its stories. `planr linear push` should follow the same rule by default-or-flag.

### Quick-task generation note

When promoting to `planr backlog promote BL-012 --quick`, tasks should cover:
- The CLI flag wiring with mutual-exclusion validation.
- Short-circuit branches in `pushEpicScope` and `pushOneFeatureAndDescendants`.
- The dry-run plan-builder updates so `--no-cascade` produces correct row counts.
- Late-linkage tests — verifying `parentId` is set when the parent's `linearIssueId` is in frontmatter.
- Doc update with the full behavior matrix table.

---
_Promote to agile hierarchy: `planr backlog promote BL-012 --story` or `planr backlog promote BL-012 --quick`_
_Close when done: `planr backlog close BL-012`_
