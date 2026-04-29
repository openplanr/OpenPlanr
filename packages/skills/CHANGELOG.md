# Changelog

All notable changes to `openplanr-skills` are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/).

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
