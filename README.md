# Planr

[![npm version](https://img.shields.io/npm/v/openplanr.svg)](https://www.npmjs.com/package/openplanr)
[![license](https://img.shields.io/npm/l/openplanr.svg)](https://github.com/TechArc-io/OpenPlanr/blob/main/LICENSE)
[![node](https://img.shields.io/node/v/openplanr.svg)](https://nodejs.org)

**Agile planning CLI for AI-assisted development.** Generate epics, features, user stories, tasks, and AI agent rules — all from your terminal.

Planr brings structured agile planning to AI coding workflows. Create planning artifacts with a simple CLI, then generate rule files that teach Cursor, Claude Code, or Codex how to follow your plan.

---

## Why Planr?

AI coding assistants are powerful but lack structured planning. Without a clear plan, they generate code that drifts from requirements. Planr solves this by:

1. **Structuring your planning** — epics, features, stories, and tasks in markdown
2. **Generating AI rules** — rule files that give your AI assistant context about the plan
3. **Keeping everything in your repo** — artifacts live alongside your code, version-controlled

## Quick Start

```bash
# Install globally
npm install -g openplanr

# Initialize in your project
cd my-project
planr init

# Create your first epic
planr epic create

# Break it down
planr feature create --epic EPIC-001
planr story create --feature FEAT-001
planr task create --story US-001

# Generate AI rules for your editor
planr rules generate
```

## How It Works

```
planr init
  └── planr epic create                    # Define the big picture
       └── planr feature create --epic EPIC-001    # Break into features
            └── planr story create --feature FEAT-001  # User stories + Gherkin
                 └── planr task create --story US-001      # Implementation tasks

planr rules generate   # Generate .cursor/rules, CLAUDE.md, AGENTS.md
```

Each command creates markdown artifacts in `docs/agile/` and interactively prompts for the details. The hierarchy is enforced — features require an epic, stories require a feature, tasks require a story or feature.

Or use `planr plan` to run the full flow in a single command:

```bash
planr plan                          # start from scratch
planr plan --epic EPIC-001          # cascade from an existing epic
```

## Supported AI Targets

| Target | Generated File(s) | Used By |
|--------|--------------------|---------|
| Cursor | `.cursor/rules/*.mdc` | Cursor IDE |
| Claude | `CLAUDE.md` | Claude Code CLI |
| Codex | `AGENTS.md` | OpenAI Codex CLI |

```bash
planr rules generate                  # all targets
planr rules generate --target cursor  # cursor only
planr rules generate --dry-run        # preview
```

## Commands

| Command | Description |
|---------|-------------|
| `planr init` | Initialize project with config and directory structure |
| `planr epic create` | Create a new epic |
| `planr epic list` | List all epics |
| `planr feature create --epic <ID>` | Create a feature from an epic |
| `planr feature list` | List all features |
| `planr story create --feature <ID>` | Create a user story with Gherkin criteria |
| `planr story list` | List all user stories |
| `planr task create --story <ID>` | Create a task list from a single story |
| `planr task create --feature <ID>` | Create a task list from all stories in a feature |
| `planr task list` | List all task lists |
| `planr task implement <ID>` | View tasks and start implementing |
| `planr plan` | Full automated flow: Epic → Features → Stories → Tasks |
| `planr refine <ID>` | AI-powered review and improvement suggestions |
| `planr sync` | Validate and fix cross-references across artifacts |
| `planr checklist show` | View the agile development checklist |
| `planr checklist reset` | Reset checklist to initial state |
| `planr rules generate` | Generate AI agent rule files |
| `planr status` | Show planning progress overview |
| `planr config show` | Display current configuration |

See [docs/CLI.md](docs/CLI.md) for the full command reference with all options and flags.

## Project Structure

After running `planr init` and creating artifacts:

```
my-project/
├── planr.config.json
├── docs/agile/
│   ├── epics/          # EPIC-001-*.md
│   ├── features/       # FEAT-001-*.md
│   ├── stories/        # US-001-*.md + US-001-gherkin.feature
│   ├── tasks/          # TASK-001-*.md
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
    "task": "TASK"
  }
}
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
