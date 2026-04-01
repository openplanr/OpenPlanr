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
# or: planr task create --feature FEAT-001  # one task list from every story + full planning context (AI)

# Generate AI rules for your editor
planr rules generate
```

## How It Works

```
planr init
  └── planr epic create                    # Define the big picture
       └── planr feature create --epic EPIC-001    # Break into features
            └── planr story create --feature FEAT-001  # User stories + Gherkin
                 ├── planr task create --story US-001       # Tasks from one story (+ parent feature/epic, Gherkin, ADRs, codebase context)
                 └── planr task create --feature FEAT-001  # Tasks from all stories in the feature (+ same context, wider scope; larger AI budget)

planr rules generate   # Generate .cursor/rules, CLAUDE.md, AGENTS.md
```

Each command creates markdown artifacts in `docs/agile/` and interactively prompts for the details. The hierarchy is enforced — features require an epic, stories require a feature, tasks require a story or feature. For AI-powered `task create`, context always includes parent feature and epic, Gherkin where present, all ADRs, and codebase-derived context; `--feature` aggregates every story under that feature and uses a higher output token limit than `--story`.

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
| `planr epic create` | Create a new epic (supports `--file <path>` for PRDs) |
| `planr epic list` | List all epics |
| `planr feature create --epic <ID>` | Create features from an epic |
| `planr feature list` | List all features |
| `planr story create --feature <ID>` | Create user stories from a feature |
| `planr story create --epic <ID>` | Batch-generate stories for all features under an epic |
| `planr story list` | List all user stories |
| `planr task create --story <ID>` | AI task list from one story (plus parent feature/epic, Gherkin, ADRs, codebase context) |
| `planr task create --feature <ID>` | AI task list from **all** stories under the feature, with the same artifact context and a larger model output budget |
| `planr task list` | List all task lists |
| `planr task implement <ID>` | View tasks and start implementing |
| `planr plan` | Full automated flow: Epic → Features → Stories → Tasks |
| `planr refine <ID>` | AI-powered review and apply improvements |
| `planr sync` | Validate and fix cross-references across artifacts |
| `planr checklist show` | View the agile development checklist |
| `planr checklist toggle` | Interactively toggle checklist items |
| `planr checklist reset` | Reset checklist to initial state |
| `planr rules generate` | Generate AI agent rule files |
| `planr status` | Show planning progress with tree view and metrics |
| `planr config show` | Display current configuration |
| `planr config set-provider` | Set AI provider (anthropic, openai, ollama) |
| `planr config set-key` | Store API key securely |
| `planr config set-model` | Set AI model |
| `planr config set-agent` | Set default coding agent |
| `planr github push [ID]` | Push artifacts to GitHub Issues (single, `--epic`, or `--all`) |
| `planr github sync` | Bi-directional status sync with GitHub Issues |
| `planr github status` | Show sync status of linked artifacts |
| `planr export` | Export planning report (markdown, JSON, or HTML) |

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
