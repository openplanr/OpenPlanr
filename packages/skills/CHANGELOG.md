# Changelog

All notable changes to `openplanr-skills` are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/).

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
