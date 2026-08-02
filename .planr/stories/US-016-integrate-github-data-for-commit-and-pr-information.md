---
id: "US-016"
title: "Integrate GitHub data for commit and PR information"
featureId: "FEAT-005"
created: "2026-04-18"
updated: "2026-04-18"
status: "done"
---

# US-016: Integrate GitHub data for commit and PR information

**Feature:** [FEAT-005](../features/FEAT-005-report-generation-engine-with-template-system.md)

## User Story
**As a** developer
**I want to** pull recent commits and PRs into reports via the GitHub CLI
**So that** progress claims align with repository activity

## Acceptance Criteria
Specifications in [US-016-gherkin.feature](./US-016-gherkin.feature). Scenarios tagged `@v1` are satisfied by the current CLI; `@v2` marks deferred enhancements.

## Additional Notes
Uses `gh api`. Warnings may appear if data is missing. Use `--no-github` to skip network calls.

## Tasks
- [TASK-005](../tasks/TASK-005-tasks-for-feat-005-report-generation-engine-with-template-system.md)
