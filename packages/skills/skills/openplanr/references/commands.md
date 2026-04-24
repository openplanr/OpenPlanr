# OpenPlanr Command Reference

Complete catalog of `planr` commands, formatted for agent consumption. For authoritative flag documentation, see the canonical [CLI reference](https://github.com/openplanr/openplanr/blob/main/docs/CLI.md) in the CLI repo.

**Binary:** `planr` (alias: `opr`). **Package:** `openplanr` on npm. **Node:** 20+.

**Invocation:** Prefer `planr <cmd>` if the binary is on PATH; otherwise `npx openplanr@latest <cmd>`.

**Global flags** apply to every command below and are omitted from individual tables for brevity:

| Flag | Description |
|------|-------------|
| `-y`, `--yes` | Auto-accept all prompts (alias for `--no-interactive`) — **required in agent mode** |
| `--no-interactive` | Skip interactive prompts (use defaults) |
| `--project-dir <path>` | Set project root (default: cwd) |
| `--verbose` | Verbose output |
| `-V`, `--version` | Print version |
| `-h`, `--help` | Show help |

---

## Project setup

### `planr init`

Initialize `.planr/` in the current project.

**Usage:**
```bash
planr init --name "my-project" --yes
planr init --no-ai --yes
```

**Key options:**
| Flag | Description |
|------|-------------|
| `--name <name>` | Project name (prompts otherwise) |
| `--no-ai` | Skip AI provider setup |

**When Claude should use:** Any planning request in a repo that has no `.planr/config.json`.

**Output:** `.planr/` scaffolded with `config.json`, `epics/`, `features/`, `stories/`, `tasks/`, `quick/`, `backlog/`, `sprints/`, `templates/`, `adrs/`, `checklists/agile-checklist.md`, `diagrams/`.

---

### `planr plan`

Full automated flow: Epic → Features → Stories → Tasks. The agent-friendly entry point for "plan this out" requests.

**Usage:**
```bash
planr plan --yes                        # start from an epic brief
planr plan --epic EPIC-001 --yes        # resume from an existing epic
planr plan --feature FEAT-001 --yes     # start from feature
planr plan --story US-001 --yes         # tasks only
```

**Key options:**
| Flag | Description |
|------|-------------|
| `--epic <epicId>` | Start from an existing epic |
| `--feature <featureId>` | Start from an existing feature |
| `--story <storyId>` | Tasks only for a given story |

**When Claude should use:** "Plan out <feature/project>", "break this PRD into tasks", "do the full agile plan."

**Output:** Cascaded artifacts under `.planr/epics/`, `features/`, `stories/`, `tasks/`. Requires AI configured.

---

## Epics

### `planr epic create`

Create an epic. With AI configured, expands a brief into a full epic. Use `--file` to feed a PRD.

**Usage:**
```bash
planr epic create --title "User Authentication" --owner "Eng" --yes
planr epic create --file ./prd.md --yes
```

**Key options:**
| Flag | Description |
|------|-------------|
| `--title <title>` | Epic title or brief |
| `--file <path>` | Read from a PRD/spec file |
| `--owner <owner>` | Epic owner |
| `--manual` | Skip AI — interactive only (not agent-compatible) |

**When Claude should use:** "Create an epic for X", "turn this PRD into an epic."

**Output:** `.planr/epics/EPIC-NNN-<slug>.md`

---

### `planr epic list`

List all epics.

**Usage:**
```bash
planr epic list
```

**When Claude should use:** "Show epics", "what epics do we have?"

---

## Features

### `planr feature create`

Generate features under an epic. AI reads the epic and produces multiple features automatically.

**Usage:**
```bash
planr feature create --epic EPIC-001 --yes
planr feature create --epic EPIC-001 --count 5 --yes
planr feature create --epic EPIC-001 --title "OAuth Login" --yes
```

**Key options:**
| Flag | Description |
|------|-------------|
| `--epic <epicId>` | Parent epic (required) |
| `--title <title>` | Manual single-feature title |
| `--count <n>` | Number of features to generate (AI mode) |
| `--manual` | Skip AI (not agent-compatible) |

**When Claude should use:** "Break this epic into features", "generate features for EPIC-XXX."

**Output:** `.planr/features/FEAT-NNN-<slug>.md` (one per generated feature)

---

### `planr feature list`

List features, optionally filtered by epic.

**Usage:**
```bash
planr feature list
planr feature list --epic EPIC-001
```

---

## User stories

### `planr story create`

Create user stories from a feature, or batch-generate for all features under an epic.

**Usage:**
```bash
planr story create --feature FEAT-001 --yes
planr story create --epic EPIC-001 --yes         # all features under epic
```

**Key options:**
| Flag | Description |
|------|-------------|
| `--feature <featureId>` | Parent feature (single-feature mode) |
| `--epic <epicId>` | Batch across every feature in the epic |
| `--title <title>` | Manual mode only |
| `--manual` | Skip AI (single feature only; not agent-compatible) |

**When Claude should use:** "Write user stories for FEAT-XXX", "generate stories for every feature under EPIC-XXX."

**Output:** For each story: `.planr/stories/US-NNN-<slug>.md` + `US-NNN-gherkin.feature`.

---

### `planr story list`

List stories, optionally filtered by feature.

**Usage:**
```bash
planr story list
planr story list --feature FEAT-001
```

---

### `planr story standup`

Append linted standup notes from a transcript onto an existing story.

**Usage:**
```bash
planr story standup --story US-029 --file standups/today.txt --lint
```

**Key options:**
| Flag | Description |
|------|-------------|
| `--story <storyId>` | Target story (required) |
| `--file <path>` | Transcript file (stdin if omitted) |
| `--lint` | Run report linter before appending |

**Output:** Appends under `## Standup notes` on the story.

---

## Tasks

### `planr task create`

Generate an implementation task list from a story or feature. Gathers full planning context (story/feature/epic/gherkin/ADRs/codebase) for AI.

**Usage:**
```bash
planr task create --story US-001 --yes
planr task create --feature FEAT-001 --yes       # all stories under feature → single merged list
```

**Key options:**
| Flag | Description |
|------|-------------|
| `--story <storyId>` | One story's tasks |
| `--feature <featureId>` | Merged tasks across all stories in the feature |
| `--title <title>` | Custom task list title |
| `--manual` | Skip AI (`--story` only; not agent-compatible) |

**When Claude should use:** "Break story X into tasks", "generate implementation tasks for FEAT-XXX."

**Output:** `.planr/tasks/TASK-NNN-<slug>.md`

---

### `planr task list`

List task files, optionally filtered by story.

**Usage:**
```bash
planr task list
planr task list --story US-001
```

---

## Quick tasks (no hierarchy)

### `planr quick create`

Standalone task list without the agile hierarchy. Use for one-off fixes.

**Usage:**
```bash
planr quick create "migrate to postgres" --yes
planr quick create --file spec.md --yes
planr quick create "add webhook retry" --epic EPIC-001 --yes
```

**Key options:**
| Flag | Description |
|------|-------------|
| `<description>` | Task description (positional) |
| `--file <path>` | Generate from a spec file |
| `--epic <epicId>` | Link QT to an epic (inherits Linear container) |
| `--manual` | Skip AI (not agent-compatible) |

**When Claude should use:** "Quick task for X", "no need for the full hierarchy", "standalone checklist."

**Output:** `.planr/quick/QT-NNN-<slug>.md`

---

### `planr quick list`

List all quick task lists.

**Usage:**
```bash
planr quick list
```

---

### `planr quick promote`

Graduate a quick task into the agile hierarchy.

**Usage:**
```bash
planr quick promote QT-001 --story US-001
planr quick promote QT-001 --feature FEAT-001
```

**Key options:**
| Flag | Description |
|------|-------------|
| `--story <storyId>` | Attach to existing story |
| `--feature <featureId>` | Attach to existing feature |

---

## Backlog

### `planr backlog add`

Capture a backlog item — idea, bug, or unscoped work.

**Usage:**
```bash
planr backlog add "fix login redirect" --priority critical --tag bug
planr backlog add "rate-limit upload API" --epic EPIC-001
```

**Key options:**
| Flag | Description |
|------|-------------|
| `<description>` | Item description (required) |
| `--priority <level>` | `critical`, `high`, `medium`, `low` (default: `medium`) |
| `--tag <tag>` | Tag (e.g. `bug`, `tech-debt`) |
| `--epic <epicId>` | Link BL to an epic |

**When Claude should use:** "Add to backlog", "capture this idea", "log a bug for later."

**Output:** `.planr/backlog/BL-NNN-<slug>.md`

---

### `planr backlog list`

Filter and list backlog items.

**Usage:**
```bash
planr backlog list --priority high --status open --tag bug
```

**Key options:**
| Flag | Description |
|------|-------------|
| `--tag <tag>` | Filter by tag |
| `--priority <level>` | Filter by priority |
| `--status <status>` | `open`, `closed`, `promoted` |

---

### `planr backlog prioritize`

AI-driven prioritization by impact/effort.

**Usage:**
```bash
planr backlog prioritize --yes
```

**When Claude should use:** "Prioritize the backlog", "rank these by impact."

**Requires:** AI configured.

---

### `planr backlog promote`

Promote a backlog item into the hierarchy or a quick task.

**Usage:**
```bash
planr backlog promote BL-001 --quick --yes
planr backlog promote BL-001 --quick --epic EPIC-001 --yes
planr backlog promote BL-001 --story --feature FEAT-001 --yes
```

**Key options:**
| Flag | Description |
|------|-------------|
| `--quick` | Promote to quick task (AI-generates breakdown from BL body) |
| `--story` | Promote to user story |
| `--feature <featureId>` | Parent feature (with `--story`) |
| `--epic <epicId>` | (`--quick` only) link QT to epic |
| `--manual` | (`--quick` only) single-task from title, skip AI |

**Output:** New QT or story; BL marked as `promoted`.

---

### `planr backlog close`

Close/archive a backlog item.

**Usage:**
```bash
planr backlog close BL-001
```

---

## Sprints

### `planr sprint create`

Create a time-boxed sprint (only one active at a time).

**Usage:**
```bash
planr sprint create --name "Sprint 1" --duration 2w --yes
```

**Key options:**
| Flag | Description |
|------|-------------|
| `--name <name>` | Sprint name (required) |
| `--duration <dur>` | `1w`, `2w`, `3w`, `4w` (required) |

**Output:** `.planr/sprints/SPRINT-NNN-<slug>.md`

---

### `planr sprint add`

Assign tasks to the active sprint.

**Usage:**
```bash
planr sprint add TASK-001 QT-001 --yes
planr sprint add --auto --yes                   # AI picks by priority/velocity
```

**Key options:**
| Flag | Description |
|------|-------------|
| `[taskIds...]` | Explicit task/QT IDs |
| `--auto` | AI auto-selection (requires AI) |

---

### `planr sprint status`

Progress dashboard for active sprint.

**Usage:**
```bash
planr sprint status
```

---

### `planr sprint close`

Archive active sprint; list carry-over candidates.

**Usage:**
```bash
planr sprint close --yes
```

---

### `planr sprint list`

All sprints with status badges.

**Usage:**
```bash
planr sprint list
```

---

### `planr sprint history`

Velocity chart across past sprints.

**Usage:**
```bash
planr sprint history
```

---

## Templates

### `planr template list`

List built-in and custom templates.

**Usage:**
```bash
planr template list
```

**Built-ins:** `rest-endpoint`, `react-component`, `database-migration`, `api-integration`, `auth-flow`.

---

### `planr template show`

Preview a template's content and variables.

**Usage:**
```bash
planr template show rest-endpoint
```

---

### `planr template use`

Generate a task list from a template.

**Usage:**
```bash
planr template use rest-endpoint --title "User Profile API" --yes
```

**Key options:**
| Flag | Description |
|------|-------------|
| `<name>` | Template name (required) |
| `--title <title>` | Generated task list title (required) |

**Output:** `.planr/tasks/TASK-NNN-<slug>.md`

---

### `planr template save`

Save an existing task list as a reusable template.

**Usage:**
```bash
planr template save TASK-001 --name my-pattern
```

---

### `planr template delete`

Remove a custom template (built-ins cannot be deleted).

**Usage:**
```bash
planr template delete my-pattern --yes
```

---

## Refinement & sync

### `planr refine`

AI review and improvement for any artifact. Cascades to children with `--cascade`.

**Usage:**
```bash
planr refine EPIC-001 --yes
planr refine EPIC-001 --cascade --yes
```

**Key options:**
| Flag | Description |
|------|-------------|
| `<artifactId>` | EPIC, FEAT, US, or TASK ID (required) |
| `--cascade` | Refine children after parent |

**When Claude should use:** "Improve this epic", "refine the plan", "review for quality."

**Requires:** AI configured.

---

### `planr sync`

Validate and repair cross-references across artifacts (stale/missing/duplicate parent-child links).

**Usage:**
```bash
planr sync
planr sync --dry-run
```

**When Claude should use:** "Fix broken links", "parent not found", "artifacts are out of sync."

---

### `planr status`

Tree view of all planning progress.

**Usage:**
```bash
planr status
planr status --all       # no truncation
```

**When Claude should use:** "What's our planning status?", "show progress", "how far are we?"

---

## Checklist (agile guide)

### `planr checklist show`

Display the 5-phase agile checklist.

**Usage:**
```bash
planr checklist show
```

---

### `planr checklist toggle`

Interactively toggle checklist items. **Requires human input** — not agent-compatible.

---

### `planr checklist reset`

Reset checklist to initial state.

**Usage:**
```bash
planr checklist reset --yes
```

---

## Agent rules

### `planr rules generate`

Generate AI agent rule files (CLAUDE.md / AGENTS.md / .cursor/rules) from planning artifacts.

**Usage:**
```bash
planr rules generate --yes
planr rules generate --target claude --yes
planr rules generate --dry-run
```

**Key options:**
| Flag | Description |
|------|-------------|
| `--target <t>` | `cursor`, `claude`, `codex`, `all` (default: `all`) |
| `--dry-run` | Preview without writing |

**When Claude should use:** "Generate CLAUDE.md", "create agent rules", "sync rules with the plan."

**Output per target:** `.cursor/rules/200x-*.mdc` (Cursor), `CLAUDE.md` (Claude), `AGENTS.md` (Codex).

---

## Estimation

### `planr estimate`

AI-powered story point estimation for a story or other artifact.

**Usage:**
```bash
planr estimate US-001 --yes
planr estimate US-001 --save --yes     # persists to frontmatter as estimatedPoints
```

**When Claude should use:** "Estimate story points", "how long will US-XXX take?"

**Requires:** AI configured.

---

## Configuration

### `planr config show`

Display current project config (provider, model, key status).

**Usage:**
```bash
planr config show
```

---

### `planr config set-provider`

Set AI provider.

**Usage:**
```bash
planr config set-provider anthropic
```

**Values:** `anthropic`, `openai`, `ollama`.

---

### `planr config set-key`

Store an API key securely in `~/.planr/credentials.json`.

**Usage:**
```bash
planr config set-key anthropic
```

Key is read from stdin/env — agent should prompt the user before invoking.

---

### `planr config set-model`

Set the AI model.

**Usage:**
```bash
planr config set-model claude-sonnet-4-20250514
```

---

### `planr config set-agent`

Default coding agent for generated guidance.

**Usage:**
```bash
planr config set-agent claude
```

**Values:** `claude`, `cursor`, `codex`.

---

## GitHub integration

### `planr github push`

Push artifacts to GitHub Issues. Requires `gh` CLI authenticated.

**Usage:**
```bash
planr github push EPIC-001 --yes
planr github push --epic EPIC-001 --yes
planr github push --all --yes
```

**When Claude should use:** "Push to GitHub Issues", "sync planning to GitHub."

---

### `planr github sync`

Bi-directional status sync between local artifacts and GitHub Issues.

**Usage:**
```bash
planr github sync --direction both --yes
planr github sync --direction pull --yes
planr github sync --direction push --yes
```

---

### `planr github status`

Show sync state of linked artifacts.

**Usage:**
```bash
planr github status
```

---

## Linear integration

### `planr linear init`

Authenticate with Linear (PAT) and pick a team.

**Usage:**
```bash
planr linear init
```

---

### `planr linear push`

Create/update Linear entities for any artifact at the smallest scope implied by its ID.

**Usage:**
```bash
planr linear push EPIC-001 --yes
planr linear push FEAT-015 --push-parents --yes
planr linear push EPIC-001 --as milestone-of:<projectId> --yes
```

**Key options:**
| Flag | Description |
|------|-------------|
| `<artifactId>` | Any `EPIC-`/`FEAT-`/`US-`/`TASK-`/`QT-`/`BL-` ID |
| `--dry-run` | Local preview only |
| `--update-only` | Update existing, don't create |
| `--push-parents` | Cascade parent push if unmapped |
| `--as <strategy>` | Epic-only mapping: `project` / `milestone-of:<id>` / `label-on:<id>` |

---

### `planr linear sync`

Bidirectional status + checklist sync.

**Usage:**
```bash
planr linear sync --yes
planr linear sync --on-conflict linear --yes
planr linear sync --dry-run
```

---

### `planr linear tasklist-sync`

Bidirectional checkbox sync between local TASK files and Linear TaskList issues.

**Usage:**
```bash
planr linear tasklist-sync --on-conflict linear --yes
```

---

### `planr linear status`

Local-only: print linked artifacts and their Linear URLs.

**Usage:**
```bash
planr linear status
planr linear status --scope EPIC-001
```

---

## Reporting

### `planr report`

Stakeholder report from artifacts + optional GitHub signals.

**Usage:**
```bash
planr report weekly --yes
planr report sprint --sprint SPRINT-001 --yes
planr report executive --format html --yes
planr report weekly --lint --strict-evidence --yes
planr report weekly --push slack --yes
```

**Types:** `sprint`, `weekly`, `executive`, `standup`, `retro`, `release`.

**Key options:**
| Flag | Description |
|------|-------------|
| `<type>` | Report type (required) |
| `--sprint <id>` | Sprint id for sprint-scoped reports |
| `--days <n>` | GitHub lookback window (default 7) |
| `--no-github` | Skip GitHub signal collection |
| `--format <f>` | `markdown` or `html` |
| `--output <dir>` | Output directory (default `.planr/reports`) |
| `--stdout` | Print instead of writing |
| `--lint` | Run report quality linter |
| `--strict-evidence` | Fail if bullets lack URLs/refs |
| `--push <targets>` | `slack`, `github`, or comma-separated |
| `--dry-run` | With `--push`, show only |

**Output:** `.planr/reports/<YYYY-MM-DD>-<type>-report.md`

---

### `planr report-linter`

Lint an existing markdown file against report rules.

**Usage:**
```bash
planr report-linter ./drafts/weekly.md --type weekly
cat drafts/sprint.md | planr report-linter --type sprint
```

---

### `planr context`

Print the report context pack (artifacts + sprint + GitHub + evidence index) as JSON for piping.

**Usage:**
```bash
planr context --report-type weekly
planr context --report-type sprint --sprint SPRINT-001 --days 14
```

---

## Voice / standup

### `planr voice standup`

Convert a transcript file into structured standup markdown (Yesterday / Today / Blockers).

**Usage:**
```bash
planr voice standup --file standups/today.txt --lint
planr voice standup --file t.txt --append-story US-029
```

**Key options:**
| Flag | Description |
|------|-------------|
| `--file <path>` | Transcript file (stdin if omitted) |
| `--write <path>` | Write output to file |
| `--append-story <id>` | Append under `## Standup notes` on a story |
| `--lint` | Run report linter |

---

## Export

### `planr export`

Consolidated planning report in markdown / JSON / HTML.

**Usage:**
```bash
planr export --yes
planr export --format html --scope EPIC-001 --yes
planr export --format json --output ./reports --yes
```

**Key options:**
| Flag | Description |
|------|-------------|
| `--format <f>` | `markdown`, `json`, `html` |
| `--scope <epicId>` | Only artifacts under one epic |
| `--output <path>` | Output file or directory |

---

## ID conventions

| Artifact | Prefix | Example |
|----------|--------|---------|
| Epic | `EPIC` | `EPIC-001` |
| Feature | `FEAT` | `FEAT-001` |
| User Story | `US` | `US-001` |
| Task List | `TASK` | `TASK-001` |
| Quick Task | `QT` | `QT-001` |
| Backlog | `BL` | `BL-001` |
| Sprint | `SPRINT` | `SPRINT-001` |
| ADR | `ADR` | `ADR-001` |
