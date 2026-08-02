---
id: "US-046"
title: "Repository-wide revision with --all flag and safety limits"
featureId: "FEAT-013"
created: "2026-04-21"
updated: "2026-04-21"
status: "planning"
---

# US-046: Repository-wide revision with --all flag and safety limits

**Feature:** [FEAT-013](../features/FEAT-013-bulk-operations-and-graph-integrity.md)

## User Story
**As a** As a developer
**I want to** I want to run planr revise --all to revise all artifacts in my repository
**So that** So that I can keep my entire planning hierarchy aligned with codebase changes in one operation

## Acceptance Criteria
See [US-046-gherkin.feature](./US-046-gherkin.feature) for detailed Gherkin scenarios.

## Additional Notes
Must implement max_writes_per_run safety limit with configurable threshold to prevent runaway operations. Should respect existing cascade ordering.

## Tasks
- [TASK-013: Tasks for FEAT-013: Bulk Operations and Graph Integrity](../tasks/TASK-013-tasks-for-feat-013-bulk-operations-and-graph-integrity.md)
