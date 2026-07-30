# planr-pipeline

> **Complete feature delivery workflow.** PO, Design, Review, DEV, QA, and delivery outputs with a mandatory human checkpoint.

`planr-pipeline` is the portable pipeline engine for the [OpenPlanr Protocol](docs/protocol/README.md). It includes its own feature-local PO planning, design and review boards, implementation, QA, documentation, and DevOps outputs. Nine canonical roles use capability tiers rather than vendor model names; runtime adapters map those capabilities to their native tools.

OpenPlanr remains the dedicated planning/project-management CLI. The two products intentionally overlap at spec decomposition and record provenance so users can see which engine performed each operation.

---

## Why this exists

Most AI-assisted development is ad hoc: you talk to the model, it produces code, you fix it, you talk again. No structure, no consistency, no way to inspect the plan before code is written.

This plugin replaces that with a **repeatable pipeline** with a deliberate human checkpoint:

```
You write WHAT (spec) → Agents decompose HOW (US + tasks) → You review → Agents build it
```

The split is non-negotiable. **The plugin refuses to auto-chain PO Phase → DEV Phase.** That's the feature, not a limitation. The review gate is where you catch decomposition errors before they become expensive code.

---

## Runtime support

The package certifies Claude Code, Codex, and Cursor first. Install and migrate adapters through `planr`:

| Runtime | Adapter | Install |
|---|---|---|
| **Claude Code** | Native commands and tool-enforced agents | `planr setup --runtime claude` |
| **Cursor** | Portable relative project rules and nine role files | `planr setup --runtime cursor` |
| **Codex** | User-scope workflow skills and concise project policy | `planr setup --runtime codex` |

All three adapters share the same `.planr/specs/SPEC-NNN-{slug}/` artifact contract — a SPEC authored on one runtime is consumable by any other. See [`docs/compatibility-matrix.md`](docs/compatibility-matrix.md) for the full parity table and per-runtime caveats; see [`docs/protocol/`](docs/protocol/) for the runtime-agnostic protocol spec.

## Ecosystem operations

OpenPlanr is a four-repo ecosystem. For the operating model, see:

- [`docs/ecosystem-guide.md`](docs/ecosystem-guide.md) — which surface plans, ships, routes, and installs.
- [`docs/ownership-map.md`](docs/ownership-map.md) — which repo owns each contract.
- [`docs/doctor.md`](docs/doctor.md) — `npm run doctor`, strict mode, JSON output, and release checks.
- [`docs/release-checklist.md`](docs/release-checklist.md) — release order, required commands, and rollback notes.

## Install

```bash
curl -fsSL https://openplanr.dev/install.sh | sh
# Windows: irm https://openplanr.dev/install.ps1 | iex

cd my-project
planr setup
planr doctor
planr pipeline plan todo
```

The installer installs the CLI only. Guided setup detects coding agents and
prompts for workflow mode and scope; user scope is the safe default and Cursor
requires a project. Use `npx openplanr@latest setup` without a global install
or `planr setup --minimal` for planning only.

## Operating Board

`planr operate` is OpenPlanr’s evidence-to-decision control plane. This package
owns its Protocol v1.2 contracts, conformance, generated adapters, dashboard
projection, artifact generator, provider kit, and ecosystem saga primitives;
the OpenPlanr CLI owns operating state and every mutation.

```bash
planr operate inspect
planr operate demo
planr operate init
planr operate run --preview # no provider/model calls and no writes
planr operate run --dry-run # disclosed provider/model calls; no state commit
planr operate review
planr operate report --lens CTO
```

Initialization and recovery are guided by CLI-owned, schema-valid questions and
actions. Certified runtimes present those artifacts using native questions,
structured chat, an attached terminal, or an exact handoff; adapters do not
invent defaults or implicit consent. Schema 1.1 questionnaires carry their exact
bounded-stdin envelope contract, so a runtime never guesses resume metadata. See
[`docs/guided-operating-board.md`](docs/guided-operating-board.md).

An explicit cycle request continues the reversible local native lifecycle
through independent CEO/CTO/CPO/CMO/COO advisors, Chair consolidation, and
Markdown or JSON reporting without manual adapter commands. Claude Code uses
isolated dispatch, Codex uses immutable-pack bounded dispatch, and Cursor uses
the structured-provider path. The dashboard is optional, and reports include
exact governed paths into specs, tasks, and quick tasks.

