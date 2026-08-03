---
id: "US-035"
title: "Build revise service for single-artifact dry-run processing"
featureId: "FEAT-010"
created: "2026-04-21"
updated: "2026-04-21"
status: "planning"
---

# US-035: Build revise service for single-artifact dry-run processing

**Feature:** [FEAT-010](../features/FEAT-010-core-revise-engine-with-decision-schema.md)

## User Story
**As a** As a developer
**I want to** I want to process single artifacts for revision decisions
**So that** So that I can test revision logic before implementing full cascade

## Acceptance Criteria
See [US-035-gherkin.feature](./US-035-gherkin.feature) for detailed Gherkin scenarios.

## Additional Notes
Service should use buildRevisePrompt, call AI with decision schema, and return structured decisions without modifying files. Focus on dry-run capability only.

## Tasks
- [TASK-010: Tasks for FEAT-010: Core Revise Engine with Decision Schema](../tasks/TASK-010-tasks-for-feat-010-core-revise-engine-with-decision-schema.md)
