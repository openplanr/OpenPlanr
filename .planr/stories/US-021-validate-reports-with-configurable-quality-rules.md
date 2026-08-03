---
id: "US-021"
title: "Validate reports with configurable quality rules"
featureId: "FEAT-007"
created: "2026-04-18"
updated: "2026-04-18"
status: "done"
---

# US-021: Validate reports with configurable quality rules

**Feature:** [FEAT-007](../features/FEAT-007-report-quality-linter-with-validation-rules.md)

## User Story
**As a** developer
**I want to** `planr report --lint` and `planr report-linter` with configurable rules
**So that** vague language and weak structure are caught before send

## Acceptance Criteria
Specifications in [US-021-gherkin.feature](./US-021-gherkin.feature). Scenarios tagged `@v1` are satisfied by the current CLI; `@v2` marks deferred enhancements.

## Additional Notes
Optional `reportLinter` in `.planr/config.json` merges with service defaults.

## Tasks
- [TASK-007](../tasks/TASK-007-tasks-for-feat-007-report-quality-linter-with-validation-rules.md)
