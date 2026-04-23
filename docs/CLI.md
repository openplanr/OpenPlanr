# Planr CLI Reference

> Complete command reference for the `planr` CLI tool.
> Package: `openplanr` | Binary: `planr` (alias: `opr`)

---

## Installation

```bash
npm install -g openplanr

# Verify
planr --version
```

---

## Agent-Friendly / Non-Interactive Mode

Planr auto-detects non-TTY environments (CI, coding agents) and skips interactive prompts by using sensible defaults. You can also opt in explicitly:

```bash
# Explicit flag
planr epic create --title "My App" --yes
planr plan --epic EPIC-001 -y

# Auto-detected (no TTY)
echo "" | planr epic create --title "My App"
```

**Behavior in non-interactive mode:**

- Confirmations return their default value (usually `yes`)
- Select menus pick the first/primary option (e.g., "Save" for epics)
- `--manual` mode exits with an error (requires interactive input)
- All skipped prompts are logged with `[auto]` prefix in dim output

---

## Global Options

These options apply to **all** commands:

| Flag                   | Description                             | Default           |
| ---------------------- | --------------------------------------- | ----------------- |
| `--project-dir <path>` | Set project root directory              | Current directory |
| `--verbose`            | Enable verbose output                   | `false`           |
| `--no-interactive`     | Skip interactive prompts (use defaults) | `false`           |
| `-y, --yes`            | Auto-accept all prompts (alias for `--no-interactive`) | `false` |
| `-V, --version`        | Print version                           | —                 |
| `-h, --help`           | Show help                               | —                 |

---

## Commands

### `planr init`

Initialize Planr in the current project.

```bash
planr init
planr init --name "my-project"
planr init --no-ai
```

| Option          | Description            | Required     |
| --------------- | ---------------------- | ------------ |
| `--name <name>` | Project name           | No (prompts) |
| `--no-ai`       | Skip AI provider setup | No           |

**What it creates:**

```text
project-root/
└── .planr/
    ├── config.json            # Project configuration
    ├── epics/
    ├── features/
    ├── stories/
    ├── tasks/
    ├── quick/
    ├── backlog/
    ├── sprints/
    ├── templates/             # Custom task templates
    ├── adrs/
    ├── checklists/
    │   └── agile-checklist.md  # Development checklist
    └── diagrams/
```

---

### `planr epic create`

Create a new epic. With AI configured, provide a brief description and the AI expands it into a full epic. Use `--file` to feed a detailed PRD or requirements document.

```bash
planr epic create
planr epic create --title "User Authentication" --owner "Engineering"
planr epic create --file ./prd.md
planr epic create --manual
```

| Option            | Description                                     | Required     |
| ----------------- | ----------------------------------------------- | ------------ |
| `--title <title>` | Epic title or brief description                 | No (prompts) |
| `--file <path>`   | Read epic description from a file (e.g., a PRD) | No           |
| `--owner <owner>` | Epic owner                                      | No (prompts) |
| `--manual`        | Use manual interactive prompts instead of AI    | No           |

When `--file` is provided, the full file content is sent to the AI with document-extraction framing so that all requirements, features, and success criteria are incorporated into the generated epic.

**Interactive prompts:**

1. Epic title
2. Owner
3. Business value
4. Target users
5. Problem statement
6. Solution overview
7. Success criteria
8. Key features (comma-separated)
9. Dependencies (default: "None")
10. Risks (default: "None")

**Output:** `.planr/epics/EPIC-001-<slug>.md`

---

### `planr epic list`

List all epics.

```bash
planr epic list
```

**Example output:**

```text
Epics
  EPIC-001  User Authentication
  EPIC-002  Payment Integration
```

---

### `planr feature create`

Create features from an epic. With AI configured, the AI reads the epic and generates multiple features automatically.

```bash
planr feature create --epic EPIC-001
planr feature create --epic EPIC-001 --title "OAuth Login"
planr feature create --epic EPIC-001 --count 5
planr feature create --epic EPIC-001 --manual
```

| Option            | Description                                  | Required        |
| ----------------- | -------------------------------------------- | --------------- |
| `--epic <epicId>` | Parent epic ID                               | **Yes**         |
| `--title <title>` | Feature title (manual mode)                  | No (prompts)    |
| `--count <n>`     | Number of features to generate (AI mode)     | No (AI decides) |
| `--manual`        | Use manual interactive prompts instead of AI | No              |

**Interactive prompts:**

1. Feature title
2. Owner
3. Overview
4. Functional requirements (comma-separated)
5. Dependencies (default: "None")
6. Technical considerations (default: "None")
7. Risks (default: "None")
8. Success metrics

**Output:** `.planr/features/FEAT-001-<slug>.md`

---

### `planr feature list`

List all features.

```bash
planr feature list
planr feature list --epic EPIC-001    # filter by epic
```

| Option            | Description       | Required |
| ----------------- | ----------------- | -------- |
| `--epic <epicId>` | Filter by epic ID | No       |

---

### `planr story create`

Create user stories from a feature, or batch-generate stories for all features under an epic.

```bash
# Single feature:
planr story create --feature FEAT-001
planr story create --feature FEAT-001 --title "Login with Google"
planr story create --feature FEAT-001 --manual

# Batch — all features under an epic:
planr story create --epic EPIC-001
```

| Option                  | Description                                            | Required                       |
| ----------------------- | ------------------------------------------------------ | ------------------------------ |
| `--feature <featureId>` | Parent feature ID                                      | One of `--feature` or `--epic` |
| `--epic <epicId>`       | Parent epic ID — generates stories for all features    | One of `--feature` or `--epic` |
| `--title <title>`       | Story title (manual mode only)                         | No                             |
| `--manual`              | Use manual prompts instead of AI (single feature only) | No                             |

