---
name: openplanr
description: Agile planning CLI for coding agents — creates epics, features, user stories, tasks, sprints, and backlog items as markdown artifacts in .planr/. Use when the user asks to plan a project, break down a PRD, write stories, estimate work, manage sprints, prioritize a backlog, or generate agent rule files (CLAUDE.md, AGENTS.md, .cursor/rules). Also use when the repo already contains a .planr/ directory — OpenPlanr owns that directory.
license: MIT
---

# OpenPlanr — Agile Planning for Coding Agents

## What This Skill Does

OpenPlanr is a CLI that generates and maintains agile planning artifacts — epics,
features, user stories, tasks, sprints, and backlog items — as markdown files in a
`.planr/` directory. This skill teaches Claude how to drive OpenPlanr end-to-end:
detecting when planning is needed, installing or verifying the CLI, running the
right commands in agent-friendly non-interactive mode, and interpreting the
markdown artifacts it produces so you can then implement the planned work.

## When to Use

Activate this skill when the user:

- Asks to **plan** a project, feature, milestone, or sprint
- Wants to **break down** a PRD, spec, or design document into structured work
- Uses agile vocabulary: "epic", "feature", "user story", "task", "sprint", "backlog", "story points"
- Asks to **estimate** work ("how long will this take?", "story points for this?")
- Asks to **prioritize** a list of items
- Asks to generate **agent rules** (CLAUDE.md, AGENTS.md, .cursor/rules) from planning
- Asks to export a **planning report** (markdown, HTML, JSON)
- Works in a repo that already contains a `.planr/` directory — OpenPlanr owns that directory
- Asks to **refine** or improve existing planning artifacts
- Asks to **sync** plans with GitHub Issues or Linear
- Wants **spec-driven planning** — author specs that decompose into agent-executable tasks ("plan for AI agents", "spec mode", "decompose this spec for execution", "bridge to openplanr-pipeline")
- Wants to author plans that the **`openplanr-pipeline` Claude Code plugin** can execute directly without translation

## When NOT to Use

Do NOT activate this skill when:

- The user wants to **write code** — plan first with OpenPlanr, then implement using
  the artifacts as context. Implementation itself is not this skill's job.
- The user is working on an **existing task** that is already fully specified and
  doesn't need breakdown.
- The user wants **project management dashboards** (Jira, Linear UI, Asana) — OpenPlanr
  is file-based, not a dashboard tool. It can sync to GitHub Issues or Linear though.
- The user wants to **track live work status in a UI** — use GitHub Issues via
  `planr github push`, Linear via `planr linear push`, or an external tool.

## Installation Check

Before running any `planr` command, verify OpenPlanr is available:

```bash
npx openplanr@latest --version
```

This fetches the latest stable version on first use and caches it. No global
install is required. If the user has installed globally (`npm i -g openplanr`),
`planr --version` works directly — prefer `planr` over `npx openplanr` when it's
on PATH.

If `npx` itself is unavailable, instruct the user to install Node.js 20+ first.

## Core Workflow

Every interaction follows the same four steps:

1. **Detect the planning intent** — map the user's request to an OpenPlanr command
   (see "Key Commands" below, or `references/commands.md` for the full catalog)
2. **Verify OpenPlanr is installed and initialized** — run the installation check
   above, and ensure `.planr/config.json` exists (run `planr init --yes` if not)
3. **Run the command in non-interactive mode** — ALWAYS pass `--yes` (or
   `--no-interactive`); never rely on interactive prompts
