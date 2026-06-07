---
description: Generate a visual design (prototype | walkthrough | canvas) + design-spec.md for a feature, BEFORE decomposition
argument-hint: <slug> [--format prototype|walkthrough|canvas] [--from spec|png|describe] [--yes] [--dry-run]
---

# /planr-pipeline:design {feature-name}

Generates a visual design artifact for `{slug}` **and** authors `design-spec.md`, so the
PO Phase decomposes real UI tasks. Run this **before** `/planr-pipeline:plan` — it is a
standalone command, not a step inside `/plan` (SPEC-015 finding A1). It never auto-chains
to `/plan` or `/ship`.

Three formats, one shared core:

| Format | What it is | Substrate |
|--------|-----------|-----------|
| **prototype** | one interactive, self-contained screen | vanilla + Pretext |
| **walkthrough** | multi-screen gallery, grouped sidebar (anchor ≤8 / lazy >8 screens) | vanilla + Pretext |
| **canvas** | Figma-like pan/zoom board of artboards (export + view-only) | vendored React |

**Flags**
- `--format` / `--from` — when **both** are supplied, the clarification prompt (Phase B) is
  **skipped** entirely → fully non-interactive (CI/headless), exactly like `/ship --yes`.
- `--yes` — auto-confirm overwrite/extract decisions (assume the recommended branch).
- `--dry-run` — resolve mode + design context + the recommended format, print the plan, and
  **STOP** (no generation, no writes). Fatal errors obey `fatal-error-format.md` (two lines).

**This command NEVER auto-chains.** It stops after writing the artifact + `design-spec.md`.
A human reviews, then runs `/planr-pipeline:plan {slug}`. Enforced by
`${CLAUDE_PLUGIN_ROOT}/docs/rules.md` R1 (and the new design clause).

---

## ORCHESTRATION CONTRACT (read this first, mandatory)

This command has **EXACTLY** these phases, in order:

| Phase | Purpose | Outputs |
|---|---|---|
| **A — Preflight** | Bind mode, resolve design context + screen list, acquire `.lock` | `MODE`, `DESIGN_DIR`, screen list, `<SPEC_DIR>/.lock` |
| **B — Clarify** | (skipped if `--format`+`--from`) ask source → format with a recommended default | resolved `{source, format}` |
| **C — Generate** | Orchestrator step: render the artifact, escape all spec text, write `finalized.json`, copy `vendor/` | `<DESIGN_DIR>/finalized.html` (or `canvas.html`+`DesignCanvas.js`), `finalized.json` |
| **D — Spec + stop** | Author `design-spec.md` (one writer per run), STOP (R1), handoff summary | `design-spec.md`, console handoff |

### Termination rule

You are done ONLY when Phase D's **Completion Contract** (in
`${CLAUDE_PLUGIN_ROOT}/procedures/design-step3-spec-and-handoff.md`) is satisfied — the
artifact, `finalized.json`, copied runtime, and `design-spec.md` all verified on disk, the
`.lock` released, and the handoff printed. A successful Bash/Write is a step, not the phase.

If any phase cannot complete, **release the `.lock`** and abort via `fatal-error-format.md`
(two lines). Do not print success. Do not auto-chain.

### Task tracking

At the start, track these 4 phases with your runtime's task tool, marking each
`in_progress` before / `completed` after on-disk verification of its outputs:

1. `Phase A — Preflight (mode + context + lock)`
2. `Phase B — Clarify (source + format) [or: flags → skipped]`
3. `Phase C — Generate artifact + finalized.json`
4. `Phase D — Author design-spec.md + STOP (handoff)`

Use the current Claude Code task tools (**`TaskCreate`** one per phase, **`TaskUpdate`**
to advance status). On Claude Code **< 2.1.142** the tool is `TodoWrite` (deprecated and
disabled by default in 2.1.142+); on Cursor/Codex or any runtime without a task tool,
track the phases inline in your responses. The tracker is a progress aid only — never
skip a phase's on-disk verification because no task tool is available. On `--dry-run`,
mark item 1 done and items 2–4 cancelled (`dry-run exit`).

---

## Step A — Preflight

**Execute** `${CLAUDE_PLUGIN_ROOT}/procedures/design-step0-preflight.md`. It:
- binds `MODE` / `SPEC_DIR` via `mode-detection.md`, and `DESIGN_DIR` (see the path table
  there: `<SPEC_DIR>/design/` spec-driven, `output/feats/feat-${SLUG}/design/` default);
- **no spec for `<slug>` (spec-driven)** → a **mandatory `AskUserQuestion`** (v0.14.0):
  **Create a spec** (`SPEC-NNN-<slug>`) · **Standalone exploration** (into
  `.planr/designs/<slug>/`, no tracked spec) · **Cancel**. Never silently scaffold a spec
  (the prior bug) and never silently abort; `--yes` assumes standalone, never auto-creates a spec;
- resolves the **screen list** from the spec (`lib/design/screens.mjs` rules) and any
  existing PNGs / prior generated design (for the evolve-vs-replace + precedence branches);
