---
id: "QT-001"
title: "OpenPlanr v1.3 Security, DX & Code Quality Hardening Implementation"
created: "2026-04-09"
updated: "2026-04-09"
status: "pending"
---

# QT-001: OpenPlanr v1.3 Security, DX & Code Quality Hardening Implementation

## Tasks

- [ ] **1.0** Prompt Architecture Hardening
  - [ ] 1.1 Add input boundary delimiters to all prompt builders in prompt-builder.ts
  - [ ] 1.2 Create wrapUserInput() helper function in prompt-builder.ts for consistent input wrapping
  - [ ] 1.3 Add input length validation with MAX_INPUT_CHARS constant in prompt-builder.ts
  - [ ] 1.4 Add 'Full Coverage' section to TASKS_SYSTEM_PROMPT in system-prompts.ts
  - [ ] 1.5 Add 'Full Coverage' section to QUICK_TASKS_SYSTEM_PROMPT in system-prompts.ts
  - [ ] 1.6 Create appendCodebaseContext() helper function in prompt-builder.ts
  - [ ] 1.7 Update buildQuickTasksPrompt() to use new input wrapping and validation
  - [ ] 1.8 Update buildTasksPrompt() to use new input wrapping and validation
  - [ ] 1.9 Update all other prompt builders to use wrapUserInput() helper
- [ ] **2.0** Error Messages & User Guidance Enhancement
  - [ ] 2.1 Create suggestCommand() helper in new error-hints.ts file
  - [ ] 2.2 Audit and enhance error messages in backlog.ts command
  - [ ] 2.3 Audit and enhance error messages in checklist.ts command
  - [ ] 2.4 Audit and enhance error messages in config.ts command
  - [ ] 2.5 Audit and enhance error messages in epic.ts command
  - [ ] 2.6 Audit and enhance error messages in estimate.ts command
  - [ ] 2.7 Audit and enhance error messages in export.ts command
  - [ ] 2.8 Audit and enhance error messages in feature.ts command
  - [ ] 2.9 Audit and enhance error messages in github.ts command
  - [ ] 2.10 Audit and enhance error messages in init.ts command
  - [ ] 2.11 Audit and enhance error messages in plan.ts command
  - [ ] 2.12 Audit and enhance error messages in quick.ts command
  - [ ] 2.13 Audit and enhance error messages in refine.ts command
  - [ ] 2.14 Audit and enhance error messages in rules.ts command
  - [ ] 2.15 Audit and enhance error messages in search.ts command
  - [ ] 2.16 Audit and enhance error messages in sprint.ts command
  - [ ] 2.17 Audit and enhance error messages in status.ts command
  - [ ] 2.18 Audit and enhance error messages in story.ts command
  - [ ] 2.19 Audit and enhance error messages in sync.ts command
  - [ ] 2.20 Audit and enhance error messages in task.ts command
  - [ ] 2.21 Audit and enhance error messages in template.ts command
  - [ ] 2.22 Standardize 'not found' error patterns across all artifact types
- [ ] **3.0** Shared Utilities & Code Deduplication
  - [ ] 3.1 Create format.ts utility file with colorByPercent() function
  - [ ] 3.2 Remove colorByPercent() duplication from sprint.ts command
  - [ ] 3.3 Remove colorByPercent() duplication from status.ts command
  - [ ] 3.4 Create shared artifact listing/filtering helper in format.ts
  - [ ] 3.5 Refactor plan.ts to use shared artifact listing helper
  - [ ] 3.6 Refactor feature.ts to use shared artifact listing helper
  - [ ] 3.7 Refactor story.ts to use shared artifact listing helper
  - [ ] 3.8 Refactor task.ts to use shared artifact listing helper
  - [ ] 3.9 Refactor backlog.ts to use shared artifact listing helper
  - [ ] 3.10 Refactor sprint.ts to use shared artifact listing helper
  - [ ] 3.11 Refactor status.ts to use shared artifact listing helper
  - [ ] 3.12 Refactor sync.ts to use shared artifact listing helper
  - [ ] 3.13 Ensure plan.ts uses handleAIError() from task-creation.ts
  - [ ] 3.14 Ensure feature.ts uses handleAIError() from task-creation.ts
  - [ ] 3.15 Ensure story.ts uses handleAIError() from task-creation.ts
  - [ ] 3.16 Parallelize sequential listArtifacts() calls in sprint.ts with Promise.all()
  - [ ] 3.17 Parallelize sequential listArtifacts() calls in sync.ts with Promise.all()
