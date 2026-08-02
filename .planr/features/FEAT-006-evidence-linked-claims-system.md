---
id: "FEAT-006"
title: "Evidence-Linked Claims System"
epicId: "EPIC-002"
owner: "Engineering"
created: "2026-04-18"
updated: "2026-04-18"
status: "done"
---

# FEAT-006: Evidence-Linked Claims System

**Epic:** [EPIC-002](../epics/EPIC-002-stakeholder-reporting-pm-intelligence-layer.md)

## Overview

Ensures every statement in generated reports links to traceable evidence sources like commits, PRs, or planr artifacts. Prevents unsupported claims and builds stakeholder trust through transparency.

## Functional Requirements

- Link every report claim to at least one evidence source
- Support evidence types: commits, PRs, planr artifacts, sprint data
- Generate clickable links to source materials in reports
- Validate evidence availability before including claims
- Provide evidence summary tooltips in HTML reports

## User Stories

- [US-018: Link report claims to evidence sources](../stories/US-018-link-report-claims-to-evidence-sources.md)
- [US-019: Validate evidence availability before report generation](../stories/US-019-validate-evidence-availability-before-report-generation.md)
- [US-020: Display evidence summaries in HTML reports](../stories/US-020-display-evidence-summaries-in-html-reports.md)

## Dependencies

GitHub service integration, planr artifact system

## Technical Considerations

Implement evidence tracking in report data model, extend GitHub service for deep linking

## Risks

Evidence links may break if repositories are moved or made private

## Success Metrics

100% of report claims have evidence links, evidence validation prevents broken links, stakeholder feedback confirms trust improvement