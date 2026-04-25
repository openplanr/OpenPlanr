# Changelog

All notable changes to `openplanr-pipeline` are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/) — with the caveat that pre-1.0 releases may contain breaking changes in minor bumps.

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
