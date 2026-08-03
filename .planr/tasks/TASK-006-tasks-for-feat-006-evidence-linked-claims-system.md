---
id: "TASK-006"
title: "Tasks for FEAT-006: Evidence-Linked Claims System"
featureId: "FEAT-006"
created: "2026-04-18"
updated: "2026-04-18"
status: "done"
---

# TASK-006: Tasks for FEAT-006: Evidence-Linked Claims System

**Feature:** [FEAT-006](../features/FEAT-006-evidence-linked-claims-system.md)

## Artifact Sources

- **User Story:** `.planr/stories/US-018`
- **User Story:** `.planr/stories/US-019`
- **User Story:** `.planr/stories/US-020`
- **Gherkin:** `.planr/stories/US-018-gherkin.feature`
- **Gherkin:** `.planr/stories/US-019-gherkin.feature`
- **Gherkin:** `.planr/stories/US-020-gherkin.feature`

## Tasks

- **1.0** Extend type system for evidence linking
  - 1.1 Add evidence types and claim interfaces to src/models/types.ts
  - 1.2 Define evidence validation and summary interfaces
- **2.0** Implement evidence service for source management
  - 2.1 Create evidence service for linking claims to sources (commits, PRs, artifacts)
  - 2.2 Implement evidence validation to check accessibility of sources
  - 2.3 Add evidence summary generation for tooltips and previews
- **3.0** Extend GitHub service for deep linking
  - 3.1 Add commit and PR metadata retrieval to src/services/github-service.ts
  - 3.2 Implement repository accessibility validation
- **4.0** Update report templates with evidence support
  - 4.1 Modify src/templates/export/planning-report.html.hbs to include evidence links and tooltips
  - 4.2 Update src/templates/export/planning-report.md.hbs to include evidence references
- **5.0** Integrate evidence validation into report generation
  - 5.1 Add evidence validation step to existing report generation workflow
  - 5.2 Implement claim rejection for missing evidence sources

## Acceptance Criteria Mapping

Paired Gherkin (`US-018`–`US-020`) marks `@v1` vs `@v2`; rich HTML hover tooltips beyond link labels are deferred (`US-020`).

- The claim includes a clickable link to the relevant commit (US-018) → Tasks 2.1, 3.1, 4.1, 4.2
- Both evidence links are included with the claim (US-018) → Tasks 2.1, 4.1, 4.2
- The system rejects the claim and requests evidence (US-018) → Tasks 5.2
- All evidence links are included and functional (US-019) → Tasks 2.2, 5.1
- The system warns about inaccessible evidence and suggests alternatives (US-019) → Tasks 2.2, 3.2
- The system identifies the missing artifact and prevents report generation (US-019) → Tasks 2.2, 5.1
- A tooltip displays the commit message and timestamp (US-020) → Tasks 2.3, 3.1, 4.1
- The evidence summary shows the PR title and description excerpt (US-020) → Tasks 2.3, 3.1, 4.1
- Key artifact details are displayed without requiring navigation (US-020) → Tasks 2.3, 4.1

## Relevant Files

- `src/models/types.ts` — Add evidence types, claim interfaces, and validation structures
- `src/services/evidence-service.ts` — New service for managing evidence links, validation, and summaries
- `src/services/github-service.ts` — Extend with commit/PR metadata retrieval and accessibility validation
- `src/templates/export/planning-report.html.hbs` — Add evidence link rendering and tooltip support for HTML reports
- `src/templates/export/planning-report.md.hbs` — Add evidence reference formatting for Markdown reports

## Notes

*Mark tasks complete by checking the boxes above. Use your coding agent (Claude Code, Cursor, Codex) with the generated rules for context-aware implementation.*