**Interactive prompts:**

1. Story title
2. As a (role)
3. I want to (goal)
4. So that (benefit)
5. Additional notes (optional)

**Output — two files:**

```text
.planr/stories/
├── US-001-<slug>.md              # User story markdown
└── US-001-gherkin.feature        # Gherkin acceptance criteria
```

---

### `planr story list`

List all user stories.

```bash
planr story list
planr story list --feature FEAT-001    # filter by feature
```

| Option                  | Description          | Required |
| ----------------------- | -------------------- | -------- |
| `--feature <featureId>` | Filter by feature ID | No       |

---

### `planr task create`

Create an implementation task list from a story or feature. With AI configured, gathers comprehensive context for intelligent task generation.

```bash
planr task create --story US-001                    # AI: one story + full planning context
planr task create --feature FEAT-001                # AI: every story under feature + full context (higher output token budget)
planr task create --story US-001 --title "Tasks"    # with custom title
planr task create --story US-001 --manual           # manual mode (story only; no AI)
```

| Option                  | Description                                                                                | Required                                     |
| ----------------------- | ------------------------------------------------------------------------------------------ | -------------------------------------------- |
| `--story <storyId>`     | AI tasks from one story                                                                    | One of `--story` or `--feature`              |
| `--feature <featureId>` | AI tasks from **all** stories under the feature (single task list, linked from each story) | One of `--story` or `--feature`              |
| `--title <title>`       | Task list title                                                                            | No (AI generates it)                         |
| `--manual`              | Manual interactive prompts instead of AI                                                   | No (`--story` only; `--feature` requires AI) |

**What it gathers (AI mode):**

Context is built by `gatherStoryArtifacts` / `gatherFeatureArtifacts` and passed to the same task-generation prompt. In both modes the model sees:

- **User stories** — one story (`--story`) or every story linked to the feature (`--feature`)
- **Gherkin** — `*-gherkin.feature` for each story included
- **Parent feature** and **parent epic** markdown
- **ADRs** — all architecture decision records in the project
- **Codebase context** — tech stack / tree / related files derived from story text (and for `--feature`, from **all** story bodies plus the feature)

`--feature` uses a larger completion budget (`taskFeature`, 32K tokens) than `--story` (`task`, 16K tokens) because the prompt and expected task list are typically bigger.

The AI generates grouped subtasks with acceptance criteria mapping and relevant files.

**Manual mode:** If AI is not configured, `planr task create --story` prompts for task names (comma-separated). `--feature` always requires AI.

**Output:** `.planr/tasks/TASK-001-<slug>.md`

---

### `planr task list`

List all task lists.

```bash
planr task list
planr task list --story US-001    # filter by story
```

| Option              | Description        | Required |
| ------------------- | ------------------ | -------- |
| `--story <storyId>` | Filter by story ID | No       |

---

### `planr backlog add`

Capture a backlog item — a quick way to record ideas, bugs, or work items without breaking your flow.

```bash
planr backlog add "add user profiles"
planr backlog add "fix login redirect" --priority critical --tag bug
planr backlog add "refactor auth middleware" --priority low --tag tech-debt
planr backlog add "rate-limit the upload API" --epic EPIC-001        # link at capture time
```

| Option               | Description                                                                                                  | Default      |
| -------------------- | ------------------------------------------------------------------------------------------------------------ | ------------ |
| `<description>`      | Item description                                                                                             | **Required** |
| `--priority <level>` | `critical`, `high`, `medium`, or `low`                                                                       | `medium`     |
| `--tag <tag>`        | Tag for categorization (e.g., `bug`, `feature`, `tech-debt`)                                                 | None         |
| `--epic <epicId>`    | Link the BL to an epic. `planr linear push EPIC-XXX` will cascade into this BL and include it in that epic's Linear container. | None         |

**Output:** `.planr/backlog/BL-001-<slug>.md`

---

### `planr backlog list`

List and filter backlog items.

```bash
planr backlog list
planr backlog list --tag bug
planr backlog list --priority high
planr backlog list --status open
```

| Option               | Description                                     | Default |
| -------------------- | ----------------------------------------------- | ------- |
| `--tag <tag>`        | Filter by tag                                   | All     |
| `--priority <level>` | Filter by priority                              | All     |
| `--status <status>`  | Filter by status (`open`, `closed`, `promoted`) | All     |

Items are sorted by priority (critical → high → medium → low).

---

### `planr backlog prioritize`

AI-powered prioritization. The AI scores each open item by impact and effort, then reorders and assigns priorities.

```bash
planr backlog prioritize
```

Requires AI to be configured. After scoring, displays the reordered list with impact/effort scores and reasoning. Prompts for confirmation before applying changes.

---

### `planr backlog promote`

Promote a backlog item into the agile hierarchy or a quick task.

```bash
planr backlog promote BL-001 --quick                           # AI-generate a task breakdown from the BL body
planr backlog promote BL-001 --quick --manual                  # single-task QT from the BL title (skip AI)
planr backlog promote BL-001 --quick --epic EPIC-001           # AI-generated + linked to an epic
planr backlog promote BL-001 --story --feature FEAT-001        # promote to story
```

| Option                  | Description                                                                                                                                        | Required                      |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| `<itemId>`              | Backlog item ID                                                                                                                                    | **Yes**                       |
| `--quick`               | Promote to a quick task                                                                                                                            | One of `--quick` or `--story` |
| `--story`               | Promote to a user story                                                                                                                            | One of `--quick` or `--story` |
| `--feature <featureId>` | Parent feature (required with `--story`)                                                                                                           | With `--story`                |
| `--epic <epicId>`       | (`--quick` only) Link the new QT to an epic. Overrides the BL's own `epicId`/`parentEpic`; stories chain through `--feature` and ignore this.      | No                            |
| `--manual`              | (`--quick` only) Skip the AI pass and create a single-task QT from the BL title (legacy behavior). Useful for trivial BLs or when AI isn't configured. | No                            |

