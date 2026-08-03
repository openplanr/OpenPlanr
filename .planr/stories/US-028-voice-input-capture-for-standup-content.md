---
id: "US-028"
title: "Voice Input Capture for Standup Content"
featureId: "FEAT-009"
created: "2026-04-18"
updated: "2026-04-18"
status: "done"
---

# US-028: Voice Input Capture for Standup Content

**Feature:** [FEAT-009](../features/FEAT-009-standup-dictation-mode.md)

## User Story
**As a** developer
**I want to** supply standup text from a transcript file or stdin
**So that** I can pair OpenPlanr with any STT or OS dictation workflow

## Acceptance Criteria
Specifications in [US-028-gherkin.feature](./US-028-gherkin.feature). Scenarios tagged `@v1` are satisfied by the current CLI; `@v2` marks deferred enhancements.

## Additional Notes
Bundled microphone capture is @v2. Entry point: `planr voice standup --file`.

## Tasks
- [TASK-009](../tasks/TASK-009-tasks-for-feat-009-standup-dictation-mode.md)
