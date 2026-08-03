# OpenPlanr Protocol — Agent Roles (v1.0.0)

> The 9 named roles defined as input/output contracts, runtime-agnostic. Claude
> Code uses manifest-enforced agents, Cursor uses host dispatch with sequential
> fallback, and Codex uses native subagents when exposed plus sequential fallback.

## Role index

| Role | Phase | Tier | Reads | Writes |
|---|---|---|---|---|
| `db-agent` | PO Phase 0.1 | analysis | `input/tech/stack.md`, DB env vars | `output/db/schema.json` |
| `entity-scaffold-agent` | Prep 0.2 (manual) | analysis | `output/db/schema.json`, stack.md | ORM scaffold under `output/src/` only |
| `designer-agent` | PO Phase 1 | analysis | PNGs (per resolution priority), `input/tech/stack.md`, spec | `<feat>/design-spec.md` or `<SPEC_DIR>/design/design-spec.md` |
| `specification-agent` | PO Phase 2 | analysis | spec body, stack.md, optional design-spec, optional schema.json | US + Task files |
| `frontend-agent` | DEV Phase | codegen | task file, stack.md, design-spec | UI files in `src/features/{name}/` |
| `backend-agent` | DEV Phase | codegen | task file, stack.md, schema.json | services, DTOs, controllers (Step 3 Tech tasks — not 0.2 scaffold) |
| `qa-agent` | DEV Phase 3.5 | analysis | all task files, generated source, stack.md | `qa-report.md` only |
| `devops-agent` | DEV Phase 3.5 | analysis | stack.md, generated source | `docker-compose.yml`, `.env.example`, Dockerfiles, CI workflow stubs |
| `doc-gen-agent` | DEV Phase 3.5 | analysis | US, tasks, generated source | `Docs/feat-{name}/` |

## Tier semantics

- **`analysis-high`** roles process structured inputs and produce structured outputs.
- **`implementation-high`** roles write production code that must build and pass tests.
- **`read-only-qa`** roles verify outputs without modifying source.

Each runtime adapter maps these tiers to its model picker. The contract is "use the runtime's strongest available model for codegen, its fast tier for analysis."

## Tool guardrails (canonical — runtime adapters enforce as they can)

### `db-agent` — read-only DB introspection

- **Allowed:** Read, Grep, Glob, DB clients (`psql`, `mysql`, `sqlite3`, `mongosh`, `mongo`), single Write to `output/db/schema.json`
- **Forbidden:** any DDL/DML, any non-DB shell, Edit anywhere, Write outside `output/db/`

### `designer-agent` — vision-based design extraction

- **Allowed:** Read, Glob, Write to `design-spec.md`
- **Forbidden:** shell access, code generation, modifying input files

### `specification-agent` — spec → US + Task decomposition

- **Allowed:** Read, Glob, Grep, Write to US/Task files
- **Forbidden:** shell, code generation, modifying spec body

### `entity-scaffold-agent` — Step 0.2 ORM scaffold (manual)

- **Allowed:** Read, Glob, Grep, Edit, Write, Bash limited to npm/npx/node (no arbitrary shell)
- **Forbidden:** feature task driven output under `src/features/`, frontend/UI files, HTTP controllers/services (use `backend-agent` at ship time)

### `frontend-agent` — UI codegen

- **Allowed:** Read, Edit, Write, Bash for npm/pnpm/yarn/npx
- **Forbidden:** Writing to services, DTOs, entities, controllers (any "Tech" file)

### `backend-agent` — backend codegen

- **Allowed:** Read, Edit, Write, Bash for npm/pnpm/yarn/npx + ORM tools (`prisma`, `node`)
- **Forbidden:** Writing to UI files (components, pages, *.tsx components, *.css UI)

### `qa-agent` — verification gate

- **Allowed:** Read, Glob, Grep, Bash for build/test commands, `git diff` (read-only)
- **Forbidden:** Edit, Write (except `qa-report.md`)

### `devops-agent` — infra config generation

- **Allowed:** Read, Glob, Write, Edit
- **Forbidden:** **Bash entirely.** Generates files only — never deploys, never calls cloud APIs.

### `doc-gen-agent` — documentation generation

- **Allowed:** Read, Glob, Grep, Write to `Docs/feat-{name}/`
- **Forbidden:** Edit existing files, shell access

## Per-runtime enforcement

| Runtime | Enforcement layer | Notes |
|---|---|---|
| **Claude Code (canonical)** | Plugin manifest (`tools:` YAML frontmatter on each agent file) | Hard enforcement — agent literally cannot invoke disallowed tools |
| **Cursor** | Prompt-level only (master rule + role body documentation) | Advisory — model is asked to honour; conformance harness's git-diff check on Preserve list catches violations |
| **Codex** | Capability-dependent; skills are durable, tool isolation may be advisory | Preserve verification + conformance |

Manifest-level enforcement remains a Claude Code differentiator. Other adapters
report their actual capability and use conformance rather than claiming identical security.

## See also

- `commands.md` — PLAN and SHIP orchestrate these roles
- `runtime-adapters.md` — how each runtime dispatches and enforces
- `../agent-model-map.md` — model assignment rationale
- `../rules.md` — full rule set (R1 through R9)

---

*OpenPlanr Protocol v1.0.0 — agent role contracts.*
