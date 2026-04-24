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