- resolves **`APP_CTX`** (v0.15.1) — reads the project's **app shell**, **design tokens**,
  **component library**, 1–2 **reference screens**, and the **real desktop viewport width**
  (`VIEWPORT_W`, default 1440) **once, up front**, so generation is grounded in bound values
  instead of re-deriving them late (the old canvas-came-out-1320×860 bug);
- acquires the advisory `<DESIGN_DIR>/../.lock` (SPEC-015 finding E1 — no two `/design` runs
  clobber the design dir);
- on `--dry-run`, prints the resolved plan + recommended format and STOPs.

**Thin spec (0 screens resolved)** is **not a dead-end** (v0.13.1). Preflight calls
`lib/design/interactivity.mjs` `decideThinSpec`: an **interactive** run continues with
`THIN_SPEC = true` so Phase B (§ B.0.5) *asks* the user how to source the screens
(derive-from-spec / use an existing design doc like `design/ux-flows.md` / add a
`## Screens` section / cancel). Only a **headless** run (both `--format` and `--from` set,
source not `describe`) aborts with a two-line `Repair:` — it can't prompt. Either way the
generator never fabricates a screen list silently (SPEC-015 finding F8/E3).

## Step B — Clarify (skipped only when `--format` AND `--from` are both set)

**Execute** `${CLAUDE_PLUGIN_ROOT}/procedures/design-step1-clarify.md`. When the relevant
flag is absent, Phase B is a **mandatory `AskUserQuestion` tool call**, not a prose decision:
it asks **source first, then format**, with the **recommended format pre-selected** from the
screen count (`0–2 → prototype · 3+ linear → walkthrough · 3+ exploratory → canvas`), shown
with a one-line "why". Outcome-labeled options, not jargon. On re-run over an existing
`design/` it offers **Evolve / Replace / Cancel** (default Evolve).

> **Do NOT auto-decide source/format from the brief and skip the prompt.** An explicit
> brief is *content*, not the user's format/source choice — writing "proceeding without
> further questions since the brief is explicit" is a violation. The prompt is skipped only
> when both `--format` and `--from` are supplied, or `--yes` assumes that question's stated
> default (say which). If no `AskUserQuestion` tool is callable, STOP and report
> `BLOCKED — AskUserQuestion unavailable` — never silently default. (See the procedure's
> "B — Enforcement" block.)

## Step C — Generate

**Execute** `${CLAUDE_PLUGIN_ROOT}/procedures/design-step2-generate.md`. Orchestrator step
(not a subagent): it loads the format's shell from `templates/design/`, fills the
`GENERATOR:*` markers with realistic content derived from the spec, **escapes every
spec-derived string** (`lib/design/escape.mjs` — `escapeHtml` / `embedJson`, SPEC-015 S1),
writes the artifact to a temp name then moves it on completion, writes `finalized.json`
(`lib/design/manifest.mjs`, validated against `schemas/v1.0.0/design-manifest.schema.json`),
and copies the needed `templates/design/vendor/` files alongside the artifact.

## Step D — design-spec.md + Completion Contract + STOP

**Execute** `${CLAUDE_PLUGIN_ROOT}/procedures/design-step3-spec-and-handoff.md`. It authors
`design-spec.md` from the **shared 10-section template**
(`agents/modes/shared/design-spec-template.md`) using **one-writer precedence** (SPEC-015
E2: if PNGs exist, leave `design-spec.md` to `designer-agent` and only produce the visual
artifact; otherwise author it directly from the brief, never by re-reading pixels). It sets
`content_provenance` (`spec` vs `inferred`), releases the `.lock`, verifies the Completion
Contract, prints the **handoff** (clickable `file://` paths, the chosen format + why, and
the one next command `/planr-pipeline:plan {slug}`), and **STOPS** (R1).

---

### Procedure index (thin orchestrator)

| Piece | Procedure file |
|---|---|
| Preflight + lock + context | `procedures/design-step0-preflight.md` |
| Clarify (recommendation rule, evolve/replace) | `procedures/design-step1-clarify.md` |
| Generate (shell fill, escape, manifest, vendor) | `procedures/design-step2-generate.md` |
| Spec + handoff + STOP | `procedures/design-step3-spec-and-handoff.md` |
| Mode detection (shared) | `procedures/mode-detection.md` |
| Fatal UX | `procedures/fatal-error-format.md` |
| Shared spec template | `agents/modes/shared/design-spec-template.md` |
| Tested helpers | `lib/design/` (escape, recommendFormat, screens, walkthroughNav, manifest) |

---

*Reads: spec body, existing PNGs, `input/tech/stack.md`, `DESIGN.md` (if present).*  
*Writes (spec-driven): `<SPEC_DIR>/design/{finalized.html|canvas.html, finalized.json, vendor/, design-spec.md}`.*  
*Writes (default): `output/feats/feat-{slug}/design/{artifact, finalized.json, vendor/}` + `output/feats/feat-{slug}/design-spec.md`.*  
*Does NOT chain to `/plan` or `/ship` — stops for human review (`${CLAUDE_PLUGIN_ROOT}/docs/rules.md` R1).*