**AI-driven task breakdown (default with `--quick`)**

When AI is configured, `--quick` reads the BL's full markdown body — description, acceptance criteria, notes, threat models, links — and feeds it through the same AI pipeline as `planr quick create`. The resulting QT contains a realistic task breakdown that a coding agent can execute step by step, not just a restated title. The new QT's frontmatter carries `sourceBacklog: "BL-XXX"` as provenance.

If AI is not configured, `--quick` falls back to the single-task behavior with a warning (equivalent to `--manual`). Use `--manual` explicitly when you want the single-task behavior even with AI configured (e.g., for one-liner BLs that don't need a breakdown).

**Epic linkage**

- `--quick`: if the BL has `epicId` (or legacy `parentEpic`) in its frontmatter, the new QT inherits it automatically. `--epic EPIC-XXX` overrides that inheritance. With an epic link, `planr linear push EPIC-XXX` cascades into the new QT (it lands inside the epic's Linear container instead of the standalone project).
- `--story`: the story's chain to an epic runs through its parent feature's `epicId`, so `--epic` is not needed here.

The original backlog item is marked as `promoted` with a link to the created artifact.

---

### `planr backlog close`

Close/archive a backlog item.

```bash
planr backlog close BL-001
```

| Argument   | Description     | Required |
| ---------- | --------------- | -------- |
| `<itemId>` | Backlog item ID | **Yes**  |

---

### `planr sprint create`

Create a time-boxed sprint. Only one sprint can be active at a time.

```bash
planr sprint create --name "Sprint 1" --duration 2w
planr sprint create --name "Sprint 2" --duration 1w
```

| Option                  | Description                                | Required |
| ----------------------- | ------------------------------------------ | -------- |
| `--name <name>`         | Sprint name                                | **Yes**  |
| `--duration <duration>` | Sprint duration: `1w`, `2w`, `3w`, or `4w` | **Yes**  |

**Output:** `.planr/sprints/SPRINT-001-<slug>.md`

---

### `planr sprint add`

Assign tasks to the active sprint — manually or with AI auto-selection.

```bash
planr sprint add TASK-001 QT-001          # add specific tasks
planr sprint add --auto                   # AI selects by priority and velocity
```

| Argument/Option | Description                                                       | Required                          |
| --------------- | ----------------------------------------------------------------- | --------------------------------- |
| `[taskIds...]`  | Task or quick-task IDs to add                                     | One of `[taskIds...]` or `--auto` |
| `--auto`        | AI selects tasks based on priority, velocity, and sprint capacity | One of `[taskIds...]` or `--auto` |

With `--auto`, the AI considers past sprint velocity, task priorities, and estimated points to fill the sprint capacity. Requires AI to be configured.

---

### `planr sprint status`

Progress dashboard for the active sprint.

```bash
planr sprint status
```

Displays:

- Sprint name, dates, and days remaining
- Per-task completion status with progress bars
- Overall completion percentage
- Velocity metrics

---

### `planr sprint close`

Archive the active sprint and review results.

```bash
planr sprint close
```

Marks the sprint as `closed`, lists incomplete tasks for carry-over consideration, and optionally opens an editor for a retrospective note.

---

### `planr sprint list`

List all sprints with status badges and task counts.

```bash
planr sprint list
```

---

### `planr sprint history`

Velocity chart across past sprints.

```bash
planr sprint history
```

Displays a bar chart of completed story points per sprint with average velocity calculation.

---

### `planr quick create`

Create a standalone task list with AI or manually — without the full agile hierarchy.

```bash
planr quick create "add user profiles"
planr quick create --file spec.md
planr quick create --manual
planr quick create "add webhook retry" --epic EPIC-001      # link at creation time
```

| Option            | Description                                                                                                                     | Required     |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| `<description>`   | Task description                                                                                                                | No (prompts) |
| `--file <path>`   | Generate tasks from a PRD or spec file                                                                                          | No           |
| `--manual`        | Interactive task entry without AI                                                                                               | No           |
| `--epic <epicId>` | Link the QT to an epic. `planr linear push EPIC-XXX` will cascade into this QT and create it inside the epic's Linear container. | No           |

**Output:** `.planr/quick/QT-001-<slug>.md`

---

### `planr quick list`

List all quick task lists.

```bash
planr quick list
```

---

### `planr quick promote`

Graduate a quick task into the agile hierarchy.

```bash
planr quick promote QT-001 --story US-001
planr quick promote QT-001 --feature FEAT-001
```

| Option                  | Description                   | Required                        |
| ----------------------- | ----------------------------- | ------------------------------- |
| `<taskId>`              | Quick task ID                 | **Yes**                         |
| `--story <storyId>`     | Attach to an existing story   | One of `--story` or `--feature` |
| `--feature <featureId>` | Attach to an existing feature | One of `--story` or `--feature` |

---

### `planr template list`

List all available task templates (built-in and custom).

```bash
planr template list
```

Shows template name, description, task count, and whether it's built-in or custom.

---

### `planr template show`

Preview a template's contents and variables.

```bash
planr template show rest-endpoint
```

| Argument | Description   | Required |
| -------- | ------------- | -------- |
| `<name>` | Template name | **Yes**  |

---

### `planr template use`

Generate a task list from a template with variable substitution.

```bash
planr template use rest-endpoint --title "User Profile API"
planr template use react-component --title "Dashboard Widget"
```

| Argument/Option   | Description                       | Required |
| ----------------- | --------------------------------- | -------- |
| `<name>`          | Template name                     | **Yes**  |
| `--title <title>` | Title for the generated task list | **Yes**  |

Template variables (e.g., `{{entityName}}`, `{{componentName}}`) are prompted interactively during generation.

**Built-in templates:**

| Template             | Description                                            | Variables                        |
| -------------------- | ------------------------------------------------------ | -------------------------------- |
| `rest-endpoint`      | CRUD endpoint with validation, auth, tests, docs       | `entityName`, `basePath`         |
| `react-component`    | Component, stories, tests, types                       | `componentName`                  |
| `database-migration` | Schema change, migration, rollback, seed data          | `tableName`, `changeDescription` |
| `api-integration`    | External API client, retry logic, error handling       | `serviceName`, `baseUrl`         |
| `auth-flow`          | Authentication flow with login, signup, password reset | `authProvider`                   |

**Output:** `.planr/tasks/TASK-001-<slug>.md`

---

### `planr template save`

Save an existing task list as a reusable custom template.

```bash
planr template save TASK-001 --name my-pattern
```

| Argument/Option | Description                      | Required |
| --------------- | -------------------------------- | -------- |
| `<taskId>`      | Task list ID to save as template | **Yes**  |
| `--name <name>` | Template name                    | **Yes**  |

**Output:** `.planr/templates/<name>.json`

---

### `planr template delete`

Remove a custom template.

```bash
planr template delete my-pattern
```

| Argument | Description   | Required |
| -------- | ------------- | -------- |
| `<name>` | Template name | **Yes**  |

Prompts for confirmation before deleting. Only custom templates can be deleted.

---

### `planr checklist show`

Display the agile development checklist.

```bash
planr checklist show
```

Shows the full 5-phase checklist:

1. Requirements Analysis
2. Technical Design
3. Architecture Decision Records
4. Solution Planning
5. Solution Review

---

### `planr checklist toggle`

Interactively toggle checklist items. Presents a multi-select prompt where you can check/uncheck items, then writes changes back to the file with a progress summary.

```bash
planr checklist toggle
```

---

### `planr checklist reset`

Reset the checklist back to its initial state.

```bash
planr checklist reset
```

---

### `planr rules generate`

Generate AI agent rule files for Cursor, Claude Code, and/or Codex.

```bash
planr rules generate                  # all configured targets
planr rules generate --target cursor  # cursor only
planr rules generate --dry-run        # preview without writing
```

| Option              | Description                           | Default |
| ------------------- | ------------------------------------- | ------- |
| `--target <target>` | `cursor`, `claude`, `codex`, or `all` | `all`   |
| `--dry-run`         | Show what would be generated          | `false` |

**Generated files by target:**

| Target | Output                                    |
| ------ | ----------------------------------------- |
| Cursor | `.cursor/rules/200x-*.mdc` (6 rule files) |
| Claude | `CLAUDE.md`                               |
| Codex  | `AGENTS.md`                               |

---

### `planr plan`

Full agile planning flow in a single command. Cascades through the hierarchy: Epic → Features → Stories → Tasks.

```bash
planr plan                          # start from scratch (creates epic first)
planr plan --epic EPIC-001          # start from existing epic → features → stories → tasks
planr plan --feature FEAT-001       # start from existing feature → stories → tasks
planr plan --story US-001           # start from existing story → tasks only
```

| Option                  | Description                    | Required |
| ----------------------- | ------------------------------ | -------- |
| `--epic <epicId>`       | Start from an existing epic    | No       |
| `--feature <featureId>` | Start from an existing feature | No       |
| `--story <storyId>`     | Start from an existing story   | No       |

When no flag is provided, the command prompts for an epic brief and cascades through the full hierarchy. Each step asks for confirmation before proceeding to the next level.

Requires AI to be configured (`planr config set-provider`).

---

### `planr refine`

AI-powered review and improvement suggestions for any existing artifact.

```bash
planr refine EPIC-001               # review an epic
planr refine FEAT-002               # review a feature
planr refine US-003                  # review a user story
planr refine EPIC-001 --cascade     # refine epic + all features → stories → tasks
```

| Argument/Option | Description                                                | Required |
| --------------- | ---------------------------------------------------------- | -------- |
| `<artifactId>`  | Any artifact ID (EPIC-001, FEAT-002, US-003, TASK-004)     | **Yes**  |
| `--cascade`     | Refine all children down the hierarchy after this artifact | No       |

The AI analyzes the artifact and provides:

1. A list of improvement suggestions
2. An improved version of the artifact

After review, you can:

- **Apply** — write the improved version to disk
- **View** — preview the improved version, then choose to apply or skip
- **Skip** — keep the original unchanged

With `--cascade`, the command automatically proceeds to refine all child artifacts after the parent. The cascade follows the full hierarchy: epic → features → stories → tasks. Each child still gets its own view/apply/skip prompt.

Without `--cascade`, the command suggests next steps after applying (shows child artifacts that may need re-alignment).

Requires AI to be configured.

---

### `planr sync`

Validate and repair cross-references across all artifacts.

```bash
planr sync                          # fix broken cross-references
planr sync --dry-run                # preview changes without writing
```

| Option      | Description                                  | Default |
| ----------- | -------------------------------------------- | ------- |
| `--dry-run` | Show what would change without writing files | `false` |

**What it checks:**

- **Stale links:** Parent links to a child file that doesn't exist on disk
- **Missing links:** Child references a parent, but parent doesn't list the child
- **Duplicates:** Same child linked more than once in a parent

Handles both story-level and feature-level task relationships.

---

### `planr status`

Show project planning progress with tree view, completion metrics, and color-coded progress.

```bash
planr status
planr status --all
```

| Option  | Description                       | Default                                  |
| ------- | --------------------------------- | ---------------------------------------- |
| `--all` | Show all items without truncation | `false` (truncates to 5 items per level) |

**Features:**

- Tree view grouping: epics → features → stories
- Task completion metrics: `(8/24 subtasks, 33%)`
- Color-coded progress: green (>75%), yellow (25-75%), red (<25%)
- Overall completion summary across all task lists
- Unlinked artifact detection (features/stories without parents)

---

### `planr config show`

Display the current project configuration including AI provider, model, and API key status.

```bash
planr config show
```

---

### `planr config set-provider`

Set the AI provider for content generation.

```bash
planr config set-provider                # interactive prompt
planr config set-provider anthropic      # set directly
```

| Argument     | Description                        | Required     |
| ------------ | ---------------------------------- | ------------ |
| `[provider]` | `anthropic`, `openai`, or `ollama` | No (prompts) |

---

### `planr config set-key`

Store an API key securely in `~/.planr/credentials.json`.

```bash
planr config set-key                     # interactive prompt
planr config set-key anthropic           # set for specific provider
```

| Argument     | Description             | Required     |
| ------------ | ----------------------- | ------------ |
| `[provider]` | `anthropic` or `openai` | No (prompts) |

---

### `planr config set-model`

Set the AI model to use for content generation.

```bash
planr config set-model claude-sonnet-4-20250514
planr config set-model gpt-4o
```

| Argument  | Description                                                         | Required |
| --------- | ------------------------------------------------------------------- | -------- |
| `<model>` | Model name (e.g., `claude-sonnet-4-20250514`, `gpt-4o`, `llama3.1`) | **Yes**  |

Requires AI provider to be configured first (`planr config set-provider`).

---

### `planr config set-agent`

Set the default coding agent for task implementation guidance.

```bash
planr config set-agent                   # interactive prompt
planr config set-agent cursor            # set directly
```

| Argument  | Description                    | Required     |
| --------- | ------------------------------ | ------------ |
| `[agent]` | `claude`, `cursor`, or `codex` | No (prompts) |

---

### `planr linear init`

Authenticate to [Linear](https://linear.app) with a personal access token, choose a team, and save `linear.teamId` and `linear.teamKey` in `.planr/config.json`. The token is stored via the credentials service (or the `PLANR_LINEAR_TOKEN` environment variable) and is never written into `config.json`.

```bash
planr linear init
```

### `planr linear sync`

**Two steps in one command:** (1) fetch the current **workflow state name** for every Feature and Story with a `linearIssueId` and map it to OpenPlanr `status` (same rules as `linear.statusMap`); (2) run **task checklist** sync (`TASK-*.md` ↔ Linear) for all task files that share a `linearIssueId` (see `planr linear tasklist-sync`). Use `--verbose` to log per-artifact work.

```bash
planr linear sync
planr linear sync --dry-run
planr linear sync --on-conflict linear
planr --verbose linear sync
```

| Option | Description |
| ------ | ----------- |
| `--dry-run` | Read from Linear to compare, but do **not** write local frontmatter or Linear issue bodies. |
| `--on-conflict` | `prompt` (default), `local`, or `linear` for checkbox merge (same as `tasklist-sync`). |

**Config:** `linear.statusMap` — keys are Linear state names (e.g. `"Code Review"`), values are one of `pending`, `in-progress`, `done`. Custom teams merge with built-in defaults. See `planr linear status` (below) to inspect which artifacts have Linear ids.

### `planr linear status`

**Local only** — no Linear API. Prints a text table: OpenPlanr id, Linear identifier, URL, last-known `status` (or em dash for epics), and a note for malformed or stale `linearIssueId` values (e.g. a workflow state uuid mistaken for an issue id).

```bash
planr linear status
planr linear status --scope EPIC-001
```

### `planr linear push`

Create or update Linear entities for any planning artifact, at the smallest scope the id implies. Accepts any supported prefix — `EPIC-`, `FEAT-`, `US-`, `TASK-`, `QT-`, `BL-` — and writes `linearProject*` / `linearIssue*` / `linearMilestoneId` / `linearLabelId` / `linearProjectMilestoneId` / `linearLabelIds` / `linearTaskChecklistSyncedAt` back to artifact frontmatter. Requires `planr linear init` and a team id in config.

```bash
planr linear push EPIC-001                              # full subtree: project + features + stories + tasklists + linked QT/BL
planr linear push FEAT-015                              # just one feature + its stories + its tasklist
planr linear push US-054                                # just one story
planr linear push TASK-015                              # just one tasklist sub-issue
planr linear push QT-007                                # standalone quick task (or epic-linked if QT has epicId)
planr linear push BL-001                                # backlog item (auto `backlog` label)
planr linear push EPIC-001 --dry-run                    # local preview only; no Linear API calls
planr linear push EPIC-001 --update-only                # only update existing linked entities
planr linear push FEAT-015 --push-parents               # if the parent epic isn't pushed yet, push it first without prompting
planr linear push EPIC-001 --as milestone-of:<projectId># first-time mapping strategy override
```

| Argument / option           | Description                                                                                                                                    | Required |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| `<artifactId>`              | Any supported prefix — `EPIC-`, `FEAT-`, `US-`, `TASK-`, `QT-`, `BL-`                                                                          | **Yes**  |
| `--dry-run`                 | Print planned creates/updates/skips from disk; does not read credentials or call Linear                                                        | No       |
| `--update-only`             | Update only objects that already have a Linear id in frontmatter; do not create new project or issues                                          | No       |
| `--push-parents`            | If a parent in the chain is not yet pushed to Linear, push it first without prompting                                                          | No       |
| `--as <strategy>`           | Epic-only: mapping strategy. One of `project` \| `milestone-of:<projectId>` \| `label-on:<projectId>`                                          | No       |

**Epic mapping strategies**

Every epic is mapped to Linear in one of three shapes, chosen once and stored in `linearMappingStrategy` on the epic's frontmatter:

| Strategy                    | Linear shape                                                                 | When it fits                                                                                  |
| --------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `project` (default)         | Epic = Linear Project (one-to-one, the v1 behavior)                          | Large epic with its own roadmap + independent lifecycle                                       |
| `milestone-of:<projectId>`  | Epic becomes a `ProjectMilestone` inside an existing Linear project; descendants carry `projectMilestoneId` | Epic is a phase of a larger initiative; keeps cross-epic visibility on one Linear board       |
| `label-on:<projectId>`      | Epic becomes a team-scoped label; descendants carry `labelIds` (merged with user-added labels, never stomped) | Small epic / mini-initiative that shouldn't own its own project scaffolding                   |

First-time push prompts interactively; CI consumers use `--as` or `linear.defaultEpicStrategy` in config. Re-strategizing an already-mapped epic is a separate flow and not supported here.

**Parent-chain pre-flight**

Granular pushes (`FEAT-`, `US-`, `TASK-`) refuse to run when their parent chain isn't mapped to Linear yet, with a pointer to the command that fixes it. `--push-parents` cascades up instead of bailing. `ADR-` and `SPRINT-` aren't pushable (they're not synced to Linear); the router errors with a pointer to the parent epic.

**Standalone project for QT / BL**

Quick tasks and backlog items push as top-level issues in a user-chosen standalone Linear project (`linear.standaloneProjectId`). First-time QT/BL push prompts you to pick or create one; after that it's silent. Backlog items automatically get a team-scoped `backlog` label; every issue type gets its kind label (`feature`, `story`, `task`, `quick-task`, `backlog` — overridable via `linear.typeLabels`).

**Epic-linked QT / BL**

A QT or BL file with `epicId: "EPIC-XXX"` (or legacy `parentEpic`) in frontmatter is pulled into that epic's Linear container instead of the standalone project. `planr linear push EPIC-XXX` cascades to every linked QT/BL. Unlinked ones stay in the standalone project. `planr quick create --epic`, `planr backlog add --epic`, and `planr backlog promote --quick --epic` set the link at creation time.

**Mapping:** Epic → Linear project (or milestone / label — see strategies above); feature → top-level issue; story → sub-issue of the feature issue; per-feature merged task list → sub-issue; linked QT/BL → top-level issue in the epic's container. Optional `linear.pushStateIds` maps `pending` / `in-progress` / `done` to Linear workflow **state id** (uuid). Optional `linear.defaultProjectLead` is the Linear user id for project `leadId`. See `planr linear sync` for pulling status **from** Linear into frontmatter.

**Idempotency:** Re-running the command updates the same project and issues when Linear ids are already stored in frontmatter. No duplicate creates.

**Resilience:** A malformed artifact file (unparseable frontmatter, missing title, broken YAML) is skipped with a clear warning and the rest of the push proceeds — one broken file no longer aborts the whole run.

### `planr linear tasklist-sync`

Bidirectionally sync **checkbox** state between local `TASK-*.md` files and the corresponding Linear **TaskList** issues (`linearIssueId` in frontmatter). OpenPlanr reuses a single Linear issue for multiple task files in the same feature by using `## TASK-...` sections; a single file maps to the whole description. A three-way merge uses `linearChecklistReconciled` in each task’s frontmatter as the last known agreement; on divergence you can be prompted, or set `--on-conflict local` or `--on-conflict linear` (e.g. in CI).

```bash
planr linear tasklist-sync
planr linear tasklist-sync --on-conflict linear
```

| Argument / option        | Description | Required |
| ------------------------ | ----------- | -------- |
| `--on-conflict <mode>`   | `prompt` (default), `local`, or `linear` when local and Linear disagree | No |

---

### `planr github push`

Push planning artifacts to GitHub Issues. Requires `gh` CLI to be installed and authenticated (`gh auth login`).

```bash
planr github push EPIC-001              # push a single artifact
planr github push --epic EPIC-001       # push all artifacts under an epic
planr github push --all                 # push all artifacts
```

| Argument/Option   | Description                         | Required                                    |
| ----------------- | ----------------------------------- | ------------------------------------------- |
| `[artifactId]`    | Single artifact ID to push          | One of `[artifactId]`, `--epic`, or `--all` |
| `--epic <epicId>` | Push all artifacts under an epic    | One of `[artifactId]`, `--epic`, or `--all` |
| `--all`           | Push all artifacts across all types | One of `[artifactId]`, `--epic`, or `--all` |

**What it does:**

- Creates a GitHub Issue for each artifact with type-specific formatting (metadata tables, section ordering, collapsible details)
- Labels issues automatically (`planr:epic`, `planr:feature`, `planr:story`, `planr:task`)
- Stores the GitHub issue number in artifact frontmatter (`githubIssue: 123`) for future syncing
- On subsequent pushes, updates the existing issue instead of creating a duplicate
- If a linked issue was deleted on GitHub, gracefully creates a new one

---

### `planr github sync`

Bi-directional status sync between local artifacts and GitHub Issues.

```bash
planr github sync                       # interactive conflict resolution (both directions)
planr github sync --direction pull      # GitHub → local (update local status from issue state)
planr github sync --direction push      # local → GitHub (update issue state from local status)
planr github sync --direction both      # both with interactive conflict resolution (default)
```

| Option              | Description               | Default |
| ------------------- | ------------------------- | ------- |
| `--direction <dir>` | `pull`, `push`, or `both` | `both`  |

**Status mapping:**

- GitHub `open` → local `in-progress` / `draft`
- GitHub `closed` → local `done` / `accepted`
- Local `done` → closes the GitHub issue
- Conflicts (both changed) → interactive prompt to choose which side wins

---

### `planr github status`

Show sync status of all linked artifacts.

```bash
planr github status
```

Displays a table of all artifacts that have a `githubIssue` field, showing local status vs GitHub issue state and whether they are in sync.

---

### `planr report`

Generate a stakeholder report from `.planr/` artifacts and (optionally) recent GitHub activity. Templates live in `src/templates/reports/`. See [docs/EPIC-PM-REPORTING-LAYER.md](EPIC-PM-REPORTING-LAYER.md) for the design and what is shipped vs deferred.

```bash
planr report weekly                                   # markdown to .planr/reports/
planr report sprint --sprint SPRINT-001               # sprint summary for one sprint
planr report executive --format html                  # HTML wrapper around the markdown
planr report weekly --stdout                          # print to stdout, no file
planr report weekly --no-github                       # skip the gh API calls
planr report weekly --lint                            # run the quality linter on the output
planr report weekly --strict-evidence                 # fail if bullet claims lack URLs or #issue refs
planr report weekly --push slack --dry-run            # show what would be posted to Slack
planr report sprint --push github                     # archive as a planr:report GitHub issue
```

| Option                | Description                                                                              | Default            |
| --------------------- | ---------------------------------------------------------------------------------------- | ------------------ |
| `<type>`              | `sprint`, `weekly`, `executive`, `standup`, `retro`, `release`                           | **Required**       |
| `--sprint <id>`       | Sprint id for sprint-scoped reports (e.g. `SPRINT-001`)                                  | Active sprint      |
| `--days <n>`          | GitHub commit/PR lookback window                                                         | `7`                |
| `--no-github`         | Skip the GitHub signal collection                                                        | GitHub enabled     |
| `--format <fmt>`      | `markdown` or `html`. `pdf` exits with a clear "not bundled" message.                    | `markdown`         |
| `--output <dir>`      | Write outputs under this directory (relative to project)                                 | `.planr/reports`   |
| `--stdout`            | Print markdown to stdout instead of writing a file                                       | `false`            |
| `--lint`              | Run the report quality linter on the generated markdown                                  | `false`            |
| `--strict-evidence`   | Fail if substantive bullets under `##` (except **Evidence**) lack URLs or `#NNN` refs; skips full-line `_placeholder_` bullets | `false`            |
| `--push <targets>`    | Comma-separated channels: `github`, `slack`                                              | None               |
| `--dry-run`           | With `--push`, show actions without sending (Slack dry-run works without a webhook)      | `false`            |

**Output files:** `.planr/reports/<YYYY-MM-DD>-<reportType>-report.md` (and `.html` when `--format html`, same basename). Example: `2026-04-19-weekly-report.md`.

**Configuration (`.planr/config.json`):**

```json
{
  "reports": {
    "orgName": "Acme",
    "accentColor": "#0a84ff",
    "logoUrl": "https://example.com/logo.png",
    "customSections": {
      "Compliance": "SOC2 controls verified weekly."
    }
  },
  "templateOverrides": "./reports-overrides",
  "distribution": {
    "slackWebhookUrl": "https://hooks.slack.com/services/...",
    "slackChannel": "#eng-updates"
  }
}
```

`slackChannel` is reserved for future use; Incoming Webhooks target the channel encoded in the webhook URL. All blocks are optional; the command works against a freshly initialized project.

---

### `planr report-linter`

Lint an existing stakeholder markdown file (or stdin) against the same rules `planr report --lint` runs.

```bash
planr report-linter ./drafts/weekly.md --type weekly
cat drafts/sprint.md | planr report-linter --type sprint
```

| Option         | Description                                                                          | Default    |
| -------------- | ------------------------------------------------------------------------------------ | ---------- |
| `[file]`       | Markdown file to lint. If omitted, the command reads from stdin.                     | stdin      |
| `--type <t>`   | Report type for rule selection: `sprint`, `weekly`, `executive`, `standup`, `retro`, `release` | `weekly` |

Findings include rule id, severity, message, and an optional suggestion. Coaching hints are emitted alongside. Exit code is non-zero when any error-severity finding is produced.

Default rules cover vague language, evidence density (URLs / `#issue` refs), and required sections per report type. Extend or override via `reportLinter` in `.planr/config.json`:

```json
{
  "reportLinter": {
    "rules": [
      { "id": "evidence-density", "enabled": true, "minEvidenceLinks": 1 },
      { "id": "weekly-structure", "enabled": true, "requireSections": ["Wins", "Risks", "Ask"] }
    ],
    "vaguePhrases": [
      { "pattern": "\\balmost done\\b", "alternatives": ["Completed 3 of 5 stories"] }
    ]
  }
}
```

---

### `planr context`

Print the report context pack — artifacts, sprint state, GitHub signals, and the flat evidence index — as JSON for piping into other tools.

```bash
planr context --report-type weekly
planr context --report-type sprint --sprint SPRINT-001 --days 14
planr context --report-type weekly | jq '.evidence | length'
```

| Option                 | Description                                                                  | Default    |
| ---------------------- | ---------------------------------------------------------------------------- | ---------- |
| `--report-type <type>` | Logical report type for placeholders (`sprint`, `weekly`, …, `release`)      | `weekly`   |
| `--sprint <id>`        | Sprint id when relevant                                                      | Active     |
| `--days <n>`           | GitHub lookback window                                                       | `7`        |
| `--no-github`          | Omit GitHub signals from the context pack                                    | Enabled    |

The JSON payload is written to stdout; a one-line summary (`context: <n> evidence items`) is logged to stderr.

---

### `planr voice standup`

Convert a transcript file (or stdin) into structured standup markdown using a heuristic Yesterday / Today / Blockers parser. Live microphone capture and bundled speech-to-text are intentionally **not** part of v1 — pair this with any STT or OS dictation tool that produces text.

```bash
planr voice standup --file standups/2026-04-19.txt
planr voice standup --file t.txt --lint
planr voice standup --file t.txt --append-story US-029
planr voice standup --file t.txt --edit          # interactive: open $EDITOR before saving
planr voice standup --file t.txt --reload-file   # interactive: re-read file after editing externally
```

| Option                       | Description                                                                                  | Default       |
| ---------------------------- | -------------------------------------------------------------------------------------------- | ------------- |
| `--file <path>`              | Transcript text file. If omitted, the command reads stdin.                                   | stdin         |
| `--write <path>`             | Write the generated markdown to this path (relative to project, or absolute)                 | None          |
| `--edit`                     | Open the generated markdown in `$EDITOR` before output / save (interactive sessions only)    | `false`       |
| `--reload-file`              | After generating, offer to re-read `--file` from disk (interactive + `--file` only)          | `false`       |
| `--append-story <storyId>`   | Append the standup under `## Standup notes` on this story                                    | None          |
| `--lint`                     | Run the standup through the report linter                                                    | `false`       |

Per-segment audio replay is reserved (`TranscriptSegment.audioOffsetMs` exists in the schema) but not implemented in v1.

---

### `planr story standup`

Append linted standup notes from a transcript directly onto an existing user story. This is the convenience entry point when you already know which story the standup belongs to.

```bash
planr story standup --story US-029 --file standups/2026-04-19.txt --lint
cat ramble.txt | planr story standup --story US-029
```

| Option                 | Description                                                          | Required     |
| ---------------------- | -------------------------------------------------------------------- | ------------ |
| `--story <storyId>`    | Target story (e.g. `US-029`)                                         | **Yes**      |
| `--file <path>`        | Transcript file. If omitted, the command reads stdin.                | No (stdin)   |
| `--lint`               | Run the report linter before appending; non-zero exit on errors      | `false`      |

Notes are appended under a `## Standup notes` section; existing content is preserved.

---

### `planr export`

Generate a consolidated planning report in markdown, JSON, or HTML format.

```bash
planr export                                    # markdown report in current directory
planr export --format html                      # self-contained HTML report
planr export --format json                      # machine-readable JSON
planr export --format html --scope EPIC-001     # only artifacts under one epic
planr export --output ./reports                 # custom output directory
```

| Option              | Description                                  | Default                 |
| ------------------- | -------------------------------------------- | ----------------------- |
| `--format <format>` | Output format: `markdown`, `json`, or `html` | `markdown`              |
| `--scope <epicId>`  | Only export artifacts under a specific epic  | All artifacts           |
| `--output <path>`   | Output file or directory                     | `.` (current directory) |

**Output formats:**

- **Markdown** — hierarchical report with all artifact details, nested under epics → features → stories → tasks
- **JSON** — structured data with full hierarchy, counts, and metadata for programmatic consumption
- **HTML** — self-contained file with inline CSS, collapsible `<details>` sections, color-coded status badges, and full hierarchy rendering

---

## Workflow

There are two main workflows — the **agile hierarchy** for structured planning, and the **backlog + sprint** flow for day-to-day work:

```text
# Agile Hierarchy
planr init
  └─ planr epic create
       └─ planr feature create --epic EPIC-001
            └─ planr story create --feature FEAT-001   (single feature)
            └─ planr story create --epic EPIC-001     (all features at once)
                 ├─ planr task create --story US-001   (one story + feature/epic/Gherkin/ADRs/codebase)
                 ├─ planr task create --feature FEAT-001   (all stories in feature + same artifact context; larger AI budget)
                 └─ planr rules generate           (generate agent rules for implementation)

planr plan                  ← full automated flow (Epic → Features → Stories → Tasks)

# Backlog & Sprint
planr backlog add "..."     ← capture ideas as they come
planr backlog prioritize    ← AI sorts by impact/effort
planr backlog promote BL-001 --quick   ← move to task when ready

planr sprint create --name "Sprint 1" --duration 2w
planr sprint add TASK-001 QT-001       ← assign tasks (or --auto for AI)
planr sprint status                    ← track progress
planr sprint close                     ← archive sprint

# Templates
planr template use rest-endpoint --title "User API"   ← generate from pattern

# Tools
planr refine EPIC-001       ← AI review and improvement suggestions
planr estimate US-001       ← AI effort estimation
planr sync                  ← validate and fix cross-references
planr rules generate        ← generate AI rules from your artifacts
planr status                ← see progress overview
planr github push --all     ← push artifacts to GitHub Issues
planr github sync           ← bi-directional status sync with GitHub
planr export --format html  ← generate planning report
```

---

## ID Convention

| Artifact   | Prefix   | Example      |
| ---------- | -------- | ------------ |
| Epic       | `EPIC`   | EPIC-001     |
| Feature    | `FEAT`   | FEAT-001     |
| User Story | `US`     | US-001       |
| Task List  | `TASK`   | TASK-001     |
| Quick Task | `QT`     | QT-001       |
| Backlog    | `BL`     | BL-001       |
| Sprint     | `SPRINT` | SPRINT-001   |

---

## Config File

`.planr/config.json` stores project settings:

```json
{
  "projectName": "my-project",
  "targets": ["cursor", "claude", "codex"],
  "outputPaths": {
    "agile": ".planr",
    "cursorRules": ".cursor/rules",
    "claudeConfig": ".",
    "codexConfig": "."
  },
  "idPrefix": {
    "epic": "EPIC",
    "feature": "FEAT",
    "story": "US",
    "task": "TASK",
    "quick": "QT",
    "backlog": "BL",
    "sprint": "SPRINT"
  },
  "createdAt": "2026-03-26"
}
```
