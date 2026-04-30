# Changelog

All notable changes to this plugin are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/) — with the caveat that pre-1.0 releases may contain breaking changes in minor bumps.

> **Note:** Plugin renamed from `openplanr-pipeline` to `planr-pipeline` in v0.7.0 (brand convergence on the `planr` CLI binary). Entries from v0.6.0 and earlier reference the old name verbatim.

## [0.7.0] — 2026-04-30

### Changed — Plugin renamed to `planr-pipeline`

Plugin name: `openplanr-pipeline` → `planr-pipeline`. Slash commands: `/openplanr-pipeline:plan` → `/planr-pipeline:plan` (same for `:ship`). GitHub repo: `openplanr/openplanr-pipeline` → `openplanr/planr-pipeline` (auto-redirected by GitHub).

### Why

Brand convergence on `planr` (the CLI binary). The `openplanr-` prefix was a vestige of an earlier naming era and created cognitive friction for users typing slash commands daily — your CLI is `planr`, your slash commands now match.

### Migration

Install via:

```
/plugin install planr-pipeline@openplanr
```

The old install command (`/plugin install openplanr-pipeline@openplanr`) continues to resolve via the v0.6.1 deprecation stub which prints a one-line redirect message to the new plugin.

The plugin's behaviour is **byte-for-byte identical** to v0.6.0. Only the name changed.

### Pairs with

- `openplanr` (planr CLI) v1.5.1 — generated rule filenames + slash command references updated
- `openplanr-skills` v1.4.0 — SKILL.md routing tree aligned with the new plugin name
- `marketplace` — pin updated to v0.7.0

## [0.6.0] — 2026-04-29

### Added — OpenPlanr Protocol v1.0.0 + cross-runtime parity

The pipeline plugin is now formally **one of three runtime adapters** to the OpenPlanr Protocol. The protocol is the contract; runtimes are adapters.

**New protocol docs at `docs/protocol/`:**

- `README.md` — protocol overview, version, and the runtime-as-adapter principle
- `spec-artifacts.md` — canonical schema for SPEC, US, Task, design-spec, error-report, qa-report, `.pipeline-shipped` marker
- `agent-roles.md` — 8 named role contracts (inputs, outputs, tool guardrails, model tier)
- `commands.md` — PLAN and SHIP as runtime-agnostic command contracts (R1 normative)
- `runtime-adapters.md` — per-adapter specs for Claude Code (canonical), Cursor, Codex

**New compatibility matrix at `docs/compatibility-matrix.md`** — full per-capability parity table, including caveats around tool restrictions, Stop hook absence on Cursor/Codex, and Cursor subagent dispatch versioning.

**New `runtime` field in the `.pipeline-shipped` marker** identifies which runtime executed (`claude-code`, `cursor`, or `codex`).

### How to use it

The plugin itself doesn't change behaviour — `/openplanr-pipeline:plan` and `/openplanr-pipeline:ship` work exactly as in v0.5.0. What's new is that other runtimes can now run the same pipeline:

```bash
# Generate Cursor pipeline rules
planr rules generate --target cursor --scope pipeline

# Generate Codex AGENTS.md pipeline section
planr rules generate --target codex --scope pipeline
```

(Requires planr CLI v1.5.0+.)

### Files updated

- `docs/protocol/{README,spec-artifacts,agent-roles,commands,runtime-adapters}.md` (new)
- `docs/compatibility-matrix.md` (new)
- `.claude-plugin/plugin.json` — version 0.5.0 → 0.6.0

### Migration

No action required. The plugin's behaviour is unchanged. The new docs are reference material for users adopting Cursor or Codex alongside Claude Code.

### Pairs with

- `OpenPlanr` (planr CLI) v1.5.0 — `planr rules generate --scope pipeline` ships the Cursor + Codex adapter rules
- `openplanr-skills` v1.3.0 — SKILL.md routing tree extended to multi-runtime

## [0.5.0] — 2026-04-28

### Changed — Consolidated under `/plan` + `/ship`

The plugin's user-facing surface is now exactly two slash commands. Auxiliary skills (`init`, `snapshot`, `spec`, `review`, `stack`) have been removed; their value is delivered inline:

- **Spec scaffolding** runs inside `/openplanr-pipeline:plan` (auto-scaffolds `.planr/specs/SPEC-NNN-{slug}/` when missing).
- **CLAUDE.md snapshot** runs inside `/openplanr-pipeline:ship` Step 5.
- **Spec authoring** is owned by the planr CLI (`planr spec create + shape`) for spec-driven mode, or by direct edits to the placeholder body the pipeline scaffolds.
- **Review** is direct inspection of `.planr/specs/SPEC-NNN-{slug}/{stories,tasks}/*.md` — no command needed.
- **Stack files** live at `${CLAUDE_PLUGIN_ROOT}/stacks/` and `.claude/stacks/` — copy a default to your project to override.

