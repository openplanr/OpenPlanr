---
id: "US-075"
title: "planr linear status — mapping-table viewer"
featureId: "FEAT-019"
created: "2026-04-22"
updated: "2026-04-22"
status: "planning"
---

# US-075: planr linear status — mapping-table viewer

**Feature:** [FEAT-019](../features/FEAT-019-linear-integration-command-interface.md)

## User Story
**As a** developer
**I want to** see which OpenPlanr artifacts are mapped to which Linear items
**So that** I can debug drift between my local plan and Linear before running a push or sync

## Acceptance Criteria
See [US-075-gherkin.feature](./US-075-gherkin.feature) for detailed Gherkin scenarios.

## Additional Notes
Reads every artifact under `.planr/` and prints a table of (OpenPlanr id → Linear identifier → Linear URL → last-seen status). Zero API calls — the view is purely from local frontmatter. Artifacts with no `linear*Id` in frontmatter show as "(not pushed)". Invalid / stale Linear IDs are flagged but not repaired here; the fix path is `planr linear push` or `planr linear sync`.

## Tasks
- [TASK-019: Tasks for FEAT-019: Linear Integration Command Interface](../tasks/TASK-019-tasks-for-feat-019-linear-integration-command-interface.md)