Finding acceptance never applies a route. Pipeline-PO DEV application pauses at
`awaiting-plan`, returns an exact native PLAN command, validates planning
provenance on resume, and leaves `shipInvoked: false`. Answered evidence gaps
close only after `gaps verify` cites explicit evidence IDs. A later
`run --review-only` can observe existing shipment proof and reconcile outcome
observations, but Operating Board never invokes SHIP.

Planning-only installs retain help, `operate inspect`, and `operate demo`.
Protocol-dependent commands return `E_PIPELINE_NOT_INSTALLED` with the
full-install recovery. See
[`docs/protocol/operating-board.md`](docs/protocol/operating-board.md).

---

## 5-minute walkthrough — build a "todo list" feature

```bash
# 1. Run the PO Phase — auto-scaffolds the spec shell on first run
/planr-pipeline:plan todo
#    → .planr/specs/SPEC-001-todo/ created with placeholder body
#    → pipeline stops with "edit and re-run" message

# 2. Edit .planr/specs/SPEC-001-todo/SPEC-001-todo.md to fill in
#    Context, Functional Requirements, Business Rules, Acceptance Criteria
#    (Or use planr CLI: `planr spec shape SPEC-001` for guided 4-question authoring.)

# 3. (Optional) Drop UI mockups for the designer-agent
cp ~/Designs/todo-*.png .planr/specs/SPEC-001-todo/design/

# 4. Re-run the PO Phase — decomposes into User Stories + tasks
/planr-pipeline:plan todo
#    → designer-agent + specification-agent decompose
#    → .planr/specs/SPEC-001-todo/{stories,tasks}/ populated

# 5. Review the decomposition before any code is written
#    → open .planr/specs/SPEC-001-todo/tasks/T-*.md and verify

# 6. Run the DEV Phase — generates code, tests, infra config, docs
/planr-pipeline:ship todo
#    → src/ updated
#    → docker-compose.yml + CI workflow generated
#    → Docs/feat-todo/ generated
#    → CLAUDE.md refreshed
#    → .planr/specs/SPEC-001-todo/.pipeline-shipped marker written
```

Total time: ~15 minutes of your input + ~10 minutes of agent work. You review, you ship.

---

## The two phases

```
┌─────────────────────────────────────────────────────────────────────┐
│  PO PHASE  (analysis-high capability roles)                        │
│  /planr-pipeline:plan {name}                                │
│                                                                     │
│  db-agent (if DB) → designer-agent (if PNG) → specification-agent   │
│  → output/feats/feat-{name}/ (US + tasks + design-spec)             │
└────────────────────────────┬────────────────────────────────────────┘
                             ▼
                   🛑 HUMAN REVIEW (mandatory)
                   open the generated US/task files, edit if needed
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│  DEV PHASE  (implementation-high + read-only-qa capabilities)      │
│  /planr-pipeline:ship {name}                                    │
│                                                                     │
│  frontend-agent + backend-agent (per task, parallel) →              │
│  qa-agent (gate) → devops-agent + doc-gen-agent →                   │
│  CLAUDE.md snapshot → .pipeline-shipped marker                      │
└─────────────────────────────────────────────────────────────────────┘
```

**PO Phase** is decomposition: read the spec, read PNGs, read the DB schema, produce a tree of User Stories and tasks that name *exact files* to create/modify/preserve. No code is written.

**DEV Phase** is code generation: each task is handed to its specialized subagent, the agent writes code, runs build/test, fixes failures up to 3 times, and writes an `error-report.md` if it fails after 3 iterations.

---

## Slash commands

