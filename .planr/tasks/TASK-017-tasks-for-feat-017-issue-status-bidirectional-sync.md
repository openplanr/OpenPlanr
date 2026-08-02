---
id: "TASK-017"
title: "Tasks for FEAT-017: Issue Status Bidirectional Sync"

featureId: "FEAT-017"
created: "2026-04-21"
updated: "2026-04-19"
status: "done"
---

# TASK-017: Tasks for FEAT-017: Issue Status Bidirectional Sync


**Feature:** [FEAT-017](../features/FEAT-017-issue-status-bidirectional-sync.md)

## Artifact Sources

- **User Story:** `.planr/stories/US-062`
- **User Story:** `.planr/stories/US-063`
- **User Story:** `.planr/stories/US-064`
- **User Story:** `.planr/stories/US-065`
- **Gherkin:** `.planr/stories/US-062-gherkin.feature`
- **Gherkin:** `.planr/stories/US-063-gherkin.feature`
- **Gherkin:** `.planr/stories/US-064-gherkin.feature`
- **Gherkin:** `.planr/stories/US-065-gherkin.feature`

## Tasks

- [x] **1.0** Linear API Integration for Status Queries
  - [x] 1.1 Add Linear GraphQL client call in `src/services/linear-service.ts` to fetch issue state for a set of known issue ids (the ones stored in OpenPlanr frontmatter)
  - [x] 1.2 Implement batched lookup (N ids → one GraphQL request) to stay well under Linear rate limits
  - [x] 1.3 Add exponential-backoff retry wrapper for 429 responses
- [x] **2.0** Status Mapping Configuration
  - [x] 2.1 Add `linear.statusMap` to the config schema in `src/models/schema.ts` — keys are Linear workflow state names, values are OpenPlanr `TaskStatus` (`'pending' | 'in-progress' | 'done'`)
  - [x] 2.2 Provide a default map: `Backlog`/`Todo` → `pending`, `In Progress` → `in-progress`, `Done`/`Canceled` → `done`
  - [x] 2.3 On unmapped Linear workflow state, log at warn level and skip the update (do NOT fail the run)
- [x] **3.0** Frontmatter Status Updates (Features + Stories only — TaskLists excluded)
  - [x] 3.1 Implement atomic `status` field updates via `updateArtifactFields` in `src/services/artifact-service.ts`
  - [x] 3.2 Skip artifacts whose `linearIssueId` frontmatter is missing (log at debug level) — these haven't been pushed yet
  - [x] 3.3 Preserve all other frontmatter fields and trailing newline on update (atomic write via existing `atomic-write-service.ts`)
- [x] **4.0** Sync Summary Output
  - [x] 4.1 Per-run summary line: `{N} status updates, {M} unchanged, {K} unmapped, {L} skipped (no linearIssueId)` — plus **not returned by API** for stale/deleted issues
  - [x] 4.2 Verbose mode logs every drift (artifact id, old status, new status, Linear state that triggered it)

## Acceptance Criteria Mapping

- [x] Linear issues exist with stored IDs in frontmatter and have a current workflow state — the system fetches the state for all mapped artifacts in one batched call (US-062) → Tasks 1.1, 1.2
- [x] Linear API returns 429 — the system backs off with exponential delay and retries (US-062) → Tasks 1.3
- [x] A Linear issue is in state `In Progress` — OpenPlanr `status` updates to `'in-progress'` (US-063) → Tasks 2.1, 2.2
- [x] A Linear issue is in state `Done` — OpenPlanr `status` updates to `'done'` (US-063) → Tasks 2.1, 2.2
- [x] A Linear team uses custom workflow states like `Code Review` — the system looks them up in `linear.statusMap` and applies the mapped OpenPlanr `TaskStatus` (US-063) → Tasks 2.1, 2.2
- [x] A Linear issue has a workflow state not in the map — the system logs at warn level and leaves the artifact untouched (US-063) → Tasks 2.3
- [x] A Feature has `linearIssueId` in frontmatter and its Linear state changed — the Feature's `status` frontmatter field updates atomically to the mapped value (US-064) → Tasks 3.1, 3.3
- [x] A Story has `linearIssueId` in frontmatter and its Linear state changed — the Story's `status` frontmatter field updates atomically to the mapped value (US-064) → Tasks 3.1, 3.3
- [x] A TaskList has `linearIssueId` in frontmatter — status sync SKIPS it; task completion flows through FEAT-018's checkbox sync instead (US-064) → Tasks 3.2
- [x] Note: US-065 was originally framed as "concurrent status modification conflicts" with Linear-wins/OpenPlanr-wins/manual strategies. Since v1 is one-way (Linear → OpenPlanr), there is no conflict to resolve — Linear is the source of truth for Linear-side state. US-065 should be re-scoped as "stale-id handling" (US-065) → Tasks 3.2 (skip on missing/invalid linearIssueId)

## Relevant Files

- `src/models/types.ts` — `LinearConfig`: `statusMap` (pull / overrides), `pushStateIds` (push – FEAT-016)
- `src/models/schema.ts` — `pushStateIds` and `statusMap` on `linear`
- `src/services/linear-service.ts` — `fetchLinearIssueStateNames`, `isLikelyLinearWorkflowStateId`, `withLinearRetry` on fetches
- `src/services/linear-status-sync-service.ts` — sync + default/user map
- `src/services/artifact-service.ts` — `updateArtifact` → `atomicWriteFile`
- `src/cli/commands/linear.ts` — `planr linear sync`
- `src/cli/index.ts` — (linear command already registered)

## Notes
_Mark tasks complete by checking the boxes above. Use your coding agent (Claude Code, Cursor, Codex) with the generated rules for context-aware implementation._