### Why

Two-command surface eliminates namespace collisions with Claude Code built-ins (`/init`, `/review`) and removes redundancy with the planr CLI's spec authoring commands. Cleaner mental model: install the plugin, run `/plan`, run `/ship`.

### Files updated

- Removed `skills/{init,snapshot,spec,review,stack}/` directories
- `commands/plan.md`, `commands/ship.md` — references to the removed skills replaced with inline behaviour or direct file edits
- `templates/CLAUDE.md.tpl` — points to `/ship` for refresh
- `hooks/hooks.json` — Stop hook reminder updated
- `docs/{rules,spec-anatomy,task-anatomy,us-anatomy,pipeline-overview}.md` — references updated
- `stacks/{frontend,backend,database,devops}/*.md` — header notes point to copy-to-project pattern
- `README.md` — install + walkthrough rewritten around the two commands
- `.claude-plugin/plugin.json` — version 0.4.0 → 0.5.0

### Migration

No action required for new installs.

For projects that previously ran the deleted skills:

| Old | Replacement |
|---|---|
| `/openplanr-pipeline:init {name}` | `/openplanr-pipeline:plan {name}` (auto-scaffolds spec shell) |
| `/openplanr-pipeline:snapshot` | Runs automatically at end of `/openplanr-pipeline:ship` |
| `/openplanr-pipeline:spec {name}` | `planr spec create + shape` (planr CLI) — or fill in the auto-scaffolded body manually |
| `/openplanr-pipeline:review {name}` | Open `.planr/specs/SPEC-NNN-{slug}/{stories,tasks}/*.md` directly |
| `/openplanr-pipeline:stack {category}` | Copy `${CLAUDE_PLUGIN_ROOT}/stacks/{category}/*.md` to `.claude/stacks/{category}/` and edit |

## [0.4.0] — 2026-04-27

### Added — Self-sufficient spec scaffolding

`/openplanr-pipeline:plan {slug}` now scaffolds its own `.planr/specs/SPEC-NNN-{slug}/` directory when missing. The pipeline plugin is a complete standalone Claude Code plugin — install from the marketplace, ship features end-to-end without external dependencies.

```
# First run — scaffolds the spec shell if missing, stops for editing
/openplanr-pipeline:plan auth

# (user fills in the spec body)

# Second run — decomposes with designer + specification agents
/openplanr-pipeline:plan auth

# Ship
/openplanr-pipeline:ship auth
```

planr CLI remains the canonical surface for agile mode, quick tasks, multi-spec management (`list`, `status`, `sync`, `destroy`), and bare-CLI workflows. Both products share the v1.0.0 spec schema verbatim — specs scaffolded by the pipeline can be managed by planr CLI and vice versa.

### Added — `.pipeline-shipped` execution marker

`/openplanr-pipeline:ship` writes a YAML marker file at the end of every run, recording shipped_at, pipeline version, mode, tasks executed, QA status, and which agents were invoked.

- **Default mode:** `output/feats/feat-{name}/.pipeline-shipped`
- **Spec-driven mode:** `.planr/specs/SPEC-NNN-{slug}/.pipeline-shipped`

### Files updated

- `commands/plan.md` — auto-scaffolding logic in Step 1b
- `commands/ship.md` — marker write step in Step 5.5
- `templates/spec-driven.md.tpl` (new) — minimal v1.0.0 spec template
- `.claude-plugin/plugin.json`

### Migration

No action required. Existing `.planr/specs/` directories continue to work; the pipeline now scaffolds new ones on demand.

## [0.3.1] — 2026-04-26

### Fixed — Self-healing in spec-driven mode

