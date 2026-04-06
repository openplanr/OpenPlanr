# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2026-04-06

### Added

- **`.planr/` directory** — all config and planning artifacts now live under `.planr/` instead of polluting the project root with `planr.config.json` and `docs/agile/`. IDE-required files (`CLAUDE.md`, `AGENTS.md`, `.cursor/rules/`) remain at their mandated locations
- **Auto-generate AI agent rules on `planr init`** — creates `CLAUDE.md`, `AGENTS.md`, and `.cursor/rules/` immediately so users get working agent rules without a separate `planr rules generate` step
- **`planr checklist toggle 1 3 5`** — direct argument support alongside interactive mode, with validation of item indices
- **Auto-check checklist items** — `checkItem()` automatically marks checklist items as done when relevant commands complete (epic→1, feature→2, story→3, task→10)

### Changed

- **Config path** — `planr.config.json` → `.planr/config.json`
- **Artifact root** — `docs/agile/` → `.planr/`
- **Cursor rule templates** — renamed from numeric prefixes (`2000-agile-checklist.mdc`) to clean descriptive names (`agile-checklist.mdc`) to avoid colliding with user's existing rule files

### Fixed

- **Broken checklist paths** — `{{agilePath}}` template variable was missing from `createChecklist()` template data, producing broken file references
- **Checklist toggle reporting** — direct-args mode now validates indices against actual checklist items and reports accurate update counts

### Breaking Changes

- Existing v1.0.x projects need to re-run `planr init`

## [1.0.0] - 2026-04-05

### Added

- **`planr backlog`** — capture, prioritize, and promote work items from a lightweight backlog
  - `planr backlog add` — capture ideas with priority and tags without breaking your flow
  - `planr backlog list` — filter by tag, priority, or status; sorted by priority
  - `planr backlog prioritize` — AI scores items by impact/effort and reorders them
  - `planr backlog promote` — promote to quick task (`--quick`) or story (`--story --feature`)
  - `planr backlog close` — archive completed or irrelevant items
- **`planr sprint`** — time-boxed iterations with velocity tracking
  - `planr sprint create` — create a sprint with name and duration (1–4 weeks); enforces one-active-at-a-time
  - `planr sprint add` — assign tasks manually or with `--auto` AI selection based on priority and velocity
  - `planr sprint status` — progress dashboard with per-task completion, progress bars, and days remaining
  - `planr sprint close` — archive sprint, list incomplete tasks, optional retrospective
  - `planr sprint list` — all sprints with status badges and task counts
  - `planr sprint history` — velocity chart with bar visualization across closed sprints
- **`planr template`** — reusable task templates for common development workflows
  - `planr template list` — list built-in and custom templates with task counts
  - `planr template show` — preview template contents and variables
  - `planr template use` — generate task list from a template with variable substitution
  - `planr template save` — save an existing task list as a reusable custom template
  - `planr template delete` — remove a custom template
- **5 built-in task templates** — `rest-endpoint`, `react-component`, `database-migration`, `api-integration`, `auth-flow`
- **User-defined AI rules** — `.planr/rules.md` injected into AI prompts as mandatory project rules
- **Auto-extracted pattern rules** — 5 heuristic detectors (generic CRUD, command registration, central types, ID generation, template rendering) produce explicit rules from architecture files
- **Post-generation validation** — warns about modify-on-missing, create-on-existing, dependency gaps, and unknown directories before user accepts AI output
- **Dependency chain detection** — import-based file dependency hints injected into AI context
- **`display` utility** — 13 methods for formatted user-facing output (tables, progress bars, key-value pairs, status badges)
- **`ArtifactFrontmatter` type** — shared typed interface for artifact frontmatter across all parsers
- **Shared task-creation helpers** — extracted `buildTaskItems`, `displayTaskPreview`, `displayValidationWarnings`, and related helpers into reusable module
- **ESM `exports` field** — `package.json` now declares explicit ESM entry point
- **Dynamic CLI version** — `planr --version` reads version from `package.json` at runtime instead of hardcoding

### Changed

