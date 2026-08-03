# Contributing to Planr

Thank you for your interest in contributing to Planr! This guide will help you get started.

## Development Setup

### Prerequisites

- Node.js >= 20.0.0
- npm >= 10.0.0

### Getting Started

```bash
# Fork and clone the repo
git clone https://github.com/openplanr/OpenPlanr.git
cd openplanr

# Install dependencies
npm install

# Build the project
npm run build

# Run from source (no build needed)
npx tsx src/cli/index.ts --help

# Link globally for testing
npm install -g .
planr --help
```

## Project Structure

```text
src/
├── cli/
│   ├── index.ts              # CLI entry point (commander setup)
│   └── commands/             # One file per command group
│       ├── init.ts
│       ├── epic.ts
│       ├── feature.ts
│       ├── story.ts
│       ├── task.ts
│       ├── quick.ts
│       ├── backlog.ts
│       ├── sprint.ts
│       ├── template.ts
│       ├── checklist.ts
│       ├── rules.ts
│       ├── config.ts
│       ├── plan.ts
│       ├── refine.ts
│       ├── estimate.ts
│       ├── search.ts
│       ├── sync.ts
│       ├── github.ts
│       ├── export.ts
│       └── status.ts
├── services/                 # Business logic
│   ├── artifact-service.ts   # Generic CRUD for all artifact types
│   ├── artifact-gathering.ts # Context gathering for AI prompts
│   ├── config-service.ts     # Config file management
│   ├── checklist-service.ts  # Checklist operations
│   ├── id-service.ts         # Auto-incrementing ID generation
│   ├── prompt-service.ts     # Interactive prompt wrappers
│   ├── rules-service.ts      # AI rule file generation
│   └── template-service.ts   # Handlebars template rendering
├── models/
│   ├── schema.ts             # Zod validation schemas
│   └── types.ts              # TypeScript type definitions
├── templates/                # Handlebars templates
│   ├── epics/
│   ├── features/
│   ├── stories/
│   ├── tasks/
│   ├── checklists/
│   ├── adrs/
│   └── rules/
│       ├── cursor/           # .mdc rule templates
│       ├── claude/           # CLAUDE.md template
│       └── codex/            # AGENTS.md template
└── utils/
    ├── constants.ts
    ├── fs.ts                 # File system helpers
    ├── logger.ts             # Chalk-based logger
    └── slugify.ts
```

## Making Changes

### Branch Naming

- `feat/description` — new features
- `fix/description` — bug fixes
- `docs/description` — documentation changes
- `refactor/description` — code refactoring
- `test/description` — test additions/changes

### Commit Messages

Use clear, descriptive commit messages:

```
feat: add --ai flag for AI-powered epic generation
fix: handle missing config file gracefully
docs: update CLI reference with new commands
refactor: extract template rendering into service
test: add unit tests for id-service
```

### Adding a New Command

1. Create a new file in `src/cli/commands/`
2. Export a `registerXxxCommand(program: Command)` function
3. Register it in `src/cli/index.ts`
4. Add a Handlebars template in `src/templates/` if needed
5. Update `docs/CLI.md` with the new command

### Adding a New AI Target

1. Add template files in `src/templates/rules/<target>/`
2. Update `src/services/rules-service.ts` to handle the target
3. Update the config schema in `src/models/schema.ts`

## Testing

```bash
# Run all tests
npm test

# Watch mode
npm run test:watch
```

### Testing Commands Manually

```bash
# Create a temp directory to test in
mkdir /tmp/planr-test && cd /tmp/planr-test

# Run commands from source
npx tsx /path/to/openplanr/src/cli/index.ts init
npx tsx /path/to/openplanr/src/cli/index.ts epic create
```

## Pull Request Process

1. Ensure your code builds without errors (`npm run build`)
2. Update documentation if you changed any commands or behavior
3. Add tests for new functionality where possible
4. Keep PRs focused — one feature or fix per PR
5. Write a clear PR description explaining what and why

## Code Style

- TypeScript strict mode is enabled
- Use ES modules (`import`/`export`)
- Prefer `async`/`await` over raw promises
- Use Zod for runtime validation
- Use Handlebars for all template rendering
- Keep CLI commands thin — put logic in services

## Questions?

Open an issue on GitHub if you have questions or need help getting started.
