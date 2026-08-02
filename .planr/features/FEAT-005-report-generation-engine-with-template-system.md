---
id: "FEAT-005"
title: "Report Generation Engine with Template System"
epicId: "EPIC-002"
owner: "Engineering"
created: "2026-04-18"
updated: "2026-04-18"
status: "done"
---

# FEAT-005: Report Generation Engine with Template System

**Epic:** [EPIC-002](../epics/EPIC-002-stakeholder-reporting-pm-intelligence-layer.md)

## Overview

Core engine that generates structured reports from planr artifacts using configurable templates. Supports 6 report types (Sprint, Weekly, Executive, Standup, Retrospective, Release Notes) with consistent formatting and evidence linking.

## Functional Requirements

- Generate reports from existing planr artifacts using Handlebars templates
- Support 6 distinct report types with type-specific data collection
- Allow template customization and organization-specific branding
- Integrate with GitHub service to pull commit and PR data
- Generate reports in under 30 seconds for typical project scope

## User Stories

- [US-014: Generate reports using Handlebars templates](../stories/US-014-generate-reports-using-handlebars-templates.md)
- [US-015: Support 6 distinct report types with type-specific data](../stories/US-015-support-6-distinct-report-types-with-type-specific-data.md)
- [US-016: Integrate GitHub data for commit and PR information](../stories/US-016-integrate-github-data-for-commit-and-pr-information.md)
- [US-017: Customize templates with organization branding](../stories/US-017-customize-templates-with-organization-branding.md)

## Dependencies

Existing planr artifact hierarchy, GitHub service integration, Handlebars template system

## Technical Considerations

Extend existing template infrastructure, reuse GitHub service patterns, implement caching for performance

## Risks

Template complexity may impact generation speed, GitHub API rate limits for large projects

## Success Metrics

Report generation completes in <30 seconds, templates render without errors, all 6 report types functional