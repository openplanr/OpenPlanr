# Changelog

All notable changes to this plugin are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/) — with the caveat that pre-1.0 releases may contain breaking changes in minor bumps.

> **Note:** Plugin renamed from `openplanr-pipeline` to `planr-pipeline` in v0.7.0 (brand convergence on the `planr` CLI binary). Entries from v0.6.0 and earlier reference the old name verbatim.

## [0.13.4] — 2026-06-07

### Fixed — `/design` Phase B now actually fires the clarification prompt

The Phase B clarification described the source/format question in prose ("if unset, ask"),
which the model could rationalize away — in practice it would **auto-decide format/source
from the brief and proceed** ("proceeding without further questions since your brief is
explicit"), never issuing a real prompt. Ported gstack's enforcement into
`procedures/design-step1-clarify.md` (+ `commands/design.md`): Phase B is now a **mandatory
`AskUserQuestion` tool call** when the relevant flag is absent —

- it MUST be sent as a tool_use, never narrated as prose;
- an explicit brief is *content*, not the user's **format** (prototype/walkthrough/canvas)
  or **source** choice — a clear brief is not consent to skip the prompt;
- the recommendation is a **pre-selected default**, not a license to skip the call;
- a prompt is skipped only when both `--format` and `--from` are passed, or `--yes` assumes
  that question's stated default;
- if no `AskUserQuestion` variant is callable, **STOP** and report
  `BLOCKED — AskUserQuestion unavailable` — never silently default.

There is no system trigger that "invokes" the question — the model must choose to call the
tool, so the fix is forceful, gstack-style instruction that removes the skip rationalization.

## [0.13.3] — 2026-06-07

### Changed — `/design` keeps the project repo clean (scoped `.gitignore`)

Each `/design` run copied a self-contained runtime into the spec's `design/vendor/`
(~141KB React for canvas, ~30KB pretext for prototype/walkthrough) plus the generated HTML —
so designing across features committed the third-party runtime into git, per design. Now
`/design` writes a **`design/.gitignore`** that treats the rendered preview as build output:
**`design-spec.md` (the intent `/plan` consumes) + `finalized.json` are tracked**, while
`finalized.html` / `canvas.html` / `vendor/` / state / lock / temp are ignored. This scopes
only the directory `/design` generated — it never touches the developer's root `.gitignore`,
and deleting the file opts back into committing the full self-contained visual. The Phase-D
handoff states the policy.

### Changed — canvas uses a Figma-style dot grid

`templates/design/DesignCanvas.jsx` (and the compiled `vendor/DesignCanvas.js`) now render
the infinite canvas with a subtle **40px dot grid** on a clean near-white background
(`#fcfcfc`), replacing the old 120px square-line grid on warm gray. Recompiled with esbuild;
`node --check` clean, render verified.

## [0.13.2] — 2026-06-07

### Fixed — `/design` generation references the plugin root robustly (no hardcoded version path)

The Step C generate procedure referenced the `lib/design/*` helpers with bare paths, so when
the orchestrator shelled out to `node` to build `finalized.json` it hand-rolled an absolute,
**version-pinned** path (e.g. `…/planr-pipeline/0.13.0/lib/design/manifest.mjs`) — which is
wrong the moment the plugin updates. `procedures/design-step2-generate.md` now establishes a
**plugin-root handle** (`PLUG="${CLAUDE_PLUGIN_ROOT}"`, the currently-loaded install) and
invokes helpers as `node "$PLUG/lib/design/…"`, with a documented fallback (author the JSON
directly + validate against the shipped schema) when `$CLAUDE_PLUGIN_ROOT` isn't set. No
behavior change to generated artifacts.

### Fixed — stronger escaping instruction in generation

The escaping step is now explicit that **every** spec-derived string (screen titles, group
names, labels, copy, field names) must be escaped **before** it is written into the artifact,
**even when it "looks safe"** — closing the gap where a model might skip `escapeHtml` for an
"obviously harmless" title (SPEC-015 S1 hardening). The tested helper is unchanged; this
sharpens the runtime instruction.

## [0.13.1] — 2026-06-07

### Fixed — `/design` no longer dead-ends on a thin spec; it asks (DevEx)

When the structural screen resolver found **0 screens** (a spec organized as functional
requirements rather than a `## Screens` list / `ui_files:`, e.g. a `FR-A01…A19` spec),
`/design` v0.13.0 **aborted** preflight with a `Repair:` hint and forced the user to re-run
with `--from describe`. That dead-ended the whole point of the interactive flow ("the agent
triggers a question to collect what it needs"). The clarification (`AskUserQuestion`) lived
in Phase B but the abort fired in Phase A, before it could run.

Now an **interactive** run with 0 screens **asks** instead of aborting (Phase B § B.0.5):
derive the screens from the spec's requirements/flows · ground them in an existing design
doc the preflight auto-detects (`design/*.md`, e.g. `ux-flows.md`) · add a `## Screens`
section · cancel. Only a **headless** run (both `--format` and `--from` set, source not
`describe`) still aborts — it cannot prompt. The decision is a tested helper
(`lib/design/interactivity.mjs` `decideThinSpec` / `isHeadless`, + `tests/design/
interactivity.test.mjs`), not prose. The generator still never fabricates a screen list
silently (SPEC-015 F8/E3). Preflight now also detects `design/*.md` docs as a screen source.

### Fixed — task tracking no longer hard-codes the deprecated `TodoWrite` tool

Claude Code **deprecated `TodoWrite` in v2.1.142** (disabled by default in favor of the
`TaskCreate` / `TaskGet` / `TaskList` / `TaskUpdate` family). The `/plan` and `/design`
commands instructed the agent to "create a TodoWrite list," which silently no-ops on
modern Claude Code (the orchestrator fell back to inline tracking — work was unaffected,
but the progress UI was lost).

- `commands/plan.md` + `commands/design.md`: phase tracking now uses the current task
  tools (`TaskCreate` / `TaskUpdate`), with documented fallbacks — `TodoWrite` on Claude
  Code < 2.1.142, and inline tracking on Cursor/Codex or any runtime without a task tool.
- `procedures/plan-step0-preflight.md`, `plan-step1-mode-and-spec.md`,
  `plan-steps-2-through-completion.md`, `strategy-scaffold-node.md`: "TodoWrite item N"
  phrasing made tool-agnostic ("task-tracker item N"). On-disk phase verification is
  unchanged and still mandatory regardless of which (or no) task tool is present.

## [0.13.0] — 2026-06-07

### Added — `/planr-pipeline:design`: design generation before decomposition (SPEC-015)

A new **optional** command that turns a brief into a visual design **and** authors a
`design-spec.md`, so the PO Phase decomposes real UI tasks instead of silently degrading to
a Tech-only ship when no mockups exist. It runs **before** `/plan` (never inside it, never as
a post-`/plan` re-decomposition) and never auto-chains. Reviewed via `/autoplan`
(CEO → Design → Eng → DX) before implementation — see `docs/design-command-plan.md`.

- **Three formats, one shared core.** `prototype` (one interactive Pretext screen),
  `walkthrough` (multi-screen gallery; sidebar **anchor-scroll ≤8 screens**, **lazy
  screen-switching >8**), and `canvas` (Figma-like pan/zoom board, vendored React). The
  shared core is three tested helpers; the three renderers are thin shells in
  `templates/design/`.
- **Clarification with a recommended default.** Source → format is asked via
  `AskUserQuestion` with the format pre-selected from the screen count
  (`0–2 → prototype · 3+ linear → walkthrough · 3+ exploratory → canvas`), outcome-labeled.
  Supplying `--format … --from …` **skips the prompt entirely** (fully non-interactive for
  CI), plus `--yes` / `--dry-run` to match the `/plan` `/ship` flag family.
- **Loop closes via R2.** `docs/rules.md` **R2 amended**: a UI task is born when a
  `design-spec.md` **OR** a PNG exists (previously PNG-only), aligning the rule with
  `specification-agent`'s `has_design` trigger.
- **Honest canvas.** Opened without a host bridge, the canvas disables edit affordances and
  shows a view-only banner; **Export PNG/HTML stays the primary action**. React + the
  compiled `DesignCanvas` are vendored locally (SRI-pinned) so the artifact opens offline.
- **Tested core + security.** `lib/design/` (escape, recommendFormat, screens,
  walkthroughNav, manifest) with 27 unit tests; all spec-derived text is HTML-escaped /
  JSON-serialized (`escapeHtml` / `embedJson`) with an injection regression. New
  `schemas/v1.0.0/design-manifest.schema.json` (field `design_format`, not the reserved
  `format`). New `conformance/verify-design-assets.mjs` + `conformance/fixture-design/`,
  wired into `npm test`.
- **Single-sourced contract.** The 10-section `design-spec.md` template moved to
  `agents/modes/shared/design-spec-template.md`, included by both `designer-agent`
  (extraction) and the generator (authoring) so it cannot drift.

### Changed

- `/plan` prints a one-line **stdout nudge** (`procedures/design-detect-nudge.md`) when a
  feature is UI-facing but has no design — never an interactive prompt, so `--dry-run` / CI
  stay unaffected.
- `procedures/mode-detection.md` documents the new `design/` artifacts dir (both modes) and
  the one-writer precedence for `design-spec.md`.
- `commands/plan.md`, `docs/rules.md` (R1 design corollary), `docs/pipeline-overview.md`,
  `README.md` updated.

## [0.12.0] — 2026-06-01

### Changed — Native host-driven parallel dispatch for `/ship` (SPEC-014; supersedes SPEC-013)

SPEC-014 is a deliberate **reversal** of the SPEC-013 (v0.11.0) DAG-aware wave scheduler. planr-pipeline is a planning and orchestration layer, not a runtime sandbox; parallel write-safety between concurrent agents is the host runtime's concern. The DEV phase now dispatches tasks as **native parallel `Agent` calls** directly on the shared main working tree, exactly like native Claude Code parallel sub-agents.

In Claude Code's multi-task dispatch mode the orchestrator emits **one `Agent` tool-call per ready task in a single assistant turn** — a task is *ready* when every id in its `dependsOn:` list is already `done`. There is **no worktree isolation, no merge-back, and no concurrency knob**; the host's native concurrency cap is the only throttle. Codex/Cursor (`per-task`) and `single-task` (`--task T-NNN`) dispatch exactly one task per invocation, unchanged.

planr does **no** write-set inference and **no** cycle detection. The only ordering it honors is an explicit `dependsOn:` field. The lock-list survives **only as an advisory note** in the dispatch prompt — it never serializes anything.

### Removed (SPEC-013 machinery)

- **Git-worktree isolation** — no more `.planr-worktrees/<id>` directories, `planr-wt/<id>-<slug>` branches, dependency-dir symlinking, or `isolation: "worktree"` on `Agent` dispatches.
- **DAG wave serialization engine** — write-set normalization, cycle detection, lock-list-driven serialization, and greedy wave selection are gone.
- **File-scoped merge-back** + the undeclared-write guard + the forbidden-file check.
- **Startup worktree reconcile sweep** (`commands/ship.md` Step 1.10).
- **`--max-parallel N`** flag and the `$SHIP_MAX_PARALLEL` binding (and its cost-gate multiplier).
- `.gitignore` entries `planr-wt` / `.planr-worktrees`.
- The 9 SPEC-013 conformance fixtures (`conformance/fixtures/parallel-dispatch-*`, ~120 assertions) and their runner functions.

### Added

- Optional **`dependsOn`** field on the task schema (`schemas/v1.0.0/task.schema.json`) — an array of `^T-\d{3}$` task IDs. Backward-compatible: task files without it stay valid.
- 4 native-dispatch conformance fixtures (`conformance/fixtures/native-dispatch-{nd1-parallel,nd2-advisory-locklist,nd3-dependson,nd4-per-task}`) + ND1–ND4 assertions in `conformance/runner.mjs`, wired into `.github/workflows/ci-parallel-dispatch.yml`.

### Migration notes

- **`--max-parallel` is gone.** Invocations that pass `--max-parallel` no longer have an effect — remove the flag. The host's native concurrency cap is the only throttle.
- **Accepted tradeoff:** planr no longer guarantees write-isolation between parallel agents. Avoid collisions through good task decomposition, the advisory lock-list hint, and the host agent's judgment.
- **Leftover artifacts from a prior 0.11.0 run:** any `.planr-worktrees/` directories or `planr-wt/*` branches left behind are no longer managed by planr and can be cleaned up with standard git — e.g. `git worktree remove .planr-worktrees/<id>` (or `git worktree prune`) and `git branch -D planr-wt/<id>-<slug>`.

### Files touched (v0.12.0)

- `commands/ship.md`, `procedures/ship-step2-dag-dispatch.md`, `procedures/ship-arguments-and-cost-gate.md` — native dispatch; worktree/wave/`--max-parallel` removed.
- `schemas/v1.0.0/task.schema.json` — optional `dependsOn`.
- `agents/**` shared QA/correction contract — `isolation`/worktree language removed.
- `conformance/runner.mjs` + `conformance/fixtures/native-dispatch-*` *(4 new fixtures; 9 SPEC-013 fixtures deleted)*.
- `.github/workflows/ci-parallel-dispatch.yml` — runs the native-dispatch suite.
- `docs/rules.md` (R11 removed), `docs/pipeline-overview.md`, `docs/protocol/runtime-adapters.md`, `docs/compatibility-matrix.md`, `docs/feat-parallel-dispatch/` *(rewritten to native dispatch)*.
- `.claude-plugin/plugin.json` — version `0.11.0` → `0.12.0`.

## [0.11.0] — 2026-05-30

### Added — DAG-aware parallel wave dispatch for `/ship` (SPEC-013, M1)

`/planr-pipeline:ship` can now dispatch multiple Tech/UI tasks **per orchestrator turn** instead of walking the queue one task at a time. In `DISPATCH_MODE: multi-task` (the default for the Claude Code runtime) the orchestrator computes a **wave** — a batch of tasks whose declared write-sets are disjoint — and emits one `Agent` tool-call per wave member in a single turn. Sequential dispatch is preserved exactly at `--max-parallel 1` and for the `per-task`/`single-task` runtimes (Cursor/Codex are **unchanged**).

**Why:** the DEV phase was strictly serial even when a feature's tasks touched non-overlapping files. Wave dispatch drains a queue of `N` write-disjoint tasks in `ceil(N/cap)` turns instead of `N`, with no change to the QA gate or the per-task R6 correction loop.

**Three-layer write-safety model (no clobbered files):**

1. **Lock-list serialization** — an inlined Node/TS lock list (`package.json`, lockfiles, `**/index.ts`, `prisma/schema.prisma`, `**/migrations/**`) forces any two lock-touching tasks to serialize even if their declared write-sets look disjoint. Empty/absent declared write-set ⇒ serialized alone.
2. **Worktree isolation** — each wave member runs with `isolation: "worktree"` on a private branch `planr-wt/<T.id>-<short-slug>` (dir `.planr-worktrees/<T.id>`, `node_modules` symlinked from main).
3. **File-scoped merge** — the orchestrator validates the worktree diff against the task's declared Create/Modify list and applies **only** those paths via `git checkout <wt-branch> -- <files>` (never a full `git merge`). Task `.md` status fields and `.run-manifest.jsonl` stay single-writer in main; any undeclared write fails the task into R6.

**Also added:**

- `--max-parallel N` (default `4`; `1` = sequential escape hatch; `≤0`/non-numeric = two-line fatal; `>20` = soft warning). Bound as `$SHIP_MAX_PARALLEL`.
- **Crash recovery** — `commands/ship.md` Step 1.10 reconcile (`git worktree prune` + sweep of dangling `planr-wt/*` branches) plus §2a `in-progress` re-queue bring a crashed run back to a clean, re-runnable state.
- **Determinism** — id-sorted waves; byte-for-byte legacy parity at width 1; cycle precheck fails fast (dispatch nothing) on a mutually-overlapping task set.
- **Shared contract rule 4** (`agents/modes/shared/contract-create-modify-preserve.md`) — the undeclared-write rejection policy, now defined once and cross-referenced (not duplicated) by the three QA agent files.
- **Conformance** — 9 new `--verify-ship` fixtures + assertions in `conformance/runner.mjs`: G1 multi-wave, G2 floor-of-1, G3 arg-validation, G4 sequential-parity, G6 crash-recovery, G7 file-scoped-merge, plus clobber-prevention, undeclared-write, and cyclic-dep fixtures (120 assertions total). Wired into a new CI workflow (`.github/workflows/ci-parallel-dispatch.yml`).

**Proof scope (honest M1 boundary):** the conformance suite proves clobber-prevention end-state and serialization of conflicting tasks via non-overlapping manifest intervals. It does **not** prove wall-clock concurrency (the orchestrator writes the timestamps). Explicit `dependsOn:` task dependencies, an authoritative `execution-plan.json` co-wave proof, and stack-extensible lock lists are deferred to **M2/M3**.

**Files touched (v0.11.0):**

- `procedures/ship-step2-dag-dispatch.md` *(new)* — the wave scheduler (Sections 1–9: input contract, cycle detection, inlined lock list, greedy wave selection, dispatch contract, worktree setup/dep-sharing, file-scoped merge, ship.md integration, determinism).
- `commands/ship.md` — Step 1.10 (worktree reconcile) + Step 2b-multi (wave-dispatch wiring; consumes `$SHIP_MAX_PARALLEL`).
- `procedures/ship-arguments-and-cost-gate.md` — `--max-parallel` parsing/validation → `$SHIP_MAX_PARALLEL`.
- `agents/modes/shared/contract-create-modify-preserve.md` — rule 4 (undeclared-write); `agents/qa-agent.md`, `agents/modes/default/qa.md`, `agents/modes/spec-driven/qa.md` — cross-reference it (DRY).
- `conformance/runner.mjs` + `conformance/fixtures/parallel-dispatch-*` *(9 new fixtures)*.
- `docs/rules.md` (R11 Wave Write-Safety), `docs/pipeline-overview.md` (Parallel Dispatch M1), `docs/protocol/runtime-adapters.md` (Worktree Isolation), `docs/compatibility-matrix.md` (SPEC-013 row); `docs/feat-parallel-dispatch/` *(generated feature docs)*.
- `.github/workflows/ci-parallel-dispatch.yml`, `.env.example` *(new)*.
- `.claude-plugin/plugin.json` — version `0.10.0` → `0.11.0`.

**Migration:** none. The task/spec **schema is unchanged** (M1 derives every serialize edge from file-scope inference + the lock list — no new frontmatter). Existing specs authored by the `planr` CLI dispatch under the new scheduler automatically; pass `--max-parallel 1` to opt back into strictly-sequential dispatch.

**Pairs with (ecosystem alignment):** only `openplanr/marketplace` needs a matching change — bump the `planr-pipeline` `version` pin `0.10.0` → `0.11.0` (after this repo is tagged `v0.11.0`). The **`openplanr` CLI and `openplanr-skills` need no update**: the schema is unchanged, the CLI vendors no pipeline files, and the feature is Claude-Code-only (Cursor/Codex remain per-task sequential, so their generated adapter rules stay accurate).

## [0.10.0] — 2026-05-30

### Changed — Frontier model bump: Opus 4.7 → Opus 4.8 (1M context) for DEV codegen

The DEV-tier codegen agents (`frontend-agent`, `backend-agent`) now ship with `model: claude-opus-4-8[1m]` in their YAML frontmatter. The `[1m]` suffix is Anthropic's selector for the 1M-context deployment of Claude Opus 4.8 (the same syntax as `/model claude-opus-4-8[1m]`). This makes Opus 4.8 with the 1M context window the default frontier for multi-file Tech and UI codegen tasks.

**Why:** Opus 4.8 improves multi-file coordination, framework-convention adherence, and design-token application — exactly the codegen surface the DEV phase exercises. The 1M context lets `backend-agent` keep an entire feature's task chain (US + 2-3 task files + design-spec + schema.json + active stack file + correction-loop history) resident across all three R6 iterations without spilling context.

**What stays the same:**

- **Sonnet 4.6 still owns the analysis tier.** `db-agent`, `designer-agent`, `specification-agent`, `qa-agent`, `devops-agent`, `doc-gen-agent`, and the new `entity-scaffold-agent` (Step 0.2, SPEC-005) continue to use `claude-sonnet-4-6`. The cost split (Opus where reasoning over many files matters; Sonnet where structured output suffices) is unchanged.
- **R3 model-assignment rule is unchanged in spirit** — the Opus tier identifier updated; the assignment table in `docs/rules.md` and `docs/agent-model-map.md` reflects the new string.
- **Tool restrictions, frontmatter `name` / `description` fields, and agent prompts are unchanged.** Manifest-enforced tool boundaries are not affected by the model bump.
- **Cost preview heuristics in `procedures/ship-arguments-and-cost-gate.md`** still reference per-million-token pricing for both classes. If Anthropic's price card for Opus 4.8 differs from 4.7, update that single line at COST ESTIMATE block § B.2.

**Files touched (v0.10.0):**

- `agents/backend-agent.md`, `agents/frontend-agent.md` — `model:` frontmatter updated to `claude-opus-4-8[1m]`.
- `agents/entity-scaffold-agent.md` — internal cross-reference to backend-agent's model updated.
- `.claude/commands/audit.md` — AGENT AUDITOR template's `MODEL:` reference updated.
- `docs/rules.md` R3 — model-tier assignment row updated.
- `docs/agent-model-map.md` — full model-tier table + rationale section updated.
- `docs/pipeline-overview.md`, `docs/protocol/agent-roles.md`, `docs/task-anatomy.md`, `commands/ship.md` — display references updated.
- `procedures/ship-arguments-and-cost-gate.md` — cost-preview model labels updated.
- `README.md` — feature summary, agent table, "Pinned model strings" footnote, and refresh date.
- `AGENTS.md` (Codex adapter), `.cursor/rules/planr-pipeline.mdc`, `.cursor/rules/agents/{backend,specification}-agent.md` — adapter mirrors updated.
- `templates/CLAUDE.md.tpl` — generated-project agent status table updated to `claude-opus-4-8[1m]` for the two DEV agents (so installs render the current model).
- `.claude-plugin/plugin.json` — version bumped from `0.9.1` to `0.10.0`.

**Migration:** none. Existing `/planr-pipeline:plan` and `/planr-pipeline:ship` invocations pick up the new model automatically on first dispatch after install. If you've forked any agent files and pinned `claude-opus-4-7` manually, swap to `claude-opus-4-8[1m]`.

**Pairs with (ecosystem alignment):** parallel updates required in the `openplanr` CLI (its agile-mode model-tier rendering), `openplanr-skills` (skill body templates that reference the Opus tier), and `openplanr/marketplace` (the marketplace.json pin for this plugin). Those repos are out-of-tree for this changelog entry but the model identifier needs to match for consistent docs across the ecosystem.

## [0.9.1] — 2026-05-11

### Fixed — Procedure files exposed as slash commands

`commands/procedures/` moved to `procedures/` at the plugin root. The Claude Code plugin loader registers every `.md` under `commands/` as a slash command — so 19 internal procedure files (mode-detection, memory-read, strategy-*, etc.) were polluting the user's autocomplete menu alongside the 3 real commands (`plan`, `ship`, `status`).

Users now see exactly 3 commands. Internal procedures are still readable by the orchestrator via `${CLAUDE_PLUGIN_ROOT}/procedures/` — no behavioral change.

#### Files touched

- 19 procedure files moved from `commands/procedures/` → `procedures/`
- All path references updated in `commands/plan.md`, `commands/ship.md`, `commands/status.md`, `docs/protocol/runtime-adapters.md`, and 7 procedure files that cross-reference each other

## [0.9.0] — 2026-05-11

### Added — Project memory, task rationale, clarification loop, R10

See [v0.9.0 release notes](https://github.com/openplanr/planr-pipeline/releases/tag/v0.9.0).

## [0.8.0] — 2026-05-03

### Changed — Mode isolation refactor

Dual-mode prompt content has been extracted from each agent prompt body into per-mode files under `agents/modes/`. Each entry file at `agents/<role>-agent.md` is now a thin loader (≤60 lines) that preserves frontmatter (`name`, `description`, `tools`, `model`) verbatim and adds a `Read` directive listing the mode-specific files the agent should load before executing.

**What stays the same:**

- **Both modes remain first-class user surfaces.** Default mode is the lightweight solo-dev fast-feedback path; spec-driven mode is the formal team / PO-handoff path. Neither is a fallback for the other.
- The security boundary at the `tools:` frontmatter is unchanged — manifest-enforced tool restrictions on Claude Code, advisory tool restrictions on Cursor and Codex, all carried verbatim from the previous entry-file frontmatter.
- The protocol artifact contract is unchanged — SPEC, US, and Task frontmatter still conforms to v1.0.0 schema; the `.pipeline-shipped` marker is unchanged.
- Existing user invocations of `/planr-pipeline:plan` and `/planr-pipeline:ship` continue to work in either mode with no observable behaviour change.

**Token cost:** approximately 30% per-invocation reduction. Only the active mode's content loads — the entry file (small), the matched per-mode file, and any shared topics it references. The inactive mode's prompt body is not read into the agent's context.

**New layout reference:** see the "Mode isolation (introduced in v0.8.0)" section in `docs/protocol/runtime-adapters.md` for the canonical file structure and adapter mirroring guidance.

**Pairs with:** SPEC-001 (Schema Discipline v1.0.0) — shipped concurrently in v0.8.0.

#### Files touched (mode isolation)

- 7 agent entry files rewritten as thin loaders (`agents/{specification,designer,frontend,backend,qa,devops,doc-gen}-agent.md`). `agents/db-agent.md` is unchanged — it has no dual-mode content.
- 14 new per-mode files at `agents/modes/{spec-driven,default}/<role>.md`.
- 3 new shared files at `agents/modes/shared/{contract-create-modify-preserve.md, correction-loop-frontend.md, correction-loop-backend.md}`.
- New `procedures/mode-detection.md` shared between `/plan` and `/ship`.
- Updated `commands/plan.md` and `commands/ship.md` to load the shared `mode-detection` procedure.
- New `conformance/fixtures/default-mode/` fixture plus updated `conformance/runner.mjs` that auto-detects mode from fixture layout.
- Harmonized `templates/spec.md.tpl` frontmatter to v1.0.0 schema.

### Changed — Agent prompt slim-down (SPEC-004)

**`docs/rules.md` § R6** is the only normative home for the DEV correction loop (command order, three passes, dual-mode error-report paths, pointer to future `T-<id>-error-report.md`). Agent prompts and `docs/pipeline-overview.md` link to R6 instead of duplicating multi-step loop prose. `agents/specification-agent.md` defers decomposition policy to **R2/R4/G1** and artifact shape to **`schemas/v1.0.0/{story,task}.schema.json`**. `templates/error-report.md` delegates pass semantics to R6. **`agents/modes/shared/correction-loop-*.md`** and per-mode **frontend/backend** tails were rewritten to reference R6 without `Iteration 1/2/3` blocks.

#### Files touched (SPEC-004)

- `docs/rules.md`, `docs/pipeline-overview.md`, `templates/error-report.md`
- `agents/specification-agent.md`, `agents/frontend-agent.md`, `agents/backend-agent.md`
- `agents/modes/shared/correction-loop-frontend.md`, `correction-loop-backend.md`
- `agents/modes/{spec-driven,default}/{frontend,backend}.md`

### Changed — Backend agent split (SPEC-005)

**`entity-scaffold-agent`** (Sonnet 4.6) owns optional **Step 0.2** manual ORM scaffold from `output/db/schema.json` → `output/src/`. **`backend-agent`** (Opus 4.7) is **DEV-only** (Step 3 Tech tasks). **`docs/rules.md`** R3 and protocol docs list both; **`commands/plan.md`** documents Step 0.2 dispatch without changing the default `/plan` Step 2 chain.

#### Files touched (SPEC-005)

- **`agents/entity-scaffold-agent.md`** — Sonnet 4.6, Step 0.2 manual scaffold only (`output/src/`).
- **`agents/backend-agent.md`** + **`agents/modes/{spec-driven,default}/backend.md`** — DEV-only (Step 3 Tech tasks); cross-link to entity-scaffold for 0.2.
- **`commands/plan.md`** — optional Step 0.2 → **entity-scaffold-agent**.
- **`docs/rules.md`** R3, **`docs/agent-model-map.md`**, **`docs/pipeline-overview.md`**, **`docs/protocol/agent-roles.md`**, **`README.md`**, **`agents/db-agent.md`** footer chain, **`.cursor/rules/planr-pipeline.mdc`**, **`.cursor/rules/agents/backend-agent.md`**, new **`.cursor/rules/agents/entity-scaffold-agent.md`**, **`.claude-plugin/plugin.json`**.

### Changed — Split `commands/plan.md` into procedures (SPEC-003)

`commands/plan.md` is a thin orchestrator (≤100 lines plus the immutable five-strategy matrix table bound to orchestration). PO Phase sequencing lives in `${CLAUDE_PLUGIN_ROOT}/procedures/plan-step0-preflight.md`, `plan-step1-mode-and-spec.md`, and `plan-steps-2-through-completion.md`, alongside the existing `strategy-*.md`, `stage-design-assets.md`, and `restore-design-assets.md` procedures. Behaviour is intentionally unchanged versus the inlined v0.7.3 prose; conformance remains the state verifier for PLAN+SHIP workflows.

Project root `input/tech/stack.md` now declares `schemaVersion: "1.0.0"` so schema validation exits clean.

#### Files touched (plan split / SPEC-003)

- Thin `commands/plan.md` plus new `procedures/plan-step0-preflight.md`, `plan-step1-mode-and-spec.md`, `plan-steps-2-through-completion.md`.
- Existing `strategy-*.md`, `stage-design-assets.md`, `restore-design-assets.md` procedure files finalized as authoritative strategy bodies extricated from `/plan`.

### Added — Run manifest + per-task error reports (SPEC-008)

`/planr-pipeline:ship` now appends a JSONL audit trail to `<SPEC_DIR>/.run-manifest.jsonl` (spec-driven) or `output/feats/feat-{slug}/.run-manifest.jsonl` (default). One record per orchestration boundary — `ship.bootstrap`, `ship.phase1`, `ship.task:T-NNN`, `qa-gate`, `devops-bundle`, `doc-gen-bundle`, `snapshot`, `marker-write` — with `started_at`, `ended_at`, `files_written`, `files_modified`, `exit_status`, `error_summary`, optional `cost_hint`. Manifest validates against `schemas/v1.0.0/run-manifest.schema.json` (additionalProperties: false, ISO-8601 timestamps).

Per-task R6 failures now write to `<SPEC_DIR>/tasks/T-NNN-error-report.md` (matching the YAML `id` field) — never the legacy singleton `tasks/error-report.md`. `qa-agent` reads per-task reports by ID; `templates/error-report.md` documents the convention as canonical.

`/planr-pipeline:status` reads the manifest when present and surfaces per-stage timing + cost cues. The manifest is git-ignored by default (`*.run-manifest.jsonl` in `.gitignore`).

#### Files touched (SPEC-008)

- `commands/ship.md` — Step 1.6 binds manifest path; emission contract documented.
- `schemas/v1.0.0/run-manifest.schema.json` — JSON Schema draft 2020-12.
- `agents/{frontend,backend,qa}-agent.md` + `templates/error-report.md` — per-task error filename convention.
- `commands/plan.md` (status command) — manifest read + timing surface.
- `.gitignore` — `*.run-manifest.jsonl`.

### Added — Task status state machine + cross-runtime resume

T-task frontmatter now carries a `status` field with enum `pending | in-progress | done | blocked` (validated by `schemas/v1.0.0/task.schema.json`). `/ship` Step 2 reads each task's status on entry, partitions the queue, and writes status updates inline as the pipeline progresses:

- `done` → skip (already shipped)
- `pending` → enqueue (fresh)
- `in-progress` → enqueue + recover (prior run crashed mid-task)
- `blocked` → enqueue + retry (prior R6 wrote `T-NNN-error-report.md`; new attempt re-reads it)

Before dispatch: status flips to `in-progress` + `updated:` bumped. On success: `done`. On R6 failure: `blocked` with companion error report.

This is the foundation for **resume semantics across invocations, sessions, machines, and runtimes**: re-running `/ship` on the same spec naturally picks up where the prior run left off — the source of truth is the task file frontmatter, not the orchestrator's memory.

### Added — Runtime adapter detection + per-task dispatch mode (`DISPATCH_MODE`)

`/ship` Step 1.7 binds `RUNTIME` from the environment:

- `claude-code` — `${CLAUDE_PLUGIN_ROOT}` resolves
- `cursor` — `.cursor/rules/planr-pipeline.mdc` exists at project root
- `codex` — `AGENTS.md` at root contains `## Planr Pipeline Orchestration`
- `unknown` — none of the above

`/ship` Step 1.8 selects `DISPATCH_MODE` accordingly:

| Runtime | Default `DISPATCH_MODE` |
|---|---|
| `claude-code` | `multi-task` (manifest-isolated subagents per task — no cumulative-context bias) |
| `cursor` / `codex` | `per-task` (one task per invocation; the Composer/persona session can't safely isolate per-task context across many tasks) |

In `per-task` mode, `/ship` dispatches one task (oldest `pending`, otherwise oldest `blocked`), closes its status to `done` or `blocked`, and prints:

```
⏸ Task T-NNN dispatched (success | blocked).
  Remaining: N task(s) {pending: A, blocked: B}.
  Run /planr-pipeline:ship {slug} again to continue.
```

The user re-invokes per task. The status field on each T-task naturally encodes "where to continue" without any state outside the spec directory.

**Override:** `--all-tasks` forces `multi-task` regardless of runtime (advanced — only when the runtime supports isolated subagents).

**Why this fix exists:** v0.7.x users on Cursor reported `/ship` producing a status rollup instead of generating code on partially-shipped specs. Root cause: Cursor's Composer is one continuous session — without per-task fresh invocation, prior tasks' context biased the model toward "this looks already shipped." The runtime-aware default is the architectural cure.

#### Files touched (status + dispatch)

- `commands/ship.md` — new Steps 1.7 (`RUNTIME`), 1.8 (`DISPATCH_MODE`), restructured Step 2 (status-aware queue + dispatch loop + status state machine).
- `agents/{frontend,backend}-agent.md` — task isolation contract pushes back on cumulative-context bias ("you see ONE task spec, do not write status rollups, generate code not commentary").
- `docs/compatibility-matrix.md` — new capability rows + dispatch-mode caveat section.

### Migration

None. No user action required. Existing projects continue to work in whichever mode they were using.

T-task files written by older specification-agent runs that lack the `status` field will be treated as `pending` on first read in v0.8.0. The pipeline will not retroactively rewrite them — author your migration via `planr task status set <T-NNN> <state>` if you want explicit state, or just let `/ship` write the field on next dispatch.

### Pairs with

- `openplanr` (planr CLI) v1.5.2 — unchanged
- `openplanr-skills` v1.4.0 — unchanged
- `marketplace` pin — bumped to v0.8.0 in a follow-on PR

## [0.7.3] — 2026-05-02

### Fixed — Pipeline cannot silently abandon mid-execution

A real greenfield smoke test on v0.7.2 exposed three classes of bug:

1. **Mid-task abandonment.** After the scaffolder ran (and surfaced an asset-folder conflict), the pipeline silently exited without continuing to bootstrap, spec authoring, or subagent dispatch. The user was left with a Next.js project but no `.planr/`, no spec, no PO Phase agents fired.
2. **Pre-existing design assets blocking the scaffolder.** A user-staged `Designs/` folder in the project root caused `create-next-app .` to refuse the directory.
3. **Silent path-expansion fallback.** `~/Designs/foo.png` from BRIEF, when not found at `$HOME`, fell back to project-local `Designs/` — which is what created the scaffolder block in the first place.

### Changed — Orchestration Contract + per-phase verification gates

The command now opens with a mandatory **Orchestration Contract** that names exactly four phases (A: Pre-flight, B: Mode + spec body, C: Subagent dispatch, D: R1 stop) and enforces:

- **TodoWrite is mandatory** at the start of execution. Phase progress is tracked as 4 todo items; each is checked complete only after on-disk verification.
- **You are NOT done when a Bash command succeeds.** Bash success is a step result, not a phase result. The model is explicitly instructed to return to the strategy and continue with the next sub-step.
- **Per-phase verification gates** between Step 0 → Step 1, Step 1 → Step 2, Step 2 → Step 3. Each gate enumerates required on-disk outputs.
- **A Completion Contract** at Step 3 with bootstrap / spec / decomposition / subagent-dispatch / stash-cleanup checkboxes. The model cannot print success unless every checkbox passes.

### Added — Designed asset stash (`STAGE_DESIGN_ASSETS` / `RESTORE_DESIGN_ASSETS`)

`SCAFFOLD_NODE` now has an explicit pair of common procedures (Steps 0.9 and 0.10) that:

- Detect known design-asset patterns at the project root (`Designs/`, `design/`, `mockups/`, `assets/`, `wireframes/`, top-level `*.png|jpg|jpeg|svg|gif|webp`)
- Move them to `/tmp/planr-pipeline-stash/<slug>-<unix-ts>/` before the scaffolder runs
- Copy them into `<SPEC_DIR>/design/` after Step 1 creates the spec design folder
- Delete the stash dir after restore-and-verify

If the project root contains files outside the recognized patterns, the strategy aborts with a clear message asking the user to clean the directory. The pipeline does NOT improvise around unknown files — and the `/tmp` stash is no longer an emergent recovery, it's a designed step the user can audit.

On scaffolder failure between stage and restore, the recovery flow moves the stash back to its original location for clean rollback (no half-state).

### Changed — Path expansion is fail-fast, not silent-fallback

When a path from BRIEF (e.g., `~/Designs/inbox.png`) doesn't resolve to an existing file after `$HOME` expansion, the command now logs a clear warning and continues — it does NOT silently fall back to a project-local path. Silent fallback is what created the scaffolder-block bug; loud warning is product-grade.

### Added — `$ARGUMENTS` sanitization (Step 0.0)

Defensive check before any other processing:

- `$ARGUMENTS` exceeding 5,000 chars → abort (prior conversation likely got pasted in)
- `$ARGUMENTS` containing literal `/planr-pipeline:` → abort (nested invocation paste)
- `$ARGUMENTS` empty → abort with usage hint

These cost nothing on normal invocations and prevent the "wall of nested narrative" rendering observed when a user pasted prior conversation content into the slash command.

### Migration

None. v0.7.0 / v0.7.1 / v0.7.2 invocations behave identically — the new contract + gates are additive checks the model runs internally. Existing planr projects (with `.planr/` already present) hit the `CONTINUE` strategy and skip Step 0 entirely.

### Pairs with

- `openplanr` (planr CLI) v1.5.2 — unchanged
- `openplanr-skills` v1.4.0 — unchanged
- `marketplace` pin — bumped to v0.7.3 in a follow-on PR

## [0.7.2] — 2026-05-01

### Changed — Step 0 redesigned as a state machine

`commands/plan.md` Step 0 is rewritten from an imperative six-substep sequence (v0.7.1) into a state machine. Detect once, pick exactly one strategy from a five-row decision matrix, execute that strategy as a clean linear sequence.

**Why:** v0.7.1's imperative ordering bootstrapped `.planr/` and `input/tech/` *before* asking the user "scaffold first?". On consent, `npx create-next-app .` then refused to run because the directory was no longer empty. The orchestrator was observed to recover by improvising a `mv to /tmp` stash on a real greenfield run — clever, but bad UX (scary, fragile). The plugin should never put the model in a position where it has to improvise around a contradiction.

**The five strategies:**

| `HAS_PLANR` | `HAS_PACKAGE_JSON` | `BRIEF_STACK` | Strategy |
|---|---|---|---|
| ✅ | any | any | `CONTINUE` — skip Step 0, go to Step 1 |
| ❌ | ✅ | any | `BOOTSTRAP_ONLY` — write `.planr/` on top of existing project |
| ❌ | ❌ | `node` | `SCAFFOLD_NODE` — identify framework from BRIEF, run its canonical scaffolder, then bootstrap `.planr/` on top |
| ❌ | ❌ | `non-node` | `ASK_MANUAL` — clear instructions to scaffold + re-run |
| ❌ | ❌ | `none` | `ASK_STACK` — clear instructions to declare a stack |

`SCAFFOLD_NODE` is **framework-agnostic within the Node ecosystem.** It supports Next.js, NestJS, Vite (React/Vue/Svelte/Solid/Lit), Nuxt, Astro, Remix, SvelteKit, Hono, SolidStart, Fastify, Express, and any other Node framework the model identifies from BRIEF. The scaffolder command isn't hardcoded — the strategy documents the supported set + common defaults (TypeScript, no-git, npm), and the model picks the right canonical CLI for the framework BRIEF declares.

### Removed

- The "scaffold first?" consent prompt. When `BRIEF` declares a Node stack and the directory is empty, the intent is unambiguous; the system acts on it. Press Esc to abort during the announce phase.
- The `/tmp` stash improvisation path. Structurally impossible now — `create-next-app .` runs first in an empty dir, before any planr files are written.

### Added

- Common procedures `WRITE_PLANR_DIRS` and `AUTHOR_STACK_FROM_BRIEF` factored out as their own subsections, reused by `BOOTSTRAP_ONLY` and `SCAFFOLD_NODE`. Clean code, no duplication.
- Explicit `BRIEF_STACK` keyword classification table (Node / non-Node / none). Documented and easy to extend in a future patch.

### Migration

None. v0.7.1 invocations continue to work — the state machine subsumes the same behaviors with cleaner ordering. Existing planr projects (with `.planr/config.json` already written) hit `CONTINUE` and skip Step 0 entirely, identical to v0.7.0/v0.7.1's CONTINUE path.

### Pairs with

- `openplanr` (planr CLI) v1.5.2 — unchanged
- `openplanr-skills` v1.4.0 — unchanged
- `marketplace` pin — bumped to v0.7.2 in a follow-on PR

## [0.7.1] — 2026-05-01

### Added — Greenfield bootstrap, brief interpretation, plan-mode awareness, path expansion

`/planr-pipeline:plan` now works on greenfield directories with a single natural-language brief in `$ARGUMENTS`. Four improvements, all in a new **Step 0 — Pre-flight** block (runs before mode detection + input validation):

#### 0a — Brief interpretation

`$ARGUMENTS` accepts two shapes:

1. Slug only: `support-inbox`
2. Slug + brief: `support-inbox\n\nAI-augmented customer support inbox.\nTickets auto-classified by Claude (budget cap + retry).\nStack: Next.js + Prisma + Postgres + Redis.\nMockups: ~/Designs/inbox-list.png`

When a brief is present, the auto-scaffolded SPEC body is populated from the brief content (substantive Context, Functional Requirements, Business Rules, Acceptance Criteria) instead of leaving template placeholder TODOs. The pipeline then continues straight through to subagent dispatch — no second invocation needed.

#### 0b — Path expansion (universal)

`~/foo` and `~user/foo` are expanded to absolute paths via `$HOME`. Bare relative paths resolve against the project root (working directory), not `${CLAUDE_PLUGIN_ROOT}`. Fallback to unexpanded form if expansion misses. Applied in:

- `commands/plan.md` Step 0b
- `agents/designer-agent.md` PNG resolution (now also reads `<SPEC_DIR>/design/*.png` as a first-class source)

Closes the `~/Designs/` path resolution issue users hit on greenfield projects.

#### 0c — Plan Mode awareness

When the user's Claude Code session is in **Plan Mode** (read-only research mode), the pipeline writes a markdown plan describing what it WOULD do — without bootstrapping directories, scaffolding the spec, or dispatching subagents. Ends with: *"Plan mode is active. Exit Plan Mode and re-run to execute."*

#### 0d — Greenfield directory bootstrap

When `.planr/config.json` is missing, the pipeline writes a minimal config (deriving `projectName` from `package.json#name` or the directory basename) and creates `.planr/specs/` + `input/tech/` directories. No more "no `.planr/`, no DB" failures on first run.

#### 0e — Greenfield Node project ask (CONDITIONAL)

When `package.json` is missing AND the brief implies a Node-based stack, the pipeline **asks the user explicitly** before scaffolding:

> ⚠ Greenfield directory detected. Reply "scaffold first" to bootstrap the project + dependencies, OR run create-next-app yourself and re-run.

On `scaffold first`, the pipeline runs `create-next-app`, `npm install` for declared deps, and `prisma init` — then continues to PO Phase. No surprise scaffolds without consent.

#### 0f — Stack inference from brief

When `input/tech/stack.md` is missing AND the brief mentions stack components (Next.js, Prisma, Postgres, Redis, Anthropic SDK, Vitest, etc.), the pipeline auto-authors `stack.md` from the template populated with the brief's hints. Falls back to existing self-heal (template + abort) when the brief is empty or stack-less.

### Migration

None. Existing v0.7.0 invocations (slug-only `$ARGUMENTS`, pre-existing `.planr/`) work identically. The new behaviors only fire on missing inputs or natural-language briefs.

### Pairs with

- `openplanr` (planr CLI) v1.5.1+ — unchanged
- `openplanr-skills` v1.4.0 — unchanged
- `marketplace` pin — no update needed (uses tag, not specific commit)

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
