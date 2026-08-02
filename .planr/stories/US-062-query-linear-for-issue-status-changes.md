---
id: "US-062"
title: "Query Linear for issue status changes"
featureId: "FEAT-017"
created: "2026-04-21"
updated: "2026-04-21"
status: "planning"
---

# US-062: Query Linear for issue status changes

**Feature:** [FEAT-017](../features/FEAT-017-issue-status-bidirectional-sync.md)

## User Story
**As a** product manager
**I want to** detect when issue statuses change in Linear
**So that** my local planning artifacts stay synchronized with Linear workflow updates

## Acceptance Criteria
See [US-062-gherkin.feature](./US-062-gherkin.feature) for detailed Gherkin scenarios.

## Additional Notes
Use Linear GraphQL API to query issues modified since last sync timestamp. Store sync timestamps in artifact frontmatter or separate sync state file.

## Tasks
- [TASK-017: Tasks for FEAT-017: Issue Status Bidirectional Sync](../tasks/TASK-017-tasks-for-feat-017-issue-status-bidirectional-sync.md)