- [ ] **4.0** Test Coverage for Command Handlers
  - [ ] 4.1 Create unit test file for plan command (Epic → Features → Stories → Tasks flow)
  - [ ] 4.2 Add test cases for plan command orchestration logic (583 lines)
  - [ ] 4.3 Create unit test file for sprint commands (create, add, status, close, velocity)
  - [ ] 4.4 Add test cases for sprint velocity calculation logic
  - [ ] 4.5 Add test cases for sprint status transitions and validation
  - [ ] 4.6 Create unit test file for github sync commands (push, pull, conflict resolution)
  - [ ] 4.7 Add test cases for bidirectional sync logic (531 lines)
  - [ ] 4.8 Add test cases for github conflict resolution workflows
  - [ ] 4.9 Create unit test file for estimate command
  - [ ] 4.10 Add test cases for Fibonacci scoring logic (476 lines)
  - [ ] 4.11 Add test cases for estimation aggregation and reporting
  - [ ] 4.12 Create unit test file for backlog commands (add, prioritize, promote)
  - [ ] 4.13 Add test cases for backlog promotion logic across artifact types
  - [ ] 4.14 Add test cases for backlog prioritization workflows
  - [ ] 4.15 Update coverage thresholds from 14% to 40% in test configuration
- [ ] **5.0** Magic Numbers & Constants Cleanup
  - [ ] 5.1 Move AI temperature constant (0.5) to named constant in ai-service.ts
  - [ ] 5.2 Move max context chars (48,000) to named constant in context-builder.ts
  - [ ] 5.3 Move max file size (50,000) to named constant in file-reader.ts
  - [ ] 5.4 Move max snippet size (3,000) to named constant in context-builder.ts
  - [ ] 5.5 Document TOKEN_BUDGETS reasoning in types.ts with inline comments
  - [ ] 5.6 Add temperature configuration per command type in types.ts
  - [ ] 5.7 Update ai-service.ts to use configurable temperature based on command type
  - [ ] 5.8 Add constants documentation section to types.ts explaining magic number choices
- [ ] **6.0** JSDoc & Internal Documentation
  - [ ] 6.1 Add JSDoc to exported functions in ai-service.ts
  - [ ] 6.2 Add JSDoc to exported functions in artifact-service.ts (createArtifact, listArtifacts, readArtifact, etc.)
  - [ ] 6.3 Add JSDoc to exported functions in config-service.ts (loadConfig, saveConfig, findProjectRoot)
  - [ ] 6.4 Add JSDoc to exported functions in id-service.ts (getNextId, parseId)
  - [ ] 6.5 Add JSDoc to exported functions in template-service.ts
  - [ ] 6.6 Add JSDoc to exported functions in github-service.ts
  - [ ] 6.7 Add JSDoc to exported functions in credentials-service.ts
  - [ ] 6.8 Add JSDoc to exported functions in checklist-service.ts
  - [ ] 6.9 Add JSDoc to exported functions in artifact-gathering.ts
  - [ ] 6.10 Add JSDoc to exported functions in prompt-service.ts
  - [ ] 6.11 Add JSDoc to exported functions in interactive-state.ts
  - [ ] 6.12 Document velocity calculation algorithm inline in sprint.ts around line 600
  - [ ] 6.13 Document artifact filename resolution regex logic in artifact-service.ts
  - [ ] 6.14 Document task promotion cross-cutting logic in relevant command files
  - [ ] 6.15 Add module-level comments to ai-service.ts explaining service responsibility
  - [ ] 6.16 Add module-level comments to artifact-service.ts explaining service responsibility
  - [ ] 6.17 Add module-level comments to config-service.ts explaining service responsibility
  - [ ] 6.18 Add module-level comments to remaining service files explaining their responsibilities
- [ ] **7.0** File Size & Input Guards
  - [ ] 7.1 Add MAX_INPUT_FILE_SIZE constant to constants.ts (500KB limit)
  - [ ] 7.2 Add file size validation for --file argument in epic.ts command
  - [ ] 7.3 Add file size validation for --file argument in quick.ts command
  - [ ] 7.4 Add content type validation for --file arguments in epic.ts
  - [ ] 7.5 Add content type validation for --file arguments in quick.ts
  - [ ] 7.6 Add truncation warning in context-builder.ts when exceeding MAX_CONTEXT_CHARS
  - [ ] 7.7 Create file validation helper function in fs.ts for reuse across commands
  - [ ] 7.8 Update commands to use shared file validation helper

