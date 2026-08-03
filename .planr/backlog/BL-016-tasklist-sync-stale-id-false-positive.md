---
id: "BL-016"
title: "tasklist-sync rejects healthy issue UUIDs as stale (UUID-shape false positive)"
priority: "high"
tags: ["bug", "linear", "sync", "tasklist", "regression-fence"]
status: "open"
created: "2026-04-29"
updated: "2026-04-29"
---

# BL-016: tasklist-sync rejects healthy issue UUIDs as stale

## Priority
HIGH (functional gap — the entire `planr linear tasklist-sync` flow is unusable on real data)

## Tags

- bug
- linear
- sync
- tasklist
- regression-fence

## Description

Real user report:

> tasklist-sync skips all 7 TASKs with "stale id" warning despite the IDs being valid issue UUIDs. The heuristic that compares an issue UUID to "looks like a workflow-state UUID" is too aggressive — Linear UUIDs share the same format. Workaround: `planr linear push TASK-XXX` updates the body just fine, so tasklist-sync is currently redundant for our flow. But if anyone ever needs the bidirectional sync, this blocks it.

## Root cause

[`src/services/linear-pull-service.ts:846`](src/services/linear-pull-service.ts:846) gates each task file through:

```ts
if (isLikelyLinearWorkflowStateId(issueId)) {
  summary.skippedStaleId++;
  logger.warn(`Task ${t.id}: linearIssueId "${issueId}" looks like a workflow state uuid, not an issue id...`);
  continue;
}
```

The premise is wrong. Linear issue ids and workflow-state ids are **both UUIDv4** — there is no shape-based way to tell them apart. The line below it (`isLikelyLinearIssueId`) already accepts UUIDs and `ENG-42` identifiers correctly; the workflow-state check above it is dead-and-harmful and fires on every healthy task file with a real UUID issue id.

We acknowledged this exact false-positive when fixing the status table in [`src/services/linear-mapping-service.ts:17-19`](src/services/linear-mapping-service.ts:17):

> _earlier versions also flagged UUID-shaped values as "looks like a workflow state id" — removed in Gap D because every pushed Linear issue id is a UUID, so that check fired on healthy data._

The same fix was never propagated to the tasklist-sync path. BL-016 closes that gap.

## Fix

Delete the `isLikelyLinearWorkflowStateId` branch in `loadTaskCheckboxFiles` (or wherever the loop sits in `linear-pull-service.ts`). The subsequent `isLikelyLinearIssueId` check is necessary and sufficient — UUIDs already pass it.

```diff
- if (isLikelyLinearWorkflowStateId(issueId)) {
-   summary.skippedStaleId++;
-   logger.warn(`Task ${t.id}: linearIssueId "${issueId}" looks like a workflow state uuid, not an issue id. Re-run \`planr linear push\` to repair.`);
-   continue;
- }
  if (!isLikelyLinearIssueId(issueId)) {
    summary.skippedStaleId++;
    logger.warn(`Task ${t.id}: linearIssueId "${issueId}" is not a valid Linear issue id (expected uuid or \`ENG-42\` identifier). Re-run \`planr linear push\` to repair.`);
    continue;
  }
```

If the import of `isLikelyLinearWorkflowStateId` is no longer used elsewhere in the file, drop it too.

## Regression fence

The bug only existed because no test exercised tasklist-sync with a healthy UUID issue id. Add one:

- A task file with `linearIssueId: "9b2f4c3e-..."` (valid UUIDv4) must reach the merge logic — i.e. `summary.skippedStaleId === 0` and the issue-id is added to the `byIssue` map.

## Acceptance criteria

1. `planr linear tasklist-sync` no longer skips task files with valid UUID issue ids.
2. Task files with truly broken ids (e.g. `ENG42`, `not-a-uuid`) still skip with `skippedStaleId++`.
3. New regression test prevents the false-positive from coming back.
4. No behavioral change on the push side or the status-table mapping (those paths already had the right shape — Gap D fix).

## Out of scope

- Refactoring the two id-shape validators into one. They are conceptually distinct (issue vs workflow state); the issue-side validator should accept UUID **or** identifier shape; the workflow-state-side should remain UUID-only. Today's bug is the order in which they're called, not the validators themselves.

## Size estimate

~10 minutes — delete 6 lines, add a 5-line regression test, run the quad-check.

## Cross-references

- **BL-014** — bidirectional TASK status / state aggregation. BL-016 is a prerequisite for BL-014's pull-side slice; without this fix, no tasklist-sync run reaches the aggregation logic.
- **Gap D fix** in [`src/services/linear-mapping-service.ts:17-19`](src/services/linear-mapping-service.ts:17) — same root cause, fixed only in the status-table path.

---
_Promote to agile hierarchy: `planr backlog promote BL-016 --quick`_
_Close when done: `planr backlog close BL-016`_
