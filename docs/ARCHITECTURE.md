# Architecture

> Contributor-oriented overview of how OpenPlanr is structured.

## Directory Structure

```text
src/
├── cli/                    # CLI entry point and command definitions
│   ├── index.ts            # Commander.js program setup, registers all commands
│   └── commands/           # One file per command (epic.ts, feature.ts, ...)
│
├── services/               # Core business logic
│   ├── operate/             # Event-sourced evidence-to-decision operating engine
│   ├── artifact-service.ts # CRUD for markdown artifacts (create, read, list, update)
│   ├── artifact-gathering.ts # Gathers related artifacts for AI context
│   ├── ai-service.ts       # AI provider orchestration (streaming, JSON generation)
│   ├── config-service.ts   # Load/save .planr/config.json
│   ├── credentials-service.ts # API key storage (OS keychain with encrypted file fallback)
│   ├── id-service.ts       # Sequential ID generation with gap-filling
│   ├── template-service.ts # Handlebars template rendering with caching
│   ├── prompt-service.ts   # Interactive prompt wrappers (@inquirer/prompts)
│   └── checklist-service.ts # Checklist CRUD, interactive toggle, and progress tracking
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
    └── logger.ts           # Colored console output (info, success, warn, error, debug) with --verbose support
```

## Data Flow

### Operating Board

`planr operate` is the deterministic governance kernel. Protocol v1.4 schemas,
canonical procedures and roles, reducers, projections, and cross-repository
contracts are owned by `planr-pipeline`; the selected Claude Code, Codex, or
Cursor runtime owns research, reasoning, and report authoring.

Operating state is append-only and content-addressed. Commit-safe records live
under `.planr/operate/`; machine-specific state lives under
`~/.planr/operate/`. Runtime-native CEO, CTO, CPO, CMO, COO, and Chair agents
inspect the workspace under the current session permissions. Their expressive
reports carry typed, cited sidecars. OpenPlanr validates citations, binds the
cycle to one runtime, materializes reversible proposal drafts, and keeps draft
approval, PLAN, and SHIP separate.

The dashboard is a disposable read-only projection. PLAN and SHIP remain
separate user invocations.

### Artifact Creation

```text
CLI Command (e.g., planr epic create)
  → Prompts user for input (prompt-service)
  → Calls AI provider to generate structured data (ai-service → provider)
  → Validates AI response against Zod schema (ai-response-schemas)
  → Renders Handlebars template with data (template-service)
  → Writes markdown file to disk (artifact-service → fs)
  → Updates parent artifact with child link (addChildReference)
```

### AI Integration

```text
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
- IDs are global per artifact type (not scoped to parent) — **except spec-driven mode**:
  in spec-driven mode, US-NNN and T-NNN IDs are **scoped to the parent spec**
  (so two specs can each have their own US-001). See `docs/proposals/spec-driven-mode.md`.
- Configurable prefixes via `.planr/config.json` → `idPrefix`

## Spec-Driven Mode (third planning posture)

Alongside the agile (epic/feature/story/task) and QT modes, planr supports a **spec-driven** mode optimized for planning *for* AI coding agents to execute.

- **Service:** `src/services/spec-service.ts` — directory-aware CRUD (specs are nested directories, not flat files)
- **Layout:** `.planr/specs/SPEC-NNN-{slug}/{SPEC-NNN-{slug}.md, design/, stories/US-NNN-*.md, tasks/T-NNN-*.md}`
- **Schema:** mirrors the [`planr-pipeline`](https://github.com/openplanr/planr-pipeline) canonical protocol schemas under `schemas/v1.0.0/` (file Create/Modify/Preserve lists, Type=UI|Tech, agent assignment, DoD with build/test commands)
- **Bridge:** `planr spec promote` validates + prints `/planr-pipeline:plan {slug}` for execution. The pipeline plugin reads `.planr/specs/` directly when spec mode is active — no conversion adapter.

See `docs/proposals/spec-driven-mode.md` for the full design.

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

| Provider  | SDK | Models |
|-----------|-----|--------|
| Anthropic | `@anthropic-ai/sdk` | claude-sonnet-4-20250514, etc. |
| OpenAI    | `openai` | gpt-4o, etc. |
| Ollama    | HTTP API | Any local model |

## Testing

- Framework: Vitest 4.x with globals enabled
- Test location: `tests/unit/` and `tests/integration/`
- Coverage: `@vitest/coverage-v8`
- Mocking: `vi.mock()` for service dependencies
- Fixtures: `tests/fixtures/` for sample markdown files
