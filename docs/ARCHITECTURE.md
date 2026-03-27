# Architecture

> Contributor-oriented overview of how OpenPlanr is structured.

## Directory Structure

```
src/
├── cli/                    # CLI entry point and command definitions
│   ├── index.ts            # Commander.js program setup, registers all commands
│   └── commands/           # One file per command (epic.ts, feature.ts, ...)
│
├── services/               # Core business logic
│   ├── artifact-service.ts # CRUD for markdown artifacts (create, read, list, update)
│   ├── artifact-gathering.ts # Gathers related artifacts for AI context
│   ├── ai-service.ts       # AI provider orchestration (streaming, JSON generation)
│   ├── config-service.ts   # Load/save planr.config.json
│   ├── credentials-service.ts # API key storage (~/.planr/credentials.json)
│   ├── id-service.ts       # Sequential ID generation with gap-filling
│   ├── template-service.ts # Handlebars template rendering with caching
│   ├── prompt-service.ts   # Interactive prompt wrappers (@inquirer/prompts)
│   └── checklist-service.ts # Checklist read/reset operations
│
├── ai/                     # AI integration layer
│   ├── prompts/            # Prompt builders for each artifact type
│   ├── providers/          # Anthropic, OpenAI, Ollama implementations
│   ├── schemas/            # Zod schemas for AI response validation
│   ├── codebase/           # Codebase analysis (stack detection, file tree)
│   ├── errors.ts           # AIError class with user-friendly messages
│   └── types.ts            # AIProvider interface, AIMessage type
│
├── agents/                 # Coding agent integration (Cursor, Claude, Codex)
│   ├── task-parser.ts      # Parse task markdown into structured subtasks
│   ├── prompt-composer.ts  # Compose implementation prompts for agents
│   ├── implementation-bridge.ts # Bridge between tasks and agent execution
│   └── *-agent.ts          # Agent-specific implementations
│
├── generators/             # Rule file generators for AI targets
│   ├── cursor-generator.ts # .cursor/rules/*.mdc files
│   ├── claude-generator.ts # CLAUDE.md
│   └── codex-generator.ts  # AGENTS.md
│
├── models/                 # Data models
│   ├── types.ts            # TypeScript interfaces (OpenPlanrConfig, Epic, Feature, ...)
│   └── schema.ts           # Zod schemas for config validation
│
├── templates/              # Handlebars templates for artifact generation
│   ├── epics/
│   ├── features/
│   ├── stories/
│   ├── tasks/
│   ├── rules/
│   └── ...
│
└── utils/                  # Shared utilities
    ├── fs.ts               # File system wrappers (read, write, list, exists)
    ├── markdown.ts          # Frontmatter parsing via gray-matter
    ├── slugify.ts          # Text to kebab-case slugs
    ├── constants.ts        # Config filename, directory constants
    └── logger.ts           # Colored console output (info, success, warn, error)
```

## Data Flow

### Artifact Creation

```
CLI Command (e.g., planr epic create)
  → Prompts user for input (prompt-service)
  → Calls AI provider to generate structured data (ai-service → provider)
  → Validates AI response against Zod schema (ai-response-schemas)
  → Renders Handlebars template with data (template-service)
  → Writes markdown file to disk (artifact-service → fs)
  → Updates parent artifact with child link (addChildReference)
```

### AI Integration

```
prompt-builder.ts           Composes system + user messages
  → ai-service.ts           Selects provider, handles streaming
    → provider (anthropic/openai/ollama)   Makes API call
  → Zod schema validation   Parses and validates JSON response
  → Command handler         Uses validated data
```

### Cross-Reference System

Artifacts link to each other via markdown:
- Epics list their features under `## Features`
- Features list their stories under `## User Stories`
- Stories/features list their tasks under `## Tasks`

`addChildReference()` manages these links automatically on creation.
`planr sync` validates and repairs broken links.

## ID System

IDs follow the pattern `PREFIX-NNN` (e.g., EPIC-001, FEAT-002).

- `getNextId()` scans existing files and finds the first available gap
- IDs are global per artifact type (not scoped to parent)
- Configurable prefixes via `planr.config.json` → `idPrefix`

## Template System

- Handlebars templates live in `src/templates/`
- Copied to `dist/templates/` during build
- Override support: users can provide custom templates via `templateOverrides` config
- Registered helpers: `date`, `uppercase`, `checkboxList`, `join`

## AI Providers

All providers implement the `AIProvider` interface:

```typescript
interface AIProvider {
  generateJSON(messages: AIMessage[], schema: ZodSchema): Promise<T>;
  generateStreamingJSON(messages: AIMessage[], schema: ZodSchema): AsyncGenerator<string>;
}
```

| Provider | SDK | Models |
|----------|-----|--------|
| Anthropic | `@anthropic-ai/sdk` | claude-sonnet-4-20250514, etc. |
| OpenAI | `openai` | gpt-4o, etc. |
| Ollama | HTTP API | Any local model |

## Testing

- Framework: Vitest 4.x with globals enabled
- Test location: `tests/unit/` and `tests/integration/`
- Coverage: `@vitest/coverage-v8`
- Mocking: `vi.mock()` for service dependencies
- Fixtures: `tests/fixtures/` for sample markdown files
