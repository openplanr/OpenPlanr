# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.4.0] - 2026-03-28

### Added

- **Token usage display** — shows input/output token counts after every AI call (`✓ Done (1,240 in → 860 out tokens)`)
- **`planr refine --cascade`** — refines an artifact then cascades to all children down the full hierarchy (epic → features → stories → tasks)
- **Parent-aligned refinements** — child refinements receive updated parent content as context so AI aligns changes with the parent
- **Post-refine next steps** — after applying without `--cascade`, suggests which children may need re-alignment
- **Cumulative token usage** for cascade operations (`Cascade complete: 7 artifacts refined (12,400 in → 8,200 out tokens total)`)
- **Spinner `succeed()` method** — shows green checkmark with completion message instead of silently clearing

### Changed

- **Updated all dependencies** to latest major versions: `@anthropic-ai/sdk` 0.80, `openai` 6.x, `zod` 4.x, `commander` 14.x, `@inquirer/prompts` 8.x, `typescript` 6.x, `vitest` 4.x
- **Removed `fs-extra`** dependency — replaced with Node.js built-in `fs/promises`
- **Removed `ora`** dependency — replaced with lightweight built-in spinner
- **Dropped Node 18 support** — minimum Node version is now 20
- **Refine prompt** now preserves existing cross-reference links instead of adding phantom references
- **"Suggestions" renamed to "Improvements"** in refine output for clearer UX

### Fixed

- **Refine command** no longer adds feature/story references that don't exist on disk
- **CI publish workflow** — fixed npm trusted publishing with bypass 2FA token

## [0.3.0] - 2026-03-28

### Added

- **`planr story create --epic <ID>`** — batch-generate stories for all features under an epic
- **`planr checklist toggle`** — interactively toggle checklist items with multi-select prompt
- **`planr config set-provider/set-key/set-model/set-agent`** — full AI configuration commands
- **`--verbose` global flag** — debug logging across all commands
- **`--all` flag on `planr status`** — show all items without truncation
- **`--manual` flag** on epic, feature, story, and task create commands
- **`--feature` filter** on `planr story list`
- **Integration test suite** with real file system tests for artifact lifecycle and sync
- **Test helpers** (`createTestProject`, `writeSampleEpic/Feature/Story`) for integration testing
- **Pre-commit hooks** with husky + lint-staged (runs related tests on commit)
- **Coverage reporting** with `@vitest/coverage-v8` and CI artifact upload
- **CODEOWNERS** file for automatic review assignment
- **Architecture guide** (`docs/ARCHITECTURE.md`)
- **Troubleshooting guide** (`docs/TROUBLESHOOTING.md`)
- **Security policy**, issue templates, and PR template

### Changed

- **`planr status`** — enhanced with tree view (epic → features → stories), task completion metrics with color-coded progress, and overall completion summary
- **`planr refine`** — apply action now works: writes improved markdown to disk with view/apply/skip options
- **`planr checklist show`** — now displays color-coded completion progress
- **Documentation** — CLI.md now covers all 25 command variants with complete option tables
- **README commands table** — expanded from 19 to 25 entries

### Fixed

- **Refine command** returning JSON instead of markdown in `improvedMarkdown` field — added explicit prompt instructions and JSON-detection fallback
- **ID gap-filling** — `getNextId()` now reuses gaps (e.g., TASK-001 if only TASK-002 exists)
- **npm bin paths** — added `./` prefix to suppress publish warnings

### Security

- Bumped `handlebars` from 4.7.8 to 4.7.9 (fixes critical vulnerability)
- Dropped Node 18 support (EOL) — minimum Node 20

### Developer Experience

- Test coverage: 3 → 15 test files, 167 tests passing
- Unit tests for: task-parser, markdown, fs, id-service, artifact-service, config-service, template-service, prompt-builder, logger, checklist-service
- Integration tests for: artifact lifecycle, sync command
- CI runs coverage on Node 22 with summary artifact upload
- Upgraded to vitest 4.x

## [0.2.0] - 2026-03-27

### Added

- **`planr plan`** — full automated flow (Epic → Features → Stories → Tasks)
- **`planr refine <ID>`** — AI-powered review and improvement suggestions
- **`planr sync`** — validate and fix cross-references across artifacts
- **`planr config show`** — display current configuration
- **`planr task create --feature <ID>`** — create tasks from all stories in a feature
- Feature-level task generation with comprehensive context gathering

## [0.1.0] - 2026-03-26

### Added

- **CLI tool** with `planr` command (alias: `opr`)
- **`planr init`** — initialize project with config and agile directory structure
- **`planr epic create/list`** — create and list epics
- **`planr feature create/list`** — create features from epics
- **`planr story create/list`** — create user stories with Gherkin acceptance criteria
- **`planr task create/list/implement`** — create task lists from stories
- **`planr checklist show/reset`** — agile development checklist
- **`planr rules generate`** — generate AI agent rule files
  - Cursor (`.cursor/rules/*.mdc`)
  - Claude Code (`CLAUDE.md`)
  - Codex (`AGENTS.md`)
- **`planr status`** — project planning progress overview
- Handlebars template system for all artifact generation
- Zod schema validation for configuration
- Auto-incrementing ID system (EPIC-001, FEAT-001, US-001, TASK-001)
- Full agile hierarchy enforcement (epic > feature > story > task)
