---
id: "TASK-005"
title: "Tasks for FEAT-005: Report Generation Engine with Template System"
featureId: "FEAT-005"
created: "2026-04-18"
updated: "2026-04-18"
status: "done"
---

# TASK-005: Tasks for FEAT-005: Report Generation Engine with Template System

**Feature:** [FEAT-005](../features/FEAT-005-report-generation-engine-with-template-system.md)

## Artifact Sources

- **User Story:** `.planr/stories/US-014`
- **User Story:** `.planr/stories/US-015`
- **User Story:** `.planr/stories/US-016`
- **User Story:** `.planr/stories/US-017`
- **Gherkin:** `.planr/stories/US-014-gherkin.feature`
- **Gherkin:** `.planr/stories/US-015-gherkin.feature`
- **Gherkin:** `.planr/stories/US-016-gherkin.feature`
- **Gherkin:** `.planr/stories/US-017-gherkin.feature`

## Tasks

- **1.0** Core Report Types and Data Models
  - 1.1 Add report types and interfaces to src/models/types.ts
  - 1.2 Create report data collection interfaces for 6 report types
- **2.0** Report Generation Service
  - 2.1 Create src/services/report-service.ts with core generation logic
  - 2.2 Implement data collection for each report type using existing artifact-service
  - 2.3 Add GitHub data integration using existing github-service patterns
- **3.0** Report Templates
  - 3.1 Create src/templates/reports/ directory with 6 report type templates
  - 3.2 Implement template customization support in template-service
- **4.0** Report Command Implementation
  - 4.1 Create src/cli/commands/report.ts following existing command patterns
  - 4.2 Register report command in src/cli/index.ts
  - 4.3 Add error handling for missing templates and GitHub API limits

## Acceptance Criteria Mapping

Paired Gherkin (`.planr/stories/US-014-gherkin.feature` … `US-017-gherkin.feature`) tags scenarios `@v1` when the current `planr report` CLI satisfies them.

- A formatted report is generated using the template and artifact data (US-014) → Tasks 2.1, 2.2, 3.1, 4.1
- I receive a clear error message indicating the missing template (US-014) → Tasks 4.3
- A report is generated with placeholder content indicating no data available (US-014) → Tasks 2.2, 3.1
- The report contains sprint progress, completed stories, and blockers (US-015) → Tasks 1.2, 2.2, 3.1
- The report contains project status, key metrics, and strategic updates (US-015) → Tasks 1.2, 2.2, 3.1
- The report contains this week's accomplishments, next week's plans, and risks (US-015) → Tasks 1.2, 2.2, 3.1
- The report shows relevant commit messages and authors (US-016) → Tasks 2.3
- The report shows PR titles, status, and review progress (US-016) → Tasks 2.3
- The report uses cached data or shows a warning about stale GitHub information (US-016) → Tasks 2.3, 4.3
- The report includes our company logo, colors, and formatting standards (US-017) → Tasks 3.2
- The report uses our custom sections instead of defaults (US-017) → Tasks 3.2
- I receive a clear error message indicating the template syntax issue (US-017) → Tasks 4.3

## Relevant Files

- `src/models/types.ts` — Add report type definitions and interfaces
- `src/services/report-service.ts` — Core report generation logic and data collection
- `src/services/template-service.ts` — Extend to support template customization
- `src/templates/reports/sprint-report.md.hbs` — Sprint report template
- `src/templates/reports/weekly-report.md.hbs` — Weekly report template
- `src/templates/reports/executive-report.md.hbs` — Executive report template
- `src/templates/reports/standup-report.md.hbs` — Standup report template
- `src/templates/reports/retrospective-report.md.hbs` — Retrospective report template
- `src/templates/reports/release-notes-report.md.hbs` — Release notes report template
- `src/cli/commands/report.ts` — Report command implementation
- `src/cli/index.ts` — Register report command

## Notes

*Mark tasks complete by checking the boxes above. Use your coding agent (Claude Code, Cursor, Codex) with the generated rules for context-aware implementation.*