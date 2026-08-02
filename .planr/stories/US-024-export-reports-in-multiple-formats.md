---
id: "US-024"
title: "Export reports in multiple formats"
featureId: "FEAT-008"
created: "2026-04-18"
updated: "2026-04-18"
status: "done"
---

# US-024: Export reports in multiple formats

**Feature:** [FEAT-008](../features/FEAT-008-multi-format-delivery-distribution.md)

## User Story
**As a** project manager
**I want to** Markdown and HTML stakeholder outputs with an explicit message when PDF is requested
**So that** I can share in standard formats today

## Acceptance Criteria
Specifications in [US-024-gherkin.feature](./US-024-gherkin.feature). Scenarios tagged `@v1` are satisfied by the current CLI; `@v2` marks deferred enhancements.

## Additional Notes
v1 ships markdown + html. `--format pdf` exits with a clear “not bundled” error.

## Tasks
- [TASK-008](../tasks/TASK-008-tasks-for-feat-008-multi-format-delivery-distribution.md)
