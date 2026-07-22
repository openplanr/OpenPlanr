<div align="center">

# OpenPlanr

### Dedicated planning CLI and cross-runtime workflow control plane

**Plan continuously. Route feature delivery anywhere.** Certified first for **Claude Code**, **Cursor**, and **Codex** through Protocol v1.0 artifacts plus v1.1 runtime contracts.

[![npm version](https://img.shields.io/npm/v/openplanr.svg?style=flat-square&color=cb3837&logo=npm)](https://www.npmjs.com/package/openplanr)
[![node](https://img.shields.io/node/v/openplanr.svg?style=flat-square&color=339933&logo=node.js&logoColor=white)](https://nodejs.org)
[![license](https://img.shields.io/npm/l/openplanr.svg?style=flat-square&color=blue)](https://github.com/openplanr/OpenPlanr/blob/main/LICENSE)
[![protocol](https://img.shields.io/badge/protocol-v1.0.0-7c3aed?style=flat-square)](https://github.com/openplanr/planr-pipeline/tree/main/docs/protocol)
[![runtimes](https://img.shields.io/badge/runtimes-Claude%20Code%20%7C%20Cursor%20%7C%20Codex-f97316?style=flat-square)](https://github.com/openplanr/planr-pipeline/blob/main/docs/compatibility-matrix.md)

**[Website](https://openplanr.dev)** · **[Setup guide](docs/CROSS_RUNTIME_SETUP.md)** · **[Artifact review](docs/ARTIFACT_REVIEW.md)** · **[Compatibility matrix](https://github.com/openplanr/planr-pipeline/blob/main/docs/compatibility-matrix.md)** · **[Protocol spec](https://github.com/openplanr/planr-pipeline/tree/main/docs/protocol)** · **[CLI reference](docs/CLI.md)**

</div>

---

OpenPlanr is the standalone planning and project-management CLI. It owns epics,
features, stories, tasks, specs, sprints, backlog, reports, integrations, and
artifact lifecycle. `planr-pipeline` is a separate complete PO → Design → Review
→ DEV → QA workflow with its own feature-local planning phase. The overlap is
intentional; shared artifacts and provenance make the producer explicit.

```bash
curl -fsSL https://openplanr.dev/install.sh | sh
# Windows: irm https://openplanr.dev/install.ps1 | iex

cd my-project
planr setup
planr doctor
planr init
planr pipeline plan auth
```

No global install is also supported: `npx openplanr@latest setup`. Planning-only
installations use `--minimal`; the full pipeline is the default.

---

## Why OpenPlanr?

AI coding agents are powerful but lack structured planning context. Without a clear plan, they generate code that drifts from requirements, churn on the same problem across sessions, and can't be audited. OpenPlanr fixes this with four properties:

1. **Markdown artifacts in your repo** — plans live next to your code, version-controlled, gittable, gradable. No external SaaS, no DB.
2. **One contract, every runtime** — Claude Code, Cursor, and Codex consume the same v1.0 artifacts while locks, adapter capabilities, and provenance use additive v1.1 contracts.
3. **Three planning postures** — agile, quick task, or spec-driven planning, independent from the pipeline's feature-local PO phase.
4. **Safe runtime migration** — setup previews exact changes, preserves hand-written content, records ownership, backs up exact bytes, and supports rollback.

---

## Three planning postures

| Posture | Best for | Output |
|---|---|---|
| **Agile** | Real teams, sprints, multi-stakeholder work | `.planr/{epics,features,stories,tasks,sprints}/*.md` + Gherkin |
| **Quick task** | Solo dev, one-off chores, no ceremony | `.planr/quick/QT-NNN-*.md` (a single checklist file) |
| **Spec-driven** | Handing a feature to an AI agent factory | `.planr/specs/SPEC-NNN-{slug}/{stories,tasks,design}/` |

Pick one per project, mix per task. The spec-driven posture is the bridge to the [planr-pipeline](https://github.com/openplanr/planr-pipeline) — same artifact contract, no conversion adapter.

---

## Cross-runtime support

`planr setup` detects installed runtimes and installs portable adapters. `planr init`
remains project initialization; it is no longer overloaded with user installation.

| Runtime | What gets installed | How the workflow activates |
|---|---|---|
| **Claude Code** | Portable package with the native plugin commands and tool-enforced agents; existing marketplace installs remain compatible | Existing slash commands or the packaged headless router |
| **Cursor** | Portable project rules plus nine generated role files using relative paths | Composer handoff with sequential fallback |
| **Codex** | User-scope skills; `AGENTS.md` contains only project policy and artifact pointers | Skills, native subagents when available, sequential fallback otherwise |

Same artifacts (`.planr/specs/SPEC-NNN-{slug}/`). Same `.pipeline-shipped` proof markers. Cross-runtime spec portability works out of the box. See the [compatibility matrix](https://github.com/openplanr/planr-pipeline/blob/main/docs/compatibility-matrix.md) for per-capability parity.

---

## Quick start

### Install and setup

```bash
curl -fsSL https://openplanr.dev/install.sh | sh
cd my-project
planr setup
planr doctor
```

The installer installs the CLI only. Guided setup detects coding agents and
prompts for workflow mode, runtimes, and scope; user scope is the safe default.
Use `planr setup --dry-run` to preview, `planr setup --minimal` for planning
only, and `planr runtime rollback` to restore exact pre-migration bytes.

### Initialise a project

```bash
cd my-project
planr init
# Interactive: pick AI provider, pick coding agent, generate rules → done
```

Non-interactive variants:

```bash
planr init --yes                       # accept all defaults (AI on, all rules)
planr init --no-ai --yes               # skip AI provider setup
planr init --no-pipeline-rules --yes   # agile rules only (skip pipeline workflow)
```

### Pick a posture and start

**Agile:**

```bash
planr epic create
planr feature create --epic EPIC-001
planr story create --feature FEAT-001
planr task create --feature FEAT-001
# Or one-shot:
planr plan --epic EPIC-001
```

**Quick task:**

```bash
planr quick create "add OAuth login"
```

**Spec-driven (with the pipeline plugin):**

```bash
planr spec create "Auth flow" --slug auth
planr spec shape SPEC-001              # 4 questions, no $EDITOR
planr pipeline plan auth
# Human review is mandatory before the separate SHIP invocation:
planr pipeline ship auth
```

### Review and privately share any HTML artifact

```bash
planr artifact ./artifact.html
# Add pins, threads, and an Approve or Request changes decision.

planr artifact share ./artifact.html --no-open # live encrypted room (default)
planr artifact share ./artifact.html --snapshot # explicit immutable snapshot
planr artifact open ./artifact.html --presentation canvas # optional spatial view
planr artifact import "<returned-review-url>"
```

Generic artifacts render edge-to-edge in the headless document presentation;
design boards retain the zoomable canvas. Complete local HTML/CSS/JavaScript is
bundled into an opaque-origin sandbox, so private review is not standalone site
hosting.

Sharing is explicit. A new generic share creates one stable encrypted live room:
anyone with its review URL can comment, while the creator receives a separate
private manage URL to pause comments, set the final verdict, or delete the
room. Immutable fragments and encrypted short links remain available with
`--snapshot`; the service stores ciphertext only.
See the [artifact review and privacy guide](docs/ARTIFACT_REVIEW.md).

---

## Commands

### Spec-driven mode

Third planning posture — designed for handing features to AI coding agents. Specs decompose into User Stories and Tasks with explicit file Create / Modify / Preserve lists, `Type: UI | Tech`, agent assignment, and DoD with build / test commands. Schema matches [OpenPlanr Protocol v1.0.0](https://github.com/openplanr/planr-pipeline/tree/main/docs/protocol); canonical JSON Schemas for this cleanup cycle live in `openplanr/planr-pipeline` under `schemas/v1.0.0/`.

| Command | Description |
|---|---|
| `planr spec init` | Activate spec-driven mode (creates `.planr/specs/`) |
| `planr spec create "Auth flow"` | Create a self-contained `SPEC-NNN-{slug}/` directory |
| `planr spec shape <id>` | Interactive 4-question authoring (Context, Functional Reqs, Business Rules, Acceptance) |
| `planr spec decompose <id>` | AI-driven decomposition into US + Tasks |
| `planr spec sync [<id>]` | Validate integrity (orphans, missing `specId`, schema drift); auto-fixes safe issues |
| `planr spec list` | List all specs with status + decomposition counts |
| `planr spec show <id>` | Print a spec + its US/Task tree |
| `planr spec status [<id>]` | Decomposition state across one/all specs |
| `planr spec destroy <id>` | Remove a spec entirely |
| `planr spec attach-design <id> --files <png>...` | Attach UI mockups for the designer-agent |
| `planr spec promote <id>` | Validate + print the pipeline handoff command |

### Agile hierarchy

| Command | Description |
|---|---|
| `planr epic create` | Create a new epic (supports `--file <path>` for PRDs) |
| `planr feature create --epic <ID>` | Create features from an epic |
| `planr story create --feature <ID>` | Create user stories from a feature |
| `planr story create --epic <ID>` | Batch-generate stories for all features under an epic |
| `planr task create --story <ID>` | AI task list from one story |
| `planr task create --feature <ID>` | AI task list from all stories under a feature |
| `planr plan` | Full automated flow: Epic → Features → Stories → Tasks |
| `planr epic list` / `planr feature list` / `planr story list` / `planr task list` | List artifacts |

### Quick tasks & templates

| Command | Description |
|---|---|
| `planr quick create "description"` | AI-generated standalone task list |
| `planr quick create --file spec.md` | Task list from a PRD or spec file |
| `planr quick promote <ID> --story US-001` | Move into agile hierarchy |
| `planr template list` | List built-in and custom templates |
| `planr template use rest-endpoint --title "User API"` | Generate tasks from a template |
| `planr template save TASK-001 --name my-pattern` | Save existing tasks as template |

Built-in templates: `rest-endpoint`, `react-component`, `database-migration`, `api-integration`, `auth-flow`.

### Backlog & Sprint

| Command | Description |
|---|---|
| `planr backlog add "desc" --priority high --tag bug` | Capture a backlog item |
| `planr backlog list` / `prioritize` / `promote <id>` / `close <id>` | Manage backlog |
| `planr sprint create --name "Sprint 1" --duration 2w` | Create a time-boxed sprint |
| `planr sprint add TASK-001 QT-001` | Assign tasks (or `--auto` for AI) |
| `planr sprint status` / `list` / `close` / `history` | Track sprint progress + velocity |

### Planning tools

| Command | Description |
|---|---|
| `planr estimate <ID>` | AI effort estimation (story points, hours, complexity) |
| `planr refine <ID>` | AI-powered review and prose polish |
| `planr revise <ID>` | AI-driven *alignment* of planning artifacts with codebase (with diff preview) |
| `planr search <query>` | Full-text search across all artifacts |
| `planr sync` | Validate and fix cross-references |
| `planr status [scope]` | Whole-project delivery report — status + GitHub/Linear cross-ref + outstanding work (`--md` / `--json` / `--github` / `--linear`) |

### AI agent rules

| Command | Description |
|---|---|
| `planr rules generate` | Generate rule files for all configured runtimes (default scope: agile) |
| `planr rules generate --target cursor --scope pipeline` | Cursor + pipeline workflow rules |
| `planr rules generate --target all --scope all` | Everything for every runtime |
| `planr rules generate --dry-run` | Preview without writing |

`--scope agile` (default) writes the agile workflow rules. `--scope pipeline` writes the rule files that drive the [planr-pipeline](https://github.com/openplanr/planr-pipeline) two-phase spec-driven flow on the chosen runtime. `--scope all` produces both. `planr init` auto-runs `--scope all` by default — opt out with `planr init --no-pipeline-rules`.

### Integrations

| Command | Description |
|---|---|
| `planr github push [ID]` | Push artifacts to GitHub Issues |
| `planr github sync` | Bi-directional status sync with GitHub |
| `planr github status` | Show sync status of linked artifacts |
| `planr linear init` | Configure Linear (allowed teams + default + token) |
| `planr linear push <id>` | Epic → Linear project; features / stories / tasks → issues |
| `planr linear sync` | Pull Linear workflow state into artifact `status` |
| `planr export --format html` | Export planning report (markdown / JSON / HTML) |

### Stakeholder reports

| Command | Description |
|---|---|
| `planr report <type>` | Generate a report (`sprint`, `weekly`, `executive`, `standup`, `retro`, `release`) |
| `planr report-linter [file]` | Lint a markdown report (vague language, evidence density) |
| `planr context --report-type weekly` | Print the report context pack as JSON |
| `planr voice standup --file transcript.txt` | Convert a transcript into a structured standup |

Output: Markdown + HTML written to `.planr/reports/`. `--push slack` posts via webhook; `--push github` opens an issue. `--strict-evidence` fails on bullets without URLs / `#issue` refs.

### Setup & config

| Command | Description |
|---|---|
| `planr setup` | Detect and install runtime adapters with preview, backup, and locking |
| `planr runtime detect/list/install/update/remove/rollback/doctor` | Manage adapter lifecycle |
| `planr doctor [--strict] [--fix] [--json]` | Unified ecosystem health checks |
| `planr pipeline <action>` | Route PLAN, Design, SHIP, status, dashboard, sync, or doctor |
| `planr init` | Initialise project (creates `.planr/`, generates rules for all runtimes by default) |
| `planr config show` | Display current configuration + spec-driven readiness |
| `planr config set-provider` / `set-key` / `set-model` / `set-agent` | Manage AI provider settings |
| `planr checklist show/toggle/reset` | Agile development checklist |

See [docs/CLI.md](docs/CLI.md) for the full reference with every flag.

---

## Project structure

After `planr init` and creating artifacts:

```text
my-project/
├── .planr/
│   ├── config.json              # Project configuration
│   ├── epics/                   # EPIC-001-*.md
│   ├── features/                # FEAT-001-*.md
│   ├── stories/                 # US-001-*.md + US-001-gherkin.feature
│   ├── tasks/                   # TASK-001-*.md
│   ├── quick/                   # QT-001-*.md
│   ├── specs/                   # SPEC-NNN-{slug}/ (spec-driven mode)
│   ├── backlog/                 # BL-001-*.md
│   ├── sprints/                 # SPRINT-001-*.md
│   ├── adrs/                    # Architecture Decision Records
│   ├── reports/                 # Stakeholder reports
│   └── checklists/              # Agile development checklist
├── .cursor/rules/
│   ├── agile-checklist.mdc      # Agile workflow rules
│   ├── planr-pipeline.mdc   # Pipeline rules (default-on)
│   └── agents/                  # 8 subagent body files
├── CLAUDE.md                    # Claude Code rules
├── planr-pipeline.md        # Pipeline reference card (Claude Code)
└── AGENTS.md                    # Codex rules + pipeline orchestration
```

---

## Architecture decision: `planr revise`

Most planning tools let plans drift from the codebase. `planr revise` actively rewrites planning artifacts so they match reality, with a four-layer safety pipeline:

1. **Clean-tree gate** — git working tree must be clean (`--allow-dirty` to override)
2. **Agent decision** — zod-validated `revise` / `skip` / `flag` per artifact
3. **Evidence verification** — agent must cite typed, verifiable evidence (file existence, grep matches, sibling artifacts); unverifiable citations are dropped
4. **Diff preview + confirmation** — per-artifact `[a]pply / [s]kip / [e]dit / [d]iff / [q]uit`; writes are atomic with sidecar backups

```bash
planr revise EPIC-003 --cascade           # interactive
planr revise --all --dry-run              # preview every revision
planr revise EPIC-003 --cascade --dry-run --audit ./revise.json   # CI mode
```

Full design: [.planr/EPIC-REVISE-COMMAND.md](.planr/EPIC-REVISE-COMMAND.md).

---

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
    "epic": "EPIC", "feature": "FEAT", "story": "US",
    "task": "TASK", "quick": "QT", "backlog": "BL",
    "sprint": "SPRINT", "spec": "SPEC"
  }
}
```

---

## Ecosystem

OpenPlanr is one of four components:

| Component | Role | Repo |
|---|---|---|
| **`planr` CLI** | Authoring surface — generates `.planr/` artifacts and runtime rule files | this repo |
| **`planr-pipeline`** | Portable PO → Design → Review → DEV → QA engine with nine canonical roles and runtime adapters | [openplanr/planr-pipeline](https://github.com/openplanr/planr-pipeline) |
| **`openplanr` skill** | Routing playbook — teaches Claude when to use which surface | [openplanr/skills](https://github.com/openplanr/skills) |
| **`openplanr/marketplace`** | Distribution — Claude Code plugin registry | [openplanr/marketplace](https://github.com/openplanr/marketplace) |

planr CLI is the only piece you need to install for Cursor and Codex. Add the marketplace + pipeline plugin for the full Claude Code experience.

---

## Development

```bash
git clone https://github.com/openplanr/OpenPlanr.git
cd OpenPlanr
npm install

# Run from source
npx tsx src/cli/index.ts init

# Build / test / lint
npm run build
npm test
npx biome check src/ tests/

# Link globally for development
npm install -g .
```

---

## Contributing

Contributions welcome. See [CONTRIBUTING.md](CONTRIBUTING.md).

1. Fork the repository
2. Create your feature branch (`git checkout -b feat/amazing-feature`)
3. Commit your changes
4. Push to the branch
5. Open a Pull Request

---

## License

[MIT](LICENSE)
