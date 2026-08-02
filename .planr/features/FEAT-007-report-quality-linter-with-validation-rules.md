---
id: "FEAT-007"
title: "Report Quality Linter with Validation Rules"
epicId: "EPIC-002"
owner: "Engineering"
created: "2026-04-18"
updated: "2026-04-18"
status: "done"
---

# FEAT-007: Report Quality Linter with Validation Rules

**Epic:** [EPIC-002](../epics/EPIC-002-stakeholder-reporting-pm-intelligence-layer.md)

## Overview

Acts as a 'linter for status reports' that validates report quality before delivery. Catches vague language, missing evidence, and informationally useless content to ensure professional output.

## Functional Requirements

- Validate reports against configurable quality rules
- Detect vague language patterns and suggest improvements
- Ensure minimum evidence backing for claims
- Check for actionable content and clear deliverable status
- Provide coaching feedback to improve future reports

## User Stories

- [US-021: Validate reports with configurable quality rules](../stories/US-021-validate-reports-with-configurable-quality-rules.md)
- [US-022: Detect vague language patterns and suggest improvements](../stories/US-022-detect-vague-language-patterns-and-suggest-improvements.md)
- [US-023: Provide coaching feedback to improve future reports](../stories/US-023-provide-coaching-feedback-to-improve-future-reports.md)

## Dependencies

Report Generation Engine

## Technical Considerations

Implement rule engine with configurable validation patterns, integrate with AI provider for language analysis

## Risks

Rule complexity may create false positives, overly strict validation may frustrate users

## Success Metrics

Catches 90%+ of informationally useless updates, user acceptance of linter suggestions >80%, reduced stakeholder follow-up questions