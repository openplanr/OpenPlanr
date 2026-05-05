# Changelog

All notable changes to `openplanr-skills` are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [1.5.0] — 2026-05-05

### Changed — Aligned with `planr-pipeline` v0.8.0

`skills/openplanr/SKILL.md` now teaches the v0.8.0 task lifecycle:

- Status enum widened to `pending | in-progress | done | blocked` (was `pending | in-progress | done`). Aligns with the pipeline's task schema and the new error-report companion files.
- New "Cross-runtime resume via task `status`" section documents the four-way status partition the pipeline uses on `/ship` entry, plus the `DISPATCH_MODE` default per runtime (Cursor/Codex `per-task`, Claude Code `multi-task`).

### Pairs with

- `planr-pipeline` v0.8.0 — schema discipline, mode isolation, run manifest, per-task error reports, dispatch state machine
- `openplanr` (planr CLI) v1.5.3 — `TaskStatus` widened to include `'blocked'` so Linear sync no longer demotes blocked tasks

## [1.4.0] — 2026-04-30

### Changed — Aligned with `planr-pipeline` rename

`skills/openplanr/SKILL.md` routing tree updated: install commands, slash commands, and generated rule filenames now reference `planr-pipeline` (was `openplanr-pipeline`). No behavioural change in the skill's logic — pure text/identifier alignment with the upstream plugin rename.

### Pairs with

- `planr-pipeline` v0.7.0 — Claude Code plugin (renamed from `openplanr-pipeline` v0.6.0; brand convergence on the `planr` CLI binary)
- `openplanr` (planr CLI) v1.5.1 — generated rule filenames + slash command references updated

## [1.3.0] — 2026-04-29

### Changed — Routing tree extended to multi-runtime

`skills/openplanr/SKILL.md` Critical Routing Decision is now a two-axis tree (runtime × pipeline-installed). New paths:

- **Path A** (Claude Code + openplanr-pipeline plugin) — canonical, manifest-enforced subagents
- **Path A2** (Cursor + planr-generated `.cursor/rules/openplanr-pipeline.mdc`) — Composer subagent dispatch
- **Path A3** (Codex + planr-generated AGENTS.md pipeline section) — persona role-shift
- **Path B** (Claude Code without pipeline plugin) — drive planr CLI, implement in-session
- **Path C** (bare CLI) — out of skill scope

When a runtime is detected without pipeline rules, the skill now suggests the appropriate `planr rules generate --target <runtime> --scope pipeline` command instead of falling back to Path B blindly.

### Pairs with

- `openplanr-pipeline` v0.6.0 — protocol docs + compatibility matrix + Cursor/Codex parity
- `OpenPlanr` (planr CLI) v1.5.0 — `--scope pipeline` flag on `rules generate`

### Files updated

- `skills/openplanr/SKILL.md`
- `.claude-plugin/marketplace.json`

## [1.2.0] — 2026-04-27

### Changed — Routing logic for the four-component ecosystem

`skills/openplanr/SKILL.md` now teaches Claude an explicit decision tree:

- **Path A (openplanr-pipeline plugin installed):** invoke `/openplanr-pipeline:plan {slug}` then `/openplanr-pipeline:ship {slug}`. The pipeline auto-scaffolds its own spec shell. planr CLI commands are optional maintenance helpers, not prerequisites.
- **Path B (no pipeline plugin):** drive `planr spec ...` commands on the user's behalf, then implement tasks in-session.
- **Path C (bare CLI):** the user runs commands themselves; skill is not in the loop.

### Added

- Frontmatter schema reference inline in the skill (matches `OpenPlanr/docs/reference/spec-schema.md` v1.0.0)
- `planr init --yes` guidance — auto-detects API keys from OS keychain or env vars
- "Spec-driven commands" reference table mapping each command to which path it belongs in

### Files updated

- `skills/openplanr/SKILL.md`
- `.claude-plugin/marketplace.json`
- `CHANGELOG.md` (new)

## [1.1.0] — 2026-04-25

Initial release with spec-driven mode awareness.
