---
id: "US-038"
title: "Clean Git Tree Requirement with Override"
featureId: "FEAT-011"
created: "2026-04-21"
updated: "2026-04-21"
status: "planning"
---

# US-038: Clean Git Tree Requirement with Override

**Feature:** [FEAT-011](../features/FEAT-011-safety-gates-and-atomic-write-system.md)

## User Story
**As a** As a developer using planr revise
**I want to** I want the system to require a clean git tree before making changes
**So that** So that I can safely rollback if something goes wrong and avoid mixing revision changes with uncommitted work

## Acceptance Criteria
See [US-038-gherkin.feature](./US-038-gherkin.feature) for detailed Gherkin scenarios.

## Additional Notes
Should check git status and refuse to run with dirty tree unless --allow-dirty flag is provided.

## Tasks
- [TASK-011: Tasks for FEAT-011: Safety Gates and Atomic Write System](../tasks/TASK-011-tasks-for-feat-011-safety-gates-and-atomic-write-system.md)