- **Version** — bumped to 1.0.0
- **Package description** — updated to reflect full planning platform: backlog, sprints, task templates, estimation, GitHub sync, and AI agent rules
- **README** — complete rewrite with expanded feature list, backlog/sprint/template quick start, and organized command tables
- **CLI.md** — added backlog, sprint, template, and quick task command sections; updated ID convention table, config example, workflow diagram
- **`planr status`** — now shows backlog items with priority badges and active sprint with days remaining
- **`planr search`** — now searches backlog and sprint artifacts
- **Codebase context builder** — dynamic `src/` subdirectory discovery instead of hardcoded directory list; pattern rules and dependency hints injected into AI prompts
- **Rules templates rewritten** — Cursor, Claude Code, and Codex templates replaced with 4-step context-gathering protocol (read task → walk parent chain → read ADRs → scan codebase)
- **Sprint task entries** — now include task title and relative file link (`- [ ] **TASK-001** title — [view](...)`)
- **Sprint auto-select** — sends subtask counts and parent feature context to AI for smarter velocity-aware selection
- **Bare catch blocks eliminated** — 39 bare `catch {}` blocks converted to `catch (err) { logger.debug(..., err) }` for `--verbose` debuggability
- **Strict Biome rules** — enabled `noExplicitAny`, `noNonNullAssertion`, `noConsole` as errors
- **`@anthropic-ai/sdk`** — bumped from 0.80.0 to 0.81.0

### Removed

- **`planr task implement` and `planr quick implement`** — coding agents (Claude Code, Cursor, Codex) handle implementation directly via generated rules
- **`planr task fix` and `planr quick fix`** — replaced by iterative agent workflows
- **8 agent adapter files** (~1,150 lines) — `agent-factory`, `claude-agent`, `codex-agent`, `cursor-agent`, `implementation-bridge`, `progress`, `prompt-composer`, `types`
- **Orphaned retry utilities** — dead `MAX_RETRIES`, `isRetryableError`, `sleep` removed after agent deletion
- **Duplicate `CodingAgentName` type** — consolidated to single definition in `models/types.ts`

### Fixed

- **Hardcoded source inventory directories** — replaced 7-directory list with dynamic `readdir` discovery that expands into leaf directories
- **Source inventory listing directories as files** — uses `readdir` with `withFileTypes` and `.isFile()` filter
- **`countInventoryMatches` counting lines** — now parses comma-separated file names per inventory line
- **Dependency chain warning wording** — "modified but" changed to "referenced but" for accuracy
- **`displayValidationWarnings` loose typing** — `action?: string` replaced with `action: 'modify' | 'create'`
- **`--file` flag error handling** — stack trace on bad file path replaced with user-friendly error message in quick.ts and epic.ts
- **Rules reader empty vs missing** — `!content` replaced with explicit `content === null` check
- **Slugify `ENAMETOOLONG` crash** — filenames truncated at 80 chars with word-boundary trimming
- **Backlog title triplication** — title no longer repeated three times in generated backlog items
- **Task parser bold ID regex** — fixed regex that caused empty template saves when IDs were bold-formatted
- **Sprint "untitled" filename** — sprint creation now uses sprint name for slug instead of falling back to "untitled"
- **Plan summary overcounting** — reports only artifacts created in current run; task generation failures no longer miscounted
- **`truncateTitle` empty input** — guards against empty description producing empty artifact titles
- **`progressBar` percent clamping** — clamps to [0,100] to prevent `String.repeat()` with negative count
- **`logger.debug` Error formatting** — formats Error instances with stack traces instead of `[object Object]`
- **Safer Map access patterns** — guarded `Map.get()` returns in sync and dependency-chains to prevent silent no-ops

### Developer Experience

- **47 new tests** — display utility (22), task-creation helpers (21), E2E smoke (4), edge cases
- **Coverage thresholds raised** — from 3% to 14% (lines, functions, branches, statements)
- **`display.*` / `logger.*` separation** — formatted user-facing output vs operational messages

## [0.9.0] - 2026-04-01

### Added

