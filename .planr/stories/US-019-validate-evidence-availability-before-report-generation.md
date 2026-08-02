---
id: "US-019"
title: "Validate evidence availability before report generation"
featureId: "FEAT-006"
created: "2026-04-18"
updated: "2026-04-18"
status: "done"
---

# US-019: Validate evidence availability before report generation

**Feature:** [FEAT-006](../features/FEAT-006-evidence-linked-claims-system.md)

## User Story
**As a** developer
**I want to** warnings when GitHub or evidence looks weak or unreachable
**So that** I do not silently ship broken credibility

## Acceptance Criteria
Specifications in [US-019-gherkin.feature](./US-019-gherkin.feature). Scenarios tagged `@v1` are satisfied by the current CLI; `@v2` marks deferred enhancements.

## Additional Notes
`planr export` adds a flat evidence index; the report command logs GitHub reachability hints.

## Tasks
- [TASK-006](../tasks/TASK-006-tasks-for-feat-006-evidence-linked-claims-system.md)
