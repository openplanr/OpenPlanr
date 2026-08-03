---
id: "FEAT-008"
title: "Multi-format Delivery & Distribution"
epicId: "EPIC-002"
owner: "Engineering"
created: "2026-04-18"
updated: "2026-04-18"
status: "done"
---

# FEAT-008: Multi-format Delivery & Distribution

**Epic:** [EPIC-002](../epics/EPIC-002-stakeholder-reporting-pm-intelligence-layer.md)

## Overview
Delivers reports in multiple formats (Markdown, HTML, PDF) and distributes them through various channels (GitHub, Slack, email). Ensures stakeholders receive reports in their preferred format and location.

**v1 scope:** Markdown + HTML from `planr report`, files under `.planr/reports/`, Slack via Incoming Webhook (`--push slack`, `--dry-run` without a secret), GitHub issue push (`--push github`). PDF rendering and SMTP are deferred; the CLI returns explicit guidance. See `@v1` / `@v2` in `US-024`–`US-027` Gherkin.

## Functional Requirements

- Export reports as Markdown, HTML, and PDF formats
- Integrate with Slack for automated report posting
- Support GitHub integration for report archiving
- Enable email distribution with formatted attachments
- Maintain consistent formatting across all output formats

## User Stories

- [US-024: Export reports in multiple formats](../stories/US-024-export-reports-in-multiple-formats.md)
- [US-025: Distribute reports via Slack integration](../stories/US-025-distribute-reports-via-slack-integration.md)
- [US-026: Archive reports via GitHub integration](../stories/US-026-archive-reports-via-github-integration.md)
- [US-027: Send reports via email distribution](../stories/US-027-send-reports-via-email-distribution.md)

## Dependencies
Report Generation Engine, existing integration patterns

## Technical Considerations
Implement format converters, extend existing service patterns for new integrations

## Risks
Format conversion may lose fidelity, integration authentication complexity

## Success Metrics
All formats render correctly, integrations work reliably, stakeholder adoption of automated distribution
