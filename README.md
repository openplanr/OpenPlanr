# OpenPlanr

[![npm version](https://img.shields.io/npm/v/openplanr.svg)](https://www.npmjs.com/package/openplanr)
[![license](https://img.shields.io/npm/l/openplanr.svg)](https://github.com/openplanr/OpenPlanr/blob/main/LICENSE)
[![node](https://img.shields.io/node/v/openplanr.svg)](https://nodejs.org)

**Website:** [openplanr.dev](https://openplanr.dev)

**AI-powered planning CLI for developers.** Capture ideas, plan sprints, generate tasks, estimate effort, and sync with GitHub or Linear — all from your terminal.

Planr replaces heavyweight project management tools with a fast, file-based workflow. Artifacts live in your repo as markdown, version-controlled alongside your code. AI generates structured plans and teaches your coding agent (Cursor, Claude Code, Codex) how to follow them.

---

## Why Planr?

AI coding assistants are powerful but lack structured planning. Without a clear plan, they generate code that drifts from requirements. Planr solves this by:

1. **Capturing ideas instantly** — `planr backlog add` captures work items without breaking your flow
2. **Structuring your planning** — epics, features, stories, and tasks in markdown
3. **Sprint planning** — time-boxed iterations with velocity tracking and AI task selection
4. **Reusable patterns** — task templates for common workflows (REST endpoints, React components, etc.)
5. **AI-powered estimation** — story points, effort hours, and complexity analysis
6. **Generating AI rules** — rule files that give your AI assistant context about the plan
7. **GitHub integration** — push artifacts to issues, bi-directional sync, export reports
8. **Linear integration** — push any artifact (epic / feature / story / task / quick-task / backlog) to Linear with `planr linear push <id>`, with flexible epic mappings (project / milestone / label) and bidirectional status + checkbox sync
9. **Keeping everything in your repo** — artifacts live alongside your code, version-controlled

## Quick Start

```bash
# Install globally
npm install -g openplanr

# Initialize in your project
cd my-project
planr init

# Capture an idea
planr backlog add "add user profiles" --priority high --tag feature

# Or jump straight into planning
planr epic create
planr feature create --epic EPIC-001
planr story create --feature FEAT-001
planr task create --feature FEAT-001

# Generate tasks from a template
planr template use rest-endpoint --title "User Profile API"

# Start a sprint
planr sprint create --name "Sprint 1" --duration 2w
planr sprint add TASK-001 QT-001

# Generate AI rules for your editor
planr rules generate
```

## How It Works

```text
Backlog → Agile Hierarchy → Sprint → Implementation

planr backlog add "..."              # Capture ideas as they come
planr backlog prioritize             # AI sorts by impact/effort
planr backlog promote BL-001 --quick # Move to task when ready

planr init
  └── planr epic create                         # Define the big picture
       └── planr feature create --epic EPIC-001
            └── planr story create --feature FEAT-001
                 └── planr task create --feature FEAT-001

planr sprint create --name "Sprint 1" --duration 2w
planr sprint add TASK-001 QT-001     # Assign tasks (or --auto for AI)
planr sprint status                  # Track progress

planr rules generate                 # Generate .cursor/rules, CLAUDE.md, AGENTS.md
```

Or use `planr plan` to run the full agile flow in a single command:

```bash
planr plan                          # start from scratch
planr plan --epic EPIC-001          # cascade from an existing epic
```

## Supported AI Targets

| Target | Generated File(s)     | Used By          |
| ------ | --------------------- | ---------------- |
| Cursor | `.cursor/rules/*.mdc` | Cursor IDE       |
| Claude | `CLAUDE.md`           | Claude Code CLI  |
| Codex  | `AGENTS.md`           | OpenAI Codex CLI |

```bash
planr rules generate                  # all targets
planr rules generate --target cursor  # cursor only
planr rules generate --dry-run        # preview
```

## Commands

### Backlog & Sprint

| Command                                               | Description                                 |
| ----------------------------------------------------- | ------------------------------------------- |
| `planr backlog add "desc" --priority high --tag bug`  | Capture a backlog item                      |
| `planr backlog list --tag bug --priority high`        | List/filter backlog items                   |
| `planr backlog prioritize`                            | AI sorts open items by impact and effort    |
| `planr backlog promote BL-001 --quick`                | Promote to quick task or story              |
| `planr backlog close BL-001`                          | Close/archive an item                       |
| `planr sprint create --name "Sprint 1" --duration 2w` | Create a time-boxed sprint                  |
| `planr sprint add TASK-001 QT-001`                    | Assign tasks to active sprint               |
| `planr sprint add --auto`                             | AI selects tasks by priority and velocity   |
| `planr sprint status`                                 | Progress dashboard with completion %        |
| `planr sprint close`                                  | Archive sprint, carry over incomplete tasks |
| `planr sprint list`                                   | List all sprints                            |
| `planr sprint history`                                | Velocity chart across past sprints          |

### Agile Hierarchy

| Command                             | Description                                           |
| ----------------------------------- | ----------------------------------------------------- |
| `planr epic create`                 | Create a new epic (supports `--file <path>` for PRDs) |
| `planr epic list`                   | List all epics                                        |
| `planr feature create --epic <ID>`  | Create features from an epic                          |
| `planr feature list`                | List all features                                     |
| `planr story create --feature <ID>` | Create user stories from a feature                    |
| `planr story create --epic <ID>`    | Batch-generate stories for all features under an epic |
| `planr story list`                  | List all user stories                                 |
| `planr task create --story <ID>`    | AI task list from one story                           |
| `planr task create --feature <ID>`  | AI task list from all stories under a feature         |
| `planr task list`                   | List all task lists                                   |
### Quick Tasks & Templates

| Command                                               | Description                        |
| ----------------------------------------------------- | ---------------------------------- |
| `planr quick create "description"`                    | AI-generated standalone task list  |
| `planr quick create --file spec.md`                   | Task list from a PRD or spec file  |
| `planr quick promote <ID> --story US-001`             | Move into agile hierarchy          |
| `planr template list`                                 | List built-in and custom templates |
| `planr template use rest-endpoint --title "User API"` | Generate tasks from a template     |
| `planr template save TASK-001 --name my-pattern`      | Save existing tasks as template    |
| `planr template show rest-endpoint`                   | Preview template contents          |

### Spec-Driven Mode (planning *for* AI agents)

Third planning posture alongside agile + QT. Specs decompose into User Stories
and Tasks with the **same artifact contract as the
[openplanr-pipeline](https://github.com/openplanr/openplanr-pipeline)** Claude
Code plugin — file Create/Modify/Preserve lists, Type=UI|Tech, agent
assignment, DoD with build/test commands. Plan in `planr`, ship in the pipeline.
See [`docs/proposals/spec-driven-mode.md`](docs/proposals/spec-driven-mode.md).

| Command                                                 | Description                                       |
| ------------------------------------------------------- | ------------------------------------------------- |
| `planr spec init`                                       | Activate spec-driven mode (creates `.planr/specs/`) |
| `planr spec create "Auth flow"`                         | Create a self-contained `SPEC-NNN-{slug}/` directory |
| `planr spec shape <SPEC-id>`                            | Interactive 4-question authoring (Context, Functional Reqs, Business Rules, Acceptance) |
| `planr spec decompose <SPEC-id>`                        | AI-driven decomposition into User Stories + Tasks (matches openplanr-pipeline schema) |
| `planr spec sync [<SPEC-id>]`                           | Validate integrity (orphaned tasks, missing `specId`, schema drift); auto-fixes safe issues |
| `planr spec list`                                       | List all specs with status + decomposition counts |
| `planr spec show <SPEC-id>`                             | Print a spec + its US/Task tree                   |
| `planr spec status [<SPEC-id>]`                         | Decomposition state across one/all specs         |
| `planr spec destroy <SPEC-id>`                          | Remove a spec entirely (clean `rm -rf`)           |
| `planr spec attach-design <SPEC-id> --files <png>...`   | Attach UI mockups for the pipeline's designer-agent |
| `planr spec promote <SPEC-id>`                          | Validate + print the `/openplanr-pipeline:plan {slug}` handoff |

### Planning Tools

| Command                | Description                                               |
| ---------------------- | --------------------------------------------------------- |
| `planr plan`           | Full automated flow: Epic -> Features -> Stories -> Tasks |
| `planr estimate <ID>`  | AI effort estimation (story points, hours, complexity)    |
| `planr refine <ID>`    | AI-powered review and improvements (prose polish)         |
| `planr revise <ID>`    | AI-driven *alignment* of planning artifacts with codebase |
| `planr search <query>` | Full-text search across all artifacts                     |
| `planr sync`           | Validate and fix cross-references                         |
| `planr status`         | Planning progress with tree view and metrics              |

#### `planr revise` — align planning with reality

`refine` improves prose; `revise` actively rewrites planning artifacts so they match the codebase, sibling artifacts, and declared sources. Four-layer safety pipeline:

1. **Clean-tree gate** — git working tree must be clean (override with `--allow-dirty`)
2. **Agent decision** — zod-validated `revise` / `skip` / `flag` per artifact
3. **Evidence verification** — agent must cite typed, verifiable evidence (file existence, grep matches, sibling artifacts…); unverifiable citations are dropped, and a `revise` that loses all support is demoted to `flag`
4. **Diff preview + confirmation** — per-artifact `[a]pply / [s]kip / [e]dit / [d]iff / [q]uit`; writes are atomic with sidecar backups; full audit log emitted on every run (dry-run included)

```bash
# Single artifact, interactive
planr revise TASK-007

# Cascade top-down (epic → features → stories → tasks)
planr revise EPIC-003 --cascade

# Revise everything in the project (content-hash cache skips unchanged artifacts)
planr revise --all --dry-run              # preview every revision
planr revise --all --yes                  # type YES once; then non-interactive apply

# CI mode — dry-run + JSON audit + non-zero exit on flagged findings
planr revise EPIC-003 --cascade --dry-run --audit-format json --audit ./revise.json
```

After a successful apply, revise prints a suggested commit:

```
git commit -am "chore(plan): revise EPIC-003 against codebase"
```

Post-flight graph-integrity check runs after every non-dry-run revise. If the writes leave parent/child links broken, revise automatically rolls back via `git checkout` (which is why clean-tree is required by default). Full design in [.planr/EPIC-REVISE-COMMAND.md](.planr/EPIC-REVISE-COMMAND.md).

### GitHub, Linear & export

| Command                      | Description                                      |
| ---------------------------- | ------------------------------------------------ |
| `planr linear init`          | Save Linear team + token (PAT) for API access    |
| `planr linear sync`          | Pull Linear workflow state into Feature/Story `status` (one-way)                |
| `planr linear push <epicId>` | Epic → Linear project, features → issues, stories and task lists → sub-issues |
| `planr github push [ID]`     | Push artifacts to GitHub Issues                  |
| `planr github sync`          | Bi-directional status sync with GitHub           |
| `planr github status`        | Show sync status of linked artifacts             |
| `planr export --format html` | Export planning report (markdown, JSON, or HTML) |

### Stakeholder reporting

Generate evidence-linked status reports from your `.planr/` artifacts and (optionally) GitHub activity. See [docs/EPIC-PM-REPORTING-LAYER.md](docs/EPIC-PM-REPORTING-LAYER.md) for the full design and what is shipped vs deferred.

| Command                                            | Description                                                                                       |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `planr report <type>`                              | Generate a report (`sprint`, `weekly`, `executive`, `standup`, `retro`, `release`)                |
| `planr report weekly --lint`                       | Generate and run the report quality linter before saving                                          |
| `planr report sprint --push slack --dry-run`       | Show what would be posted to Slack (no webhook required for dry runs)                             |
| `planr report-linter [file]`                       | Lint an existing markdown report (vague language, evidence density, required sections)            |
| `planr context --report-type weekly`               | Print the report context pack (artifacts + GitHub + evidence) as JSON for piping                  |
| `planr voice standup --file transcript.txt --lint` | Convert a transcript into a structured standup, optionally linted, edited, or appended to a story |
| `planr story standup --story US-001 --file t.txt`  | Append linted standup notes from a transcript onto an existing user story                         |

**Output:** Markdown + HTML, written to `.planr/reports/<type>-<timestamp>.{md,html}` (override with `--output`). PDF rendering is intentionally out of scope for v1; `--format pdf` exits with a clear message.

**Distribution:** `--push slack` posts via an [Incoming Webhook](https://api.slack.com/messaging/webhooks) configured at `distribution.slackWebhookUrl` in `.planr/config.json`. `--push github` opens a `planr:report` issue using the local `gh` CLI.

**Quality gates:** `--strict-evidence` fails when substantive bullets under `##` sections (except the **Evidence** appendix) are missing URLs or `#issue` refs; full-line italic placeholders like `_Add links…_` are skipped. `--lint` runs configurable rules (extend or override via `reportLinter` in `.planr/config.json`).

### Setup & config commands

| Command                             | Description                                            |
| ----------------------------------- | ------------------------------------------------------ |
| `planr init`                        | Initialize project with config and directory structure |
| `planr config show`                 | Display current configuration                          |
| `planr config set-provider`         | Set AI provider (anthropic, openai, ollama)            |
| `planr config set-key`              | Store API key securely                                 |
| `planr config set-model`            | Set AI model                                           |
| `planr config set-agent`            | Set default coding agent                               |
| `planr rules generate`              | Generate AI agent rule files                           |
| `planr checklist show/toggle/reset` | Agile development checklist                            |

See [docs/CLI.md](docs/CLI.md) for the full command reference with all options and flags.

## Project Structure

After running `planr init` and creating artifacts:

```text
my-project/
├── .planr/
│   ├── config.json     # Project configuration
│   ├── epics/          # EPIC-001-*.md
│   ├── features/       # FEAT-001-*.md
│   ├── stories/        # US-001-*.md + US-001-gherkin.feature
│   ├── tasks/          # TASK-001-*.md
│   ├── quick/          # QT-001-*.md
│   ├── backlog/        # BL-001-*.md
│   ├── sprints/        # SPRINT-001-*.md
│   ├── templates/      # Custom task templates
│   ├── adrs/           # Architecture Decision Records
│   ├── checklists/     # Agile development checklist
│   └── diagrams/       # UML, C4, sequence diagrams
├── .cursor/rules/      # Generated Cursor rules
├── CLAUDE.md           # Generated Claude Code rules
└── AGENTS.md           # Generated Codex rules
```

## Configuration

`.planr/config.json` is created by `planr init`:

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
  }
}
```

## Built-in Task Templates

| Template             | Description                                             |
| -------------------- | ------------------------------------------------------- |
| `rest-endpoint`      | CRUD endpoint with validation, auth, tests, docs        |
| `react-component`    | Component, stories, tests, types                        |
| `database-migration` | Schema change, migration, rollback, seed data           |
| `api-integration`    | External API client, retry logic, error handling, tests |
| `auth-flow`          | Authentication flow with login, signup, password reset  |

```bash
planr template use rest-endpoint --title "User Profile API"
```

## Development

```bash
# Clone and install
git clone https://github.com/openplanr/OpenPlanr.git
cd openplanr
npm install

# Run from source
npx tsx src/cli/index.ts init

# Build
npm run build

# Run tests
npm test

# Link globally for development
npm install -g .
```

## Contributing

Contributions are welcome! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

1. Fork the repository
2. Create your feature branch (`git checkout -b feat/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feat/amazing-feature`)
5. Open a Pull Request

## License

[MIT](LICENSE)
