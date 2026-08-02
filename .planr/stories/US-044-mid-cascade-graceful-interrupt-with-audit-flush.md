---
id: "US-044"
title: "Mid-cascade graceful interrupt with audit flush"
featureId: "FEAT-012"
created: "2026-04-21"
updated: "2026-04-21"
status: "planning"
---

# US-044: Mid-cascade graceful interrupt with audit flush

**Feature:** [FEAT-012](../features/FEAT-012-cascade-processing-and-sibling-context.md)

## User Story
**As a** developer running a cascade revision
**I want** Ctrl+C and `[q]uit` to stop the cascade gracefully while keeping already-applied artifacts applied
**So that** I can walk away from a long cascade mid-flight without losing completed work or corrupting the repo

## Acceptance Criteria
See [US-044-gherkin.feature](./US-044-gherkin.feature) for detailed Gherkin scenarios.

## Additional Notes
**This story deliberately does not implement cascade-level transactional rollback.** Already-applied artifacts stay applied, not-yet-processed artifacts stay untouched, and the audit log flushes each entry immediately (not at end) so the on-disk audit reflects exactly what was written. If the partial cascade leaves the artifact graph broken, FEAT-013's post-flight graph check + git rollback is the corrective — that is the only "rollback" mechanism in v1.

## Tasks
- [TASK-012: Tasks for FEAT-012: Cascade Processing and Sibling Context](../tasks/TASK-012-tasks-for-feat-012-cascade-processing-and-sibling-context.md)
