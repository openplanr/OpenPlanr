<div align="center">

# OpenPlanr

### Dedicated planning CLI and cross-runtime workflow control plane

**Plan continuously. Route feature delivery anywhere.**
Certified first for **Claude Code**, **Cursor**, and **Codex** through Protocol
v1.0 artifacts plus additive runtime contracts.

[![npm version](https://img.shields.io/npm/v/openplanr.svg?style=flat-square&color=cb3837&logo=npm)](https://www.npmjs.com/package/openplanr)
[![node](https://img.shields.io/node/v/openplanr.svg?style=flat-square&color=339933&logo=node.js&logoColor=white)](https://nodejs.org)
[![license](https://img.shields.io/npm/l/openplanr.svg?style=flat-square&color=blue)](https://github.com/openplanr/OpenPlanr/blob/main/LICENSE)
[![protocol](https://img.shields.io/badge/protocol-v1.7.0-7c3aed?style=flat-square)](https://github.com/openplanr/OpenPlanr/tree/main/packages/pipeline/docs/protocol)
[![runtimes](https://img.shields.io/badge/runtimes-Claude%20Code%20%7C%20Cursor%20%7C%20Codex-f97316?style=flat-square)](https://github.com/openplanr/OpenPlanr/blob/main/packages/pipeline/docs/compatibility-matrix.md)

**[Website](https://openplanr.dev)** · **[Setup guide](docs/CROSS_RUNTIME_SETUP.md)** · **[Artifact review](docs/ARTIFACT_REVIEW.md)** · **[Compatibility matrix](https://github.com/openplanr/OpenPlanr/blob/main/packages/pipeline/docs/compatibility-matrix.md)** · **[Protocol spec](https://github.com/openplanr/OpenPlanr/tree/main/packages/pipeline/docs/protocol)** · **[CLI reference](docs/CLI.md)**

</div>

---

OpenPlanr is the public planning and project-management CLI package. It owns
epics, features, stories, tasks, specs, sprints, backlog, reports,
integrations, and artifact lifecycle. The public `planr-pipeline` package owns
the PO → Design → Review → DEV → QA workflow. Their package boundaries remain
independent, while their sources and shared contracts now live in the same
OpenPlanr workspace.

```bash
curl -fsSL https://openplanr.dev/install.sh | sh
# Windows: irm https://openplanr.dev/install.ps1 | iex

cd my-project
planr setup
planr doctor
planr init
```

Create a spec locally, then invoke the `planr:plan` skill in your coding host.

No global install is also supported: `npx openplanr@latest setup`. Planning-only
installations use `--minimal`; the full pipeline is the default.

---

## Why OpenPlanr?

AI coding agents are powerful but lack structured planning context. Without a clear plan, they generate code that drifts from requirements, churn on the same problem across sessions, and can't be audited. OpenPlanr fixes this with four properties:

1. **Markdown artifacts in your repo** — plans live next to your code, version-controlled, gittable, gradable. No external SaaS, no DB.
2. **One contract, every runtime** — Claude Code, Cursor, and Codex consume the same planning artifacts while locks and provenance retain explicit additive contracts.
3. **Three planning postures** — agile, quick task, or spec-driven planning, independent from the pipeline's feature-local PO phase.
4. **Safe runtime migration** — setup previews exact changes, preserves hand-written content, records ownership, backs up exact bytes, and supports rollback.

---

## Three planning postures

| Posture | Best for | Output |
|---|---|---|
| **Agile** | Real teams, sprints, multi-stakeholder work | `.planr/{epics,features,stories,tasks,sprints}/*.md` + Gherkin |
| **Quick task** | Solo dev, one-off chores, no ceremony | `.planr/quick/QT-NNN-*.md` (a single checklist file) |
| **Spec-driven** | Handing a feature to an AI agent factory | `.planr/specs/SPEC-NNN-{slug}/{stories,tasks,design}/` |

Pick one per project, mix per task. The spec-driven posture is the bridge to the [planr-pipeline](https://github.com/openplanr/OpenPlanr/tree/main/packages/pipeline) — same artifact contract, no conversion adapter.

---

## Cross-runtime support

`planr setup` detects installed runtimes and installs portable adapters. `planr init`
remains project initialization; it is no longer overloaded with user installation.

| Runtime | What gets installed | How the workflow activates |
|---|---|---|
| **Claude Code** | Official `planr@openplanr` unified marketplace plugin | Native `/planr:*` skills and packaged role agents |
| **Cursor** | Portable project rules plus nine generated role files using relative paths | Composer handoff with sequential fallback |
| **Codex** | User-scope skills; `AGENTS.md` contains only project policy and artifact pointers | Skills, native subagents when available, sequential fallback otherwise |

Same artifacts (`.planr/specs/SPEC-NNN-{slug}/`). Same `.pipeline-shipped` proof markers. Cross-runtime spec portability works out of the box. See the [compatibility matrix](https://github.com/openplanr/OpenPlanr/blob/main/packages/pipeline/docs/compatibility-matrix.md) for per-capability parity.

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
only, and `planr runtime rollback` to restore exact pre-migration bytes. When
Claude Code is selected, confirmed setup also refreshes the official
OpenPlanr marketplace and installs or updates its compatible plugins. Restart
Claude Code when setup reports that runtime packages changed.

### Run an Operate cycle with Codex

Full Codex setup installs one globally owned, digest-verified bundle containing
every canonical `planr-*` skill in the Protocol registry. The Operate set is
`planr-operate` plus the seven
`planr-{ceo,cto,cpo,cmo,coo,challenger,chair}-review` executors. Setup
copies every manifest-owned asset in each skill tree; `planr doctor --strict
--json` checks the installed files and their declared CLI requirements.

Invoke `$planr-operate` directly for a local seven-lens review. It infers a
current-snapshot periodic review when the request is clear, asks one native
question only when a consequential choice is genuinely ambiguous, and returns a
concise board report with decisions, actions, risks, coverage, and issues.

The note checker is optional editing help. It reports bounded structural
diagnostics, but a missing or imperfect lens does not discard the useful review
or create a workflow gate:

```bash
planr operate validate-note <note.md> --profile advisor|challenger|chair|board-report --contract-version 2.0.0 --json
```

Use `--contract-version auto` (the default) to detect current v2 notes and
historical v1 Markdown notes by declaration or structure.

The durable Operate runtime is a separate stateful interface. Discover its exact
registered domain identity before starting a durable Cycle; a domain version is
not the Protocol version and is never guessed:

```bash
planr operate domains --json
```

Issued durable assignments use the packet workflow below. The returned
`resultPath` is the file to author; no base64 or private runtime-store reads are
required.

```bash
planr operate assignment prepare <assignmentId> --actor <agentId> --runtime codex --json
planr operate assignment validate <packetId> --content-file <resultPath> --json
planr operate assignment submit <packetId> --content-file <resultPath> --json
```

If setup, domain discovery, or a packet command fails, run
`planr doctor --strict --json`. Re-run `planr setup` to repair only known owned
skill bytes; modified or unknown files are preserved and reported as conflicts.
Use `planr upgrade status`, then the explicit `planr upgrade apply` command when
doctor reports an incompatible installed CLI. See the
[setup and troubleshooting guide](docs/CROSS_RUNTIME_SETUP.md)
and [CLI reference](docs/CLI.md#planr-operate).

### Initialise a project

```bash
cd my-project
planr init
# Creates deterministic project-local planning storage
```

Non-interactive variants:

```bash
planr init --name "My project"          # create deterministic project storage
planr setup --dry-run                  # preview host adapter installation
```

### Pick a posture and start

**Agile:**

```bash
planr epic create
planr feature create --epic EPIC-001
planr story create --feature FEAT-001
planr task create --feature FEAT-001
# Use the planr:plan host skill when semantic decomposition is needed.
```

**Quick task:**

```bash
planr quick create "add OAuth login"
```

**Spec-driven (with the pipeline plugin):**

```bash
planr spec create "Auth flow" --slug auth
planr spec shape SPEC-001              # 4 questions, no $EDITOR
planr spec promote SPEC-001            # validate and print the host handoff
```

In Claude Code invoke `/planr:plan`; in Codex invoke `$planr:plan`. After
reviewing the plan, invoke the matching `planr:ship` skill explicitly.

### Review and privately share any HTML artifact

```bash
planr artifact ./artifact.html
# Add pins, threads, and an Approve or Request changes decision.

planr artifact share ./artifact.html --secret-output ./room.private.json --no-open # live encrypted room (default)
planr artifact share ./artifact.html --snapshot # explicit immutable snapshot
planr artifact open ./artifact.html --presentation canvas # optional spatial view
planr artifact import "<returned-review-url>"
```

Generic artifacts render edge-to-edge in the headless document presentation;
design boards retain the zoomable canvas. Authored `design-document.json` files
open the Design studio through `planr artifact open design-document.json`, with
Canvas, Prototype and Walkthrough views of the same source, responsive frames,
variant selection and persistent pinned feedback. The design skills also bundle
the same local utilities for installations without a global CLI. Browser
readiness and visual verification are reported separately; a design without
browser evidence remains unverified. Complete local HTML/CSS/JavaScript is
bundled into an opaque-origin sandbox, so private review is not standalone site
hosting.

Sharing is explicit. A new generic share creates one stable encrypted live room:
anyone with its review URL can comment. Owner decisions require a distinct
owner-verdict URL plus the matching private P-256 signer in the mode-0600
`--secret-output` file. A third management URL can pause/reopen comments or
delete the room, but cannot set a verdict. Before any room request, the CLI
prepares one room identity and durably writes its exact three URLs plus owner
signer to the private recovery file. A lost response retries that same prepared
creation once without rotating secrets or creating a second room. A definite
rejection revokes the file; an ambiguous outcome preserves it and reports a
bounded recovery error. Immutable fragments and encrypted short links remain
available with `--snapshot`; the service never receives the private signer.
See the [artifact review and privacy guide](docs/ARTIFACT_REVIEW.md).

---

## Commands

### Spec-driven mode

Third planning posture for handing reviewed features to coding hosts. Specs contain
User Stories and Tasks with explicit Create / Modify / Preserve lists, `Type: UI |
Tech`, ownership, and build/test completion criteria. Canonical schemas live in
[`packages/protocol`](https://github.com/openplanr/OpenPlanr/tree/main/packages/protocol).

| Command | Description |
|---|---|
| `planr spec init` | Activate spec-driven mode (creates `.planr/specs/`) |
| `planr spec create "Auth flow"` | Create a self-contained `SPEC-NNN-{slug}/` directory |
| `planr spec shape <id>` | Interactive 4-question authoring (Context, Functional Reqs, Business Rules, Acceptance) |
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
| `planr task create --story <ID>` | Create a task from flags or deterministic JSON for one story |
| `planr task create --feature <ID>` | Create a task from flags or deterministic JSON for one feature |
| `planr epic list` / `planr feature list` / `planr story list` / `planr task list` | List artifacts |

### Quick tasks & templates

| Command | Description |
|---|---|
| `planr quick create "description"` | Create a standalone task list |
| `planr quick create --file spec.md` | Task list from a PRD or spec file |
| `planr quick show <ID>` / `planr quick update <ID>` | Inspect or update a quick task |
| `planr template list` | List built-in and custom templates |
| `planr template use rest-endpoint --title "User API"` | Generate tasks from a template |
| `planr template save TASK-001 --name my-pattern` | Save existing tasks as template |

Built-in templates: `rest-endpoint`, `react-component`, `database-migration`, `api-integration`, `auth-flow`.

### Backlog & Sprint

| Command | Description |
|---|---|
| `planr backlog add "desc" --priority high --tag bug` | Capture a backlog item |
| `planr backlog list` / `show <id>` / `update <id>` | Inspect or update backlog items |
| `planr sprint create "Sprint 1" --duration 2w` | Create a time-boxed sprint |
| `planr sprint list` / `show <id>` / `update <id>` | Inspect or update sprints |

### Planning tools

| Command | Description |
|---|---|
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

`--scope agile` writes agile workflow rules. `--scope pipeline` writes the
project policy for the [planr-pipeline](https://github.com/openplanr/OpenPlanr/tree/main/packages/pipeline)
two-phase flow. `--scope all` produces both.

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
| `planr init` | Initialise project (creates `.planr/`, generates rules for all runtimes by default) |
| `planr config show` | Display current configuration + spec-driven readiness |
| `planr config set-agent` / `set-upgrade-policy` | Manage deterministic host and upgrade preferences |
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

The source ecosystem is consolidated under the OpenPlanr npm workspace:

| Workspace path | Role |
|---|---|
| `packages/cli` | Public `openplanr` authoring and setup package |
| `packages/pipeline` | Public feature-delivery engine and compatibility projections |
| `skills/` and `agents/` | Canonical workflow and role sources |
| `packages/protocol` | Schemas, registries, and public contracts |
| `adapters/` | Generated Claude Code, Codex, and Cursor projections |
| `.claude-plugin/` | Generated workspace marketplace metadata |

`openplanr-web` remains an independently deployed external repository. Package
publication and hosted deployment are separate from local workspace
development.

---

## Development

```bash
cd /path/to/OpenPlanr
npm ci
npm run generate
npm run build
npm run test:focused
npm run lint

# Optional: expose the local public binaries on PATH
npm link --workspace=planr-pipeline
npm link --workspace=openplanr
```

Use Node 20 or 22; no specific Node version manager is required. Run workspace
commands from the repository root so npm uses the single root lockfile. See the
root README for link detection, Codex adapter refresh, and a first-project
walkthrough.

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

### Design review handoffs

`planr artifact handoff <design-document.json>` prepares a deterministic review
handoff beside the design specification. Refine the proposed text in the active
Claude/Codex session, then review and approve it in the attached studio. This
command never invokes Plan, Ship, or publication. Approved handoffs are bound to
the exact design and feedback snapshot; subsequent changes require a new review.

Verified diagram manifests open the native Diagram studio:

```sh
planr artifact diagrams/application-flow/application-flow.manifest.json
```

The drawing uses one SVG canvas with an outline, search, pan, pointer-centered
zoom, Fit, Fit width, and presentation mode. Comments stay attached to diagram
coordinates. Export offers the verified drawing/source files and a JSON review
handoff containing timestamps, source identity, scene dimensions, and pins.
The diagram studio is local; existing hosted design boards are unchanged.
