---
id: "QT-003"
title: "OpenPlanr v1.3 Security, DX & Code Quality Hardening Implementation"
created: "2026-04-09"
updated: "2026-04-09"
status: "pending"
---

# QT-003: OpenPlanr v1.3 Security, DX & Code Quality Hardening Implementation

## Tasks

- [ ] **1.0** Prompt Architecture Hardening
  - [ ] 1.1 Add input boundary delimiters to all prompt builders
  - [ ] 1.2 Add input length validation before prompt construction
  - [ ] 1.3 Strengthen detailed document prompts with PRD coverage rules
  - [ ] 1.4 Add Full Coverage section to TASKS_SYSTEM_PROMPT and QUICK_TASKS_SYSTEM_PROMPT
  - [ ] 1.5 Standardize prompt structure with shared helpers wrapUserInput() and appendCodebaseContext()
- [ ] **2.0** Error Messages & User Guidance Enhancement
  - [ ] 2.1 Audit all logger.error() and logger.warn() calls across 19 command files and add actionable guidance
  - [ ] 2.2 Create suggestCommand() helper for consistent next-step hints
  - [ ] 2.3 Standardize not found errors across artifact types using consistent pattern
- [ ] **3.0** Shared Utilities & Code Deduplication
  - [ ] 3.1 Extract colorByPercent() function to src/utils/format.ts from sprint.ts and status.ts
  - [ ] 3.2 Extract shared artifact listing and filtering helper for 8+ commands with list→filter→display pattern
  - [ ] 3.3 Ensure all commands use handleAIError() from task-creation.ts for consistent error handling
  - [ ] 3.4 Parallelize sequential listArtifacts() calls with Promise.all() in sprint.ts:483 and sync.ts:94
- [ ] **4.0** Test Coverage for Command Handlers
  - [ ] 4.1 Add unit tests for plan command flow covering Epic → Features → Stories → Tasks orchestration
  - [ ] 4.2 Add unit tests for sprint commands covering create, add, status, close, and velocity calculation logic
  - [ ] 4.3 Add unit tests for github sync covering push, pull, and conflict resolution workflows
  - [ ] 4.4 Add unit tests for estimate command covering Fibonacci scoring logic
  - [ ] 4.5 Add unit tests for backlog commands covering add, prioritize, and cross-artifact promotion logic
  - [ ] 4.6 Raise coverage thresholds from 14% to 40% in test configuration
- [ ] **5.0** Magic Numbers & Constants Cleanup
  - [ ] 5.1 Move AI magic numbers (0.5 temperature, 48_000 max context, 50_000 max file size, 3_000 max snippet) to named constants
  - [ ] 5.2 Document TOKEN_BUDGETS with reasoning for why taskFeature is 32768 but epic is 8192
  - [ ] 5.3 Make temperature configurable per command type instead of hardcoded 0.5 in ai-service.ts:180
- [ ] **6.0** JSDoc & Internal Documentation
  - [ ] 6.1 Add JSDoc to all exported service functions including createArtifact(), loadConfig(), listArtifacts(), resolveArtifactFilename()
  - [ ] 6.2 Document complex algorithms inline including velocity calculation, artifact filename resolution regex, and task promotion logic
  - [ ] 6.3 Add module-level comments to all service files with 2-line responsibility summaries
- [ ] **7.0** File Size & Input Guards
  - [ ] 7.1 Add file size validation for --file arguments with MAX_INPUT_FILE_SIZE constant and clear error messages
  - [ ] 7.2 Add --file content type validation to ensure text files, not binary
  - [ ] 7.3 Add truncation warning when codebase context exceeds MAX_CONTEXT_CHARS with logger.debug() breadcrumb
- [ ] **8.0** Versioning & Release Strategy Implementation
  - [ ] 8.1 Create patch changesets for Features 1-7 following the documented versioning strategy
  - [ ] 8.2 Implement PR ordering strategy starting with Feature 1 (prompts) as most impactful
  - [ ] 8.3 Create minor changeset for v1.3.0 marketing release after all patches

## Relevant Files

