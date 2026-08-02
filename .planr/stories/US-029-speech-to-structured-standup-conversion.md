---
id: "US-029"
title: "Speech-to-Structured Standup Conversion"
featureId: "FEAT-009"
created: "2026-04-18"
updated: "2026-04-18"
status: "done"
---

# US-029: Speech-to-Structured Standup Conversion

**Feature:** [FEAT-009](../features/FEAT-009-standup-dictation-mode.md)

## User Story
**As a** developer
**I want to** heuristic parsing into Yesterday / Today / Blockers
**So that** dictation becomes the same shape as typed standups

## Acceptance Criteria
Specifications in [US-029-gherkin.feature](./US-029-gherkin.feature). Scenarios tagged `@v1` are satisfied by the current CLI; `@v2` marks deferred enhancements.

## Additional Notes
Implemented in `standup-parser.ts` with `segments` for future audio offsets.

## Tasks
- [TASK-009](../tasks/TASK-009-tasks-for-feat-009-standup-dictation-mode.md)
