---
id: "US-026"
title: "Archive reports via GitHub integration"
featureId: "FEAT-008"
created: "2026-04-18"
updated: "2026-04-18"
status: "done"
---

# US-026: Archive reports via GitHub integration

**Feature:** [FEAT-008](../features/FEAT-008-multi-format-delivery-distribution.md)

## User Story
**As a** developer
**I want to** dated files under `.planr/reports` and optional GitHub issue push
**So that** there is a durable trail tied to the repo

## Acceptance Criteria
Specifications in [US-026-gherkin.feature](./US-026-gherkin.feature). Scenarios tagged `@v1` are satisfied by the current CLI; `@v2` marks deferred enhancements.

## Additional Notes
`--push github` creates an issue. Native git commits without issues are @v2.

## Tasks
- [TASK-008](../tasks/TASK-008-tasks-for-feat-008-multi-format-delivery-distribution.md)
