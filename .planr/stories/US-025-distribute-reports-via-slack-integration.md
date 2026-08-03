---
id: "US-025"
title: "Distribute reports via Slack integration"
featureId: "FEAT-008"
created: "2026-04-18"
updated: "2026-04-18"
status: "done"
---

# US-025: Distribute reports via Slack integration

**Feature:** [FEAT-008](../features/FEAT-008-multi-format-delivery-distribution.md)

## User Story
**As a** team lead
**I want to** post summaries to Slack via Incoming Webhooks
**So that** the channel gets updates without manual paste

## Acceptance Criteria
Specifications in [US-025-gherkin.feature](./US-025-gherkin.feature). Scenarios tagged `@v1` are satisfied by the current CLI; `@v2` marks deferred enhancements.

## Additional Notes
Set `distribution.slackWebhookUrl`. Use `planr report … --push slack`. `--dry-run` is webhook-optional.

## Tasks
- [TASK-008](../tasks/TASK-008-tasks-for-feat-008-multi-format-delivery-distribution.md)
