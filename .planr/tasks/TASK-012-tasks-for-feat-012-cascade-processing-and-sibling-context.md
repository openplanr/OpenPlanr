---
id: "TASK-012"
title: "Tasks for FEAT-012: Cascade Processing and Sibling Context"

featureId: "FEAT-012"
created: "2026-04-21"
updated: "2026-04-21"
status: "done"
---

# TASK-012: Tasks for FEAT-012: Cascade Processing and Sibling Context


**Feature:** [FEAT-012](../features/FEAT-012-cascade-processing-and-sibling-context.md)

## Artifact Sources

- **User Story:** `.planr/stories/US-041`
- **User Story:** `.planr/stories/US-042`
- **User Story:** `.planr/stories/US-043`
- **User Story:** `.planr/stories/US-044`
- **User Story:** `.planr/stories/US-045`
- **Gherkin:** `.planr/stories/US-041-gherkin.feature`
- **Gherkin:** `.planr/stories/US-042-gherkin.feature`
- **Gherkin:** `.planr/stories/US-043-gherkin.feature`
- **Gherkin:** `.planr/stories/US-044-gherkin.feature`
- **Gherkin:** `.planr/stories/US-045-gherkin.feature`

## Tasks

- [x] **1.0** Cascade Processing Core Infrastructure
  - [x] 1.1 Add cascade types to src/models/types.ts for CascadeLevel, CascadeContext, and CascadeProgress interfaces
  - [x] 1.2 Create cascade-service.ts with buildCascadeOrder() function for top-down hierarchy ordering (epic → features → stories → tasks). The artifact hierarchy is a strict tree — no cycle detection needed.
  - [x] 1.3 Add cascade flag to existing revise command in src/cli/commands/revise.ts
- [x] **2.0** Sibling Context System
  - [x] 2.1 Add sibling context gathering to existing context-builder.ts with memory-efficient metadata loading
  - [x] 2.2 Implement lazy loading for large sibling sets in context-builder.ts to prevent memory overflow
  - [x] 2.3 Add sibling context to existing buildRevisePrompt() in src/ai/prompts/prompt-builder.ts
- [x] **3.0** Audit Log Grouping
  - [x] 3.1 Add cascade-aware grouping to existing audit log types in src/models/types.ts
  - [x] 3.2 Modify existing audit log generation to group by cascade level and artifact type
  - [x] 3.3 Add summary statistics per group to audit log output
- [x] **4.0** Graceful interrupt + audit flush (**no rollback here — FEAT-013's post-flight mechanism is the corrective for partial cascades that break the graph**)
  - [x] 4.1 Immediate per-entry audit flush: write each audit log entry to disk as it is produced (not batched at cascade end), so the on-disk audit always reflects exactly what was written
  - [x] 4.2 Implement SIGINT handler in cascade-service.ts: let any in-flight atomic write complete, then stop before the next artifact; record a final "interrupted by user (SIGINT)" audit entry with the exact count of applied artifacts
  - [x] 4.3 Wire the `[q]uit` option from FEAT-011's confirmation menu into cascade-service.ts: `q` stops the cascade cleanly with an "interrupted by user (q)" audit entry; no further artifacts are prompted for
  - [x] 4.4 On mid-cascade agent error, record the failing artifact with action "failed" in the audit and stop the cascade (no auto-retry or auto-skip in v1); exit with a non-zero code so CI detects the partial run
- [x] **5.0** Progress Tracking
  - [x] 5.1 Add progress tracking types to src/models/types.ts with current/total counts and time estimation
  - [x] 5.2 Implement progress display in cascade-service.ts showing current artifact and overall completion
  - [x] 5.3 Add time estimation based on processing rate for remaining cascade work

## Acceptance Criteria Mapping

- [ ] The epic is revised first, then features see the revised epic content, then stories see revised feature content (US-041) → Tasks 1.2, 1.3
- [ ] It maintains strict top-down ordering: feature → stories → tasks (US-041) → Tasks 1.2
- [ ] It receives context from Feature-1, Feature-3, Feature-4, and Feature-5 as sibling context (US-042) → Tasks 2.1, 2.3
- [ ] Only essential sibling metadata is loaded, not full content, to prevent memory overflow (US-042) → Tasks 2.2
- [ ] It processes normally with empty sibling context and logs the absence (US-042) → Tasks 2.1
- [ ] The audit log shows three distinct groups: Epic (1 item), Features (3 items), Stories (8 items) (US-043) → Tasks 3.1, 3.2
- [ ] The audit log groups stories and tasks separately even though they're at the same hierarchy level (US-043) → Tasks 3.2
- [ ] The audit log includes empty groups for levels with no artifacts to process (US-043) → Tasks 3.2, 3.3
- [ ] User quits at a diff prompt: cascade stops cleanly, already-applied artifacts stay applied, audit records "interrupted by user (q)" (US-044) → Tasks 4.1, 4.3
- [ ] SIGINT during cascade: in-flight atomic write completes, cascade stops, audit records "interrupted by user (SIGINT)" (US-044) → Tasks 4.1, 4.2
- [ ] Mid-cascade agent error: failing artifact recorded as "failed", cascade stops, exit code non-zero (US-044) → Tasks 4.1, 4.4
- [ ] Successful cascade: all artifacts applied, audit captures every decision, no rollback triggered (US-044) → Tasks 4.1
- [ ] Partial cascade that breaks the graph: FEAT-013's post-flight rollback restores via git checkout (US-044) → handled in TASK-013 §4.0, referenced here for traceability
- [ ] Progress updates show 'Processing Feature 3/5' and 'Overall: 8/26 artifacts completed' (US-045) → Tasks 5.2
- [ ] The progress display shows an estimated 3 minutes remaining based on current processing rate (US-045) → Tasks 5.3
- [ ] Progress tracking shows it's resuming from artifact 6 and adjusts total progress accordingly (US-045) → Tasks 5.1, 5.2

## Relevant Files

- `src/models/types.ts` — Add cascade processing types, progress tracking interfaces, and audit log grouping types
- `src/services/cascade-service.ts` — New service for cascade ordering, graceful interrupt (SIGINT + `[q]uit` handlers), immediate audit flush, and progress tracking. No rollback logic — that is owned by TASK-013 §4.0.
- `src/ai/codebase/context-builder.ts` — Add sibling context gathering with memory-efficient metadata loading
- `src/ai/prompts/prompt-builder.ts` — Include sibling context in revise prompts
- `src/cli/commands/revise.ts` — Add cascade flag and integrate cascade processing

## Notes
_Mark tasks complete by checking the boxes above. Use your coding agent (Claude Code, Cursor, Codex) with the generated rules for context-aware implementation._
