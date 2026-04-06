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

## Global Options

These options apply to **all** commands:

| Flag                   | Description                             | Default           |
| ---------------------- | --------------------------------------- | ----------------- |
| `--project-dir <path>` | Set project root directory              | Current directory |
| `--verbose`            | Enable verbose output                   | `false`           |
| `--no-interactive`     | Skip interactive prompts (use defaults) | `false`           |
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
```

| Option               | Description                                                  | Default      |
| -------------------- | ------------------------------------------------------------ | ------------ |
| `<description>`      | Item description                                             | **Required** |
| `--priority <level>` | `critical`, `high`, `medium`, or `low`                       | `medium`     |
| `--tag <tag>`        | Tag for categorization (e.g., `bug`, `feature`, `tech-debt`) | None         |

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
planr backlog promote BL-001 --quick              # promote to quick task
planr backlog promote BL-001 --story --feature FEAT-001   # promote to story
```

| Option                  | Description                              | Required                      |
| ----------------------- | ---------------------------------------- | ----------------------------- |
| `<itemId>`              | Backlog item ID                          | **Yes**                       |
| `--quick`               | Promote to a quick task                  | One of `--quick` or `--story` |
| `--story`               | Promote to a user story                  | One of `--quick` or `--story` |
| `--feature <featureId>` | Parent feature (required with `--story`) | With `--story`                |

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
```

| Option          | Description                            | Required     |
| --------------- | -------------------------------------- | ------------ |
| `<description>` | Task description                       | No (prompts) |
| `--file <path>` | Generate tasks from a PRD or spec file | No           |
| `--manual`      | Interactive task entry without AI      | No           |

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
