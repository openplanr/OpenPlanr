---
id: "BL-019"
title: "Consolidate input/, output/ under .planr/ for unified ownership"
priority: "high"
tags: ["architecture", "dx", "breaking-change", "v0.8"]
status: "open"
created: "2026-05-01"
updated: "2026-05-01"
target_release: "planr-pipeline v0.8.0"
---

# BL-019: Consolidate input/, output/ under .planr/ for unified ownership

## Priority
HIGH (architectural cleanup; targets pipeline v0.8.0, ~2 weeks post-launch)

## Problem

The pipeline has two parallel directory layouts:

- **Default mode (legacy):** uses top-level `input/specs/`, `input/ui/`, `input/tech/`, and `output/feats/` directories. Cluttered project root, mixes pipeline state with user code.
- **Spec-driven mode (modern):** uses `.planr/specs/SPEC-NNN-{slug}/` for everything. Clean, single root.

But spec-driven mode still depends on `input/tech/stack.md` at the project root — outside `.planr/`. So even in the modern flow, the user's project root has both `.planr/` and `input/tech/`.

This split creates three real problems:

1. **DX clutter** — modern frameworks (`.next/`, `.cache/`, `.git/`) put all framework state under one hidden dir. OpenPlanr's split is inconsistent.
2. **Gitignore confusion** — users have to gitignore `input/`, `output/`, AND maintain `.planr/` selectively. One folder to rule them all is easier.
3. **Onboarding friction** — new users see `input/`, `output/`, and `.planr/` and have to learn three layouts. The mental model is "one root: `.planr/`."

## Proposed end state (v0.8.0)

```
project/
├── package.json, src/, tsconfig.json, etc.   ← user's project (unchanged)
└── .planr/                                   ← all OpenPlanr territory
    ├── config.json
    ├── tech/stack.md                         ← was input/tech/stack.md
    ├── specs/SPEC-NNN-{slug}/                ← already here
    │   ├── SPEC-NNN-{slug}.md
    │   ├── stories/
    │   ├── tasks/
    │   ├── design/*.png
    │   ├── db-schema-snapshot.md
    │   └── .pipeline-shipped
    ├── feats/feat-{name}/                    ← was output/feats/ (default mode)
    ├── db/schema.json                        ← was output/db/
    └── (legacy agile dirs: epics/, features/, stories/, tasks/, sprints/, ...)
```

Deletes: top-level `input/`, top-level `output/`. Both go away entirely.

## What this requires

### Pipeline plugin (planr-pipeline v0.8.0)

- Update all 8 agent prompts to read from `.planr/tech/stack.md`, `.planr/feats/`, `.planr/db/` instead of `input/`, `output/`
- Update `commands/plan.md` and `commands/ship.md` mode-detection paths
- Update `templates/CLAUDE.md.tpl` references
- Update `hooks/hooks.json` if any path references
- Update `docs/protocol/spec-artifacts.md` schema docs
- Update `docs/compatibility-matrix.md` examples
- Update `conformance/runner.mjs` and `conformance/expected/*.json`
- Bump version 0.7.x → 0.8.0

### planr CLI (openplanr v1.6.0)

- Update generators to write rule files referencing the new paths
- Add `planr migrate --to-v08` command:
  - Detects old layout (`input/tech/`, `output/feats/`, etc.)
  - Moves files to new locations under `.planr/`
  - Updates `.planr/config.json` paths if needed
  - Stages a single git commit for review
- Add deprecation warnings in v1.5.x: when `input/tech/stack.md` is read, log a one-line warning pointing at v0.8 + `planr migrate`

### planr-pipeline cross-runtime adapters

- `.cursor/rules/planr-pipeline*.mdc` templates updated for new paths
- `_pipeline-section.md.hbs` (Codex) updated
- All vendored agent body files updated

### Documentation

- README in pipeline + CLI repos updated
- CHANGELOG entries (v0.8.0 + v1.6.0) with explicit migration block
- Conformance harness documentation updated

## Migration story

For existing v0.7.x users:

1. Upgrade planr CLI: `npm i -g openplanr@latest`
2. Run: `planr migrate --to-v08` (interactive, shows diff before applying)
3. Upgrade plugin: `/plugin install planr-pipeline@openplanr` (resolves to v0.8.0)
4. Re-run `/planr-pipeline:plan` against any existing spec — works identically with new paths

For new users on v0.8.0:

- `planr init` writes the new layout from day one
- No mention of `input/` or `output/` anywhere in docs
- `/planr-pipeline:plan` greenfield bootstrap (from v0.7.1 BL-019 unblocks this) creates `.planr/tech/`, `.planr/specs/`, etc. directly

## Why NOT in v0.7.1

- v0.7.0 just shipped 24 hours before this ticket was filed
- Launch posts go out next Tuesday — shipping a directory-layout breaking change 24h before posts is a recipe for breakage
- v0.7.1 fixes the **tactical DX gaps** (greenfield bootstrap, brief interpretation, plan mode, path expansion) without touching layout
- v0.8 is the right place for the **architectural** cleanup with proper migration tooling

## Acceptance criteria

- [ ] All 8 agent prompts in planr-pipeline read from `.planr/tech/`, `.planr/feats/`, `.planr/db/` (zero references to top-level `input/` or `output/`)
- [ ] `commands/plan.md` and `commands/ship.md` mode-detection updated
- [ ] `planr migrate --to-v08` command exists in planr CLI, includes:
  - Dry-run mode
  - Interactive confirm before applying
  - Atomic move (stash + apply, rollback on failure)
- [ ] Conformance harness `runner.mjs` passes against new layout
- [ ] CHANGELOG migration block tested by following the steps in a v0.7.x project
- [ ] Anti-grep: `grep -rn "input/tech\|input/specs\|input/ui\|output/feats\|output/db" src/` returns zero hits in both repos (excluding CHANGELOG history)
- [ ] Cross-runtime adapters (Cursor `.mdc`, Codex `AGENTS.md`) updated to match
- [ ] Skills (`openplanr-skills` v1.5.0) routing tree updated to mention v0.8 layout

## Estimated effort

- pipeline plugin sed + manual review: 4-6 hours
- planr CLI migration command: 4-6 hours
- Conformance + tests: 2-3 hours
- Cross-runtime adapter updates: 1-2 hours
- Docs + CHANGELOG: 1-2 hours
- **Total: 12-19 hours** (1.5-2 focused days)

## Blocked on

- v0.7.1 ship (greenfield bootstrap + brief interpretation) — this PR makes the v0.8 migration story cleaner because new users will already start with the right `.planr/` shape post-bootstrap.

## Ships with

- planr-pipeline v0.8.0
- openplanr (planr CLI) v1.6.0 (minor bump for `planr migrate` command)
- openplanr-skills v1.5.0 (text update only)
- marketplace pin update (mechanical)

## Notes

This is the right architectural call but it's a **breaking change**. The migration command + clear deprecation warnings in v0.7.x are the make-or-break ergonomics. Without them, anyone who manually upgrades the plugin without running `planr migrate` will hit confusing path errors.

Filed alongside the v0.7.1 PR (which solves the immediate launch-blocker DX gaps) so it doesn't get lost. Pick this up in week 2 post-launch when the launch firehose calms down.
