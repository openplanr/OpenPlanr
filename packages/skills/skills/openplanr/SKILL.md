---
name: openplanr
description: Agile planning CLI for coding agents — creates epics, features, user stories, tasks, sprints, and backlog items as markdown artifacts in .planr/. Use when the user asks to plan a project, break down a PRD, write stories, estimate work, manage sprints, prioritize a backlog, or generate agent rule files (CLAUDE.md, AGENTS.md, .cursor/rules). Also use when the repo already contains a .planr/ directory — OpenPlanr owns that directory.
license: MIT
---

# OpenPlanr — Agile Planning for Coding Agents

## What This Skill Does

OpenPlanr is a CLI that generates and maintains agile planning artifacts — epics,
features, user stories, tasks, sprints, and backlog items — as markdown files in
a `.planr/` directory. This skill teaches Claude how to drive OpenPlanr end-to-end:
detecting when planning is needed, installing or verifying the CLI, running the
right commands in agent-friendly non-interactive mode, and interpreting the
markdown artifacts it produces.

A **third planning posture (spec-driven mode)** bridges to the
`planr-pipeline` Claude Code plugin for AI-driven feature shipping. See
[Critical Routing Decision](#critical-routing-decision) for which surface owns
the work in each runtime context.

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
- Wants **spec-driven planning** — author specs that decompose into agent-executable tasks ("plan for AI agents", "spec mode", "decompose this spec for execution", "bridge to planr-pipeline")
- Wants to author plans that the **`planr-pipeline` Claude Code plugin** can execute directly without translation

## When NOT to Use

Do NOT activate this skill when:

- The user wants to **write code directly** for a task that's already fully specified — implementation alone isn't this skill's job (planning is)
- The user wants **project management dashboards** (Jira UI, Linear UI, Asana) — OpenPlanr is file-based, not a dashboard tool. It can sync to GitHub Issues or Linear though.
- The user wants to **track live work status in a UI** — use GitHub Issues via `planr github push`, Linear via `planr linear push`, or an external tool.

---

## Critical Routing Decision

OpenPlanr ships across three first-class AI coding agent runtimes (Claude
Code, Cursor, Codex) and a bare CLI mode. Pick exactly one path per request
based on the runtime context (axis 1) and whether pipeline rules are
installed for that runtime (axis 2).

### Two-axis decision tree

```
What runtime are you in?
│
├── Claude Code
│   │
│   └── Is the planr-pipeline plugin installed?
│       │
│       ├── YES → Path A   (canonical — manifest-enforced subagents)
│       │
│       └── NO  → Path B   (drive planr CLI; suggest plugin install at end)
│
├── Cursor
│   │
│   └── Are pipeline rules installed (`.cursor/rules/planr-pipeline.mdc`)?
│       │
│       ├── YES → Path A2  (Cursor adapter — Composer subagent dispatch)
│       │
│       └── NO  → suggest: planr rules generate --target cursor --scope pipeline
│
├── Codex
│   │
│   └── Does AGENTS.md include the OpenPlanr pipeline section?
│       │
│       ├── YES → Path A3  (Codex adapter — persona role-shift)
│       │
│       └── NO  → suggest: planr rules generate --target codex --scope pipeline
│
└── Bare CLI (no AI runtime)
    │
    └── Path C — out of skill scope
        The user runs planr commands themselves; skill is not in the loop.
```

All three pipeline paths (A, A2, A3) execute the same OpenPlanr Protocol
v1.0.0 — same artifacts, same workflow, same `.pipeline-shipped` marker.
Full compatibility matrix: see `planr-pipeline/docs/compatibility-matrix.md`.

### Path A — pipeline-driven (canonical)

**Use when:** the planr-pipeline plugin is installed in the user's Claude Code session.

**The pipeline plugin is self-sufficient.** It does NOT require the planr CLI to
be installed. Your job is to invoke the pipeline directly with the feature slug
— the pipeline scaffolds its own spec shell, runs the designer + specification
agents, and ships the code.

```
# Single command — pipeline scaffolds .planr/specs/SPEC-NNN-{slug}/ if missing,
# then runs decomposition.
/planr-pipeline:plan <slug>
```

**First run** (no spec exists): pipeline auto-scaffolds an empty spec shell at
`.planr/specs/SPEC-NNN-<slug>/SPEC-NNN-<slug>.md` and stops with an
"edit and re-run" message. Tell the user to fill in the spec body (or open
the file for them) and re-invoke `/planr-pipeline:plan <slug>`.

**Second run** (spec body has real content): pipeline's designer-agent and
specification-agent decompose the spec into stories + tasks. Stop and wait for
the user to review.

After user approval, ship:

```
/planr-pipeline:ship <slug>
```

If the user has dropped PNG mockups for the feature, place them at
`input/ui/feat-<slug>/*.png` (default) or attach via `planr spec attach-design`
if planr CLI is installed. Either path resolves correctly.

**Path A invariants:**

- Do not call `planr spec decompose` — duplicates the pipeline's specification-agent
- Do not call `planr spec create` — the pipeline scaffolds its own shell
- Do not implement tasks yourself in-session — the pipeline's frontend-agent / backend-agent must run

### Path A2 — Cursor adapter

**Use when:** the user is in Cursor with pipeline rules installed at
`.cursor/rules/planr-pipeline.mdc` (generated by
`planr rules generate --target cursor --scope pipeline`).

The Cursor rules tell Composer how to orchestrate the pipeline:

- User says "plan {feature}" → `planr-pipeline-plan.mdc` activates
- User says "ship {feature}" → `planr-pipeline-ship.mdc` activates

Subagents are dispatched via Cursor's Composer subagent system using body
files at `.cursor/rules/agents/{role}.md`. Tool restrictions are advisory
(prompt-level only on Cursor — see compatibility matrix caveats).

If the user is in Cursor but pipeline rules aren't installed: tell them to
run `planr rules generate --target cursor --scope pipeline` first.

### Path A3 — Codex adapter

**Use when:** the user is in Codex with `AGENTS.md` containing the
OpenPlanr pipeline section (generated by
`planr rules generate --target codex --scope pipeline`).

Codex models the 8 roles as personas the model adopts during specific tasks.
No separate subagent processes — persona role-shift happens in-session.

If `AGENTS.md` doesn't include the pipeline section: tell the user to run
`planr rules generate --target codex --scope pipeline` to add it.

**Optional planr CLI helpers in any Path A variant** (only if planr CLI is installed; the pipeline does not depend on it):

| Command | Use case |
|---|---|
| `planr spec list` | Browse all specs in the project |
| `planr spec status` | Decomposition + ship state per spec |
| `planr spec sync` | Validate integrity (orphans, missing specId, schema drift) |
| `planr spec show <id>` | Print one spec + its US/Task tree |
| `planr spec destroy <id>` | Clean removal of a spec directory |
| `planr spec shape <id>` | Guided 4-question spec authoring (alternative to manually editing the markdown) |

These are convenience surfaces for ongoing maintenance — they are NOT
prerequisites for the core `/planr-pipeline:plan` → `/ship` flow.

### Path B — skill-driven (no pipeline plugin)

**Use when:** you're in Claude Code but `planr-pipeline` is not installed.

Drive planr CLI commands on the user's behalf, then implement the tasks yourself
in-session. Suggest the pipeline at the end:

```bash
planr init --yes                                # AI auto-enabled
planr spec init
planr spec create "<title>" --slug <slug>
planr spec shape <SPEC-id>                       # interactive 4 questions; reliable in TTY
planr spec decompose <SPEC-id>                   # AI generates US + tasks
planr spec show <SPEC-id>                        # human review the tree
```

After decomposition, implement the tasks in your session, then tell the user:

> *For full pipeline orchestration with QA gate, parallel subagents, Docker
> generation, and CLAUDE.md snapshot — install the planr-pipeline plugin
> from the marketplace: `/plugin marketplace add openplanr/marketplace` and
> `/plugin install planr-pipeline@openplanr`.*

### Path C — bare CLI (out of skill scope)

The user runs planr commands themselves at the terminal. You're not invoked.
This skill activates only inside Claude Code (Paths A and B).

---

## Pipeline invocation when tasks are populated (Path A)

If you find populated `.planr/specs/SPEC-NNN-{slug}/tasks/T-*.md` files
with `type: UI|Tech` frontmatter AND the planr-pipeline plugin is
installed, invoke `/planr-pipeline:ship <slug>` to execute them. The
pipeline's qa-agent gate, error-report mechanism, and CLAUDE.md snapshot
are part of the contract.

The only acceptable bypass: the user explicitly says *"do not run the
pipeline, implement directly."* A generic "continue" or "go" is not
explicit consent.

---

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

## `planr init` defaults

Run `planr init --yes` (without `--no-ai`) on the user's behalf. planr
auto-detects API keys from the OS keychain, environment variables
(`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`), or `~/.planrrc`.
Pass `--no-ai` only when the user has explicitly opted out of AI features.

## Core Workflow

Every interaction follows the same four steps:

1. **Detect the planning intent** — map the user's request to an OpenPlanr command (see "Key Commands" below, or `references/commands.md` for the full catalog)
2. **Apply the routing decision** — Path A (pipeline-driven), Path B (skill-driven), or Path C (out of scope)
3. **Run commands non-interactively** — ALWAYS pass `--yes` (or `--no-interactive`); never rely on interactive prompts
4. **Read the generated artifact(s)** — locate the output file in `.planr/`, read it, summarize the result, and propose the next step

## Key Commands

The most common commands. For the full catalog (~40 commands), see
`references/commands.md`.

### Setup + agile commands

| Command | What it does |
|---------|-------------|
| `planr init --yes` | Initialize `.planr/` in the current project (AI auto-enabled if keys present) |
| `planr plan --yes` | Full agile flow: Epic → Features → Stories → Tasks |
| `planr epic create --file <path> --yes` | Generate an epic from a PRD document |
| `planr feature create --epic EPIC-001 --yes` | Generate features under an epic |
| `planr story create --epic EPIC-001 --yes` | Generate stories for every feature under an epic |
| `planr task create --story US-001 --yes` | Generate an implementation task list |
| `planr refine EPIC-001 --cascade --yes` | AI review and improvement, cascading to children |
| `planr status` | Tree view of all planning progress |
| `planr rules generate --yes` | Generate CLAUDE.md / AGENTS.md / .cursor/rules |
| `planr backlog prioritize --yes` | AI-powered backlog prioritization by impact/effort |

### Spec-driven commands

⚠️ **Read the [Critical Routing Decision](#critical-routing-decision-read-this-first) before invoking
any of these.** When the planr-pipeline plugin is installed (Path A),
the pipeline scaffolds its own spec shell — planr CLI commands here become
optional maintenance helpers, not prerequisites.

| Command | Path A (pipeline) | Path B (skill-driven) | What it does |
|---|---|---|---|
| `planr spec init` | optional | ✅ | Activate spec-driven mode (pipeline does this implicitly) |
| `planr spec create "<title>" --slug <slug>` | optional | ✅ | Create the spec shell (pipeline auto-scaffolds otherwise) |
| `planr spec attach-design SPEC-NNN --files ...` | optional | ✅ | Attach PNG mockups (or drop them in `input/ui/feat-{slug}/` directly) |
| `planr spec shape <SPEC-id>` | ❌ skip — let pipeline handle | ✅ | Interactive 4-question authoring |
| `planr spec decompose <SPEC-id>` | ❌ skip — pipeline's specification-agent does this | ✅ | AI generation of US + Tasks |
| `planr spec show <SPEC-id>` | ✅ (read-only) | ✅ | Inspect the spec tree |
| `planr spec list` | ✅ | ✅ | Browse all specs in the project |
| `planr spec status` | ✅ | ✅ | Decomposition + ship state per spec |
| `planr spec sync` | ✅ | ✅ | Validate spec integrity (orphans, missing specId, schema drift) |
| `planr spec destroy <id>` | ✅ | ✅ | Clean removal of a spec directory |
| `planr spec promote <SPEC-id>` | ❌ not needed (pipeline reads `.planr/specs/` directly) | ✅ | Validate + print pipeline handoff |

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
├── specs/SPEC-001-*/            # Spec-driven mode (third posture)
│   ├── SPEC-001-*.md            # the functional spec
│   ├── design/                  # PNG mockups + design-spec.md
│   ├── stories/US-NNN-*.md      # scoped to this spec
│   └── tasks/T-NNN-*.md         # scoped to this spec, with type/agent frontmatter
├── adrs/ADR-001-*.md            # Architecture decision records (created by user)
├── templates/                   # Custom task templates
└── checklists/agile-checklist.md
```

Every artifact has YAML frontmatter with `id`, `status`, and parent links
(`epicId`, `featureId`, `storyId`, `specId`). Follow parent links to build the
full context chain when implementing a task. See
`references/artifacts.md` for the full frontmatter schema per artifact type, or
visit the canonical reference at `openplanr.dev/docs/reference/spec-schema`.

## Common Workflows

See `references/workflows.md` for full walkthroughs of:

- **PRD → full agile hierarchy** (epic → features → stories → tasks)
- **Quick task** (standalone, no hierarchy)
- **Sprint cycle** (create → add tasks → track → close)
- **Backlog grooming** (capture → AI-prioritize → promote)
- **Refinement pass** (review and improve artifacts with AI)
- **Export** (markdown / HTML / JSON reports)
- **GitHub sync** (push artifacts to Issues, bi-directional status)
- **Spec-driven workflow** (Paths A and B above — bridges to `planr-pipeline` plugin)

## Spec-Driven Mode (third planning posture)

OpenPlanr supports three planning modes:

1. **Agile** — humans planning for humans (epic → feature → story → task, sprints, story points)
2. **QT (Quick Task)** — standalone task lists, no hierarchy
3. **Spec-driven** — humans planning **for AI coding agents to execute** (the `planr-pipeline` plugin reads `.planr/specs/` verbatim)

The spec-driven mode produces planning artifacts with a richer agent-execution
contract: explicit file Create/Modify/Preserve lists, `Type: UI|Tech`, agent
assignment (`frontend-agent` / `backend-agent`), and DoD with build/test
commands. The schema **matches the
[`planr-pipeline`](https://github.com/openplanr/planr-pipeline) Claude
Code plugin verbatim** — both products share one schema, no conversion adapter.

### When to suggest spec-driven mode

The user's project might benefit from spec-driven mode when:

- They use Claude Code, Cursor, or Codex to ship features end-to-end (planning *for* agents)
- They've installed (or want to install) `planr-pipeline` for code generation
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
│   └── design-spec.md               # written by planr-pipeline's designer-agent
├── stories/
│   └── US-001-login.md              # US-NNN scoped to this spec (not project-globally unique)
└── tasks/
    └── T-001-loginform.md           # T-NNN scoped to this spec
```

**ID scoping rule:** in spec-driven mode, `US-NNN` and `T-NNN` are scoped to
their parent SPEC, not project-globally unique. Two specs can each have their
own US-001. Disambiguate via path or via `specId` frontmatter when necessary.

### Frontmatter schema (canonical)

When hand-authoring or repairing US/T files, every story and task MUST include:

**Story (`stories/US-NNN-*.md`):**
```yaml
---
id: "US-001"
title: "Story title"
specId: "SPEC-001"
slug: "story-slug"
schemaVersion: "1.0.0"
status: "pending"            # pending | in-progress | done | blocked
priority: "P0"               # P0 | P1 | P2 | P3
created: "YYYY-MM-DD"
updated: "YYYY-MM-DD"
---
```

**Task (`tasks/T-NNN-*.md`):**
```yaml
---
id: "T-001"
title: "Task title"
storyId: "US-001"
specId: "SPEC-001"
slug: "task-slug"
schemaVersion: "1.0.0"
type: "UI"                   # UI | Tech (UI → frontend-agent, Tech → backend-agent)
agent: "frontend-agent"      # frontend-agent | backend-agent | (db-agent for migrations)
status: "pending"            # pending | in-progress | done | blocked
created: "YYYY-MM-DD"
updated: "YYYY-MM-DD"
---
```

The pipeline's specification-agent generates these automatically. If you need
to hand-author them (e.g., AI is unavailable), use these templates verbatim.

### Cross-runtime resume via task `status` (planr-pipeline v0.8.0+)

The pipeline's `/ship` command reads each task's `status` on entry and
partitions the dispatch queue:

| status | behaviour |
|---|---|
| `done` | skip — already shipped |
| `pending` | enqueue (fresh task) |
| `in-progress` | enqueue + recover (prior run crashed) |
| `blocked` | enqueue + retry (prior R6 wrote `tasks/T-NNN-error-report.md`) |

This makes a partially-shipped SPEC resumable across sessions, machines,
and runtimes — a SPEC half-shipped on Claude Code can finish on Cursor and
vice versa.

On Cursor and Codex `/ship` defaults to `DISPATCH_MODE: per-task` (one task
per invocation) because Composer / persona role-shift is a single
continuous session and cumulative context biases the model toward
"verification rollup" instead of fresh codegen. On Claude Code the default
is `multi-task` because manifest-isolated subagents give each task a clean
context. Override with `--all-tasks` when you know your runtime supports
isolated subagents.

### Spec-driven command sequence (Path B — when no pipeline plugin)

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

When the planr-pipeline plugin is installed, follow Path A in the
[Critical Routing Decision](#critical-routing-decision) section. The pipeline
scaffolds the spec shell, decomposes, and ships — planr CLI is optional. Both
products share the v1.0.0 spec schema verbatim.

### When NOT to use spec-driven mode

- The user is doing pure human planning (agile mode is the right call)
- The user wants story points / sprint velocity / burndown (agile concepts; spec mode focuses on agent-execution contracts instead)
- The user's project doesn't (and won't) use a Claude Code plugin for code generation

## Troubleshooting

See `references/troubleshooting.md` for handling:

- "AI provider not configured" → `planr config set-provider anthropic`
- "API key missing" → `planr config set-key anthropic`
- "AI is not configured" during `planr spec decompose` → configure AI as above, or hand-author from the [schema reference](https://openplanr.dev/docs/reference/spec-schema)
- Hangs in agent execution → you forgot `--yes`
- Broken parent links → `planr sync` (or `planr spec sync` for spec-driven mode)
- Import errors on older Node → upgrade to Node 20+

## Examples

- `examples/plan-from-prd.md` — turn a PRD markdown file into a full agile hierarchy
- `examples/quick-task.md` — capture a standalone task list for a one-off fix
- `examples/sprint-cycle.md` — full sprint lifecycle from creation to close