- **`planr github push`** — push planning artifacts to GitHub Issues. Supports single artifact (`planr github push EPIC-001`), all artifacts under an epic (`--epic EPIC-001`), or everything (`--all`). Creates labeled issues with type-aware formatting, metadata tables, and collapsible artifact sources. Stores the GitHub issue number in artifact frontmatter for bi-directional linking
- **`planr github sync`** — bi-directional status sync between local artifacts and GitHub Issues. Supports `--direction pull` (GitHub→local), `push` (local→GitHub), or `both` (interactive conflict resolution). Detects open/closed state changes and maps them to artifact status fields
- **`planr github status`** — show sync status of all linked artifacts (local status vs GitHub issue state)
- **`planr export`** — generate consolidated planning reports in markdown (`--format markdown`), JSON (`--format json`), or HTML (`--format html`). Supports epic scoping (`--scope EPIC-001`) and custom output path (`--output ./reports`). HTML reports are self-contained with collapsible sections, status badges, and inline CSS
- **`planr epic create --file <path>`** — read epic description from a file (e.g., a PRD or requirements document) instead of single-line input. Supports multi-line documents of any size
- **Type-aware GitHub issue formatting** — different body builders for task, epic, feature, and story artifacts with metadata tables, section reordering, and collapsible details
- **Temp file body delivery** — uses `--body-file` for GitHub issue creation/update to avoid OS argument length limits on large artifacts
- **Graceful deleted issue handling** — when a linked GitHub issue has been deleted, falls back to creating a new one instead of failing
- **HTML export template** — self-contained Handlebars template with collapsible `<details>` sections, color-coded status badges, and full hierarchy rendering

### Changed

- **Epic prompt framing** — `buildEpicPrompt()` detects detailed input (>5 lines) and uses document extraction framing instead of "brief description" framing, so AI faithfully processes large PRDs
- **Epic system prompt** — updated to explicitly handle detailed PRD input: "extract and incorporate ALL sections — do not summarize or ignore content"
- **Epic token budget** — increased from 4096 to 8192 to support richer output from detailed PRD input

## [0.8.0] - 2026-03-31

### Added

- **`planr estimate <id>`** — AI-powered effort estimation for any artifact (task, story, feature, epic, quick). Returns story points (Fibonacci 1-21), estimated hours, complexity, risk factors, and reasoning
- **`planr estimate --epic <id>`** — Estimates all tasks under an epic and produces a rollup table with total points and hours
- **`planr estimate --calibrate`** — Accuracy report from past estimates on completed artifacts
- **`planr estimate --save`** — Persists estimate to artifact frontmatter (`estimatedPoints`, `estimatedHours`, `complexity`) and appends a full `## Estimate` section to the artifact body
- **Interactive estimate prompt** — After displaying results, prompts to save, re-estimate, or discard (single artifact) or save all / discard all (epic rollup)
- **`planr search <query>`** — Full-text search across all artifact types with highlighted snippets and 1 line of context
- **`planr search --type <type>`** — Filter search by artifact type (epic, feature, story, task, quick, adr)
- **`planr search --status <status>`** — Filter search results by artifact status
- **`docs/agile/ESTIMATION.md`** — Estimation rubric generated by `planr init` with the full Fibonacci scale, complexity levels, risk categories, and team calibration guidance

### Fixed

- **Estimate save preserves frontmatter formatting** — Injects estimate fields directly into raw YAML without re-serializing through gray-matter, so original quoting and structure is preserved
- **Legacy `estimatedEffort` field cleanup** — Free-text `estimatedEffort` fields added by AI during task generation are removed when saving a structured estimate

### Changed

- **Estimation AI prompt** — Embeds the full story point rubric (Fibonacci scale definitions, complexity levels, risk categories) for consistent and calibrated scoring across all artifacts

## [0.7.0] - 2026-03-31

### Added

- **`planr quick`** — standalone task lists without the full agile hierarchy (Epic → Feature → Story → Task). Ideal for prototyping, bug fixes, hackathons, or any work that doesn't need agile ceremony
- **`planr quick create`** — AI generates a structured task list from a one-line description, with codebase-aware context and relevant file detection
- **`planr quick --manual`** — interactive task entry without AI
- **`planr quick list`** — list all quick task lists
- **`planr quick promote`** — graduate a quick task into the agile hierarchy by attaching to a story or feature
- **Auto-mark subtasks as done** — after a coding agent completes successfully, implemented subtask checkboxes are automatically checked off in the task markdown
- **Quick tasks in `planr status`** — standalone quick tasks shown in their own section with completion metrics

### Fixed

- **Claude retry for stdout API errors** — "API Error: 400 due to tool use concurrency" was emitted via stdout (stream-json) rather than stderr, so the retry logic never caught it. Now checks both streams for retryable errors

### Type System

- Added `'quick'` to `ArtifactType` union
- Made `TaskList.storyId` optional (quick tasks have no parent story)
- Added `QT` prefix to ID system and `quick/` directory to artifact mapping

## [0.6.0] - 2026-03-29

### Added

- **Error context helper** — truncates large build logs for clearer failure output

### Fixed

