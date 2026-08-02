---

id: "TASK-004"
title: "Tasks for FEAT-004: Code Quality & Shared Utilities Consolidation"

## featureId: "FEAT-004"
created: "2026-04-09"
updated: "2026-04-09"
status: "pending"

# TASK-004: Tasks for FEAT-004: Code Quality & Shared Utilities Consolidation

**Feature:** [FEAT-004](../features/FEAT-004-code-quality-shared-utilities-consolidation.md)

## Artifact Sources

- **User Story:** `.planr/stories/US-011`
- **User Story:** `.planr/stories/US-012`
- **User Story:** `.planr/stories/US-013`
- **Gherkin:** `.planr/stories/US-011-gherkin.feature`
- **Gherkin:** `.planr/stories/US-012-gherkin.feature`
- **Gherkin:** `.planr/stories/US-013-gherkin.feature`

## Tasks

- **1.0** Extract duplicated validation patterns into shared utilities
  - 1.1 Create src/utils/validation.ts with common validation functions for file paths, IDs, and input sanitization
  - 1.2 Update command handlers in src/cli/commands/ to use shared validation utilities instead of duplicated validation logic
  - 1.3 Add JSDoc documentation to all validation utility functions with parameter types and examples
- **2.0** Extract duplicated file operation patterns into shared utilities
  - 2.1 Create src/utils/file-operations.ts with common patterns for reading/writing markdown files with frontmatter
  - 2.2 Refactor command handlers to use shared file operation utilities instead of duplicated file handling code
  - 2.3 Add comprehensive JSDoc documentation to file operation utilities with usage examples
- **3.0** Replace magic numbers with named constants
  - 3.1 Create src/utils/constants.ts with documented constants for file size limits, timeout values, and other hardcoded numbers
  - 3.2 Replace hardcoded values across the codebase with references to named constants from the constants file
  - 3.3 Add JSDoc documentation explaining the purpose and rationale for each constant
- **4.0** Add comprehensive JSDoc documentation to service functions
  - 4.1 Add JSDoc documentation to all exported functions in src/services/artifact-service.ts with parameters, return types, and examples
  - 4.2 Add JSDoc documentation to all exported functions in src/services/id-service.ts, config-service.ts, and template-service.ts
  - 4.3 Add JSDoc documentation to utility functions in src/utils/ with usage examples and error conditions

## Acceptance Criteria Mapping

- Multiple files contain similar validation logic (US-011) → Tasks 1.1, 1.2
- All files use the same validation utility functions (US-011) → Tasks 1.2, 1.3
- Multiple command handlers have similar file reading/writing logic (US-011) → Tasks 2.1, 2.2
- File operations are consistent across all command handlers (US-011) → Tasks 2.2, 2.3
- Code contains hardcoded file size limits like 500000 (US-012) → Tasks 3.1, 3.2
- The constants are documented and easily configurable (US-012) → Tasks 3.1, 3.3
- Code contains hardcoded timeout values (US-012) → Tasks 3.1, 3.2
- Timeout values are centralized and documented (US-012) → Tasks 3.1, 3.3
- Service functions lack JSDoc documentation (US-013) → Tasks 4.1, 4.2
- Each function has documented parameters, return values, and examples (US-013) → Tasks 4.1, 4.2, 4.3
- Utility functions lack documentation (US-013) → Tasks 4.3
- Developers can understand how to use each utility function (US-013) → Tasks 4.3

## Relevant Files

- `src/utils/validation.ts` — New utility file for common validation patterns extracted from command handlers
- `src/utils/file-operations.ts` — New utility file for common file operation patterns extracted from command handlers
- `src/utils/constants.ts` — Update existing constants file to include new named constants replacing magic numbers
- `src/services/artifact-service.ts` — Add JSDoc documentation to all exported functions
- `src/services/id-service.ts` — Add JSDoc documentation to all exported functions
- `src/services/config-service.ts` — Add JSDoc documentation to all exported functions
- `src/services/template-service.ts` — Add JSDoc documentation to all exported functions
- `src/utils/fs.ts` — Add JSDoc documentation to utility functions
- `src/utils/logger.ts` — Add JSDoc documentation to utility functions
- `src/utils/markdown.ts` — Add JSDoc documentation to utility functions
- `src/utils/slugify.ts` — Add JSDoc documentation to utility functions
- `src/cli/commands/backlog.ts` — Refactor to use shared validation and file operation utilities
- `src/cli/commands/epic.ts` — Refactor to use shared validation and file operation utilities
- `src/cli/commands/feature.ts` — Refactor to use shared validation and file operation utilities
- `src/cli/commands/story.ts` — Refactor to use shared validation and file operation utilities
- `src/cli/commands/task.ts` — Refactor to use shared validation and file operation utilities
- `src/cli/commands/quick.ts` — Refactor to use shared validation and file operation utilities

## Notes

*Mark tasks complete by checking the boxes above. Use your coding agent (Claude Code, Cursor, Codex) with the generated rules for context-aware implementation.*