| Name | Purpose |
|---|---|
| `/planr-pipeline:design {slug}` | **Optional, before `/plan`.** Generates a visual design — **prototype** (one screen), **walkthrough** (multi-screen gallery), or **canvas** (Figma-like board) — *and* a `design-spec.md`, so the PO Phase decomposes real UI tasks. Interactive by default; fully flag-driven for CI (`--format … --from … --yes`). |
| `/planr-pipeline:design-loop {target}` | Interactive design exploration for ANY target (logo, brand-sheet, screen, og-image): concept gate **before any spend** → N parallel AI variants → a live localhost **board** (pin-comments on exact regions, ratings, remix, versions rail) → file-handshake feedback → session-chained iteration → approval + **taste memory**. Works with an OpenAI key (image generation) or **without one** (claude-svg: agent-authored SVG — exact hex, real type). See `docs/design-loop.md`. |
| `/planr-pipeline:design-review {slug}` | Pin-comment review loop on an existing generated design: serves `finalized.html`/`canvas.html` on the live board, every pin maps to its screen, only the pinned screen is regenerated (lint gate stays 0-error), and the results sync back into `design-spec.md` + `finalized.json` + the run manifest. |
| `/planr-pipeline:plan {slug}` | PO Phase — auto-scaffolds the spec shell if missing, then decomposes into User Stories + tasks via designer-agent + specification-agent |
| `/planr-pipeline:ship {slug}` | DEV Phase — **feature-flat wide dispatch** (every ready task across all stories at once, not one US at a time) → qa (incl. a **design-fidelity gate**) → devops ‖ doc-gen → snapshot, with `.pipeline-shipped` marker. On Claude Code multi-task the cost gate also offers a **dispatch style**: `native` (free fan-out) or `workflow` (host-scheduled `dependsOn` DAG, deterministic) — `--native`/`--workflow` to preselect. |
| `/planr-pipeline:sync` | Reconcile **spec ↔ quick-task ↔ issue-tracker** alignment across `.planr/`. Guarantees every non-meta spec carries its externalization **Quick Task** (the unit pushed to Linear/GitHub for PO + manager visibility), flips evidenced-stale statuses, and surfaces judgment calls. **Read-only by default**; `--apply` writes the SAFE-class fixes locally, `--push` pushes changed QTs to the tracker + commits. Idempotent. |

Two core phases (`plan` → `ship`) with a mandatory human review between them, plus an optional `design` step before `plan`. Everything else is automatic — auto-scaffolding when a spec is missing, auto-snapshot at the end of `/ship`, auto-self-heal of `input/tech/stack.md` in spec-driven mode. The pipeline never auto-chains across phases (`docs/rules.md` R1).

**DEV dispatch (`/ship`).** In `multi-task` mode (Claude Code default) the orchestrator builds one **feature-flat** queue across every story and dispatches **every** ready task (no unmet `dependsOn`) in a single turn — the host's native concurrency cap is the only throttle, not a per-US walk. The Frontend‖Backend pair within one story is the *smallest* case, never the ceiling. Single-session runtimes (Cursor/Codex) run one task per invocation. The **design-fidelity gate** in qa verifies each shipped UI against its `design-spec.md` — structural validation of the spec (R10), a compiled-CSS lint (off-grid spacing, sub-AA contrast), and an off-palette colour check.

---

## Agents

| Agent | Capability | Phase | Role | Tool restrictions |
|---|---|---|---|---|
| **db-agent** | analysis-high | 0.1 | Schema introspection | Database and source read-only |
| **designer-agent** | analysis-high | 1 | UI inputs → design spec | Design artifact writes only |
| **specification-agent** | analysis-high | 1 | Spec → stories + tasks | Planning artifacts only |
| **entity-scaffold-agent** | analysis-high | 0.2 (manual) | Persistence skeleton | Declared scaffold paths only |
| **frontend-agent** | implementation-high | 3 | UI implementation | Task UI Create/Modify paths only |
| **backend-agent** | implementation-high | 3 | Service implementation | Task tech Create/Modify paths only |
| **qa-agent** | read-only-qa | 3.5 | DoD, build, and test gate | Source read-only; QA report only |
| **devops-agent** | analysis-high | 3.5 | Docker, CI, env templates | Declared config only; never deploys |
| **doc-gen-agent** | analysis-high | 3.5 | Feature documentation | Documentation output only |

`registry/roles.json` is authoritative and generates adapter assets and documentation.

---

## Configuration

### `input/tech/stack.md` (you author this once per project)

Single source of truth: project identity, database type, language, framework, ORM, build/test commands, naming conventions. Every agent reads this.

