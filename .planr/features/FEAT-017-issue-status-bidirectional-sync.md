---
id: "FEAT-017"
title: "Issue Status Sync (Linear → OpenPlanr)"
epicId: "EPIC-004"
owner: "Engineering"
created: "2026-04-21"
updated: "2026-04-19"
status: "done"
---

# FEAT-017: Issue Status Sync (Linear → OpenPlanr)

**Epic:** [EPIC-004](../epics/EPIC-004-linear-integration-full-hierarchy-push-bidirectional-sync.md)

## Overview
One-way status sync: when the user runs `planr linear sync`, pull the current Linear workflow state for every mapped Feature and Story, map it to an OpenPlanr `TaskStatus` value, and update the artifact's `status` frontmatter when drift is detected. No reverse direction in v1 — editing status locally does not push to Linear. TaskList issues are excluded; task completion flows through FEAT-018's checkbox sync instead.

**Shipped:** `planr linear sync`, `src/services/linear-status-sync-service.ts`, `linear.pushStateIds` for `planr linear push` (FEAT-016), `linear.statusMap` for pull overrides + built-in defaults. Version via Changesets.

## Functional Requirements

- Query Linear issues for current workflow state during `planr linear sync` runs
- Map Linear workflow states to OpenPlanr `TaskStatus` values — default: `Backlog` / `Todo` → `pending`, `In Progress` → `in-progress`, `Done` / `Canceled` → `done`
- Allow per-project status-map overrides via `linear.statusMap` in `.planr/config.json` for teams with custom workflows
- Update artifact frontmatter `status` field atomically when drift is detected (Features and Stories only)
- Log and skip (not fail) unknown Linear workflow states that aren't in the map
- Explicitly NOT in v1: OpenPlanr → Linear status push, webhook-driven updates, real-time sync — all user-triggered via `planr linear sync`

## User Stories

- [US-062: Query Linear for issue status changes](../stories/US-062-query-linear-for-issue-status-changes.md)
- [US-063: Map Linear workflow states to OpenPlanr status values](../stories/US-063-map-linear-workflow-states-to-openplanr-status-values.md)
- [US-064: Update OpenPlanr frontmatter with Linear status changes](../stories/US-064-update-openplanr-frontmatter-with-linear-status-changes.md)
- [US-065: Handle concurrent status modification conflicts](../stories/US-065-handle-concurrent-status-modification-conflicts.md)

## Dependencies
FEAT-016 (Four-Level Hierarchy Push) for Linear ID storage in frontmatter

## Technical Considerations
Pull-based polling via `planr linear sync` (user-triggered). No webhook server. Frontmatter parsing and atomic updates reuse existing `artifact-service.ts` primitives.

## Risks
Unmapped Linear workflow states silently no-op, leaving artifacts out-of-sync — mitigated by logging every unmapped state at warn level. Large projects may hit Linear rate limits during a single sync pass — mitigated by request batching + exponential backoff.

## Success Metrics
When user runs `planr linear sync`, every mapped Feature/Story whose Linear state diverged from its local `status` field is reconciled in one pass with no errors; unmapped states are logged and left untouched.
