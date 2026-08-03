---
id: "US-018"
title: "Link report claims to evidence sources"
featureId: "FEAT-006"
created: "2026-04-18"
updated: "2026-04-18"
status: "done"
---

# US-018: Link report claims to evidence sources

**Feature:** [FEAT-006](../features/FEAT-006-evidence-linked-claims-system.md)

## User Story
**As a** developer
**I want to** an evidence appendix with artifacts, commits, and PR links
**So that** stakeholders can verify statements

## Acceptance Criteria
Specifications in [US-018-gherkin.feature](./US-018-gherkin.feature). Scenarios tagged `@v1` are satisfied by the current CLI; `@v2` marks deferred enhancements.

## Additional Notes
Use `--strict-evidence` to fail when bullets under `##` lack URLs or #issue references.

## Tasks
- [TASK-006](../tasks/TASK-006-tasks-for-feat-006-evidence-linked-claims-system.md)
