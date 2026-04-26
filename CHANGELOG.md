# Changelog

## 1.4.2

### Patch Changes

- [`45f2714`](https://github.com/openplanr/OpenPlanr/commit/45f2714c45a8148f23de32ec10c6a07b04ae30cc) Spec-driven workflow polish: clearer errors, schema reference, readiness check.

- **Friendlier `planr spec decompose` error** when AI is unavailable — surfaces two actionable paths (configure AI, or hand-author from the schema reference) instead of one terse line.
- **`planr config show` now includes a "Spec-driven readiness" section** — at-a-glance view of whether `planr spec decompose` can run given the current AI config.
- **`planr init --no-ai` prints a warning** listing the AI-dependent commands (`spec decompose`, `refine`, `backlog prioritize`) that will be unavailable, with a one-liner to re-enable later.
- **Canonical schema reference at `docs/reference/spec-schema.md`** — single source of truth for spec / story / task frontmatter, body sections, lifecycle states, and the `.pipeline-shipped` marker. To be hosted at `openplanr.dev/docs/reference/spec-schema`.
- Spec template footnote updated with concrete pipeline / CLI handoff routes.

## 1.4.1

### Patch Changes

- [`2e36aee`](https://github.com/openplanr/OpenPlanr/commit/2e36aeec579dcac0e212eaabdce24a578f51f9c4) Fix `planr spec shape` UX — replace `$EDITOR`-opening prompts with single-line prompts.

Previously, `planr spec shape <SPEC-id>` opened `$EDITOR` (vim by default for many users) for the Context, Business Rules, and Decomposition Notes questions. This was hostile UX — users unfamiliar with vim couldn't navigate, and a single accidental Enter on an empty buffer aborted the entire interactive flow.

**v1.4.1 changes:**

- **Question 1 (Context)** is now three single-line prompts: primary user, problem solved, expected outcome. Each is optional; provide what you can. The shape skill composes the Context section from your answers using markdown subheadings.
- **Question 3 (Business Rules)** is now a single line. Hint guides the user to edit the spec markdown file directly for longer-form rules.
- **Optional Decomposition Notes** is now a single line. Same guidance — edit file directly for longer prose.
- Functional Requirements (Q2) and Acceptance Criteria (Q4) are unchanged — they were already comma-separated lists.

Net effect: the entire shape flow now runs in the terminal with single-line prompts only. No `$EDITOR` open. No accidentally-empty-buffer aborts.

For users who genuinely want long-form prose, the recommended path is: run `planr spec shape` for quick capture, then edit `.planr/specs/SPEC-NNN-{slug}/SPEC-NNN-{slug}.md` directly in your editor of choice afterward.

Origin: surfaced by real-world testing where a user pressed Enter past the vim buffer without writing anything and lost the entire shape flow.

## 1.4.0

### Minor Changes

- [`00e91df`](https://github.com/openplanr/OpenPlanr/commit/00e91dfc5020826bc9c180f057082daab4ebf14f) Add spec-driven planning mode — third planning posture alongside agile + QT, designed for humans planning _for_ AI coding agents.

A new `planr spec` command namespace authors specs that decompose into User Stories and Tasks with the **same artifact contract as the [openplanr-pipeline](https://github.com/openplanr/openplanr-pipeline) Claude Code plugin** — file Create/Modify/Preserve lists, Type=UI|Tech, agent assignment, DoD with build/test commands. The two products share one schema; no conversion adapter ever.

**Subcommands shipped:**

- `planr spec init` — Activate spec-driven mode in the current project
- `planr spec create [title]` — Create a self-contained `.planr/specs/SPEC-NNN-{slug}/` directory
- `planr spec shape <id>` — Interactive 4-question SPEC authoring (Context, Functional Requirements, Business Rules, Acceptance Criteria)
- `planr spec decompose <id>` — AI-driven generation of User Stories + Tasks; matches openplanr-pipeline schema; works with all 3 AI providers (Anthropic, OpenAI, Ollama). Flags: `--force`, `--no-code-context`, `--max-stories <n>`
- `planr spec sync [id]` — Validate spec integrity (orphaned tasks, stories without tasks, missing `specId`, schema drift); auto-fixes safe issues; `--dry-run` reports without writing
- `planr spec list` — List all specs with status + decomposition counts
- `planr spec show <id>` — Print a spec + its US/Task tree
- `planr spec status [id]` — Decomposition state across one or all specs
- `planr spec destroy <id>` — `rm -rf` of a single self-contained spec directory
- `planr spec attach-design <id> --files <png>...` — Attach UI mockups for the pipeline's designer-agent
- `planr spec promote <id>` — Validate completeness, mark `ready-for-pipeline`, print the `/openplanr-pipeline:plan {slug}` handoff command

**Directory layout (per spec, self-contained):**

```
.planr/specs/SPEC-NNN-{slug}/
├── SPEC-NNN-{slug}.md         # the spec document
├── design/                    # PNG mockups + design-spec.md (written by pipeline's designer-agent)
├── stories/US-NNN-{slug}.md   # US-NNN scoped to this spec
└── tasks/T-NNN-{slug}.md      # T-NNN scoped to this spec
```

**ID scoping:** US-NNN and T-NNN are scoped to their parent SPEC (not project-globally unique). Two specs can each have their own US-001. Disambiguate via path or via `specId` frontmatter.

**Coexistence:** purely additive — agile (epic/feature/story/task) and QT modes work unchanged. Activate spec mode per project via `planr spec init`. Modes are independent; pick the posture that fits the work.

**Decompose AI behavior:**

- Always scans the project codebase via the existing `buildCodebaseContext()` so generated tasks reference real file paths matching the user's stack
- Reads `input/tech/stack.md` (best-effort) for stack-specific hints
- Detects `ui_files` in SPEC frontmatter to drive 1-vs-2 tasks per US (per openplanr-pipeline rule R2)
- Refuses to overwrite an existing decomposition unless `--force` is passed
- Status: pending|shaping → decomposing → decomposed

**Pipeline integration:** When this CLI marks a spec `ready-for-pipeline`, the openplanr-pipeline Claude Code plugin (v0.3.0+) reads `.planr/specs/SPEC-NNN-{slug}/` directly — no conversion. See `docs/proposals/spec-driven-mode.md` for the full design proposal and BL-011 for the original strategic feedback.

## 1.3.0

### Minor Changes

- [`61dc183`](https://github.com/openplanr/OpenPlanr/commit/61dc183e2a1ef7397682b6d7ba871c37c82c2c7a) **`planr linear`** — full Linear.app integration for OpenPlanr (EPIC-004).

### Subcommands

- `planr linear init` — validate a Linear PAT, pick a team, save settings.
- `planr linear push <artifactId>` — create/update Linear entities at any scope:
  - `EPIC-XXX` → project + features + stories + tasklists
  - `FEAT-XXX` → feature + its stories + its tasklist
  - `US-XXX` → one story sub-issue
  - `TASK-XXX` → one tasklist sub-issue
  - `QT-XXX` → quick task in the standalone project
  - `BL-XXX` → backlog item (auto-labeled) in the standalone project
- `planr linear sync` — pull workflow status + bidirectional task checkboxes.
- `planr linear tasklist-sync` — sync TASK checkbox lines with Linear issue bodies.
- `planr linear status` — local mapping table (no API calls).

### Flags on `push`

`--dry-run`, `--update-only`, `--push-parents`, `--as <strategy>`.

### Epic mapping strategies (chosen once, stored in `linearMappingStrategy`)

- `project` (default) — Epic = Linear Project, one-to-one.
- `milestone-of:<projectId>` — Epic becomes a `ProjectMilestone` in an existing project; descendants carry `projectMilestoneId`.
- `label-on:<projectId>` — Epic becomes a team-scoped label; descendants carry `labelIds` (merged with user-added labels, never stomped).

First-time push prompts interactively. CI consumers use `--as` or `linear.defaultEpicStrategy`.

### Parent-chain pre-flight

Granular pushes (`FEAT-/US-/TASK-`) refuse to run when the parent chain is not yet in Linear — unless `--push-parents` is set, which cascades up. Unsupported prefixes (`ADR-/SPRINT-/checklist-`) error with a pointer to the parent epic.

### Standalone project for `QT-` / `BL-`

Quick tasks and backlog items push as top-level issues in a user-chosen Linear project (`linear.standaloneProjectId`, set once via an interactive first-push prompt). Backlog items auto-apply a team-scoped `backlog` label for filtering.

### Security & reliability

- Linear IDs validated before every API call — accepts UUID or `ENG-42` identifier; corrupted frontmatter falls through to create instead of 404-ing.
- Frontmatter writer preserves regex-special sequences (`$1`, `$&`, `$$`) literally — Linear values can contain them.
- SDK error fallback sanitizes raw GraphQL bodies; known error types keep their user-friendly guidance.
- Rate-limit retries honor Linear's `Retry-After` (never retry sooner than the server asked, never faster than our exponential backoff).
- Non-interactive conflict decisions audited to `.planr/reports/`.
- Three-way checkbox merge warns when a baseline looks corrupted.
- PATs stored via keychain-first credentials service, never in `config.json`.

### Bidirectional status sync with three-way merge (fixes silent data loss)

`planr linear sync` now reconciles workflow status in **both directions** via a three-way merge:

- **Local changed, Linear unchanged** → pushes local to Linear (fixes the data-loss bug where `planr quick update --status done` followed by `planr linear sync` silently reverted local back to Linear's stale state).
- **Linear changed, local unchanged** → pulls Linear to local (existing behavior, preserved).
- **Both changed** → conflict resolved per `--on-conflict prompt|local|linear`. Interactive runs prompt per artifact; CI/non-interactive runs auto-resolve to `linear` and log the decision to `.planr/reports/linear-sync-conflicts-<date>.md`.

Baseline is stored per-artifact in new frontmatter fields `linearStatusReconciled` and `linearStatusSyncedAt`, written on every successful sync. `planr quick update --status` and `planr backlog update --status` automatically clear `linearStatusReconciled` so the next sync recognizes the local change and pushes it up.

`--on-conflict` now applies to both status and checkbox conflicts (previously checkbox-only). Applies to FEAT / US / QT / BL. TASK stays deferred (aggregate issue, needs its own aggregation rules).

### Status sync now covers QT + BL (zero-config)

`planr linear push QT-XXX` and `planr linear push BL-XXX` now write local status to Linear's workflow state. `planr linear sync` pulls state changes back into QT and BL frontmatter alongside features and stories.

- **Zero-config:** push auto-derives the status→stateId map from Linear's canonical state types (`backlog` / `unstarted` / `started` / `completed` / `canceled`) on every run. `linear.pushStateIds` is now an optional override, not a requirement.
- Quick tasks use the task vocabulary (`pending` / `in-progress` / `done`), plus transparent aliases for Linear-native wording (`completed` / `cancelled` / `canceled` / `todo`).
- Backlog items use their own vocabulary (`open` / `closed` / `promoted`). Pull is asymmetric by design: any Linear "in flight" state maps to `open`, `Done`/`Cancelled` maps to `closed`, and local `promoted` is never overwritten (it implies a target pointer Linear can't know about).
- TASK status sync stays on the TODO list. One Linear TaskList issue aggregates many task files, so a 1:1 status mapping doesn't apply; use `planr linear tasklist-sync` for per-checkbox state.

**Fix:** Linear's API rejects `stateId: null` on update (`InvalidInput`). All push paths — feature, story, QT, BL — now omit the `stateId` field entirely when unmapped instead of sending an explicit null, so pushes without any state configuration continue to succeed.

### `planr revise` — unchanged-content short-circuit

Revise now detects when the agent returns content that is effectively identical to the original (byte-exact, or differs only in trailing whitespace that LLM markdown serializers routinely strip). Behavior in that case:

- No file write, no backup sidecar produced, no confirm prompt.
- New audit outcome `unchanged-by-agent` (distinct from `skipped-by-agent` / `flagged`).
- UI renders "(no changes — agent's revised output matches the current file; nothing to apply)" in place of an empty diff block.

Prevents the confusing `Outcome: applied` report when the only on-disk delta was a trailing newline strip.

### `planr linear status` — full URLs, no truncation

Reordered the table so the URL column is last and never truncated. Clickable URLs are the primary value of the table; the previous 28-char ellipsis made them useless for copy-paste.

### Estimate sync for FEAT / US / QT / BL

`planr linear push` now writes local `estimatedPoints` (from `planr estimate --save`, or hand-edited `storyPoints`) to Linear's native Issue estimation field, snapped to the team's configured scale:

- **Fibonacci** — snap to `{0, 1, 2, 3, 5, 8, 13, 21}` (e.g. `4 → 5`, `7 → 8`).
- **Linear** — snap to `{0, 1, 2, 3, 4, 5}`.
- **Exponential** — snap to `{0, 1, 2, 4, 8, 16}`.
- **tShirt** — skipped with one-per-run warning (no reliable numeric → XS/S/M/L/XL mapping).
- **notUsed** — skipped silently.

Zero-config: the team's `issueEstimationType` is auto-detected per push run (one extra API round-trip, cached). TASK is deferred — one Linear TaskList issue aggregates multiple task files, so 1:1 estimate mapping doesn't apply.

### Story body fixes

- **Empty role/goal/benefit no longer renders `As a \*\***, I want \***\* so that \*\***.`\*\* Suppresses the "As a" sentence entirely when any of the three fields is blank (or whitespace-only).
- **Gherkin scenarios now push to Linear.** Stories following the OpenPlanr convention store acceptance criteria as Gherkin in a sibling `<storyId>-gherkin.feature` file. Before this fix the push path never loaded the `.feature` content and Linear stories rendered empty for convention-following teams.
- **Epic project description trims whitespace-only fields** — no more empty `**Risks**` headers.

### Linear label case + workspace-scope fix

`ensureIssueLabel` lookup is now **case-insensitive and workspace-wide** (matching Linear's own uniqueness rule). Previously a workspace with a `Feature` label blocked creation of `feature` with an `InvalidInput: Label already exists` error. Push now adopts the existing cross-team label instead of failing.

### Revise — next-step guidance + rejected-proposal preservation

- Flagged outcomes now print actionable next steps (read the audit log, hand-edit, re-run with `--scope-to prose`, re-run with `--no-code-context`) instead of leaving users in a dead end.
- Demoted `revise → flag` decisions preserve the agent's rejected rewrite in the audit log as a `REJECTED by verifier` diff so users can inspect and hand-apply the parts that make sense. The file is still not written (action remains `flag`); the markdown is kept for audit purposes only.

### BL → QT promote is now AI-driven

`planr backlog promote BL-XXX --quick` feeds the full BL markdown body (description, acceptance criteria, notes, threat models) through the same AI pipeline used by `planr quick create`, producing a realistic task breakdown instead of a single checkbox that restates the title. The new QT carries `sourceBacklog: "BL-XXX"` as provenance and inherits `epicId` from the BL (or an explicit `--epic` override) so `planr linear push EPIC-XXX` cascades to it. Use `--manual` to opt out of AI and keep the legacy single-task behavior.

### Config additions

```jsonc
{
  "linear": {
    "teamId": "UUID",
    "teamKey": "ENG",
    "defaultProjectLead": "UUID",
    "pushStateIds": {
      "pending": "UUID",
      "in-progress": "UUID",
      "done": "UUID"
    },
    "statusMap": { "In Review": "in-progress" },
    "standaloneProjectId": "UUID",
    "standaloneProjectName": "Planr",
    "defaultEpicStrategy": "project"
  }
}
```

## 1.2.8

### Patch Changes

- [`2d9c113`](https://github.com/openplanr/OpenPlanr/commit/2d9c113627c0eae69611af7ee2adbde366c2799f) Add `planr revise` — agent-driven alignment of planning artifacts with codebase reality

New command complementing `planr refine` (prose polish) with a focus on _factual_ alignment:

- `planr revise <ID>` — revise a single artifact (epic / feature / story / task)
- `planr revise <ID> --cascade` — top-down revision of an artifact and its descendants (epic → features → stories → tasks); children see the _revised_ parent in their context
- `planr revise --all` — revise every epic in the project, with a content-hash cache that skips unchanged artifacts
- `--dry-run`, `--yes`, `--allow-dirty`, `--scope-to prose|references|paths|all`, `--no-code-context`, `--no-sibling-context`, `--audit-format md|json`, `--max-writes-per-run`

Four-layer safety pipeline (every run):

1. **Clean-tree gate** — refuses to run on a dirty git working tree (override with `--allow-dirty`)
2. **Evidence verification** — every AI citation uses a typed kind (`file_exists`, `file_absent`, `grep_match`, `sibling_artifact`, `source_quote`, `pattern_rule`); unverifiable citations are dropped. When a majority of evidence fails to verify, the decision is demoted from `revise` to `flag` so a human reviews instead of silently applying
3. **Diff preview + confirmation** — per-artifact menu: `[a]pply / [s]kip / [e]dit rationale / [d]iff again / [q]uit`; `--yes` still requires typed "YES" at start in an interactive TTY, skipped in non-TTY (CI) environments
4. **Post-flight graph-integrity check + git rollback** — after writes, `syncParentChildLinks` runs; if any cross-reference broke, affected artifact paths are restored via `git checkout`. This is the only v1 mechanism allowed to use the word "rollback"; atomic writes are called atomicity

Template-conformance guardrail:

- Revise is taught the canonical `## Section` set for each artifact type (from the Handlebars templates) and instructed to flag rather than add sections outside it. Prevents task-level conventions like `## Relevant Files` from leaking into epics
- Existing user-maintained custom sections are preserved byte-for-byte

Other safety properties:

- **Atomic writes** with sidecar backups (`.planr/reports/revise-<scope>-<date>/backup/`) — no partial files ever on disk
- **Facts win from code, plan wins on intent** — concrete paths and symbols are rewritten to match the repo; what the feature is _supposed to do_ is never rewritten (intent conflicts surface as `flag` with ambiguous entries)
- **Graceful mid-cascade interrupt** — Ctrl+C and `[q]uit` let any in-flight atomic write complete, stop cleanly, and flush the audit log immediately; already-applied artifacts stay applied
- **SIGINT closes the audit log cleanly** with an `interrupted: sigint` footer, so Ctrl+C at the confirmation prompt doesn't leave a half-written log

Every run emits a Markdown or JSON audit log under `.planr/reports/` capturing applied / skipped / flagged / failed artifacts with rationale, evidence, ambiguities, and unified diffs — dry-run included.

After a successful apply, revise prints:

```
git commit -am "chore(plan): revise <SCOPE> against codebase"
```

See the [README section on `planr revise`](https://github.com/openplanr/OpenPlanr/blob/main/README.md#planr-revise--align-planning-with-reality) for workflow examples.

## 1.2.7

### Patch Changes

- [`57d07b3`](https://github.com/openplanr/OpenPlanr/commit/57d07b324cd34bc8461d09ae3fc2225dc5da610f) Add stakeholder reporting & PM intelligence layer

New commands:

- `planr report <type>` — generate `sprint`, `weekly`, `executive`, `standup`, `retro`, or `release` reports from `.planr/` artifacts and (optionally) recent GitHub commits/PRs, written as Markdown + HTML under `.planr/reports/`
- `planr report-linter [file]` — validate stakeholder markdown against configurable rules (vague language, evidence density, required sections per report type) with coaching hints
- `planr context` — emit the report context pack (artifacts + sprint state + GitHub signals + flat evidence index) as JSON for piping
- `planr voice standup` — convert a transcript file or stdin into a structured Yesterday / Today / Blockers standup, with optional `--lint`, `--edit`, `--reload-file`, and `--append-story`
- `planr story standup --story <ID>` — append linted standup notes onto an existing user story

Reporting features:

- `--lint` and `--strict-evidence` quality gates so vague or unsupported claims do not ship
- `--push slack` via [Incoming Webhooks](https://api.slack.com/messaging/webhooks) (`distribution.slackWebhookUrl` in `.planr/config.json`); `--dry-run` works without a webhook configured
- `--push github` archives the report as a `planr:report` GitHub issue via the local `gh` CLI
- Optional org branding and extra sections via the `reports` block in config; optional rule overrides via the `reportLinter` block

Out of scope for this release (deferred):

- Bundled PDF rendering (`--format pdf` exits with a clear "not in this build" message)
- SMTP email delivery (the email path is a documented stub)
- Live microphone capture and bundled speech-to-text — pair `planr voice standup` with any STT or OS dictation tool
- Per-segment audio replay, Slack OAuth / multi-channel routing, native git-tree report commits, persistent cross-session coaching history

See [docs/EPIC-PM-REPORTING-LAYER.md](https://github.com/openplanr/OpenPlanr/blob/main/docs/EPIC-PM-REPORTING-LAYER.md) for the design and shipped-vs-deferred matrix.

## 1.2.6

### Patch Changes

- [`4cf5bcc`](https://github.com/openplanr/OpenPlanr/commit/4cf5bcc5e6e4f56bb0d59cda9cb9ba7f57115277) Replace gray-matter with yaml package to eliminate eval() vulnerability

- Remove gray-matter dependency (+ 6 transitive deps including js-yaml with eval)
- Add yaml package (zero deps, YAML 1.2 spec, no eval, maintained by YAML spec editors)
- Custom frontmatter parse/stringify in ~15 lines with robust regex handling

## 1.2.5

### Patch Changes

- [`97e34be`](https://github.com/openplanr/OpenPlanr/commit/97e34bee794585c50d6ba774d1ba0b586a130030) Add artifact update commands and GitHub issue type auto-assignment

- Add `planr update <ids...>` top-level command with batch support, status validation, and `--force` override
- Add `update` subcommand to all artifact types: epic, feature, story, task, quick, backlog
- Supported fields: `--status` (all types), `--owner` (epic/feature), `--priority` (backlog)
- Auto-set GitHub issue types (Task, Feature) via GraphQL when pushing with `planr github push`
- Extract shared `updateArtifactFields()` using regex-based replacement to preserve file formatting
- Harden environment variable access with explicit allowlist in credentials-service

## 1.2.4

### Patch Changes

- [`64a0f80`](https://github.com/openplanr/OpenPlanr/commit/64a0f80fda6d6d44faff957d7064a55d6833682c) Code quality and performance improvements

- Faster sprint and sync commands via parallelized artifact loading
- Consistent error messages across all AI-powered commands
- Shared formatting utilities to reduce internal code duplication
- JSDoc documentation added to all core service functions

## 1.2.3

### Patch Changes

- [`5551aea`](https://github.com/openplanr/OpenPlanr/commit/5551aea8113ae17af67306219c9eb22bd5405667) Add prompt injection protection with input boundary delimiters and file size validation for --file arguments

## 1.2.2

- [`45836f9`](https://github.com/openplanr/OpenPlanr/commit/45836f99ad88605ba4aac5fab4f318b20badf5b0) Reduce AI over-engineering in plan generation with scope discipline rules, count guidance per artifact level, and anti-enumeration batching ([#62](https://github.com/openplanr/OpenPlanr/pull/62))

## 1.2.1

- [`696da73`](https://github.com/openplanr/OpenPlanr/commit/696da735d7cdb88c3d11022233d2b17bb274ca02) Fix project root resolution for monorepos — planr now walks up the directory tree to find `.planr/config.json`, so commands work from any subdirectory ([#55](https://github.com/openplanr/OpenPlanr/pull/55))

## 1.2.0

- [`3f47e3c`](https://github.com/openplanr/OpenPlanr/commit/3f47e3c7524cd54827cc4e63830de4bacb9f2df6) Add agent-friendly non-interactive mode and API key UX improvements
  - Add `--yes`/`-y` flag for fully unattended planning workflows (Claude Code, Cursor, Codex)
  - Auto-detect non-interactive terminals via TTY detection
  - All prompts return sensible defaults when non-interactive
  - Add `planr config remove-key` command to delete stored API keys
  - Show clear multi-line guidance when API key is not configured
  - Detect existing API keys (env var, OS keychain, encrypted file) during init
  - Replace magic numbers with named CHECKLIST constants
  - Fix TOCTOU race condition in checklist reads

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
