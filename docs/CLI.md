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

| Flag | Description | Default |
|------|-------------|---------|
| `--project-dir <path>` | Set project root directory | Current directory |
| `--verbose` | Enable verbose output | `false` |
| `--no-interactive` | Skip interactive prompts (use defaults) | `false` |
| `-V, --version` | Print version | — |
| `-h, --help` | Show help | — |

---

## Commands

### `planr init`

Initialize Planr in the current project.

```bash
planr init
planr init --name "my-project"
planr init --no-ai
```

| Option | Description | Required |
|--------|-------------|----------|
| `--name <name>` | Project name | No (prompts) |
| `--no-ai` | Skip AI provider setup | No |

**What it creates:**

```
project-root/
├── planr.config.json          # Project configuration
└── docs/agile/
    ├── epics/
    ├── features/
    ├── stories/
    ├── tasks/
    ├── adrs/
    ├── checklists/
    │   └── agile-checklist.md  # Development checklist
    └── diagrams/
```

---

### `planr epic create`

Create a new epic. With AI configured, provide a brief description and the AI expands it into a full epic.

```bash
planr epic create
planr epic create --title "User Authentication" --owner "Engineering"
planr epic create --manual
```

| Option | Description | Required |
|--------|-------------|----------|
| `--title <title>` | Epic title | No (prompts) |
| `--owner <owner>` | Epic owner | No (prompts) |
| `--manual` | Use manual interactive prompts instead of AI | No |

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

**Output:** `docs/agile/epics/EPIC-001-<slug>.md`

---

### `planr epic list`

List all epics.

```bash
planr epic list
```

**Example output:**

```
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

| Option | Description | Required |
|--------|-------------|----------|
| `--epic <epicId>` | Parent epic ID | **Yes** |
| `--title <title>` | Feature title (manual mode) | No (prompts) |
| `--count <n>` | Number of features to generate (AI mode) | No (AI decides) |
| `--manual` | Use manual interactive prompts instead of AI | No |

**Interactive prompts:**

1. Feature title
2. Owner
3. Overview
4. Functional requirements (comma-separated)
5. Dependencies (default: "None")
6. Technical considerations (default: "None")
7. Risks (default: "None")
8. Success metrics

**Output:** `docs/agile/features/FEAT-001-<slug>.md`

---

### `planr feature list`

List all features.

```bash
planr feature list
planr feature list --epic EPIC-001    # filter by epic
```

| Option | Description | Required |
|--------|-------------|----------|
| `--epic <epicId>` | Filter by epic ID | No |

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

| Option | Description | Required |
|--------|-------------|----------|
| `--feature <featureId>` | Parent feature ID | One of `--feature` or `--epic` |
| `--epic <epicId>` | Parent epic ID — generates stories for all features | One of `--feature` or `--epic` |
| `--title <title>` | Story title (manual mode only) | No |
| `--manual` | Use manual prompts instead of AI (single feature only) | No |

**Interactive prompts:**

1. Story title
2. As a (role)
3. I want to (goal)
4. So that (benefit)
5. Additional notes (optional)

**Output — two files:**

```
docs/agile/stories/
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

| Option | Description | Required |
|--------|-------------|----------|
| `--feature <featureId>` | Filter by feature ID | No |

---

### `planr task create`

Create an implementation task list from a story or feature. With AI configured, gathers comprehensive context for intelligent task generation.

```bash
planr task create --story US-001                    # from a single story
planr task create --feature FEAT-001                # from all stories in a feature
planr task create --story US-001 --title "Tasks"    # with custom title
planr task create --story US-001 --manual           # manual mode
```

| Option | Description | Required |
|--------|-------------|----------|
| `--story <storyId>` | Create tasks from a single story | One of `--story` or `--feature` |
| `--feature <featureId>` | Create tasks from all stories in a feature | One of `--story` or `--feature` |
| `--title <title>` | Task list title | No (AI generates it) |
| `--manual` | Use manual interactive prompts instead of AI | No |

**What it gathers (AI mode):**

When AI is configured, the command gathers comprehensive context:
- User stories (one or all under a feature)
- Gherkin acceptance criteria files
- Parent feature and epic content
- Architecture Decision Records (ADRs)
- Codebase structure and tech stack

The AI generates grouped subtasks with acceptance criteria mapping and relevant files.

**Manual mode:** If AI is not configured, prompts for task names (comma-separated).

**Output:** `docs/agile/tasks/TASK-001-<slug>.md`

---

### `planr task list`

List all task lists.

```bash
planr task list
planr task list --story US-001    # filter by story
```

| Option | Description | Required |
|--------|-------------|----------|
| `--story <storyId>` | Filter by story ID | No |

---

### `planr task implement`

Display a task list and guidance on implementing with AI agents.

```bash
planr task implement TASK-001
```

| Argument | Description | Required |
|----------|-------------|----------|
| `<taskId>` | Task list ID | **Yes** |

