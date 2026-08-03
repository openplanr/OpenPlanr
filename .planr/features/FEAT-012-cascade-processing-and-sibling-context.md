---
id: "FEAT-012"
title: "Cascade Processing and Sibling Context"
epicId: "EPIC-003"
owner: "Engineering"
created: "2026-04-21"
updated: "2026-04-21"
status: "done"
---

# FEAT-012: Cascade Processing and Sibling Context

**Epic:** [EPIC-003](../epics/EPIC-003-plan-revision-layer-revise-command.md)

## Overview
Enables top-down cascade revision (epic → features → stories → tasks) with sibling artifact context and grouped audit logging. Ensures children see revised parent content during processing.

## Functional Requirements

- Implement top-down cascade ordering for artifact revision
- Add sibling context gathering for related artifacts at same hierarchy level
- Create audit log grouping by cascade level and artifact type, with **immediate per-entry flush** to disk (not batched at end) so the on-disk audit always reflects exactly what was written
- Build **graceful mid-cascade interrupt**: Ctrl+C and `[q]uit` stop the cascade cleanly — any in-flight atomic write completes so no artifact is left partially written, already-applied artifacts stay applied, not-yet-processed artifacts stay untouched. **No cascade-level transactional rollback in v1** — FEAT-013's post-flight graph check + git rollback is the corrective if a partial cascade leaves the graph inconsistent.
- Add progress tracking and status reporting during cascade
- Implement cascade-aware context building that includes revised parent content

## User Stories

- [US-041: Top-down cascade ordering for artifact revision](../stories/US-041-top-down-cascade-ordering-for-artifact-revision.md)
- [US-042: Sibling context gathering for related artifacts](../stories/US-042-sibling-context-gathering-for-related-artifacts.md)
- [US-043: Audit log grouping by cascade level and artifact type](../stories/US-043-audit-log-grouping-by-cascade-level-and-artifact-type.md)
- [US-044: Mid-cascade graceful interrupt with audit flush](../stories/US-044-mid-cascade-graceful-interrupt-with-audit-flush.md)
- [US-045: Progress tracking and status reporting during cascade](../stories/US-045-progress-tracking-and-status-reporting-during-cascade.md)

## Dependencies
Safety gates system, artifact-service for hierarchy traversal, existing context-builder

## Technical Considerations
Sibling context needs memory management for large artifact sets (an epic with many stories can generate a sibling pack that competes with codebase context for the token budget).

## Risks
Cascade failures could leave part of the hierarchy written and part unwritten; FEAT-013's post-flight graph-integrity check + git rollback is the corrective. Memory / token usage could spike with large sibling sets; FEAT-014's token budget guards are the corrective.

## Success Metrics
Top-down cascade processes artifacts in correct dependency order. Mid-cascade failures trigger proper cleanup.