- **Agent hangs on large prompts** — implementation prompt is delivered via temp file + stdin pipe instead of a giant CLI argument (avoids OS argv limits and interactive “wait forever” behavior)
- **Stream backpressure** — prompt delivery uses `createReadStream` → `stdin` pipe instead of buffered `stdin.write`
- **Codex sandbox** — `--full-auto` and `--json` so Codex can write files and emit structured events (matches Claude-style progress output)
- **Claude stderr** — retryable 400/429/5xx errors detected while still showing output in real time

### Changed

- **Agent stdout/stderr** — `stdio: inherit` for live agent output where applicable
- **Safety** — system prompt guidance to reduce destructive cross-project commands

### Developer Experience

- **Linting and formatting** — ESLint and Prettier replaced with [Biome](https://biomejs.dev/) (`biome check` / `biome format`)

## [0.5.0] - 2026-03-28

### Added

- **Secure credential storage** — API keys are now stored in the OS keychain (macOS Keychain, Windows Credential Manager, Linux Secret Service) via `@napi-rs/keyring`, with AES-256-GCM encrypted file fallback for environments without a keychain (CI, Docker, SSH)
- **Automatic credential migration** — existing plaintext `~/.planr/credentials.json` keys are migrated to the secure backend on first access, then the plaintext file is deleted
- **Credential source display** — `planr config show` now shows where the API key is stored: `(OS keychain)`, `(encrypted file)`, or `(env: ANTHROPIC_API_KEY)`
- **Per-command token budgets** — each command uses a tuned `maxTokens` limit (epic: 4K, feature/story/refine: 8K, task: 16K, task --feature: 32K) instead of a one-size-fits-all default
- **Definitive truncation detection** — uses `stop_reason` (Anthropic) / `finish_reason` (OpenAI) to detect truncated responses instead of heuristic token thresholds
- **8 new truncation unit tests** covering skip-retry, per-attempt token reporting, and streaming truncation

### Changed

- **`planr config set-key`** now shows the storage backend: `"saved to OS keychain"` or `"saved to encrypted file"`
- **AI service refactored** — `generateJSON` and `generateStreamingJSON` now share a common `generateCore()` function, eliminating duplicated validation/retry/truncation logic
- **GitHub Actions** updated to v6 (checkout, setup-node) and v7 (upload-artifact) with Node.js 24

### Fixed

- **Task generation from features failing** — `planr task create --feature` was truncating AI responses at 4,096 tokens, producing invalid JSON. Now uses 32K budget
- **Spinner not stopping on API errors** — spinner animation no longer mixes with error messages when the AI provider throws
- **Spinner showing ✓ before validation** — `succeed()` now only fires after successful parse/validation, not before
- **Truncation error over-reporting tokens** — error messages now show per-attempt output tokens instead of cumulative totals
- **Keychain write failures crashing** — `saveCredential` now catches keychain errors and falls back to encrypted file
- **Migration flag set before completion** — `migrateCredentials` now resets the flag on failure so it retries next invocation
- **`resolveApiKeySource` skipping migration** — `config show` now properly triggers legacy credential migration

### Security

- API keys no longer stored in plaintext on disk
- Encrypted file uses AES-256-GCM with machine-derived key (hostname + username + per-installation salt via scrypt)
- File permissions set to `0o600` on all credential files

### Developer Experience

- Test coverage: 261 → 269 tests across 23 test files
- Added `tests/unit/ai-service-truncation.test.ts` (8 tests)
- Added `tests/unit/credential-backends.test.ts` (8 tests)
- Expanded `tests/unit/credentials-service.test.ts` with mocked backends (13 tests)

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
- **`planr task create --feature <ID>`** — AI task list from every story under the feature, with parent feature and epic, all Gherkin files for those stories, all ADRs, and codebase-derived context (higher output token budget than per-story task create)
- Feature-level task generation shares the same rich context model as `--story`, aggregated across the feature

## [0.1.0] - 2026-03-26

### Added

- **CLI tool** with `planr` command (alias: `opr`)
- **`planr init`** — initialize project with config and agile directory structure
- **`planr epic create/list`** — create and list epics
- **`planr feature create/list`** — create features from epics
- **`planr story create/list`** — create user stories with Gherkin acceptance criteria
- **`planr task create/list`** — task lists from a story or from all stories in a feature (AI mode includes epic, feature, Gherkin, ADRs, codebase context)
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
