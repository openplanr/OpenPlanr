# planr-pipeline

> **Spec-driven AI factory.** Two-phase pipeline. Human checkpoint between phases. Plugin for Claude Code.

The **canonical Claude Code adapter** for the [OpenPlanr Protocol v1.0.0](docs/protocol/README.md) — a runtime-agnostic spec-driven workflow that turns functional specs into production code. Nine specialized subagents (Sonnet 4.6 for analysis, Opus 4.8 for code generation), stack-aware decomposition, and hard rules enforced at the *tool* layer — not just in prompts.

The same protocol runs on Cursor and Codex via planr-generated rule files (see [Runtime support](#runtime-support) below). Same artifacts. Same workflow. Same `.pipeline-shipped` proof markers.

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

`planr-pipeline` is the **canonical Claude Code adapter** for the OpenPlanr Protocol v1.0.0. The same protocol runs on Cursor and Codex via planr-generated rule files:

| Runtime | Adapter | Install |
|---|---|---|
| **Claude Code** *(canonical)* | This plugin (manifest-enforced subagents) | `/plugin marketplace add openplanr/marketplace && /plugin install planr-pipeline@openplanr` |
| **Cursor** | `.cursor/rules/planr-pipeline.mdc` + agent body files | `npm i -g openplanr && planr rules generate --target cursor --scope pipeline` |
| **Codex** | `AGENTS.md` with pipeline section | `npm i -g openplanr && planr rules generate --target codex --scope pipeline` |

All three adapters share the same `.planr/specs/SPEC-NNN-{slug}/` artifact contract — a SPEC authored on one runtime is consumable by any other. See [`docs/compatibility-matrix.md`](docs/compatibility-matrix.md) for the full parity table and per-runtime caveats; see [`docs/protocol/`](docs/protocol/) for the runtime-agnostic protocol spec.

## Ecosystem operations

OpenPlanr is a four-repo ecosystem. For the operating model, see:

- [`docs/ecosystem-guide.md`](docs/ecosystem-guide.md) — which surface plans, ships, routes, and installs.
- [`docs/ownership-map.md`](docs/ownership-map.md) — which repo owns each contract.
- [`docs/doctor.md`](docs/doctor.md) — `npm run doctor`, strict mode, JSON output, and release checks.
- [`docs/release-checklist.md`](docs/release-checklist.md) — release order, required commands, and rollback notes.

## Install

```
/plugin marketplace add openplanr/marketplace
/plugin install planr-pipeline@openplanr
```

Two commands and you have an opinionated, multi-agent code factory in any Claude Code project.

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
│  PO PHASE  (Sonnet 4.6 agents — fast, structured)                   │
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
│  DEV PHASE  (Opus 4.8 codegen + Sonnet 4.6 verifiers)               │
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

| Agent | Model | Phase | Role | Tool restrictions |
|---|---|---|---|---|
| **db-agent** | Sonnet 4.6 | 0.1 | Schema introspection (SQL + Mongo) | READ-ONLY: `Bash(psql:*)`, `Bash(mongosh:*)`, etc. No `Edit`. |
| **designer-agent** | Sonnet 4.6 | 1 | PNG → design-spec.md | `Read`, `Glob`, `Write` only |
| **specification-agent** | Sonnet 4.6 | 1 | Spec → US + tasks | `Read`, `Glob`, `Grep`, `Write` |
| **frontend-agent** | Opus 4.8 | 3 | UI codegen (task-1 UI) | `Read`, `Edit`, `Write`, `Bash(npm:*)` etc. |
| **entity-scaffold-agent** | Sonnet 4.6 | 0.2 (manual) | Schema → `output/src/` ORM skeleton | `Read`, `Glob`, `Grep`, `Edit`, `Write`, `Bash(npm:*)`, `Bash(npx:*)`, `Bash(node:*)` |
| **backend-agent** | Opus 4.8 | 3 | Backend codegen (task-2 Tech) | Same plus `Bash(prisma:*)`, `Bash(node:*)` |
| **qa-agent** | Sonnet 4.6 | 3.5 | DoD gate, runs build/test | Read-only on src; `Write` only for qa-report.md |
| **devops-agent** | Sonnet 4.6 | 3.5 | Docker, CI, env templates | `Read`, `Glob`, `Write`, `Edit`. **No Bash** — non-deploy enforced at tool layer. |
| **doc-gen-agent** | Sonnet 4.6 | 3.5 | `Docs/feat-{name}/` from US + code | `Read`, `Glob`, `Grep`, `Write` |

See `docs/agent-model-map.md` for the rationale per agent.

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
- **R3** — Model assignments are fixed (Sonnet for analysis, Opus for codegen). *Enforced by `model:` frontmatter.*
- **R8** — DB Agent is READ-ONLY. *Enforced by `tools` frontmatter — only read-only DB clients in Bash, no Edit, single Write target.*

R6 — Max 3 correction iterations per task — applies to DEV agents. After 3, the agent stops and writes `error-report.md` per `templates/error-report.md`.

Read the full rule set in [`docs/rules.md`](docs/rules.md).

---

## Relationship to planr

[planr](https://github.com/openplanr/OpenPlanr) is OpenPlanr's agile + spec-driven planning CLI. It owns the **planning** verb.

`planr-pipeline` owns the **execution** verb. The two are complementary: planr plans, pipeline ships.

### Bridge to planr spec-driven mode

When a project uses planr's **spec-driven mode** (the third planning posture, see `planr spec init`), this plugin reads `.planr/specs/SPEC-NNN-{slug}/` directly — no conversion adapter, no copy step. Both products share the same artifact schema:

- planr authors specs and runs `planr spec decompose` to generate User Stories + Tasks
- The pipeline plugin (`/planr-pipeline:plan {slug}` and `/planr-pipeline:ship {slug}`) reads from the planr spec directory and executes
- planr is the **authoring surface**; planr-pipeline is the **executor**

The pipeline auto-detects spec mode by looking for `.planr/config.json` with `idPrefix.spec` set. If absent, it falls back to the default `output/feats/feat-{name}/` layout — existing pipeline-only workflows are unchanged.

See [planr's spec-driven proposal](https://github.com/openplanr/OpenPlanr/blob/main/docs/proposals/spec-driven-mode.md) for the design.

---

## Versioning

Pre-1.0 semver. Expect minor breaks across `0.1.x → 0.2.x`. Patch bumps (`0.1.0 → 0.1.1`) are doc/prompt clarifications only.

Pinned model strings (`claude-sonnet-4-6`, `claude-opus-4-8`) are operational guidance, not part of the protocol schema. Claude Code uses the default context window for these assignments; do not add context-window suffixes unless the CLI contract changes. Check [`docs/agent-model-map.md`](docs/agent-model-map.md) and the changelog when upgrading.

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
