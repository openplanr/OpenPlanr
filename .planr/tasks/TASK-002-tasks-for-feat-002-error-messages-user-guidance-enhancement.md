---
id: "TASK-002"
title: "Tasks for FEAT-002: Error Messages & User Guidance Enhancement"

featureId: "FEAT-002"
created: "2026-04-09"
updated: "2026-04-09"
status: "pending"
---

# TASK-002: Tasks for FEAT-002: Error Messages & User Guidance Enhancement


**Feature:** [FEAT-002](../features/FEAT-002-error-messages-user-guidance-enhancement.md)

## Artifact Sources

- **User Story:** `.planr/stories/US-005`
- **User Story:** `.planr/stories/US-006`
- **User Story:** `.planr/stories/US-007`
- **Gherkin:** `.planr/stories/US-005-gherkin.feature`
- **Gherkin:** `.planr/stories/US-006-gherkin.feature`
- **Gherkin:** `.planr/stories/US-007-gherkin.feature`

## Tasks

- [x] **1.0** Audit and catalog existing error messages
  - [x] 1.1 Scan all command files in src/cli/commands/ for error messages and console.error() calls
  - [x] 1.2 Audit src/services/ files for thrown errors and validation messages
  - [x] 1.3 Create error message inventory JSON file with location, current text, and context
  - [x] 1.4 Categorize messages by type (validation, file operations, command errors, configuration)
- [x] **2.0** Create error message standardization utilities
  - [ ] 2.1 Add ErrorMessage interface and formatting functions to src/models/types.ts
  - [ ] 2.2 Create src/utils/error-messages.ts with standardized error formatting functions
  - [ ] 2.3 Add context-aware error message builder with operation type and suggested actions
- [ ] **3.0** Implement standardized error format across command handlers
  - [ ] 3.1 Update src/cli/commands/epic.ts to use standardized error messages with next-step guidance
  - [ ] 3.2 Update src/cli/commands/feature.ts to use standardized error messages with next-step guidance
  - [ ] 3.3 Update src/cli/commands/story.ts to use standardized error messages with next-step guidance
  - [ ] 3.4 Update src/cli/commands/task.ts to use standardized error messages with next-step guidance
  - [ ] 3.5 Update src/cli/commands/quick.ts to use standardized error messages with next-step guidance
  - [ ] 3.6 Update remaining command files to use standardized error format
- [ ] **4.0** Add context-specific help suggestions
  - [ ] 4.1 Enhance artifact-service.ts error handling with operation context and suggested commands
  - [ ] 4.2 Add progressive error disclosure for validation errors with common fixes first
  - [ ] 4.3 Implement command-specific guidance for invalid options and syntax errors
  - [ ] 4.4 Add file operation context to suggest creating missing dependencies
- [ ] **5.0** Update service layer error handling
  - [ ] 5.1 Enhance src/services/config-service.ts ConfigNotFoundError with setup guidance
  - [ ] 5.2 Update src/services/ai-service.ts error messages with troubleshooting steps
  - [ ] 5.3 Improve src/services/credentials-service.ts error messages with credential setup guidance

## Acceptance Criteria Mapping

- [ ] I should have a complete inventory of all error messages with their locations and current text (US-005) → Tasks 1.1, 1.2, 1.3
- [ ] I should have categories like validation errors, file errors, and command errors (US-005) → Tasks 1.4
- [ ] It should follow the standard format with problem description and next step (US-006) → Tasks 2.1, 2.2, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6
- [ ] It should use plain language and avoid technical jargon (US-006) → Tasks 2.3, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6
- [ ] The message should suggest creating the feature first with the specific command (US-007) → Tasks 4.1, 4.4
- [ ] It should show the most common fix first, with option to see advanced solutions (US-007) → Tasks 4.2
- [ ] The message should show the correct syntax and available options for that specific command (US-007) → Tasks 4.3

## Relevant Files

- `src/models/types.ts` — Add ErrorMessage interface and error formatting types
- `src/utils/error-messages.ts` — Create standardized error message formatting utilities
- `src/cli/commands/epic.ts` — Update error handling to use standardized format with actionable guidance
- `src/cli/commands/feature.ts` — Update error handling to use standardized format with actionable guidance
- `src/cli/commands/story.ts` — Update error handling to use standardized format with actionable guidance
- `src/cli/commands/task.ts` — Update error handling to use standardized format with actionable guidance
- `src/cli/commands/quick.ts` — Update error handling to use standardized format with actionable guidance
- `src/services/artifact-service.ts` — Enhance error handling with operation context and suggested commands
- `src/services/config-service.ts` — Enhance ConfigNotFoundError with setup guidance and actionable next steps
- `src/services/ai-service.ts` — Update error messages with troubleshooting steps and plain language guidance
- `src/services/credentials-service.ts` — Improve error messages with credential setup guidance and specific commands

## Notes
_Mark tasks complete by checking the boxes above. Use your coding agent (Claude Code, Cursor, Codex) with the generated rules for context-aware implementation._