4. **Read the generated artifact(s)** — locate the output file in `.planr/`, read
   it, summarize the result, and propose next steps (e.g. "Epic created. Next,
   generate features with `planr feature create --epic EPIC-001 --yes`?")

## Key Commands

The 10 most common commands. For the full catalog (~40 commands), see
`references/commands.md`.

| Command | What it does |
|---------|-------------|
| `planr init --yes` | Initialize `.planr/` in the current project |
| `planr plan --yes` | Full agile flow: Epic → Features → Stories → Tasks |
| `planr epic create --file <path> --yes` | Generate an epic from a PRD document |
| `planr feature create --epic EPIC-001 --yes` | Generate features under an epic |
| `planr story create --epic EPIC-001 --yes` | Generate stories for every feature under an epic |
| `planr task create --story US-001 --yes` | Generate an implementation task list |
| `planr refine EPIC-001 --cascade --yes` | AI review and improvement, cascading to children |
| `planr status` | Tree view of all planning progress |
| `planr rules generate --yes` | Generate CLAUDE.md / AGENTS.md / .cursor/rules |
| `planr backlog prioritize --yes` | AI-powered backlog prioritization by impact/effort |
| `planr spec init` | Activate **spec-driven mode** — the third planning posture for AI-agent execution |
| `planr spec create "<title>" --slug <slug>` | Create a self-contained `.planr/specs/SPEC-NNN-{slug}/` with stories/, tasks/, design/ subdirs |
| `planr spec shape <SPEC-id>` | Interactive 4-question spec authoring (Context, Functional Reqs, Business Rules, Acceptance) |
| `planr spec decompose <SPEC-id>` | AI-driven generation of User Stories + Tasks; matches openplanr-pipeline schema |
| `planr spec sync [<SPEC-id>] --dry-run` | Validate spec integrity (orphans, missing specId, schema drift); auto-fixes safe issues |
| `planr spec promote <SPEC-id>` | Validate decomposition + print `/openplanr-pipeline:plan {slug}` handoff |

**Rule:** Every command that accepts `--yes` MUST receive it when invoked by an
agent. Interactive prompts hang forever in non-TTY contexts.

## Non-Interactive Mode (Required for Agents)

OpenPlanr auto-detects non-TTY environments and falls back to defaults, but you
should be explicit anyway. Pass `--yes` (or its long form `--no-interactive`) on
every invocation.

```bash
# CORRECT — agent-friendly
planr epic create --title "User Auth" --yes

# WRONG — will hang in agent execution
planr epic create --title "User Auth"
```

**What `--yes` does:**

- Confirmations return their default (usually "yes")
- Select menus pick the primary option
- `--manual` mode exits with an error (it requires a human)
- Skipped prompts are logged with `[auto]` prefix for auditability

## Artifact Layout

After running commands, `.planr/` contains:

```
.planr/
├── config.json                  # Project config (AI provider, paths)
├── epics/EPIC-001-*.md          # Epics
├── features/FEAT-001-*.md       # Features
├── stories/
│   ├── US-001-*.md              # User story (role, goal, benefit, acceptance)
│   └── US-001-gherkin.feature   # Gherkin acceptance criteria
├── tasks/TASK-001-*.md          # Implementation task lists (parent: a story or feature)
├── quick/QT-001-*.md            # Standalone task lists (no hierarchy)
├── backlog/BL-001-*.md          # Captured backlog items
├── sprints/SPRINT-001-*.md      # Time-boxed sprints
├── adrs/ADR-001-*.md            # Architecture decision records (created by user)
├── templates/                   # Custom task templates
└── checklists/agile-checklist.md
```

Every artifact has YAML frontmatter with `id`, `status`, and parent links
(`epicId`, `featureId`, `storyId`). Follow parent links to build the full context
chain when implementing a task. See `references/artifacts.md` for the full
frontmatter schema per artifact type.

## Common Workflows

See `references/workflows.md` for full walkthroughs of:

- **PRD → full agile hierarchy** (epic → features → stories → tasks)
- **Quick task** (standalone, no hierarchy)
- **Sprint cycle** (create → add tasks → track → close)
- **Backlog grooming** (capture → AI-prioritize → promote)
- **Refinement pass** (review and improve artifacts with AI)
- **Export** (markdown / HTML / JSON reports)
- **GitHub sync** (push artifacts to Issues, bi-directional status)
- **Spec-driven workflow** (see below — bridges to `openplanr-pipeline` plugin)

## Spec-Driven Mode (third planning posture)

OpenPlanr supports three planning modes:

1. **Agile** — humans planning for humans (epic → feature → story → task, sprints, story points)
2. **QT (Quick Task)** — standalone task lists, no hierarchy
3. **Spec-driven** *(NEW)* — humans planning **for AI coding agents to execute**

The spec-driven mode produces planning artifacts with a richer agent-execution
contract: explicit file Create/Modify/Preserve lists, Type=UI|Tech, agent
assignment, and DoD with build/test commands. The schema **matches the
[`openplanr-pipeline`](https://github.com/openplanr/openplanr-pipeline) Claude
Code plugin verbatim** — both products share one schema, no conversion adapter.

### When to suggest spec-driven mode

The user's project might benefit from spec-driven mode when:

- They use Claude Code, Cursor, or Codex to ship features end-to-end (planning *for* agents)
- They've installed (or want to install) `openplanr-pipeline` for code generation
- Their tasks need explicit file lists / build/test DoD (richer than agile tasks)
- They mention "spec-driven", "decompose for agents", "pipeline", or similar

Activate spec-driven mode with `planr spec init`. It is **opt-in and additive** —
existing agile + QT artifacts are untouched.

### Spec-driven artifact layout

Each spec is a **self-contained directory** under `.planr/specs/`:

```
.planr/specs/SPEC-001-auth-flow/
├── SPEC-001-auth-flow.md            # the functional spec
├── design/                          # PNG mockups + design-spec.md
│   ├── login-screen.png
│   └── design-spec.md               # written by openplanr-pipeline's designer-agent
├── stories/
│   └── US-001-login.md              # US-NNN scoped to this spec (not project-globally unique)
└── tasks/
    └── T-001-loginform.md           # T-NNN scoped to this spec
```

**ID scoping rule:** in spec-driven mode, `US-NNN` and `T-NNN` are scoped to
their parent SPEC, not project-globally unique. Two specs can each have their
own US-001. Disambiguate via path or via `specId` frontmatter when necessary.

### Spec-driven command sequence

```bash
# 1. Activate spec-driven mode (idempotent, additive)
planr spec init

# 2. Author a spec (creates self-contained SPEC-NNN-{slug}/ directory)
planr spec create "Auth flow" --slug auth --priority P0 --milestone v1.0

# 3. (Optional) Attach UI mockups for the pipeline's designer-agent
planr spec attach-design SPEC-001 --files login.png signup.png

# 4a. Author the spec body — pick one:
#     EITHER guided authoring (interactive 4 questions):
planr spec shape SPEC-001
#     OR edit the spec markdown in your $EDITOR directly

# 4b. Decompose into User Stories + Tasks (AI-driven)
planr spec decompose SPEC-001
#     Flags: --force (overwrite existing), --no-code-context (faster),
#            --max-stories <n> (cap output)

# 5. Review the decomposition
planr spec show SPEC-001
planr spec status

# 5b. Validate integrity if needed (orphans, missing specId, schema drift)
planr spec sync SPEC-001        # or `planr spec sync` for all specs

# 6. Promote (validates completeness; prints pipeline handoff)
planr spec promote SPEC-001
```

### Pipeline bridge

After `planr spec promote SPEC-001` succeeds, the user invokes the pipeline plugin
in **Claude Code** (not the planr CLI):

```
/openplanr-pipeline:plan auth     # PO Phase: design-spec, decomposition (if not done)
/openplanr-pipeline:review auth   # human review of the decomposition
/openplanr-pipeline:ship auth     # DEV Phase: code generation, QA, devops, docs
```

The pipeline plugin reads `.planr/specs/` directly when spec mode is active —
no conversion. This is the integration story: **planr plans, openplanr-pipeline
ships, schema is shared.**

### When NOT to use spec-driven mode

- The user is doing pure human planning (agile mode is the right call)
- The user wants story points / sprint velocity / burndown (those are agile concepts; spec mode focuses on agent-execution contracts instead)
- The user's project doesn't (and won't) use a Claude Code plugin for code generation

## Troubleshooting

See `references/troubleshooting.md` for handling:

- "AI provider not configured" → `planr config set-provider anthropic`
- "API key missing" → `planr config set-key anthropic`
- Hangs in agent execution → you forgot `--yes`
- Broken parent links → `planr sync`
- Import errors on older Node → upgrade to Node 20+

## Examples

- `examples/plan-from-prd.md` — turn a PRD markdown file into a full agile hierarchy
- `examples/quick-task.md` — capture a standalone task list for a one-off fix
- `examples/sprint-cycle.md` — full sprint lifecycle from creation to close
