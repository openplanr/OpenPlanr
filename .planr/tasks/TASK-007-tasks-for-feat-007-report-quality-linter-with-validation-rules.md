---

## id: "TASK-007"
title: "Tasks for FEAT-007: Report Quality Linter with Validation Rules"
featureId: "FEAT-007"
created: "2026-04-18"
updated: "2026-04-18"
status: "done"

# TASK-007: Tasks for FEAT-007: Report Quality Linter with Validation Rules

**Feature:** [FEAT-007](../features/FEAT-007-report-quality-linter-with-validation-rules.md)

## Artifact Sources

- **User Story:** `.planr/stories/US-021`
- **User Story:** `.planr/stories/US-022`
- **User Story:** `.planr/stories/US-023`
- **Gherkin:** `.planr/stories/US-021-gherkin.feature`
- **Gherkin:** `.planr/stories/US-022-gherkin.feature`
- **Gherkin:** `.planr/stories/US-023-gherkin.feature`

## Tasks

- **1.0** Create report linter types and interfaces
  - 1.1 Add report linter types to src/models/types.ts (ValidationRule, LintResult, CoachingFeedback, QualityReport interfaces)
  - 1.2 Add report linter configuration schema to src/models/schema.ts with zod validation
- **2.0** Implement core validation rule engine
  - 2.1 Create src/services/report-linter-service.ts with validateReport() function and configurable rule loading
  - 2.2 Implement vague language detection patterns (progress, almost done, working on) with specific alternatives
  - 2.3 Add evidence validation to check for linked commits, artifacts, and measurable claims
- **3.0** Build coaching feedback system
  - 3.1 Add coaching history tracking in src/services/report-linter-service.ts with pattern analysis
  - 3.2 Implement personalized feedback generation based on recurring issues and improvements
  - 3.3 Add educational context for first-time users and positive reinforcement for improvements
- **4.0** Create report linter command interface
  - 4.1 Create src/cli/commands/report-linter.ts following the pattern in src/cli/commands/quick.ts
  - 4.2 Register report linter command in src/cli/index.ts using registerReportLinterCommand()
  - 4.3 Add validation output formatting with specific suggestions and coaching messages
- **5.0** Create linter configuration templates
  - 5.1 Create src/templates/linter/linter-config.json.hbs with default validation rules
  - 5.2 Add vague language dictionary with phrase patterns and specific alternatives

## Acceptance Criteria Mapping

Paired Gherkin (`US-021`–`US-023`) uses `@v1` for configurable rules + coaching strings; persistent per-user coaching history is `@v2`.

- The report passes validation with no warnings (US-021) → Tasks 2.1, 2.3
- The linter flags vague language and suggests specific alternatives (US-021) → Tasks 2.2, 4.3
- The linter requires evidence backing for each claim (US-021) → Tasks 2.3, 4.3
- It suggests 'Completed 3 of 5 user stories, blocked on API integration' (US-022) → Tasks 2.2, 5.2
- It suggests 'Implementation 90% complete, remaining: error handling and tests' (US-022) → Tasks 2.2, 5.2
- It accepts the specific, measurable language without suggestions (US-022) → Tasks 2.1, 2.2
- It includes educational context about why specific language is preferred (US-023) → Tasks 3.3, 4.3
- It provides targeted coaching on that specific communication pattern (US-023) → Tasks 3.1, 3.2
- It acknowledges the improvement and encourages continued progress (US-023) → Tasks 3.2, 3.3

## Relevant Files

- `src/models/types.ts` — Add report linter interfaces and types for validation rules, lint results, and coaching feedback
- `src/models/schema.ts` — Add zod validation schemas for report linter configuration
- `src/services/report-linter-service.ts` — Core service implementing validation rule engine, coaching feedback, and pattern analysis
- `src/cli/commands/report-linter.ts` — Command interface for running report validation and displaying results
- `src/cli/index.ts` — Register the new report linter command following existing pattern
- `src/templates/linter/linter-config.json.hbs` — Default configuration template with validation rules and vague language patterns

## Notes

*Mark tasks complete by checking the boxes above. Use your coding agent (Claude Code, Cursor, Codex) with the generated rules for context-aware implementation.*