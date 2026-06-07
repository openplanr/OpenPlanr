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

### TodoWrite is mandatory

At the start, create a TodoWrite list with these 4 items, and mark each `in_progress`
before / `completed` after on-disk verification:

1. `Phase A — Preflight (mode + context + lock)`
2. `Phase B — Clarify (source + format) [or: flags → skipped]`
3. `Phase C — Generate artifact + finalized.json`
4. `Phase D — Author design-spec.md + STOP (handoff)`

On `--dry-run`, mark item 1 `completed`, items 2–4 `cancelled` (`dry-run exit`).

---

## Step A — Preflight

**Execute** `${CLAUDE_PLUGIN_ROOT}/procedures/design-step0-preflight.md`. It:
- binds `MODE` / `SPEC_DIR` via `mode-detection.md`, and `DESIGN_DIR` (see the path table
  there: `<SPEC_DIR>/design/` spec-driven, `output/feats/feat-${SLUG}/design/` default);
- resolves the **screen list** from the spec (`lib/design/screens.mjs` rules) and any
  existing PNGs / prior generated design (for the evolve-vs-replace + precedence branches);
- acquires the advisory `<SPEC_DIR>/.lock` (SPEC-015 finding E1 — no two `/design` runs
  clobber `design/`);
- on `--dry-run`, prints the resolved plan + recommended format and STOPs.

If the spec resolves **0 screens** and `--from` is not `describe`: abort (thin spec) with a
two-line `Repair:` pointing the user to add a Screens section or pass `--from describe`
(SPEC-015 finding E3 — never fabricate screens).

## Step B — Clarify (skipped when `--format` AND `--from` are both set)

**Execute** `${CLAUDE_PLUGIN_ROOT}/procedures/design-step1-clarify.md`. It asks, via
`AskUserQuestion`, **source first, then format**, with the **recommended format
pre-selected** from the screen count (`lib/design/recommendFormat.mjs`:
`0–2 → prototype · 3+ linear → walkthrough · 3+ exploratory → canvas`), shown with a
one-line "why". Options are outcome-labeled, not jargon. On re-run over an existing
`design/`, it offers **Evolve / Replace / Cancel** (default Evolve, preserving
`.design-canvas.state.json` layout). When both flags are supplied, this whole step is a
no-op and the flag values are used verbatim.

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
