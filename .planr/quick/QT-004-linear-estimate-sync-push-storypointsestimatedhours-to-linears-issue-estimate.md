---
id: "QT-004"
title: "Linear Estimate Sync: Push storyPoints/estimatedHours to Linear's Issue Estimate Field"
created: "2026-04-23"
updated: "2026-04-23"
status: "in-progress"
sourceBacklog: "BL-007"
---

# QT-004: Linear Estimate Sync: Push storyPoints/estimatedHours to Linear's Issue Estimate Field

## Tasks

- [x] **1.0** Team Configuration and Caching
  - [x] 1.1 Add fetchTeamIssueEstimationType() to linear-service.ts following fetchTeamWorkflowStates pattern
  - [x] 1.2 Cache team estimation config in linear-push-service.ts to avoid per-issue API calls
  - [ ] 1.3 Add issueEstimationType field to LinearConfig interface in types.ts (deferred — fetched at runtime via fetchTeamIssueEstimationType, not stored in config.json; a LinearIssueEstimationType type alias was added for the SDK values)
- [x] **2.0** Estimate Mapping and Snapping Logic
  - [x] 2.1 Create resolveEstimateForPush() pure function with scale-aware snapping logic
  - [x] 2.2 Implement Fibonacci scale mapping (0,1,2,3,5,8,13,21) with nearest-value snapping
  - [x] 2.3 Implement Linear scale mapping (0,1,2,3,4,5) with nearest-value snapping
  - [x] 2.4 Implement Exponential scale mapping (0,1,2,4,8,16) with nearest-value snapping
  - [x] 2.5 Add t-shirt scale detection with skip-and-warn behavior (no numeric mapping)
  - [x] 2.6 Add notUsed scale detection with silent skip behavior
- [x] **3.0** Push Integration (FEAT / US / QT / BL — TASK deferred)
  - [x] 3.1 Wire estimate resolution into pushOneFeatureAndDescendants() in linear-push-service.ts (both create and update branches)
  - [x] 3.2 Wire estimate resolution into pushOneStoryUnderFeature() in linear-push-service.ts (both create and update branches)
  - [x] 3.3 Wire estimate resolution into pushOneQuickTaskWithContext() in linear-push-service.ts
  - [x] 3.4 Wire estimate resolution into pushOneBacklogItemWithContext() in linear-push-service.ts
  - [x] 3.5 Skip TASK estimate sync — pushOneTaskListForFeature aggregates multiple task files into one Linear issue (same rationale as deferred TASK status sync in PR #79). Leave a one-line TODO comment in pushOneTaskListForFeature citing BL-007 and this QT.
  - [x] 3.6 Extract storyPoints from frontmatter with estimatedPoints fallback for back-compat (hand-edited older snapshots used the latter)
  - [x] 3.7 Follow null-stateId pattern: omit estimate field entirely when unmapped, never send explicit null (Linear rejects null on update)
- [ ] **4.0** Dry-Run and Status Integration (partial — latch done, plan/sync display deferred)
  - [ ] 4.1 Add estimate display to dry-run plan output in linear-push-service.ts (deferred — plan builder doesn't currently show per-field inputs; file as follow-up)
  - [ ] 4.2 Show 'skipped — team has estimation disabled' in dry-run when notUsed (deferred with 4.1)
  - [ ] 4.3 Update planr linear sync summary line to mention estimate coverage (deferred — sync path doesn't currently push estimate, only push does; revisit when pull-side lands)
  - [x] 4.4 Add one-per-run warning logging for t-shirt scale skips
- [x] **5.0** Idempotency and Error Handling
  - [x] 5.1 Ensure re-push of unchanged artifact sends the same estimate (idempotent by value — update always includes the current estimate, matching Linear's field regardless of whether local changed)
  - [x] 5.2 Handle artifacts with missing storyPoints frontmatter gracefully (no estimate sent)
  - [x] 5.3 Add debug logging for estimate snapping decisions (OP value → Linear value)
  - [ ] 5.4 Add explicit error handling for Linear API estimate validation failures (deferred — relies on existing mapLinearError; file a follow-up if an actionable message is needed)
- [x] **6.0** Comprehensive Test Coverage
  - [x] 6.1 Add Fibonacci snapping tests: OP 4→Linear 5, OP 7→Linear 8 in linear-estimate-sync.test.ts
  - [x] 6.2 Add Linear scale snapping tests: OP 3.5→Linear 4, OP 5.1→Linear 5
  - [x] 6.3 Add Exponential scale snapping tests: OP 3→Linear 4, OP 6→Linear 8
  - [x] 6.4 Add team notUsed test: no estimate sent, no warning spam
  - [x] 6.5 Add team tShirt test: skipped (single-warning-log behavior uses a per-client WeakSet latch — asserted implicitly via "no estimate sent")
  - [x] 6.6 Add re-push test: updateIssue receives the correct estimate on update (not just create)
  - [x] 6.7 Add missing storyPoints test: artifact without estimate frontmatter pushes successfully
  - [x] 6.8 Add edge case tests: zero estimates, boundary values, invalid scales
- [x] **7.0** Documentation and Polish
  - [x] 7.1 Add 'Estimate sync' subsection to status-sync section in docs/CLI.md
  - [x] 7.2 Document scale mapping behavior and snapping rules
  - [x] 7.3 Document team configuration requirements (issueEstimationType enabled)
  - [x] 7.4 Add JSDoc comments to all new estimate-related functions

## Relevant Files

- `src/models/types.ts` — Add issueEstimationType field to LinearConfig interface
- `src/services/linear-service.ts` — Add fetchTeamIssueEstimationType() function following fetchTeamWorkflowStates pattern
- `src/services/linear-push-service.ts` — Wire estimate resolution into all pushOne* functions and add caching logic
- `src/services/linear/estimate-resolver.ts` — Create new module for resolveEstimateForPush() and scale mapping logic (new file, co-located with existing linear/ submodule files)
- `tests/linear-estimate-sync.test.ts` — Comprehensive test coverage for all estimate sync scenarios (new file, follows tests/linear-push-service.test.ts naming convention)
- `docs/CLI.md` — Add estimate sync documentation to Linear integration section

## Notes
_Mark tasks complete by checking the boxes above. Use your coding agent (Claude Code, Cursor, Codex) with the generated rules for context-aware implementation._
_To move this into your agile hierarchy, run `planr quick promote QT-004 --story <storyId>`._