When a project enters spec-driven mode via planr CLI (`planr spec init` + `planr spec create`), `.planr/specs/` is created but `input/tech/stack.md` is NOT (planr doesn't own that file). Previously, running `/openplanr-pipeline:plan {slug}` against this state aborted with "input/tech/stack.md not found", forcing the user to switch tools and run `/openplanr-pipeline:init` just to get one file.

In v0.3.1, when spec mode is active AND `input/tech/stack.md` is missing, the pipeline:

1. Copies `${CLAUDE_PLUGIN_ROOT}/templates/stack.md.tpl` to `input/tech/stack.md`
2. Prints a clear "edit and re-run" message
3. Aborts gracefully — no subagent is invoked, no source code is touched

Same self-heal behavior applies to `/openplanr-pipeline:ship` (which is even more critical since the DEV phase needs `BuildCommand`/`TestCommand` from stack.md).

**Default mode is unchanged.** Missing `stack.md` in default mode still aborts with the existing "Run `/openplanr-pipeline:init`" guidance — because there, missing stack typically means missing the entire scaffolding and `/init` is the right answer.

### Why

Coordination gap surfaced by real-world testing: planr authors specs, pipeline executes them, but neither side bootstrapped the file the pipeline requires from the user. v0.3.1 closes this gap with friendly self-heal rather than hard failure.

### Files updated

- `commands/plan.md` — Self-healing block added under Step 1b spec-mode requirements
- `commands/ship.md` — Same
- `.claude-plugin/plugin.json` — version 0.3.0 → 0.3.1

### Migration

No action required. v0.3.1 is a strict superset of v0.3.0 behavior.

## [0.3.0] — 2026-04-25

### Added — Bridge to planr spec-driven mode

The pipeline now reads `.planr/specs/SPEC-NNN-{slug}/` directly when planr's spec-driven mode is active in the project. No conversion adapter, no copy step — both products share one artifact schema.

**Detection:** If `.planr/config.json` exists AND `idPrefix.spec` is set, the orchestrator commands (`/plan`, `/ship`) switch to spec-driven mode. Otherwise they fall through to the default `output/feats/feat-{name}/` layout.

**Path mapping (default mode → spec-driven mode):**

| Concept | Default | Spec-driven |
|---|---|---|
| Feature root | `output/feats/feat-{name}/` | `.planr/specs/SPEC-NNN-{slug}/` |
| US files | `output/feats/.../us-{N}/us-{N}.md` | `<SPEC_DIR>/stories/US-NNN-{slug}.md` |
| Task files | `output/feats/.../tasks/task-{M}.md` | `<SPEC_DIR>/tasks/T-NNN-{slug}.md` |
| Design spec | `output/feats/.../design-spec.md` | `<SPEC_DIR>/design/design-spec.md` |
| Error report | `output/feats/.../tasks/error-report.md` | `<SPEC_DIR>/tasks/error-report.md` |
| QA report | `output/feats/.../qa-report.md` | `<SPEC_DIR>/qa-report.md` |

In spec-driven mode, US-NNN and T-NNN IDs are scoped to their parent SPEC (not project-globally unique). Two specs can each have their own US-001.

**Optimization:** if `<SPEC_DIR>/stories/` is non-empty (the user already ran `planr spec decompose`), `/plan` skips the specification-agent step and treats the existing decomposition as authoritative.

### Files updated

- `commands/plan.md`, `commands/ship.md` — Mode-detection block + conditional path resolution
- `agents/specification-agent.md`, `designer-agent.md`, `frontend-agent.md`, `backend-agent.md`, `qa-agent.md`, `doc-gen-agent.md` — "Path Resolution" section explaining dual-mode behavior
- `agents/db-agent.md`, `devops-agent.md` — UNCHANGED (mode-agnostic by nature)
- `templates/error-report.md` — Header documents both possible "Lives at" paths
- `README.md` — "Bridge to planr spec-driven mode" subsection added
- `.claude-plugin/plugin.json` — version 0.2.0 → 0.3.0

### Migration

**No change required** for existing projects using the default `output/feats/` layout. Detection is conservative: spec mode activates ONLY when `.planr/config.json` exists with `idPrefix.spec` set.

To opt into spec-driven mode:
1. Install planr CLI: `npm i -g openplanr` (or `npx openplanr` ad hoc)
2. In your project: `planr spec init` then `planr spec create "<title>" --slug <slug>`
3. (Optional) `planr spec shape <SPEC-id>` for guided authoring
4. (Optional) `planr spec decompose <SPEC-id>` for AI-driven US + Task generation
5. From Claude Code: `/openplanr-pipeline:plan {slug}` — pipeline picks up `.planr/specs/SPEC-NNN-{slug}/` automatically

### Why this matters

Without this bridge, planr's spec-driven mode would require a conversion step before invoking the pipeline (translate `.planr/specs/` into `output/feats/`). Sharing the schema eliminates that drift permanently — planr is the authoring surface, openplanr-pipeline is the executor, both speak the same contract.

See https://github.com/openplanr/OpenPlanr/blob/main/docs/proposals/spec-driven-mode.md for the full design.

## [0.2.0] — 2026-04-25

### ⚠️ Breaking changes — slash command rename

All slash commands were renamed to single-verb form for ergonomics. The old names no longer exist. Per pre-1.0 semver, this minor bump signals a breaking change. Update any docs or scripts referencing the old names.

| v0.1.x (removed) | v0.2.0 (new) |
|---|---|
| `/openplanr-pipeline:po-phase` | `/openplanr-pipeline:plan` |
| `/openplanr-pipeline:dev-phase` | `/openplanr-pipeline:ship` |
| `/openplanr-pipeline:shape-spec` | `/openplanr-pipeline:spec` |
| `/openplanr-pipeline:discover-stack` | `/openplanr-pipeline:stack` |
| `/openplanr-pipeline:review-tasks` | `/openplanr-pipeline:review` |

Unchanged: `/openplanr-pipeline:init`, `/openplanr-pipeline:snapshot`.

### Why

The new names compose into a clean three-verb narrative — **plan, review, ship** — that reads naturally with the plugin namespace. They also drop the redundant `-phase` and `-spec`/`-stack`/`-tasks` suffixes that were carrying no information once the namespace prefix was applied.

### Migration

If you ran `/openplanr-pipeline:init` on v0.1.x, no change is needed in your project — the `input/`, `output/`, `Docs/` structure and seeded files are unchanged. Just use the new slash command names going forward.

### Other changes
- Skill directory layout follows the new names: `skills/spec/`, `skills/stack/`, `skills/review/` (was `shape-spec/`, `discover-stack/`, `review-tasks/`).
- Subagent names (`db-agent`, `specification-agent`, etc.) are unchanged — they're internal references, never typed by users.
- Stop hook message simplified: `[openplanr-pipeline] DEV phase finished` instead of redundant `/openplanr-pipeline:ship finished`.
- Cleaned up several legacy regex artifacts in agent prompts (`${CLAUDE_PLUGIN_ROOT}/stacks/ (or .claude/stacks/...)` collapsed to `${CLAUDE_PLUGIN_ROOT}/stacks/` with cleaner override semantics described once).

## [0.1.2] — 2026-04-25

### Fixed
- `templates/CLAUDE.md.tpl` was the planr CLI's auto-generated agile-planning preamble (accidentally inherited from the source repo). Replaced with a proper pipeline-framework snapshot template covering Project Identity, Phase Status, Feature Registry, Active Agents (all 8), Build Log, Known Issues, Stack Summary. Existing project `CLAUDE.md` files are NOT touched on upgrade — `/init` is idempotent and only seeds when missing.

## [0.1.1] — 2026-04-25

### Fixed
- `plugin.json` `repository` field reverted to plain string (Claude Code plugin schema validator rejects the `{type, url}` object shape that the npm/package.json convention uses). v0.1.0 was tagged but uninstallable due to this validation error.

## [0.1.0] — 2026-04-25 (yanked — broken plugin.json schema)

### Added

- Initial plugin release.
- 8 subagents with frontmatter + tool-layer rule enforcement:
  - `db-agent` (Sonnet 4.6, READ-ONLY DB introspection — SQL + Mongo)
  - `designer-agent` (Sonnet 4.6, PNG → design-spec.md, with feature-namespaced PNG resolution)
  - `specification-agent` (Sonnet 4.6, spec → US + tasks)
  - `frontend-agent` (Opus 4.7, UI codegen, 3-iteration correction loop)
  - `backend-agent` (Opus 4.7, backend codegen + scaffold mode, 3-iteration correction loop)
  - `qa-agent` (Sonnet 4.6, DoD gate, runs build/test from stack.md)
  - `devops-agent` (Sonnet 4.6, generates docker-compose / CI / Dockerfiles — **no Bash, non-deploy enforced at tool layer**)
  - `doc-gen-agent` (Sonnet 4.6, generates `Docs/feat-{name}/`)
- 2 orchestrator commands: `/openplanr-pipeline:po-phase`, `/openplanr-pipeline:dev-phase`.
- 5 skills: `/init`, `/shape-spec`, `/discover-stack`, `/review-tasks`, `/snapshot`.
- Stack library defaults: NestJS, Next.js, Prisma, MongoDB, Docker Compose. User overrides at `.claude/stacks/` always win.
- Templates: `error-report.md` (R6 failure schema), `CLAUDE.md.tpl`, `stack.md.tpl`, `spec.md.tpl`.
- Stop hook in `hooks/hooks.json` — fires a snapshot reminder if `/dev-phase` aborts before its explicit snapshot call.
- Documentation: `docs/{rules,pipeline-overview,agent-model-map,spec-anatomy,us-anatomy,task-anatomy}.md`.

### Pipeline rules enforced

- R1 — No single PO → DEV command (separate `/po-phase` and `/dev-phase` commands; mandatory human review between).
- R3 — Model assignments fixed in subagent frontmatter.
- R6 — Max 3 correction iterations per task (in `frontend-agent` and `backend-agent` prompts).
- R8 — DB Agent READ-ONLY (enforced by `tools:` frontmatter — only read-only DB clients in Bash).

### Known limitations

- macOS / Linux / WSL only. The Stop hook uses POSIX shell.
- Live end-to-end testing against a real DB is deferred (manual verification recommended after install).
- planr ↔ pipeline bridge deferred to v0.2.
