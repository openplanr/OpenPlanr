---
name: review
description: Use this skill before invoking ship. Walks the human reviewer through a structured checklist of design-spec, US, and task files for feat-{name}, and gates the DEV phase on all-clear.
argument-hint: <feature-name>
allowed-tools: Read, Glob, Grep
---

# Skill: review

> **Type:** Pre-DEV validation checklist
> **Owner:** Human (Tech Lead or PO)
> **Purpose:** Structured review of the PO Phase output before launching DEV Phase
> **When:** After PO Phase completes, before DEV Phase starts

## Trigger

```
/openplanr-pipeline:review {feat}
```

Where `{feat}` is the feature name (e.g. `auth`, `dashboard`).
Targets: `output/feats/feat-{feat}/`

## What This Skill Does

Walks through the feature arborescence and presents each file for human sign-off.
For each file, it shows the content and asks a targeted validation question.
Keeps a running checklist. Only when ALL checks pass does it unlock the DEV phase.

## Review Checklist

### Phase A — Design Spec (if exists)

**File:** `output/feats/feat-{feat}/design-spec.md`

```
✅ / ❌  Section 1: Color palette — are hex values correct?
✅ / ❌  Section 2: Typography — fonts match the design?
✅ / ❌  Section 4: Component inventory — all key components listed?
✅ / ❌  Section 10: Open Questions — all ambiguities resolved?
```

*If ❌ on any: Edit design-spec.md before continuing.*

### Phase B — User Stories

For each `us-{N}/us-{N}.md`:

```
✅ / ❌  User Story statement is clear and valuable
✅ / ❌  Scope is appropriately bounded (not too broad, not micro)
✅ / ❌  Acceptance criteria are testable and observable
✅ / ❌  Dependencies are correctly identified
✅ / ❌  No scope overlap with adjacent US
```

### Phase C — Tasks

For each `us-{N}/tasks/task-{M}.md`:

```
✅ / ❌  Objective is clear and specific
✅ / ❌  File paths under "Create" match stack.md conventions
✅ / ❌  File paths under "Modify" refer to files that actually exist
✅ / ❌  File paths under "Preserve" are correctly identified
✅ / ❌  Technical spec references only tables/columns from schema.json
✅ / ❌  Task granularity is appropriate (not too large for one agent run)
✅ / ❌  Task type matches agent assignment (UI → frontend-agent, Tech → backend-agent)
```

### Phase D — Global Checks

```
✅ / ❌  Task count per US follows R2 (1 if no PNG, 2 if PNG, never more)
✅ / ❌  Total US count is reasonable for this feature
✅ / ❌  No circular dependencies between US
✅ / ❌  Stack.md is up to date and accurate
```

## Summary Output

After completing all checks:

```
/openplanr-pipeline:review feat-{name} — Summary
────────────────────────────────────────
Total US:      N
Total Tasks:   M
Checks passed: X / Y
Checks failed: Z

[List of failed checks with file references]

Status: [✅ READY FOR DEV PHASE | ❌ REQUIRES FIXES]
```

## Unlocking DEV Phase

If all checks pass:
```
✅ All checks passed. You may now run:
   /openplanr-pipeline:ship {feat}
```

If any checks fail:
```
❌ Fix the items above, then re-run:
   /openplanr-pipeline:review {feat}
```

---

*Reads: `output/feats/feat-{feat}/`*
*Does not modify any files (allowed-tools is Read/Glob/Grep only)*
*See: `${CLAUDE_PLUGIN_ROOT}/docs/rules.md` for the full rule set*
