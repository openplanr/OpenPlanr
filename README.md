# Planr

[![npm version](https://img.shields.io/npm/v/openplanr.svg)](https://www.npmjs.com/package/openplanr)
[![license](https://img.shields.io/npm/l/openplanr.svg)](https://github.com/TechArc-io/OpenPlanr/blob/main/LICENSE)
[![node](https://img.shields.io/node/v/openplanr.svg)](https://nodejs.org)

**AI-powered planning CLI for developers.** Capture ideas, plan sprints, generate tasks, estimate effort, and sync with GitHub — all from your terminal.

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
8. **Keeping everything in your repo** — artifacts live alongside your code, version-controlled

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

### Planning Tools

| Command                | Description                                               |
| ---------------------- | --------------------------------------------------------- |
| `planr plan`           | Full automated flow: Epic -> Features -> Stories -> Tasks |
| `planr estimate <ID>`  | AI effort estimation (story points, hours, complexity)    |
| `planr refine <ID>`    | AI-powered review and improvements                        |
| `planr search <query>` | Full-text search across all artifacts                     |
| `planr sync`           | Validate and fix cross-references                         |
| `planr status`         | Planning progress with tree view and metrics              |

### GitHub & Export

| Command                      | Description                                      |
| ---------------------------- | ------------------------------------------------ |
| `planr github push [ID]`     | Push artifacts to GitHub Issues                  |
| `planr github sync`          | Bi-directional status sync with GitHub           |
| `planr github status`        | Show sync status of linked artifacts             |
| `planr export --format html` | Export planning report (markdown, JSON, or HTML) |

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
├── planr.config.json
├── docs/agile/
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

`planr.config.json` is created by `planr init`:

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
git clone https://github.com/TechArc-io/OpenPlanr.git
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
