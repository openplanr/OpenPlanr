---
id: "US-014"
title: "Generate reports using Handlebars templates"
featureId: "FEAT-005"
created: "2026-04-18"
updated: "2026-04-18"
status: "done"
---

# US-014: Generate reports using Handlebars templates

**Feature:** [FEAT-005](../features/FEAT-005-report-generation-engine-with-template-system.md)

## User Story
**As a** developer
**I want to** generate stakeholder reports from planr artifacts using Handlebars templates
**So that** I can ship consistent updates without hand-formatting each week

## Acceptance Criteria
Specifications in [US-014-gherkin.feature](./US-014-gherkin.feature). Scenarios tagged `@v1` are satisfied by the current CLI; `@v2` marks deferred enhancements.

## Additional Notes
CLI: `planr report <type>`. Templates: `src/templates/reports/*.md.hbs`. Options: `--no-github`, `--sprint`, `--format html|markdown`.

## Tasks
- [TASK-005](../tasks/TASK-005-tasks-for-feat-005-report-generation-engine-with-template-system.md)
