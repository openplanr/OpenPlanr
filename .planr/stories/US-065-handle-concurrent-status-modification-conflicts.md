---
id: "US-065"
title: "Gracefully handle missing or stale Linear IDs during status sync"
featureId: "FEAT-017"
created: "2026-04-21"
updated: "2026-04-22"
status: "planning"
---

# US-065: Gracefully handle missing or stale Linear IDs during status sync

**Feature:** [FEAT-017](../features/FEAT-017-issue-status-bidirectional-sync.md)

## User Story
**As a** product manager
**I want to** have status sync skip (not fail) on artifacts that have missing or stale `linearIssueId` frontmatter
**So that** one bad pointer doesn't abort the whole sync and I can see which artifacts need re-pushing

## Acceptance Criteria
See [US-065-gherkin.feature](./US-065-gherkin.feature) for detailed Gherkin scenarios.

## Additional Notes
Re-scoped (2026-04-22) from "concurrent status conflict resolution" — FEAT-017 is one-way (Linear → OpenPlanr) in v1, so Linear is the source of truth for Linear-side state and there is no conflict to resolve. This story now covers the robustness case: an artifact's `linearIssueId` is missing (never pushed) or references an issue Linear can no longer find (deleted / wrong team). Expected behavior: log at warn, skip that artifact, continue the sync, surface counts in the summary.

## Tasks
- [TASK-017: Tasks for FEAT-017: Issue Status Bidirectional Sync](../tasks/TASK-017-tasks-for-feat-017-issue-status-bidirectional-sync.md)
