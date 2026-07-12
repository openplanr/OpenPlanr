# Changelog

All notable changes to `openplanr-skills` are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [1.12.0] — 2026-07-12

### Added

- Portable PLAN, Design, SHIP, dashboard, sync, and doctor skills.
- Unified routing that distinguishes dedicated OpenPlanr planning from the
  pipeline's complete delivery flow and feature-local PO planning.
- CI validation for skill paths, names, and runtime-specific instruction leaks.

### Changed

- Codex skills and Cursor rules are first-class adapter surfaces rather than a
  large `AGENTS.md` persona workflow.

## [1.11.0] — 2026-06-17

### Changed — Aligned with `planr-pipeline` v0.23.0–v0.24.0

- Routes the new `/planr-pipeline:sync` command (v0.23.0+): reconciles spec ↔ quick-task ↔ tracker so every unit of work has its quick task — the externalization unit — then pushes those to Linear or GitHub for PO / manager visibility. Read-only and native-first by default (audit + local file fixes); the tracker push is explicit. Teaches that this is distinct from the CLI's `planr spec sync` (local integrity check), which it does NOT replace.
- Notes the v0.24.0 collaborative review board: `/planr-pipeline:design-review` now serves a persistent, multi-author feedback surface — contributions are attributed and merged without loss, survive refresh / close / re-serve, and show live presence over SSE.

### Pairs with

- `planr-pipeline` v0.23.0 — `/sync` spec ↔ quick-task ↔ tracker reconciliation
- `planr-pipeline` v0.24.0 — persistent, multi-author collaborative `/design-review` board

## [1.10.0] — 2026-06-14

### Changed — Aligned with `planr-pipeline` v0.21.0

- Routes the new `/planr-pipeline:dashboard` command (v0.21.0+): a persistent localhost server with six live, read-only views of `.planr/` — Overview · Graph · Board · List · Sprints · Activity — kept in sync as files change (≤1s, view-state preserved). Teaches when to reach for the visual dashboard versus the `/planr-pipeline:status` (terminal / markdown) delivery report.

### Pairs with

- `planr-pipeline` v0.21.0 — `/dashboard` live read-only project dashboard

## [1.9.0] — 2026-06-10

### Changed — Aligned with `planr-pipeline` v0.19.0

- Routes `/planr-pipeline:design-loop <target>` (brand-asset exploration on a live pin-comment board with taste memory; key-optional) and `/planr-pipeline:design-review <slug>` (pin-driven per-screen fixes on an existing generated design, with artifact sync). Both R1-stop.

### Pairs with

- `planr-pipeline` v0.19.0 — the Design Loop Engine + design-review

## [1.8.0] — 2026-06-07

### Changed — Aligned with `planr-pipeline` v0.14.0

- Teaches that `/planr-pipeline:design <slug>` works even when **no spec exists** yet: it asks whether to scaffold a spec or **explore standalone** (design only, into `.planr/designs/<slug>/`, no tracked spec) — so a design can be prototyped without committing to a spec first.

### Pairs with

- `planr-pipeline` v0.14.0 — `/design` no-spec ask + standalone exploration

## [1.7.0] — 2026-06-07

### Changed — Aligned with `planr-pipeline` v0.13.0

- Routing now teaches the optional `/planr-pipeline:design <slug>` step that runs **before** `/plan`: when a feature is UI-facing but has no PNG mockups, generate a visual design (prototype / walkthrough / canvas) + `design-spec.md` instead of shipping backend-only.
- Notes the R2 amendment (a `design-spec.md` OR a PNG ⇒ a UI task) so the design→UI-task loop is explained.

### Pairs with

- `planr-pipeline` v0.13.0 — `/planr-pipeline:design` generation (SPEC-015), Claude Code only

## [1.6.0] — 2026-05-11

### Changed — Aligned with `planr-pipeline` v0.9.0

- Task frontmatter template adds `rationale:` field (1-3 sentence decomposition reasoning)
- New "Project memory" section: `.planr/memory.md` with decisions, traps, corrections — append-only, keyword-matched into agent dispatch context
- New "Clarification loop" section: specification-agent emits structured options on ambiguity, PO resolves before re-running `/plan`
- New "Task rationale" section: qa-agent checks implementation drift vs stated rationale

### Pairs with

- `planr-pipeline` v0.9.0 — project memory, rationale, clarification loop, R10 build-order rule
- `openplanr` CLI v1.7.0 — artifact integrity, managed-block markers, adapter template alignment

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