- `src/ai/prompts/prompt-builder.ts` — Add input boundary delimiters, length validation, and shared helper functions
- `src/ai/prompts/system-prompts.ts` — Add Full Coverage sections to TASKS_SYSTEM_PROMPT and QUICK_TASKS_SYSTEM_PROMPT
- `src/cli/helpers/error-hints.ts` — Create suggestCommand() helper for consistent next-step hints
- `src/cli/commands/backlog.ts` — Audit and enhance error messages with actionable guidance
- `src/cli/commands/checklist.ts` — Audit and enhance error messages with actionable guidance
- `src/cli/commands/config.ts` — Audit and enhance error messages with actionable guidance
- `src/cli/commands/epic.ts` — Audit error messages, add file size validation, ensure handleAIError() usage
- `src/cli/commands/estimate.ts` — Audit and enhance error messages with actionable guidance
- `src/cli/commands/export.ts` — Audit and enhance error messages with actionable guidance
- `src/cli/commands/feature.ts` — Audit error messages and ensure handleAIError() usage
- `src/cli/commands/github.ts` — Audit and enhance error messages with actionable guidance
- `src/cli/commands/init.ts` — Audit and enhance error messages with actionable guidance
- `src/cli/commands/plan.ts` — Audit error messages and ensure handleAIError() usage
- `src/cli/commands/quick.ts` — Add file size validation and content type validation for --file arguments
- `src/cli/commands/refine.ts` — Audit and enhance error messages with actionable guidance
- `src/cli/commands/rules.ts` — Audit and enhance error messages with actionable guidance
- `src/cli/commands/search.ts` — Audit and enhance error messages with actionable guidance
- `src/cli/commands/sprint.ts` — Extract colorByPercent(), parallelize listArtifacts() calls, audit error messages
- `src/cli/commands/status.ts` — Extract colorByPercent() to shared utility, audit error messages
- `src/cli/commands/story.ts` — Audit error messages and ensure handleAIError() usage
- `src/cli/commands/sync.ts` — Parallelize sequential listArtifacts() calls, audit error messages
- `src/cli/commands/task.ts` — Audit and enhance error messages with actionable guidance
- `src/cli/commands/template.ts` — Audit and enhance error messages with actionable guidance
- `src/utils/format.ts` — Create shared utility for colorByPercent() and artifact listing/filtering helpers
- `src/ai/types.ts` — Move magic numbers to named constants and document TOKEN_BUDGETS
- `src/ai/codebase/context-builder.ts` — Move magic numbers to constants and add truncation warning
- `src/ai/codebase/file-reader.ts` — Move magic numbers to named constants
- `src/services/ai-service.ts` — Make temperature configurable per command type and move magic numbers to constants
- `src/services/artifact-service.ts` — Add JSDoc to all exported functions and module-level comments
- `src/services/config-service.ts` — Add JSDoc to all exported functions and module-level comments
- `src/services/id-service.ts` — Add JSDoc to all exported functions and module-level comments
- `src/services/template-service.ts` — Add JSDoc to all exported functions and module-level comments
- `src/services/prompt-service.ts` — Add JSDoc to all exported functions and module-level comments
- `src/services/github-service.ts` — Add JSDoc to all exported functions and module-level comments
- `src/services/credentials-service.ts` — Add JSDoc to all exported functions and module-level comments
- `src/services/checklist-service.ts` — Add JSDoc to all exported functions and module-level comments
- `src/services/artifact-gathering.ts` — Add JSDoc to all exported functions and module-level comments
- `tests/unit/commands/plan.test.ts` — Create unit tests for plan command Epic → Features → Stories → Tasks orchestration
- `tests/unit/commands/sprint.test.ts` — Create unit tests for sprint commands and velocity calculation logic
- `tests/unit/commands/github.test.ts` — Create unit tests for github sync workflows
- `tests/unit/commands/estimate.test.ts` — Create unit tests for estimate command Fibonacci scoring logic
- `tests/unit/commands/backlog.test.ts` — Create unit tests for backlog commands and promotion logic

## Notes
_Mark tasks complete by checking the boxes above. Use your coding agent (Claude Code, Cursor, Codex) with the generated rules for context-aware implementation._
_To move this into your agile hierarchy, run `planr quick promote QT-003 --story <storyId>`._
