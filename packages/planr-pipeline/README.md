# openplanr-pipeline

> **Spec-driven AI factory.** Two-phase pipeline. Human checkpoint between phases. Plugin for Claude Code.

A Claude Code plugin that turns functional specs into production code via a structured pipeline. Eight specialized subagents (Sonnet 4.6 for analysis, Opus 4.7 for code generation), stack-aware decomposition, and hard rules enforced at the *tool* layer — not just in prompts.

---

## Why this exists

Most AI-assisted development is ad hoc: you talk to the model, it produces code, you fix it, you talk again. No structure, no consistency, no way to inspect the plan before code is written.

This plugin replaces that with a **repeatable pipeline** with a deliberate human checkpoint:

```
You write WHAT (spec) → Agents decompose HOW (US + tasks) → You review → Agents build it
```

The split is non-negotiable. **The plugin refuses to auto-chain PO Phase → DEV Phase.** That's the feature, not a limitation. The review gate is where you catch decomposition errors before they become expensive code.

---

## Install

```
/plugin marketplace add OpenPlanr/marketplace
/plugin install openplanr-pipeline@openplanr
/openplanr-pipeline:init
```

That's it. Three commands and you have an opinionated, multi-agent code factory in any Claude Code project.

---

## 5-minute walkthrough — build a "todo list" feature

```bash
# 1. Initialize the framework in your project
/openplanr-pipeline:init my-app

# 2. Edit input/tech/stack.md to match your real stack
#    (Language, Framework, ORM, BuildCommand, TestCommand)

# 3. Author your first spec interactively
/openplanr-pipeline:spec todo
#    → 4 guided questions → input/specs/spec-todo.md

# 4. (Optional) Drop UI mockups for the Designer Agent
cp ~/Designs/todo-*.png input/ui/feat-todo/

# 5. Run the PO Phase — decomposes into User Stories + tasks
/openplanr-pipeline:plan todo
#    → output/feats/feat-todo/ with us-1/, us-2/, ... and tasks per US

# 6. Review the decomposition before any code is written
/openplanr-pipeline:review todo
#    → walk a structured checklist; edit US/task files if needed

# 7. Run the DEV Phase — generates code, tests, infra config, docs
/openplanr-pipeline:ship todo
#    → src/features/todo/ with components, services, tests
#    → docker-compose.yml updated
#    → Docs/feat-todo/ generated
#    → CLAUDE.md refreshed
```

Total time: ~15 minutes of your input + ~10 minutes of agent work. You review, you ship.

---

## The two phases

```
┌─────────────────────────────────────────────────────────────────────┐
│  PO PHASE  (Sonnet 4.6 agents — fast, structured)                   │
│  /openplanr-pipeline:plan {name}                                │
│                                                                     │
│  db-agent (if DB) → designer-agent (if PNG) → specification-agent   │
│  → output/feats/feat-{name}/ (US + tasks + design-spec)             │
└────────────────────────────┬────────────────────────────────────────┘
                             ▼
                   🛑 HUMAN REVIEW (mandatory)
                   /openplanr-pipeline:review {name}
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│  DEV PHASE  (Opus 4.7 codegen + Sonnet 4.6 verifiers)               │
│  /openplanr-pipeline:ship {name}                               │
│                                                                     │
│  frontend-agent + backend-agent (per task, parallel) →              │
│  qa-agent (gate) → devops-agent + doc-gen-agent →                   │
│  /openplanr-pipeline:snapshot                                       │
└─────────────────────────────────────────────────────────────────────┘
```

**PO Phase** is decomposition: read the spec, read PNGs, read the DB schema, produce a tree of User Stories and tasks that name *exact files* to create/modify/preserve. No code is written.

**DEV Phase** is code generation: each task is handed to its specialized subagent, the agent writes code, runs build/test, fixes failures up to 3 times, and writes an `error-report.md` if it fails after 3 iterations.

---

## Slash commands & skills

