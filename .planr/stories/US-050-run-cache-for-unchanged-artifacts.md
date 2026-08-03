---
id: "US-050"
title: "Run cache for unchanged artifacts"
featureId: "FEAT-014"
created: "2026-04-21"
updated: "2026-04-21"
status: "planning"
---

# US-050: Run cache for unchanged artifacts

**Feature:** [FEAT-014](../features/FEAT-014-performance-and-usability-enhancements.md)

## User Story
**As a** As a developer
**I want to** I want caching to avoid re-processing unchanged artifacts
**So that** So that revision runs are 80% faster when most artifacts haven't changed

## Acceptance Criteria
See [US-050-gherkin.feature](./US-050-gherkin.feature) for detailed Gherkin scenarios.

## Additional Notes
Cache invalidation must account for artifact dependencies and file modification times. Cache key should include artifact content hash and dependency hashes.

## Tasks
- [TASK-014: Tasks for FEAT-014: Performance and Usability Enhancements](../tasks/TASK-014-tasks-for-feat-014-performance-and-usability-enhancements.md)
