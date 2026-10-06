# OpenPlanr Protocol — Agent Roles (v1.0.0)

> The 9 named roles defined as input/output contracts, runtime-agnostic. Claude
> Code uses native subagents, Cursor uses host dispatch with sequential
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
| `qa-agent` | SHIP review | read-only QA | frozen candidate, scoped task contracts, gate evidence | structured review result only |
| `devops-agent` | DEV Phase 3.5 | analysis | stack.md, generated source | `docker-compose.yml`, `.env.example`, Dockerfiles, CI workflow stubs |
| `doc-gen-agent` | DEV Phase 3.5 | analysis | US, tasks, generated source | `Docs/feat-{name}/` |

## Tier semantics

- **`analysis-high`** roles process structured inputs and produce structured outputs.
- **`implementation-high`** roles write production code that must build and pass tests.
- **`read-only-qa`** roles verify outputs without modifying source.

Each runtime adapter maps these tiers to its model picker. The contract is "use the runtime's strongest available model for codegen, its fast tier for analysis."

## Tool boundaries

Role ownership (R9) is an instruction every host follows; only a few boundaries are
also expressed through the host's own tool model, and each is stated where it holds:

- `devops-agent` declares a `tools` allowlist without Bash, so the Claude Code
  subagent has no shell and cannot run a deploy, image push, or cloud CLI.
- `qa-agent` declares `disallowedTools: Edit, Write, NotebookEdit`, so the Claude
  Code subagent cannot edit files; the shell commands it runs follow the session's
  permission rules.
- Every other role inherits the session's tools. Command-specific entries such as
  `Bash(npm:*)` in a subagent `tools` list grant the whole Bash tool, not a command
  subset, so no role claims one.

No role pre-approves tools (`allowed-tools`); the host's permission prompts govern
every write and command.

## Per-runtime enforcement

| Runtime | Enforcement layer | Notes |
|---|---|---|
| **Claude Code (canonical)** | Agent frontmatter `tools` / `disallowedTools` for the two boundaries above; session permissions for everything else | Removes whole tools from a subagent; never scopes a tool to specific commands |
| **Cursor** | Prompt-level only (master rule + role body documentation) | Advisory — model is asked to honour; conformance harness's git-diff check on Preserve list catches violations |
| **Codex** | Capability-dependent; skills are durable, tool isolation may be advisory | Preserve verification + conformance |

## See also

- `commands.md` — PLAN and SHIP orchestrate these roles
- `runtime-adapters.md` — how each runtime dispatches and enforces
- `../agent-model-map.md` — model assignment rationale
- `../rules.md` — full rule set (R1 through R9)

---

*OpenPlanr Protocol v1.0.0 — agent role contracts.*
