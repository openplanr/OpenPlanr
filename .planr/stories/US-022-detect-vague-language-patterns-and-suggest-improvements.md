---
id: "US-022"
title: "Detect vague language patterns and suggest improvements"
featureId: "FEAT-007"
created: "2026-04-18"
updated: "2026-04-18"
status: "done"
---

# US-022: Detect vague language patterns and suggest improvements

**Feature:** [FEAT-007](../features/FEAT-007-report-quality-linter-with-validation-rules.md)

## User Story
**As a** developer
**I want to** the linter to flag low-signal phrases with concrete alternatives
**So that** status updates stay measurable

## Acceptance Criteria
Specifications in [US-022-gherkin.feature](./US-022-gherkin.feature). Scenarios tagged `@v1` are satisfied by the current CLI; `@v2` marks deferred enhancements.

## Additional Notes
Default phrase list is code-defined; override via `reportLinter.vaguePhrases`.

## Tasks
- [TASK-007](../tasks/TASK-007-tasks-for-feat-007-report-quality-linter-with-validation-rules.md)
