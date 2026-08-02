---
id: "US-031"
title: "Quality Validation for Dictated Standups"
featureId: "FEAT-009"
created: "2026-04-18"
updated: "2026-04-18"
status: "done"
---

# US-031: Quality Validation for Dictated Standups

**Feature:** [FEAT-009](../features/FEAT-009-standup-dictation-mode.md)

## User Story
**As a** developer
**I want to** `planr voice standup --lint` and `planr story standup --lint`
**So that** voice-generated standups meet the same quality checks as typed reports

## Acceptance Criteria
Specifications in [US-031-gherkin.feature](./US-031-gherkin.feature). Scenarios tagged `@v1` are satisfied by the current CLI; `@v2` marks deferred enhancements.

## Additional Notes
Reuses `report-linter-service` with report type `standup`.

## Tasks
- [TASK-009](../tasks/TASK-009-tasks-for-feat-009-standup-dictation-mode.md)