## Relevant Files

- `src/ai/prompts/prompt-builder.ts` — Add input boundary delimiters, validation, and helper functions for consistent prompt construction
- `src/ai/prompts/system-prompts.ts` — Add 'Full Coverage' sections to task generation prompts for completeness enforcement
- `src/cli/helpers/error-hints.ts` — Create new helper for consistent error message guidance patterns
- `src/cli/commands/backlog.ts` — Enhance error messages with actionable guidance and use shared utilities
- `src/cli/commands/checklist.ts` — Enhance error messages with actionable guidance
- `src/cli/commands/config.ts` — Enhance error messages with actionable guidance
- `src/cli/commands/epic.ts` — Enhance error messages and add file size validation for --file arguments
- `src/cli/commands/estimate.ts` — Enhance error messages with actionable guidance
- `src/cli/commands/export.ts` — Enhance error messages with actionable guidance
- `src/cli/commands/feature.ts` — Enhance error messages, use shared utilities, and ensure handleAIError usage
- `src/cli/commands/github.ts` — Enhance error messages with actionable guidance
- `src/cli/commands/init.ts` — Enhance error messages with actionable guidance
- `src/cli/commands/plan.ts` — Enhance error messages, use shared utilities, and ensure handleAIError usage
- `src/cli/commands/quick.ts` — Enhance error messages and add file size validation for --file arguments
- `src/cli/commands/refine.ts` — Enhance error messages with actionable guidance
- `src/cli/commands/rules.ts` — Enhance error messages with actionable guidance
- `src/cli/commands/search.ts` — Enhance error messages with actionable guidance
- `src/cli/commands/sprint.ts` — Remove code duplication, enhance error messages, parallelize I/O, and document velocity calculation
- `src/cli/commands/status.ts` — Remove code duplication and enhance error messages
- `src/cli/commands/story.ts` — Enhance error messages, use shared utilities, and ensure handleAIError usage
- `src/cli/commands/sync.ts` — Enhance error messages, use shared utilities, and parallelize I/O operations
- `src/cli/commands/task.ts` — Enhance error messages and use shared utilities
- `src/cli/commands/template.ts` — Enhance error messages with actionable guidance
- `src/utils/format.ts` — Create new utility file for shared formatting functions like colorByPercent and artifact listing
- `src/ai/types.ts` — Document TOKEN_BUDGETS reasoning, add temperature configuration, and constants documentation
- `src/ai/codebase/context-builder.ts` — Move magic numbers to named constants and add truncation warnings
- `src/ai/codebase/file-reader.ts` — Move magic numbers to named constants
- `src/services/ai-service.ts` — Move magic numbers to named constants, add JSDoc, and implement configurable temperature
- `src/services/artifact-service.ts` — Add comprehensive JSDoc documentation and document filename resolution logic
- `src/services/config-service.ts` — Add comprehensive JSDoc documentation
- `src/services/id-service.ts` — Add comprehensive JSDoc documentation
- `src/services/template-service.ts` — Add comprehensive JSDoc documentation
- `src/services/github-service.ts` — Add comprehensive JSDoc documentation
- `src/services/credentials-service.ts` — Add comprehensive JSDoc documentation
- `src/services/checklist-service.ts` — Add comprehensive JSDoc documentation
- `src/services/artifact-gathering.ts` — Add comprehensive JSDoc documentation
- `src/services/prompt-service.ts` — Add comprehensive JSDoc documentation
- `src/services/interactive-state.ts` — Add comprehensive JSDoc documentation
- `src/utils/constants.ts` — Add MAX_INPUT_FILE_SIZE constant for file validation
- `src/utils/fs.ts` — Add file validation helper function for size and content type checking
- `tests/unit/commands/plan.test.ts` — Create comprehensive unit tests for plan command orchestration logic
- `tests/unit/commands/sprint.test.ts` — Create comprehensive unit tests for sprint commands and velocity calculation
- `tests/unit/commands/github.test.ts` — Create comprehensive unit tests for github sync and conflict resolution
- `tests/unit/commands/estimate.test.ts` — Create comprehensive unit tests for estimate command and Fibonacci scoring
- `tests/unit/commands/backlog.test.ts` — Create comprehensive unit tests for backlog commands and promotion logic

## Notes
_Mark tasks complete by checking the boxes above. Use your coding agent (Claude Code, Cursor, Codex) with the generated rules for context-aware implementation._
_To move this into your agile hierarchy, run `planr quick promote QT-001 --story <storyId>`._
