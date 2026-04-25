# Changelog

All notable changes to `openplanr-pipeline` are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/) — with the caveat that pre-1.0 releases may contain breaking changes in minor bumps.

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