**Output:** Prints the full task list content and recommends using your AI assistant with generated rules.

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

| Option | Description | Default |
|--------|-------------|---------|
| `--target <target>` | `cursor`, `claude`, `codex`, or `all` | `all` |
| `--dry-run` | Show what would be generated | `false` |

**Generated files by target:**

| Target | Output |
|--------|--------|
| Cursor | `.cursor/rules/200x-*.mdc` (6 rule files) |
| Claude | `CLAUDE.md` |
| Codex | `AGENTS.md` |

---

### `planr plan`

Full agile planning flow in a single command. Cascades through the hierarchy: Epic → Features → Stories → Tasks.

```bash
planr plan                          # start from scratch (creates epic first)
planr plan --epic EPIC-001          # start from existing epic → features → stories → tasks
planr plan --feature FEAT-001       # start from existing feature → stories → tasks
planr plan --story US-001           # start from existing story → tasks only
```

| Option | Description | Required |
|--------|-------------|----------|
| `--epic <epicId>` | Start from an existing epic | No |
| `--feature <featureId>` | Start from an existing feature | No |
| `--story <storyId>` | Start from an existing story | No |

When no flag is provided, the command prompts for an epic brief and cascades through the full hierarchy. Each step asks for confirmation before proceeding to the next level.

Requires AI to be configured (`planr config set-provider`).

---

### `planr refine`

AI-powered review and improvement suggestions for any existing artifact.

```bash
planr refine EPIC-001               # review an epic
planr refine FEAT-002               # review a feature
planr refine US-003                  # review a user story
```

| Argument | Description | Required |
|----------|-------------|----------|
| `<artifactId>` | Any artifact ID (EPIC-001, FEAT-002, US-003, TASK-004) | **Yes** |

The AI analyzes the artifact and provides:
1. A list of improvement suggestions
2. An improved version of the artifact

After review, you can:
- **Apply** — write the improved version to disk
- **View** — preview the improved version, then choose to apply or skip
- **Skip** — keep the original unchanged

Requires AI to be configured.

---

### `planr sync`

Validate and repair cross-references across all artifacts.

```bash
planr sync                          # fix broken cross-references
planr sync --dry-run                # preview changes without writing
```

| Option | Description | Default |
|--------|-------------|---------|
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

| Option | Description | Default |
|--------|-------------|---------|
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

| Argument | Description | Required |
|----------|-------------|----------|
| `[provider]` | `anthropic`, `openai`, or `ollama` | No (prompts) |

---

### `planr config set-key`

Store an API key securely in `~/.planr/credentials.json`.

```bash
planr config set-key                     # interactive prompt
planr config set-key anthropic           # set for specific provider
```

| Argument | Description | Required |
|----------|-------------|----------|
| `[provider]` | `anthropic` or `openai` | No (prompts) |

---

### `planr config set-model`

Set the AI model to use for content generation.

```bash
planr config set-model claude-sonnet-4-20250514
planr config set-model gpt-4o
```

| Argument | Description | Required |
|----------|-------------|----------|
| `<model>` | Model name (e.g., `claude-sonnet-4-20250514`, `gpt-4o`, `llama3.1`) | **Yes** |

Requires AI provider to be configured first (`planr config set-provider`).

---

### `planr config set-agent`

Set the default coding agent for task implementation guidance.

```bash
planr config set-agent                   # interactive prompt
planr config set-agent cursor            # set directly
```

| Argument | Description | Required |
|----------|-------------|----------|
| `[agent]` | `claude`, `cursor`, or `codex` | No (prompts) |

---

## Workflow

The typical agile planning flow follows this hierarchy:

```
planr init
  └─ planr epic create
       └─ planr feature create --epic EPIC-001
            └─ planr story create --feature FEAT-001   (single feature)
            └─ planr story create --epic EPIC-001     (all features at once)
                 └─ planr task create --story US-001
                      └─ planr task implement TASK-001

planr plan                  ← full automated flow (Epic → Features → Stories → Tasks)
planr refine EPIC-001       ← AI review and improvement suggestions
planr sync                  ← validate and fix cross-references
planr rules generate        ← generate AI rules from your artifacts
planr status                ← see progress overview
```

---

## ID Convention

| Artifact | Prefix | Example |
|----------|--------|---------|
| Epic | `EPIC` | EPIC-001 |
| Feature | `FEAT` | FEAT-001 |
| User Story | `US` | US-001 |
| Task List | `TASK` | TASK-001 |

---

## Config File

`planr.config.json` stores project settings:

```json
{
  "projectName": "my-project",
  "targets": ["cursor", "claude", "codex"],
  "outputPaths": {
    "agile": "docs/agile",
    "cursorRules": ".cursor/rules",
    "claudeConfig": ".",
    "codexConfig": "."
  },
  "idPrefix": {
    "epic": "EPIC",
    "feature": "FEAT",
    "story": "US",
    "task": "TASK"
  },
  "createdAt": "2026-03-26"
}
```