```yaml
AppName: my-app
DatabaseType: PostgreSQL
Language: TypeScript
Framework: NestJS
ORM: Prisma
BuildCommand: npm run build
TestCommand: npm test -- --run
ActiveStackFiles:
  - .claude/stacks/backend/nestjs.md   # user override (optional)
  - .claude/stacks/database/prisma.md
```

### Stack files (defaults + user overrides)

The plugin ships defaults at `${CLAUDE_PLUGIN_ROOT}/stacks/{frontend,backend,database,devops}/*.md`. You can override or extend by adding files to your project at `.claude/stacks/...` — **user files always win on filename collision**. Copy a default stack file as a starting template and edit to taste.

### Default stacks shipped

- `frontend/nextjs.md`
- `backend/nestjs.md`
- `database/prisma.md`, `database/mongodb.md`
- `devops/docker-compose.md`

---

## The rules (`docs/rules.md`)

The plugin enforces 9 hard rules. Three are critical:

- **R1** — Never auto-chain PO Phase → DEV Phase. Two separate triggers, mandatory human review between. *Enforced by command structure.*
- **R3** — Portable roles request capability tiers; each runtime adapter owns its model mapping.
- **R8** — DB Agent is READ-ONLY. *Enforced by `tools` frontmatter — only read-only DB clients in Bash, no Edit, single Write target.*

R6 — Max 3 correction iterations per task — applies to DEV agents. After 3, the agent stops and writes `error-report.md` per `templates/error-report.md`.

Read the full rule set in [`docs/rules.md`](docs/rules.md).

---

## Relationship to planr

[planr](https://github.com/openplanr/OpenPlanr) is the dedicated planning and project-management CLI. `planr-pipeline` is the complete feature-delivery workflow and includes its own PO planning. Their decomposition overlap is intentional.

### Bridge to planr spec-driven mode

When a project uses planr's **spec-driven mode** (the third planning posture, see `planr spec init`), this plugin reads `.planr/specs/SPEC-NNN-{slug}/` directly — no conversion adapter, no copy step. Both products share the same artifact schema:

- OpenPlanr can author and decompose specs for ongoing project planning.
- The pipeline PO phase can independently author feature-local decomposition directly connected to Design, DEV, and QA.
- Both append `.planr/provenance.jsonl`; do not run both decomposers on one populated spec without explicit reconciliation.

The pipeline auto-detects spec mode by looking for `.planr/config.json` with `idPrefix.spec` set. If absent, it falls back to the default `output/feats/feat-{name}/` layout — existing pipeline-only workflows are unchanged.

See [planr's spec-driven proposal](https://github.com/openplanr/OpenPlanr/blob/main/docs/proposals/spec-driven-mode.md) for the design.

---

## Versioning

Pre-1.0 semver. Expect minor breaks across `0.1.x → 0.2.x`. Patch bumps (`0.1.0 → 0.1.1`) are doc/prompt clarifications only.

Vendor model strings are confined to the native adapter and are not part of the protocol. Portable registries use `analysis-high`, `implementation-high`, and `read-only-qa` capabilities.

---

## Contributing

- **Add a stack file:** drop a markdown file in `stacks/{category}/{name}.md` following the shape in existing files. Open a PR.
- **Propose a new agent:** open an issue describing the role, model, and tool restrictions. Agents that would shrink scope (e.g., split backend-agent into api-agent + db-agent) need a strong case.
- **Bug reports:** include the full failing command, the contents of any relevant **per-task** `tasks/T-<NNN>-error-report.md` (or legacy `error-report.md` if you are on an older plugin revision), and your `input/tech/stack.md`.

---

## Caveats

- **macOS / Linux / WSL only** for v0.1. The Stop hook uses POSIX shell. Windows-native support lands in v0.2.
- **No deploy automation, ever** — by design. The DevOps agent generates docker-compose / CI config, but the plugin will not run `docker compose up` or any cloud API. You ship.
- **Subagents have isolated context.** They can't see your conversation. They read files. Pass information by writing to disk, not by chat.

---

## License

MIT. See [LICENSE](LICENSE).

## Credits

Built on the Claude Code plugin system (Anthropic). The two-phase pipeline architecture and rule set were prototyped in [`po-dev-framework`](https://github.com/asemabdou/po-dev-framework) before the plugin migration.
