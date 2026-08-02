---
id: "TASK-001"
title: "Tasks for FEAT-001: Prompt Architecture Hardening & Injection Protection"

featureId: "FEAT-001"
created: "2026-04-09"
updated: "2026-04-09"
status: "pending"
---

# TASK-001: Tasks for FEAT-001: Prompt Architecture Hardening & Injection Protection


**Feature:** [FEAT-001](../features/FEAT-001-prompt-architecture-hardening-injection-protection.md)

## Artifact Sources

- **User Story:** `.planr/stories/US-001`
- **User Story:** `.planr/stories/US-002`
- **User Story:** `.planr/stories/US-003`
- **User Story:** `.planr/stories/US-004`
- **Gherkin:** `.planr/stories/US-001-gherkin.feature`
- **Gherkin:** `.planr/stories/US-002-gherkin.feature`
- **Gherkin:** `.planr/stories/US-003-gherkin.feature`
- **Gherkin:** `.planr/stories/US-004-gherkin.feature`

## Tasks

- [ ] **1.0** Input Validation and Sanitization Infrastructure
  - [ ] 1.1 Add input validation types to src/models/types.ts for boundary delimiters and injection patterns
  - [ ] 1.2 Create input validation service in src/services/input-validation-service.ts with delimiter wrapping and injection detection functions
  - [ ] 1.3 Add file size validation constants (500KB limit) to src/utils/constants.ts
  - [ ] 1.4 Implement file size validation in src/utils/fs.js readFile function with clear error messages
- [ ] **2.0** Boundary Delimiter Implementation
  - [ ] 2.1 Add boundary delimiter wrapping function to src/services/input-validation-service.ts using triple backticks format
  - [ ] 2.2 Modify src/ai/prompts/prompt-builder.ts to wrap all user inputs with boundary delimiters
  - [ ] 2.3 Update prompt construction in src/ai/prompts/system-prompts.ts to handle delimiter-wrapped content
- [ ] **3.0** Prompt Injection Detection
  - [ ] 3.1 Add injection pattern detection functions to src/services/input-validation-service.ts for role switching and instruction overrides
  - [ ] 3.2 Implement delimiter escape detection in src/services/input-validation-service.ts
  - [ ] 3.3 Add input validation calls to all command handlers in src/cli/commands/ that process user content
- [ ] **4.0** Secure Template Architecture
  - [ ] 4.1 Update Handlebars templates in src/templates/ to use secure content isolation patterns
  - [ ] 4.2 Modify src/services/template-service.ts to apply input validation before template rendering
  - [ ] 4.3 Add template security validation to ensure system instructions remain isolated from user content
- [ ] **5.0** Testing and Validation
  - [ ] 5.1 Create unit tests for input validation service covering boundary delimiters and injection detection
  - [ ] 5.2 Add integration tests for file size validation with various file types and sizes
  - [ ] 5.3 Test prompt construction with malicious inputs to verify injection protection

## Acceptance Criteria Mapping

- [ ] The user content is wrapped with standardized boundary delimiters (US-001) → Tasks 2.1, 2.2
- [ ] The empty content is still wrapped with boundary delimiters (US-001) → Tasks 2.1, 2.2
- [ ] The original formatting and content is preserved within the delimiters (US-001) → Tasks 2.1, 2.3
- [ ] The injection attempt is detected and blocked with an error message (US-002) → Tasks 3.1, 3.3
- [ ] The content passes validation and proceeds to prompt construction (US-002) → Tasks 3.1, 3.3
- [ ] The escape attempt is detected and the input is rejected (US-002) → Tasks 3.2, 3.3
- [ ] The file is accepted for processing (US-003) → Tasks 1.4
- [ ] The file is rejected with a clear error message explaining the limit and suggesting solutions (US-003) → Tasks 1.3, 1.4
- [ ] An appropriate error message is shown indicating the file issue (US-003) → Tasks 1.4
- [ ] The system instructions remain unchanged and isolated from user content (US-004) → Tasks 4.1, 4.3
- [ ] The template structure is maintained regardless of content type (US-004) → Tasks 4.1, 4.2
- [ ] Special characters are handled safely without breaking template structure (US-004) → Tasks 4.2, 4.3

## Relevant Files

- `src/models/types.ts` — Add input validation types and interfaces for boundary delimiters and injection patterns
- `src/services/input-validation-service.ts` — Create new service for input validation, boundary delimiter wrapping, and injection detection
- `src/utils/constants.ts` — Add file size limit constants and validation error messages
- `src/utils/fs.ts` — Add file size validation to readFile function with clear error handling
- `src/ai/prompts/prompt-builder.ts` — Integrate boundary delimiter wrapping into prompt construction
- `src/ai/prompts/system-prompts.ts` — Update system prompts to handle delimiter-wrapped user content
- `src/services/template-service.ts` — Add input validation before template rendering to ensure secure content isolation
- `src/cli/commands/quick.ts` — Add input validation calls for user content processing
- `src/cli/commands/story.ts` — Add input validation calls for user content processing
- `src/cli/commands/task.ts` — Add input validation calls for user content processing

## Notes
_Mark tasks complete by checking the boxes above. Use your coding agent (Claude Code, Cursor, Codex) with the generated rules for context-aware implementation._