| Type | Name | Purpose |
|---|---|---|
| Command | `/openplanr-pipeline:plan` | Run PO Phase orchestration for a feature |
| Command | `/openplanr-pipeline:ship` | Run DEV Phase orchestration for a feature |
| Skill | `/openplanr-pipeline:init` | Bootstrap a fresh project (idempotent) |
| Skill | `/openplanr-pipeline:spec` | 4-question guided spec authoring |
| Skill | `/openplanr-pipeline:stack` | Add a new stack file to `.claude/stacks/` |
| Skill | `/openplanr-pipeline:review` | Pre-DEV checklist walkthrough |
| Skill | `/openplanr-pipeline:snapshot` | Refresh `CLAUDE.md` with project state |

---

## Agents

| Agent | Model | Phase | Role | Tool restrictions |
|---|---|---|---|---|
| **db-agent** | Sonnet 4.6 | 0.1 | Schema introspection (SQL + Mongo) | READ-ONLY: `Bash(psql:*)`, `Bash(mongosh:*)`, etc. No `Edit`. |
| **designer-agent** | Sonnet 4.6 | 1 | PNG → design-spec.md | `Read`, `Glob`, `Write` only |
| **specification-agent** | Sonnet 4.6 | 1 | Spec → US + tasks | `Read`, `Glob`, `Grep`, `Write` |
| **frontend-agent** | Opus 4.7 | 3 | UI codegen (task-1 UI) | `Read`, `Edit`, `Write`, `Bash(npm:*)` etc. |
| **backend-agent** | Opus 4.7 | 0.2 + 3 | Backend codegen (task-2 Tech) | Same plus `Bash(prisma:*)`, `Bash(node:*)` |
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

The plugin ships defaults at `${CLAUDE_PLUGIN_ROOT}/stacks/{frontend,backend,database,devops}/*.md`. You can override or extend by adding files to your project at `.claude/stacks/...` — **user files always win on filename collision**. Use `/openplanr-pipeline:stack` to scaffold a new stack file interactively.

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

`openplanr-pipeline` owns the **execution** verb. The two are complementary: planr plans, pipeline ships.

### Bridge to planr spec-driven mode (v0.3.0+)

When a project uses planr's **spec-driven mode** (the third planning posture, see `planr spec init`), this plugin reads `.planr/specs/SPEC-NNN-{slug}/` directly — no conversion adapter, no copy step. Both products share the same artifact schema:

- planr authors specs and runs `planr spec decompose` to generate User Stories + Tasks
- The pipeline plugin (`/openplanr-pipeline:plan {slug}` and `/openplanr-pipeline:ship {slug}`) reads from the planr spec directory and executes
- planr is the **authoring surface**; openplanr-pipeline is the **executor**

The pipeline auto-detects spec mode by looking for `.planr/config.json` with `idPrefix.spec` set. If absent, it falls back to the default `output/feats/feat-{name}/` layout — existing pipeline-only workflows are unchanged.

See [planr's spec-driven proposal](https://github.com/openplanr/OpenPlanr/blob/main/docs/proposals/spec-driven-mode.md) for the design.

---

## Versioning

Pre-1.0 semver. Expect minor breaks across `0.1.x → 0.2.x`. Patch bumps (`0.1.0 → 0.1.1`) are doc/prompt clarifications only.

Pinned model strings (`claude-sonnet-4-6`, `claude-opus-4-7`) are correct as of April 2026. They will drift; check the CHANGELOG when upgrading.

---

## Contributing

- **Add a stack file:** drop a markdown file in `stacks/{category}/{name}.md` following the shape in existing files. Open a PR.
- **Propose a new agent:** open an issue describing the role, model, and tool restrictions. Agents that would shrink scope (e.g., split backend-agent into api-agent + db-agent) need a strong case.
- **Bug reports:** include the full failing command, the contents of the relevant `output/feats/feat-{name}/us-{N}/tasks/error-report.md`, and your `input/tech/stack.md`.

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
