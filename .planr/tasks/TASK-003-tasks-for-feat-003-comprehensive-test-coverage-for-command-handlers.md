---
id: "TASK-003"
title: "Tasks for FEAT-003: Comprehensive Test Coverage for Command Handlers"

featureId: "FEAT-003"
created: "2026-04-09"
updated: "2026-04-09"
status: "pending"
---

# TASK-003: Tasks for FEAT-003: Comprehensive Test Coverage for Command Handlers


**Feature:** [FEAT-003](../features/FEAT-003-comprehensive-test-coverage-for-command-handlers.md)

## Artifact Sources

- **User Story:** `.planr/stories/US-008`
- **User Story:** `.planr/stories/US-009`
- **User Story:** `.planr/stories/US-010`
- **Gherkin:** `.planr/stories/US-008-gherkin.feature`
- **Gherkin:** `.planr/stories/US-009-gherkin.feature`
- **Gherkin:** `.planr/stories/US-010-gherkin.feature`

## Tasks

- [ ] **1.0** Test Infrastructure Setup
  - [ ] 1.1 Create test fixtures and mock factories in src/test/fixtures/
  - [ ] 1.2 Create test helper utilities for command handler setup in src/test/helpers/
  - [ ] 1.3 Add test dependencies (jest, @types/jest) to package.json
  - [ ] 1.4 Configure jest.config.js for TypeScript and coverage reporting
- [ ] **2.0** Happy Path Unit Tests
  - [ ] 2.1 Create unit tests for artifact creation commands (epic, feature, story, task, quick, backlog, sprint)
  - [ ] 2.2 Create unit tests for artifact listing commands (status, search)
  - [ ] 2.3 Create unit tests for configuration commands (init, config)
  - [ ] 2.4 Create unit tests for AI-powered commands (plan, refine, estimate)
  - [ ] 2.5 Create unit tests for export and integration commands (export, rules, sync, github)
  - [ ] 2.6 Create unit tests for utility commands (template, checklist)
- [ ] **3.0** Error Condition Unit Tests
  - [ ] 3.1 Test invalid input validation for all command handlers
  - [ ] 3.2 Test missing required parameters handling
  - [ ] 3.3 Test external service failure scenarios (AI providers, file system)
  - [ ] 3.4 Test configuration error handling (missing config, invalid config)
- [ ] **4.0** Test Coverage Verification
  - [ ] 4.1 Add coverage reporting script to package.json
  - [ ] 4.2 Verify 40% statement coverage target is achieved
  - [ ] 4.3 Ensure all 19 command handlers have test files
  - [ ] 4.4 Add CI pipeline test step to run all tests

## Acceptance Criteria Mapping

- [ ] Command handler executes successfully with valid input (US-008) → Tasks 2.1, 2.2, 2.3, 2.4, 2.5, 2.6
- [ ] Command handler calls mocked dependencies correctly (US-008) → Tasks 1.1, 1.2, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6
- [ ] Command handler handles invalid input gracefully (US-009) → Tasks 3.1, 3.2
- [ ] Command handler handles external service failures (US-009) → Tasks 3.3
- [ ] Command handler validates required parameters (US-009) → Tasks 3.2, 3.4
- [ ] Test fixtures provide consistent mock data (US-010) → Tasks 1.1
- [ ] Helper utilities simplify test setup (US-010) → Tasks 1.2

## Relevant Files

- `src/test/fixtures/index.ts` — Create mock factories for common dependencies like OpenPlanrConfig, AI providers, and file system operations
- `src/test/helpers/command-test-utils.ts` — Create helper utilities for command handler test setup, mocking, and assertion patterns
- `src/cli/commands/epic.test.ts` — Unit tests for epic command handler covering happy path and error conditions
- `src/cli/commands/feature.test.ts` — Unit tests for feature command handler covering happy path and error conditions
- `src/cli/commands/story.test.ts` — Unit tests for story command handler covering happy path and error conditions
- `src/cli/commands/task.test.ts` — Unit tests for task command handler covering happy path and error conditions
- `src/cli/commands/quick.test.ts` — Unit tests for quick command handler covering happy path and error conditions
- `src/cli/commands/backlog.test.ts` — Unit tests for backlog command handler covering happy path and error conditions
- `src/cli/commands/sprint.test.ts` — Unit tests for sprint command handler covering happy path and error conditions
- `src/cli/commands/init.test.ts` — Unit tests for init command handler covering happy path and error conditions
- `src/cli/commands/config.test.ts` — Unit tests for config command handler covering happy path and error conditions
- `src/cli/commands/status.test.ts` — Unit tests for status command handler covering happy path and error conditions
- `src/cli/commands/search.test.ts` — Unit tests for search command handler covering happy path and error conditions
- `src/cli/commands/plan.test.ts` — Unit tests for plan command handler covering happy path and error conditions
- `src/cli/commands/refine.test.ts` — Unit tests for refine command handler covering happy path and error conditions
- `src/cli/commands/estimate.test.ts` — Unit tests for estimate command handler covering happy path and error conditions
- `src/cli/commands/export.test.ts` — Unit tests for export command handler covering happy path and error conditions
- `src/cli/commands/rules.test.ts` — Unit tests for rules command handler covering happy path and error conditions
- `src/cli/commands/sync.test.ts` — Unit tests for sync command handler covering happy path and error conditions
- `src/cli/commands/github.test.ts` — Unit tests for github command handler covering happy path and error conditions
- `src/cli/commands/template.test.ts` — Unit tests for template command handler covering happy path and error conditions
- `src/cli/commands/checklist.test.ts` — Unit tests for checklist command handler covering happy path and error conditions
- `package.json` — Add test dependencies (jest, @types/jest) and test scripts for coverage reporting
- `jest.config.js` — Configure Jest for TypeScript support and coverage reporting to achieve 40% target

## Notes
_Mark tasks complete by checking the boxes above. Use your coding agent (Claude Code, Cursor, Codex) with the generated rules for context-aware implementation._
