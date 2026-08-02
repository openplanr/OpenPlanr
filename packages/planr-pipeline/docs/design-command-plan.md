# Plan — `/planr-pipeline:design` : design generation phase + missing-design clarification

> Rough plan for review via `/autoplan`. Target: planr-pipeline v0.13.0 (SPEC-015).
> Status: DRAFT — pre-review.

## Problem

planr-pipeline's `designer-agent` only does **inward extraction**: it reads PNG
mockups and writes a 10-section `design-spec.md` (vision, Sonnet, tools `Read, Glob,
Write`). It is conditional — if zero PNGs resolve for a feature, it **skips silently**.
Downstream, `specification-agent` then emits **1 Tech task per User Story** (no UI
task, per R2), and `/ship` builds a backend with no frontend and no visual artifact.

Two concrete failures:
1. **No way to generate a design.** A user with a brief/spec but no mockups cannot get
   a design out of the pipeline at all. The factory has an importer but no studio.
2. **No prompt that offers one.** Nothing detects "this feature has UI intent but no
   design" and offers to make one. The skip is silent, so users don't discover the gap
   until they notice `/ship` produced backend-only code.

The reference design skill (`design-html`) solves the inverse direction (brief/plan → production HTML) and
uses an `AskUserQuestion` routing flow (Step 0 Cases A/B/C) to decide what to build.
planr-pipeline has no equivalent.

## Goals

1. Add a **design generation** capability to planr-pipeline: brief/spec → visual design
   artifact, mirroring `design-html`'s proven flow.
2. A **clarification-driven format choice** when a design is needed, offering three
   kinds:
   - **Prototype** — one interactive, self-contained Pretext-native HTML screen.
   - **Walkthrough** — multi-screen gallery, sidebar/tab navigation (anchor-scroll:
     app-bar + grouped sidebar + browser-chrome screen frames).
   - **Canvas** — Figma-like pan/zoom infinite canvas of artboards grouped in sections
     (the provided `DesignCanvas.jsx`: reorder, rename, focus overlay, PNG/HTML export).
3. A **missing-design nudge**: when `/plan` (or the new command) detects UI intent but
   no design, surface an `AskUserQuestion` that offers to generate one (or skip / accept
   PNGs) — the "agent suggests, then triggers the flow" behavior.
4. **Close the loop**: the generated design feeds the existing extraction path so
   `design-spec.md` is produced and `specification-agent` emits UI tasks. No-design →
   designed → UI tasks flow, instead of silently degrading to Tech-only.

## Non-goals

- Not replacing `designer-agent` (extraction stays).
- Not auto-chaining `/plan → /design → /ship` (R1 stands; design is its own gate with a
  human review point).
- Not a live WYSIWYG editor. Canvas editing/persistence requires a host bridge
  (`window.__canvasHost`); without it the canvas is view + client-side reorder only.
- Not building a Pretext fork. We vendor the existing `pretext.js` (already 30KB, used
  by `design-html`).

## Proposed architecture

### New command: `commands/design.md` → `/planr-pipeline:design <slug> [--format ...] [--from ...]`

Interactive orchestrator (runs in main thread, so it *can* call `AskUserQuestion` —
agents are headless and cannot). Phases:

- **Phase A — Preflight**: bind MODE + SPEC_DIR/FEAT_DIR via existing
  `procedures/mode-detection.md`. Resolve the feature's design context: existing PNGs,
  prior generated design (`design/finalized.html`), `design-spec.md`, the spec body.
- **Phase B — Source + format clarification** (`AskUserQuestion`, decision-brief
  format): mirror `design-html` Step 0/1:
  - *Source*: from the spec/brief (plan-driven) · from existing PNGs (extract-first) ·
    freeform description.
  - *Format*: Prototype · Walkthrough · Canvas.
- **Phase C — Dispatch `design-gen-agent`** with `{format, source, screen list,
  out_dir}`. Agent generates the artifact(s) + metadata + copies the vendored runtime.
- **Phase D — Extract + stop**: optionally chain the existing `designer-agent` to read
  the generated HTML and write `design-spec.md` (so UI tasks become available), then
  STOP for human review (R1). Print summary + next step (`/planr-pipeline:plan` to
  re-decompose with the new design, or `/ship`).

### New agent: `agents/design-gen-agent.md` (+ `agents/modes/{default,spec-driven}/design-gen.md`)

- Direction: **outward** (spec/brief → HTML/canvas). Distinct job from `designer-agent`
  (inward). Tools: `Read, Glob, Grep, Write, Edit` (+ maybe `Bash(npx:*)` only if a
  framework build is requested; default vanilla = no Bash).
- Model: generation is large-artifact code work → **Opus 4.8** (matches frontend-agent),
  pending review (could be Sonnet for cost).
- Reads the chosen format's template/runtime from the plugin, generates realistic
  content (never lorem), writes the artifact + `finalized.json`, copies the runtime
  alongside.

### Vendored assets (mirror `design-html/vendor/pretext.js`)

- `templates/design/pretext.js` — copied for Prototype + Walkthrough output.
- `templates/design/DesignCanvas.jsx` — copied for Canvas output (the provided file).
- `templates/design/walkthrough-shell.html` — gallery chrome reference (anchor-gallery style).
- `templates/design/canvas-shell.html` — boots React + `DesignCanvas` + the artboards.

### Artifact contract

Spec-driven: `.planr/specs/SPEC-NNN-{slug}/design/`
Default: `output/feats/feat-{slug}/design/`

```
design/
  finalized.html              # prototype OR walkthrough gallery
  canvas.html + DesignCanvas.jsx + .design-canvas.state.json   # canvas mode
  pretext.js                  # vendored runtime (prototype/walkthrough)
  finalized.json              # metadata: format, source, screens[], iterations, date, branch
  design-spec.md              # extracted by designer-agent from the generated HTML
```

`finalized.json` extends the `design-html` shape with a `format` field
(`prototype|walkthrough|canvas`).

### `/plan` integration — the nudge

In `procedures/plan-step1-mode-and-spec.md` (or a new `procedures/design-detect.md`),
after input validation: if the feature shows UI intent (spec has Screens/UIFiles, or
keywords) but no design context resolves, emit an `AskUserQuestion`:

> No design found for FEAT-X, but it looks UI-facing. Generate one now?
> A) Prototype  B) Walkthrough  C) Canvas  D) Skip — Tech-only tasks  E) I'll add PNGs

A/B/C → run the `/design` flow inline, then continue planning with the new design.
D → current behavior. E → pause for the user to stage PNGs.

## Schema / rules / docs touchpoints

- `schemas/v1.0.0/` — add `design-manifest.schema.json` (validates `finalized.json`).
- `docs/rules.md` — add a rule: design generation never auto-chains into `/ship`
  (extends R1); generated artifacts are advisory inputs, human-reviewable.
- `docs/pipeline-overview.md` — document the optional design sub-phase.
- `plugin.json` — bump to 0.13.0. `CHANGELOG.md` entry. New `.planr/specs/SPEC-015-*`.

## Rough task breakdown (pre-review, will be re-decomposed)

1. Vendor assets into `templates/design/` (pretext.js, DesignCanvas.jsx, shells).
2. `agents/design-gen-agent.md` + mode files (default + spec-driven).
3. `commands/design.md` orchestrator (Phases A–D) + `procedures/design-*.md`.
4. `/plan` missing-design nudge (`AskUserQuestion`) + detection procedure.
5. `design-manifest.schema.json` + `finalized.json` writer.
6. Loop-closing: `designer-agent` reads generated HTML → `design-spec.md`.
7. Docs + rules + version bump + SPEC-015 authoring + conformance test.

## Risks / open decisions (for the review gauntlet)

- **New agent vs extend `designer-agent`?** Generation ≠ extraction (opposite data
  direction, different tools, no vision). Leaning new agent for separation of concerns.
- **Canvas persistence** depends on a host bridge not present in a plain file open.
  Acceptable degraded mode (view + reorder, writes no-op)? Document clearly.
- **Where the format choice lives**: only in `/design`, or also nudged from `/plan`?
  Leaning both.
- **Model for `design-gen-agent`**: Opus (quality) vs Sonnet (cost).
- **Walkthrough "tabs" vs sidebar-anchor**: the anchor pattern is sidebar + smooth-scroll
  anchors; "tabs" may mean true tab-switching. Confirm the interaction.
- **React dependency for canvas**: shell loads React via CDN (self-contained) vs project
  bundler. Leaning CDN for zero-setup preview.

---

# REVIEW REPORT — /autoplan

> **Voices: subagent-only this run.** Codex CLI is authenticated but its realtime
> websocket endpoint (`wss://chatgpt.com/backend-api/codex/responses`) is unreachable in
> this environment (DNS/socket failures during the call). Every phase below runs with an
> independent Claude subagent + primary review; the Codex column is `[codex-unavailable]`.
> Surfaced at the final gate.

## Phase 1 — CEO Review (Strategy & Scope) · mode: SELECTIVE EXPANSION

### 0A. Premise Challenge

| # | Premise (stated/assumed) | Verdict |
|---|--------------------------|---------|
| P1 | A spec-to-code factory should *generate visual design artifacts*, not just better specs. | **Hold, with reframe.** User-explicit (prototype/walkthrough/canvas requested). But the artifact is decorative unless it also yields machine-readable design intent that `/ship` consumes. Keep generation; make the spec a first-class co-output, not a pixel re-extraction. |
| P2 | All three formats (prototype/walkthrough/canvas) are worth building. | **User-explicit; not auto-cut.** CEO voice argues for one (F2/F9). Conflicts with the user's stated surfaces and the standing "don't remove user surfaces for code simplicity" preference. → final-gate taste decision, default = keep all three on shared core. |
| P3 | A new `design-gen-agent` beats extending `designer-agent`. | **Challenge (F4).** Direction differs but a headless agent can't clarify; cost is R3 (model roster) + R10 (qa coverage). → eng-phase decision; budget the cost explicitly either way. |
| P4 | Design should be its own gate, run *after* `/plan`, then re-decompose. | **Wrong (F6) — auto-corrected.** Re-decomposition collides with R4 (human-edited tasks). Design must run *before* decomposition. |
| P5 | Generated content should be "realistic, never lorem." | **Guardrail needed (F8).** Ungrounded generation launders invented UI into spec authority. Must be grounded in the spec's screen list; thin spec → clarify, don't fabricate. |

Real-problem framing: the factory's gap is **design intent reaching `/ship`** so UI tasks
get built with direction. A visual artifact the user can see is valuable (review,
stakeholder buy-in, the user explicitly wants it) — but its *machine-consumable* sibling
(`design-spec.md` authored directly + UI acceptance hints) is what closes the loop. Do
both; don't substitute pixels for intent.

### 0B. Existing Code Leverage (what already exists)

- `agents/designer-agent.md` — inward extraction (PNG → `design-spec.md`). **Reuse as the
  fallback "extract from user-supplied PNGs" path**, not the primary loop-closer.
- `procedures/mode-detection.md` — MODE/SPEC_DIR binding. **Reuse verbatim** in `/design`.
- `procedures/stage-design-assets.md` / `restore-design-assets.md` — asset staging into
  `design/`. **Reuse** for placing generated artifacts + vendored runtime.
- `templates/` + `stacks/` — vendoring convention. **Reuse** for `templates/design/`.
- the reference skill's `vendor/pretext.js` (30KB) — **vendor the file, not the skill** (DRY
  the runtime; do not fork the skill logic → keeps planr-pipeline standalone, F5).
- `specification-agent` R2 — already emits a UI task when a design exists. **The whole
  point**: make a design exist so the UI task is born.

### 0C. Dream-State Mapping

```
CURRENT                         THIS PLAN (revised)              12-MONTH IDEAL
no design → designer skips  →   /design (pre-decomp):       →    brief → design intent →
→ Tech-only tasks, no UI        brief → visual artifact +        right UI, every time;
→ silent degrade                design-spec.md authored          formats are thin views
                                directly → UI tasks born         over one intent model
```
Delta: the revised plan moves *toward* the ideal (design intent precedes decomposition).
The original (post-`/plan` re-decompose) moved *away* (two conflicting decompositions).

### 0C-bis. Implementation Alternatives (MANDATORY)

```
APPROACH A — Self-contained generation phase (vendor pretext.js, author spec directly)
  Summary: /design (interactive) → design-gen authors visual artifact + design-spec.md,
           BEFORE /plan decomposes. Vendor pretext.js + canvas assets under templates/design.
  Effort: M (human ~3-4d / CC ~1 session)   Risk: Med (vendored JS maintenance)
  Pros: standalone (no third-party skill dep); single design-aware decomposition; closes loop cleanly
  Cons: owns a JS runtime + canvas asset; format breadth = real surface to maintain
  Reuses: mode-detection, stage-design-assets, designer-agent (PNG fallback), pretext.js

APPROACH B — Nudge-only, no generation (printed recommendation + accept user PNGs)
  Summary: /plan detects missing design, prints "add PNGs or run a design tool", designer
           extracts from whatever PNGs the user provides. No generation at all.
  Effort: S (human ~0.5d / CC ~15min)   Risk: Low
  Pros: tiny; zero new runtime; no R3/R10 churn
  Cons: doesn't satisfy the user ask (they want generation); leaves the gap open

APPROACH C — Shell out to an external /design-html skill
  Summary: /design invokes the external skill to produce HTML, then ingest.
  Effort: S-M   Risk: High (hard dependency on a separate product being installed)
  Pros: zero reimplementation; tracks upstream Pretext fixes
  Cons: couples a standalone plugin to an external skill; brittle across environments; no canvas/walkthrough
```
**RECOMMENDATION: Approach A**, because planr-pipeline must stand alone (P-independence)
and the user wants real generation; DRY only the runtime (vendor `pretext.js`), not the
skill (explicit over clever; reuse over fork). B is the safe floor if the gate rejects
generation; C is rejected (hard external dep on a planning plugin).

### 0D / 0E / 0F — Scope, Temporal, Mode

- **0D scope (SELECTIVE EXPANSION):** in-blast-radius + cheap → auto-accept (design-spec
  direct authoring; design-before-decomposition; printed nudge). Out-of-radius → defer
  (canvas live-edit/host bridge; framework-native component output).
- **0E temporal:** HOUR 1 — user runs `/design feat-x`, picks a format, gets an artifact +
  `design-spec.md`. HOUR 6 — `/plan` decomposes with a real UI task. WEEK 1 — does the
  vendored canvas still open standalone (writes no-op, reads OK)? MONTH 6 — has format
  count drifted, or did the shared core hold? Test: each format is a thin template over one
  generator, or it's sprawl.
- **0F mode:** SELECTIVE EXPANSION confirmed — hold the user's 3-format scope as baseline,
  surface the "start with 1" reduction as an opt-in at the gate (never silently cut).

### CEO Dual Voices — Consensus Table

```
  Dimension                              Claude-subagent   Codex          Consensus
  ────────────────────────────────────── ───────────────  ─────────────  ──────────
  1. Premises valid?                      Partly (reframe)  [unavailable]  subagent-only
  2. Right problem to solve?              Reframe to intent [unavailable]  subagent-only
  3. Scope calibration correct?          No — cut to 1     [unavailable]  → taste (user)
  4. Alternatives explored?              No — add B,C      [unavailable]  auto-added 0C-bis
  5. Competitive/market risk (reference tool)?   Yes — F5 fork     [unavailable]  addressed (vendor runtime only)
  6. 6-month trajectory sound?           Risk: canvas/JS   [unavailable]  → taste (user)
```
Single-voice run: no CONFIRMED rows (missing voice = N/A). Every subagent critical
finding is flagged regardless (F1/F2/F3 critical → carried).

### Review Sections 1–10 (real analysis, brief)

1. **Architecture** — Revised: design is a PO sub-phase before `specification-agent`, not a
   post-`/plan` re-run. New command `/design` (interactive orchestrator) + generation step.
   See ASCII graph in Phase 3.
2. **Error & Rescue** — Failure registry below. Named paths: missing-spec, thin-spec,
   vendor-missing, canvas-no-host, framework-absent.
3. **Security & Threat** — Generated HTML is static; CDN React is a supply-chain surface
   (pin + SRI, or vendor React too). No secrets, no network writes. Low surface.
4. **Data-flow edge cases** — spec with 0 screens; spec with 30 screens (gallery scale);
   user opens canvas with no host (writes must no-op silently, reads via fetch); re-running
   `/design` over an existing `design/` (evolve vs overwrite — ask, mirror design-html).
5. **Code quality / DRY** — One generator core; formats are templates. Vendor `pretext.js`
   rather than reimplement (DRY vs the reference). Don't duplicate designer-agent's extraction.
6. **Test review** — See Phase 3 test diagram. Conformance test for the new command + a
   golden `finalized.json`; R10 qa coverage for any new agent role.
7. **Observability** — `finalized.json` + `.run-manifest.jsonl` record the design stage
   (format, screens, source, duration). Stage is visible in `/status`.
8. **Performance** — generation is one-shot; gallery HTML can get large (24+ screens) —
   stream/section it; canvas pan/zoom already 60fps in the provided JSX.
9. **Deployment/rollback** — additive; new command, no change to `/ship`. Feature-flagged
   by simply not invoking `/design`. Safe.
10. **Docs/rules** — `docs/rules.md` (design never auto-chains), `pipeline-overview.md`
    (optional pre-decomposition design sub-phase), `agent-model-map.md` if new agent.

### Mandatory CEO Outputs

**NOT in scope (deferred):** live canvas editing/persistence (needs host bridge);
framework-native component output (React/Vue) from `/design`; design-system/DESIGN.md
authoring; multi-variant "shotgun" exploration; auto-chaining `/design → /plan → /ship`.

**Failure Modes Registry:**

| Mode | Trigger | Visible? | Handling |
|------|---------|----------|----------|
| MissingSpec | `/design` on a slug with no spec | yes (fatal-error-format) | abort with 2-line error |
| ThinSpec | spec has no screens/flows | yes (clarify) | `/design` asks (interactive), never fabricates (F8) |
| VendorMissing | `templates/design/pretext.js` absent | yes (warn) | CDN fallback + comment, like design-html |
| CanvasNoHost | canvas opened as plain file | partial | writes no-op silently; reads via fetch; banner notes view-mode |
| ReDecompCollision | `/design` after tasks edited | **designed out (F6)** | design precedes decomposition; N/A |

**Completion summary:** Plan is sound after three auto-corrections (F1/F6 spec-direct +
pre-decomposition, F7 printed nudge, F8 grounding). Two foundational calls remain for the
user: (1) format breadth (3 vs 1), (2) new-agent vs orchestrator-procedure. Both surfaced
at gates — neither silently decided.

<!-- AUTONOMOUS DECISION LOG -->
## Decision Audit Trail

| # | Phase | Decision | Class | Principle | Rationale |
|---|-------|----------|-------|-----------|-----------|
| 1 | CEO | Author `design-spec.md` directly from brief; drop pixel re-extraction | Mechanical | P1,P5 | Lossy round-trip (F1); direct is strictly better |
| 2 | CEO | Position `/design` BEFORE decomposition, not after `/plan` | Mechanical | P5 | Avoids R4 re-decomp collision (F6) |
| 3 | CEO | `/plan` nudge = printed recommendation, not inline AskUserQuestion | Mechanical | P3,P5 | Keeps `/plan` non-interactive / dry-run / CI safe (F7) |
| 4 | CEO | Ground generation in spec screen list; thin spec → clarify | Mechanical | P1 | Prevents hallucinated UI laundered to spec (F8) |
| 5 | CEO | Vendor `pretext.js` runtime, do NOT fork the reference skill | Mechanical | P4 | DRY runtime; stay standalone (F5) |
| 6 | CEO | Add alternatives B (nudge-only) and C (shell-out) to 0C-bis | Mechanical | P1 | Alternatives were missing |
| 7 | CEO | Keep all 3 formats (don't auto-cut to 1) | **Taste→gate** | P-surfaces | User-explicit + standing surface-preference; not auto-decided |
| 8 | CEO | New-agent vs orchestrator-procedure | **Taste→eng/gate** | P5 | Real R3/R10 tradeoff (F4); decide in eng phase |
| 9 | CEO-GATE | **Adopt reframe** (design before decomposition + spec authored directly) | **User-confirmed** | premise | User chose "Adopt the reframe" at D1 |
| 10 | CEO-GATE | **Keep all 3 formats on shared core** (canvas view-mode) | **User-confirmed** | P-surfaces | User chose "All three, shared core" at D2; supersedes F2/F9 cut-to-one |

**Premise gate: PASSED.** Reframe adopted; 3-format scope confirmed on a shared generator
core. Decisions #7 (format breadth) and the reframe are now settled by the user; the plan
body's Phase D and `/plan`-nudge sections are superseded by audit rows #1–#4.

**Phase 1 complete.** Codex `[unavailable]`; Claude subagent: 10 findings (3 critical, 4
high, 3 medium). 6 auto-corrections applied, 2 premise calls confirmed by user. → Phase 2.

---

## Phase 2 — Design Review (UI scope) · subagent-only

The strategy pass settled architecture; this pass found UX was treated as a residual. The
plan's own "open decisions" (tabs-vs-sidebar, CDN-vs-bundler, evolve-vs-overwrite) are
**interaction decisions**, resolved here — not deferred to implementation.

### Design Litmus Scorecard (Claude subagent · Codex `[unavailable]`)

| Dimension | Score | What makes it a 10 |
|-----------|-------|--------------------|
| 1. Information architecture of the clarification flow | 3/10 | format-first… → **source-first, then format**, plain-language labels, one pre-selected recommendation |
| 2. Missing states (command + artifacts) | 4/10 | command registry good; artifacts need empty/loading/export-failed/view-mode copy |
| 3. User journey / emotional arc | 4/10 | close the canvas export-trap; specify the post-generation handoff beat |
| 4. Specificity vs generic | 3/10 | resolve the parked UX "open decisions" in the plan |
| 5. When is each format the default | **2/10** | a screen-count + intent rule that pre-selects the recommended format |

### Findings → disposition (all auto-adopted unless noted)

- **F1/F2 (CRITICAL) — no format-recommendation rule; jargon options.** ADOPT. Sequence
  the clarification **source-first, then format**; relabel by *outcome*: Prototype =
  "Single screen — one page to react to"; Walkthrough = "Full flow — click through every
  screen in order"; Canvas = "Explore board — all screens on one zoomable wall (view-only
  unless saved into the project)". Pre-select one via a **decision rule** off the spec's
  resolved screen count: `0/freeform→Prototype · 1–2→Prototype · 3+ linear→Walkthrough ·
  3+ exploratory/"options"/"concept"→Canvas`, shown with a one-line why ("12 screens →
  Walkthrough recommended"). Others stay selectable.
- **F3 (CRITICAL) — view-only canvas is a silent-discard trap.** ADOPT. When
  `window.__canvasHost` is absent: edit affordances (reorder grips, rename, delete) render
  **visibly disabled** (not fake-then-discard); a persistent banner carries real copy +
  the edit command; **Export PNG/HTML stays enabled as the primary CTA** — a detached
  canvas is an honest *shareable export surface*, not a broken editor. (This *adds* value
  to the canvas surface rather than cutting it.)
- **F4 (HIGH) — walkthrough scale extremes.** ADOPT. ≤2 screens → recommend Prototype (or
  render sans sidebar, app-bar + prev/next). 30 screens → group by the spec's
  screen-section headers, sticky group header, "Screen 7 of 24" counter, lazy-mount
  active+neighbors (`content-visibility:auto`).
- **F5 (HIGH) — resolve parked UX decisions.** ADOPT both: (a) **walkthrough nav =
  sidebar screen-switching** (one screen at a time, lazy-mount) over smooth-scroll anchors
  — anchors force all screens into one DOM (perf) and read as a marketing page, not a flow;
  *minor taste note: the gallery reference is anchor-scroll — flagged at final gate as a light
  call, default = switch+lazy-mount.* (b) **vendor React locally, not CDN** — self-contained
  offline-openable deliverable; resolves the CDN supply-chain note + F3.
- **F6 (HIGH) — artifact empty/loading/export-failed states.** ADOPT. Canvas empty state;
  generation streams progress from `.run-manifest.jsonl`; write artifacts to temp then move
  on complete; export-failed → toast ("too large; export screens individually"), never a
  silent no-op.
- **F7 (MEDIUM) — re-run evolve/overwrite UX.** ADOPT. 3-option on re-run: **Evolve**
  (regenerate content, preserve `.design-canvas.state.json` layout/section order),
  **Replace** (warn "discards your canvas layout"), **Cancel**. Default Evolve.
- **F8 (MEDIUM) — `/plan` printed nudge still lists jargon.** ADOPT. Nudge recommends **one**
  format in plain language (F2 rule) + the single command, not a 5-letter menu.
- **F9 (MEDIUM) — content provenance.** ADOPT. Artifacts from a thin/clarified spec carry a
  small "Draft content — illustrative" ribbon; `finalized.json` records
  `content_provenance: spec|inferred`. Extends CEO-F8 to the pixels.
- **F10 (MEDIUM) — post-generation delight.** ADOPT. Phase D summary prints clickable
  `file://` paths per artifact, the format + why, a copy-paste next command, and notes that
  `design-spec.md` was authored so UI tasks will now generate.
- **Passes 6–7 (a11y/responsive/motion):** artifacts inherit design-html's baseline —
  keyboard nav (walkthrough prev/next + sidebar focus), `focus-visible`, ARIA on chrome,
  breakpoints at 375/768/1024/1440, `prefers-reduced-motion`. Noted as a generation
  requirement, not a gap.

**Audit trail (appended):**

| # | Phase | Decision | Class | Principle |
|---|-------|----------|-------|-----------|
| 11 | Design | Format **recommendation rule** off screen-count + outcome-labeled options | Mechanical | P1,P5 (F2) |
| 12 | Design | Honest view-only canvas: disable edits, banner+copy, **Export = primary CTA** | Mechanical | P5 (F3) |
| 13 | Design | Walkthrough = sidebar **screen-switching + lazy-mount**; group by spec sections | Mechanical | P1 (F4/F5) |
| 14 | Design | **Vendor React locally** (not CDN) for canvas | Mechanical | P5,security (F5) |
| 15 | Design | Artifact empty/loading/export-failed states specified | Mechanical | P1 (F6) |
| 16 | Design | Re-run = Evolve(preserve layout)/Replace(warn)/Cancel | Mechanical | P1 (F7) |
| 17 | Design | `content_provenance` ribbon + metadata for thin-spec artifacts | Mechanical | P1 (F9) |
| 18 | Design | Phase D summary = deliverable handoff (file:// links, why, next cmd) | Mechanical | P6 (F10) |
| 19 | Design | Walkthrough anchor-scroll vs screen-switch | **Taste→gate** | P5 — light call |

**Phase 2 complete.** Codex `[unavailable]`; Claude subagent: 10 findings (3 critical, 4
high, 3 medium). 8 auto-adopted, 1 light taste call (walkthrough nav). Plan UX went from
~3/10 to design-complete on the clarification flow + artifact states. → Phase 3 (Eng).

---

## Phase 3 — Eng Review · subagent-only

This pass read the **actual repo** and found the plan was underspecified at the integration
seams. Test plan artifact written to
the user-space autoplan archive.

### Step 0 — Scope challenge (sub-problem → existing code)

- Phase C chain `db→designer→specification` is **frozen** in
  `procedures/plan-steps-2-through-completion.md` §2.1–2.3 — no pre-decomposition hook.
- `commands/plan.md` is **non-interactive / `--dry-run` / CI-safe** — cannot host an
  `AskUserQuestion`.
- `R2` (`docs/rules.md:20`) keys `tasks_per_us` on **PNG existence**, while
  `agents/modes/spec-driven/specification.md:49` keys `has_design` on **design-spec.md**.
  Already divergent in the repo.
- SPEC-009 `.lock` is **specced, not shipped** (`hooks/hooks.json` has only the snapshot
  Stop hook) → no live concurrency guard.
- `conformance/runner.mjs:1484/1518` has a live `assertNotExists` design-spec.md anti-check.

### Eng Dual Voices — Consensus Table

```
  Dimension                       Claude-subagent              Codex          Consensus
  ─────────────────────────────── ──────────────────────────── ───────────── ──────────
  1. Architecture sound?          No — A1 integration unwired   [unavailable] subagent-only
  2. Test coverage sufficient?    No — T1 anti-check + fixtures [unavailable] subagent-only
  3. Performance risks addressed? Partial — lazy-mount gallery  [unavailable] subagent-only
  4. Security threats covered?    No — S1 injection unescaped   [unavailable] subagent-only
  5. Error paths handled?         Partial — 0-screen/race/dup   [unavailable] subagent-only
  6. Deployment risk manageable?  Yes — additive, flag-by-noop  [unavailable] subagent-only
```

### Architecture (condensed dependency graph)

```
USER ─/design (NEW, standalone, BEFORE /plan)─► commands/design.md
  Phase A preflight ── reuses ─► procedures/mode-detection.md (MODE/SPEC_DIR)
  Phase B AskUserQuestion (source → format, recommendation rule)
  Phase C generate ── ORCHESTRATOR STEP (A2: not a new agent) ─► design/{finalized.html,
         finalized.json, canvas.html+DesignCanvas.jsx+React (vendored), .state.json}
         └ copies templates/design/{pretext.js, DesignCanvas.jsx, react, shells}
  Phase D design-spec.md (single-sourced 10-section template) + STOP (R1)
        └ precedence: PNGs present → designer-agent writes it; else generator authors direct
/plan (unchanged Phase C) ── prints stdout nudge only ──► specification-agent
        └ R2 AMENDED: "design-spec.md OR PNG ⇒ UI task"  (else loop never closes)
qa-agent ── only if a generator subagent is kept ──► +Design Artifact Gate (R10)
```

### Findings → disposition

- **A1 (CRITICAL) — integration point doesn't exist; breaks dry-run.** ADOPT.
  `/design` is a **standalone command run before `/plan`**; the only `/plan` change is a
  **printed stdout nudge** (no AskUserQuestion in `/plan`). Zero coupling to the frozen
  Phase C chain. (Supersedes any "inline `/design` from `/plan`" reading.)
- **A2 (HIGH) — new agent unjustified + R3/R10 churn.** ADOPT (resolves audit #8).
  Generation is single-shot, single-artifact, interactive-source; the orchestrator must
  clarify anyway. → **generation is an orchestrator step**, not a 4th PO agent. No R3
  model-roster edit, no R10 qa-mandate. *Fallback:* if context-window isolation forces a
  thin generator subagent, the plan must then budget a qa-agent "Design Artifact Gate" +
  an `agent-model-map.md` row (not a footnote). Default = step. → light gate item.
- **A3 (HIGH) — R2 PNG-vs-design-spec conflict; loop won't close.** ADOPT. Amend `R2` to
  "**a design-spec.md OR a PNG** ⇒ UI task," and align `specification.md` `has_design`.
  One-line rules change, load-bearing, was missing from touchpoints.
- **E1 (CRITICAL) — no concurrency guard (SPEC-009 unshipped).** ADOPT. Ship a **minimal
  `<SPEC_DIR>/.lock`** (pid/host/started_at, TTL) acquire-on-start / release-on-exit in
  `/design`, forward-compatible with SPEC-009's contract. Don't depend on unshipped work.
- **E2 (HIGH) — design-spec.md double-write collision.** ADOPT. **One writer per run:**
  PNGs present → `designer-agent` owns design-spec.md (`/design` makes only the visual
  artifact); generating → generator authors it directly. Precedence line added to
  `mode-detection.md` + designer skip logic.
- **H1 (CRITICAL) — 10-section contract duplicated → drift.** ADOPT **as synthesis, not as
  the eng voice proposed.** Eng wanted to *reverse* direct-authoring (make designer-agent
  the sole writer). That would undo the user-confirmed D1. Instead: **single-source the
  10-section template** to `agents/modes/shared/design-spec-template.md`, included by BOTH
  the generator's direct-author path AND designer-agent's extraction path. Kills the drift
  the eng voice feared **while keeping direct authoring** (user's D1). → flagged at final
  gate (transparency: eng wanted reversal; user's choice kept).
- **S1 (CRITICAL) — injection: spec text → HTML/JSX unescaped (stored XSS / JSX breakout).**
  ADOPT. **HTML-entity-escape** all spec-derived text in HTML; **JSON-serialize** (never
  string-concat) all data injected into `DesignCanvas.jsx` / `.state.json`. Mandatory
  injection regression fixture (screen title `</script><img onerror=…>` → assert escaped).
- **H2 (HIGH) — "one core" is really three silos.** ADOPT (honest scoping). The genuine
  shared core = **(a)** spec→screen-list resolver, **(b)** content-realism + escaping pass,
  **(c)** `finalized.json` writer. The three formats are **separate renderers** (canvas
  uses React, not pretext.js). Keeps all three formats (user surface) but corrects the cost
  framing + task budget. No format cut.
- **E3 (MED) — 0-screen path.** ADOPT. 0 resolved screens → abort Phase B with a 2-line
  message (mode-detection style); never fabricate.
- **E4 (MED) — `.design-canvas.state.json` lifecycle.** ADOPT. Re-run reads + preserves it
  on Evolve; **git policy: commit it** (user intent, unlike `.lock` which is git-ignored).
- **E5 (MED) — default-mode path divergence.** ADOPT. Introduce the `design/` subdir
  consistently in BOTH modes (update `mode-detection.md`, default `designer.md` +
  `specification.md` reads) — don't silently fork the convention.
- **T1 (HIGH) — conformance anti-check blocks the loop test.** ADOPT. New `fixture-design/`
  (spec with a Screens section) + `--verify-design` runner flag; **keep feat-todo's
  anti-check intact**.
- **T2 (MED) — schema `format` keyword collision.** ADOPT. Name the field **`design_format`**
  (not `format` — reserved JSON-Schema keyword); spell out the full required-field set
  before authoring `design-manifest.schema.json`.
- **S2 / H3 (confirm) — vendor React locally; canvas is export+view-only forever.** ADOPT
  (reconfirms Design-F3/F5). `window.__canvasHost` exists nowhere in this repo → Canvas here is
  permanently view+export; the **body** (not just the appendix) must say so, Export primary,
  edits disabled.

### Mandatory eng outputs

**NOT in scope (deferred → backlog/SPEC, not a foreign root TODOS.md):** canvas live-edit /
`window.__canvasHost` host bridge; framework-native (React/Vue) component output from `/design`;
DESIGN.md / design-system authoring; multi-variant "shotgun" exploration; auto-chaining.

**Failure modes (additions to Phase 1 registry):** ReDecompCollision → **designed out**
(standalone-before-`/plan`); ConcurrentRun → `.lock`; SpecSpecCollision → precedence rule;
InjectionXSS → escaping contract + regression; ZeroScreen → abort.

**Completion summary:** Eng pass converts a directional plan into a buildable one. Two
load-bearing calls settled: **(1)** `/design` standalone-before-`/plan`, generation as an
orchestrator step, `/plan` nudge = stdout (kills A1/A2/E1-interactivity/R3-R10); **(2)**
single-source the 10-section template + one-writer precedence + R2 amendment (kills
H1/E2/A3) while preserving the user's direct-authoring choice.

**Audit trail (appended):**

| # | Phase | Decision | Class | Principle |
|---|-------|----------|-------|-----------|
| 20 | Eng | `/design` standalone, runs **before** `/plan`; `/plan` nudge = stdout only | Mechanical | P5 (A1) |
| 21 | Eng | Generation = **orchestrator step**, not a new agent (resolves #8) | Mechanical→light gate | P3,P5 (A2) |
| 22 | Eng | Amend **R2**: design-spec.md OR PNG ⇒ UI task | Mechanical | P1 (A3) |
| 23 | Eng | Ship minimal `<SPEC_DIR>/.lock` concurrency guard | Mechanical | P1 (E1) |
| 24 | Eng | **One writer per run** precedence for design-spec.md | Mechanical | P5 (E2) |
| 25 | Eng | **Single-source** 10-section template (keep direct authoring) | **Taste→gate** | P4 (H1) — synthesis, not eng's reversal |
| 26 | Eng | **Escape/serialize** all spec-derived content (XSS) + regression | Mechanical | P1,security (S1) |
| 27 | Eng | Shared core = 3 helpers; 3 renderers; budget honestly | Mechanical | P5 (H2) |
| 28 | Eng | 0-screen abort; `.state.json` commit; `design/` subdir both modes | Mechanical | P1 (E3/E4/E5) |
| 29 | Eng | New `fixture-design/` + `--verify-design`; keep anti-check; `design_format` field | Mechanical | P1 (T1/T2) |

**Phase 3 complete.** Codex `[unavailable]`; Claude subagent: 16 findings (4 critical, 6
high, 6 medium), all grounded in repo files. 14 auto-adopted, 1 synthesis kept over eng's
reversal (#25), 1 light gate item (#21). → Phase 3.5 (DX).

---

## Phase 3.5 — DX Review · subagent-only

planr-pipeline IS a developer tool; `/design` must feel like a first-class member of the
`/plan` `/ship` `/status` family. Composite DX (body as drafted): **~4.9/10** — strong
concept + loop-closure, but headless support and progressive-disclosure defaults were weak.

### DX Scorecard + Developer Journey

| Dimension | Score | 10 = |
|-----------|-------|------|
| 1. Time-to-first-design | 5/10 | one decision for the common case (pre-picked default); flags short-circuit |
| 2. Naming & consistency | 6/10 | `design`+`<slug>` fit; add `--yes`/`--dry-run` to match family |
| 3. Escape hatches (CI/headless) | **2/10** | `--format X --from Y --yes` fully bypasses the prompt |
| 4. Error messages | 6/10 | every fatal cites `fatal-error-format.md` + a `Repair:` string |
| 5. Discoverability & docs | 4/10 | `argument-hint` frontmatter + README/overview row |
| 6. Progressive disclosure | 4/10 | default format auto-chosen; experts override via `--format` |
| 7. Handoff / next-step | 7/10 | one unambiguous copy-paste next command + `file://` path |

```
DISCOVER → RUN → CLARIFY → GENERATE → NEXT
 /plan      /design  AskUserQ    one-shot   Phase D
 nudge +   <slug>    (skip if    artifact   summary →
 overview  [flags]   flags set)  + spec     /plan <slug>
TTHW: interactive ~45-75s (2 decisions); headless = ∞ as drafted (no bypass) → fixed below.
```

### Findings → disposition (all ADOPT)

- **F-DX1 (CRITICAL) — no non-interactive path; blocks CI.** `/design` becomes **dual-path**:
  if `--format` AND `--from` are supplied, **Phase B is skipped** (no AskUserQuestion); add
  **`--yes`** to auto-confirm overwrite/extract. Canonical headless form:
  `/design <slug> --from spec --format walkthrough --yes` — mirrors `/ship --yes`. Interactive
  is the fallback when flags are absent. (Resolves the eng-A1 interactivity worry too.)
- **F-DX2 (HIGH) — no default format → mandatory jargon.** Pre-select the recommended format
  from the spec's screen count (same rule as Design-F2); novice accepts default (1 keystroke),
  expert overrides with `--format`.
- **F-DX3 (HIGH) — flag-family fit.** Add `--yes` and `--dry-run`; keep `--format`; `--from`
  justified as a noun-valued source selector (same shape as `--task T-NNN`).
- **F-DX4 (HIGH) — discoverability.** Ship `argument-hint: <slug> [--format
  prototype|walkthrough|canvas] [--from spec|png|describe] [--yes]` + a `description:` in the
  family voice; add a README + `pipeline-overview.md` row.
- **F-DX5 (MEDIUM) — fatal contract.** Route every fatal (missing-spec, wrong-slug,
  vendor-missing) through `procedures/fatal-error-format.md` with concrete `Repair:` strings
  (missing spec → `Repair: /planr-pipeline:plan <slug>`). Thin-spec stays the clarify case.
- **F-DX6 (MEDIUM) — ambiguous next-step.** One canonical next: `/planr-pipeline:plan
  <slug>`, copy-paste-ready + `file://` artifact path + "design-spec.md authored → UI tasks
  will now generate." (Reinforces Design-F10.)

**Audit trail (appended):**

| # | Phase | Decision | Class | Principle |
|---|-------|----------|-------|-----------|
| 30 | DX | **Dual-path**: flags `--format`+`--from` bypass prompt; add `--yes` (headless) | Mechanical | P1 (F-DX1) |
| 31 | DX | Default format pre-selected from screen count (accept-to-go) | Mechanical | P5 (F-DX2) |
| 32 | DX | Add `--yes`/`--dry-run`; `argument-hint` + `description` frontmatter | Mechanical | P5 (F-DX3/4) |
| 33 | DX | Every fatal → `fatal-error-format.md` + `Repair:` string | Mechanical | P1 (F-DX5) |
| 34 | DX | One canonical next-step (`/plan <slug>`) + `file://` path | Mechanical | P6 (F-DX6) |

**Phase 3.5 complete.** Codex `[unavailable]`; Claude subagent: 6 findings (1 critical, 3
high, 2 medium), all adopted. → Final gate.

---

## Cross-Phase Themes (concerns that surfaced in 2+ phases independently)

- **Theme A — interactive vs headless** (Eng-A1 + DX-F-DX1). High-confidence signal. The
  interactive AskUserQuestion is right for humans but blocks CI. **Resolution: dual-path** —
  flag-driven non-interactive mode (`--format --from --yes`) is first-class; interactive is
  the no-flags fallback. `/plan`'s nudge is stdout-only. This also keeps `/plan` itself
  non-interactive (dry-run/CI safe).
- **Theme B — format recommendation, not a flat menu** (Design-F2 + DX-F-DX2). The
  screen-count→format rule is the single fix that upgrades IA, progressive disclosure, AND
  TTHW. Adopted once, pays three times.
- **Theme C — honest deliverable handoff** (Design-F10 + DX-F-DX6). Phase D is a handoff
  moment, not a file-write log: clickable paths, one next command, "spec authored."

---

# REVISED PLAN (post-review, authoritative)

> Supersedes the DRAFT body above. This is the buildable v0.13.0 / SPEC-015 shape.

## What ships

A standalone **`/planr-pipeline:design <slug>`** command (run **before** `/plan`) that turns
a spec/brief into a visual design artifact **and** a `design-spec.md`, so the existing PO
chain decomposes UI tasks. Three formats, one thin shared core, dual-path (interactive +
flag-driven).

```
argument-hint: <slug> [--format prototype|walkthrough|canvas] [--from spec|png|describe] [--yes] [--dry-run]
```

### Flow
- **Phase A — preflight:** `mode-detection.md` binds MODE/SPEC_DIR; resolve design context +
  the spec's screen list; acquire `<SPEC_DIR>/.lock` (E1).
- **Phase B — clarify (skipped if `--format`+`--from` given):** AskUserQuestion, **source
  first, then format**, outcome-labeled, with the **recommended format pre-selected** from
  screen count (`0-2→prototype · 3+ linear→walkthrough · 3+ exploratory→canvas`). Re-run →
  Evolve/Replace/Cancel.
- **Phase C — generate (orchestrator step, not a new agent):** shared core =
  (a) screen-list resolver, (b) content + **escaping** pass (S1), (c) `finalized.json`
  writer (`design_format` field). Per-format renderers: prototype/walkthrough use vendored
  `pretext.js`; canvas uses **locally vendored React** + `DesignCanvas.jsx` (export+view-only;
  edits disabled without a host bridge; Export is the primary CTA). All spec-derived text
  HTML-escaped / JSON-serialized.
- **Phase D — spec + stop:** author `design-spec.md` from the **single-sourced 10-section
  template** (`agents/modes/shared/design-spec-template.md`); **one writer per run** (PNGs
  present → `designer-agent` owns it). STOP (R1). Summary = handoff (file:// links, format +
  why, `Repair:`/next `/planr-pipeline:plan <slug>`).

### Artifacts (`<SPEC_DIR>/design/` or `output/feats/feat-{slug}/design/`, consistent both modes)
`finalized.html` (prototype/walkthrough) · `canvas.html`+`DesignCanvas.jsx`+vendored React+
`.design-canvas.state.json` (committed) · `pretext.js` · `finalized.json`
(`design_format`, screens, source, `content_provenance`) · `design-spec.md`.

### Repo changes
- `commands/design.md` + `procedures/design-*.md` (preflight, clarify, generate, lock).
- `templates/design/` vendored: `pretext.js`, `DesignCanvas.jsx`, React, `*-shell.html`.
- `agents/modes/shared/design-spec-template.md` (single-sourced; `designer-agent` includes it).
- `docs/rules.md`: **amend R2** ("design-spec.md OR PNG ⇒ UI task"); add "design never
  auto-chains." `pipeline-overview.md`: optional pre-decomposition design sub-phase. README row.
- `schemas/v1.0.0/design-manifest.schema.json` (light; `design_format` enum) + validator entry.
- `commands/plan.md`: **printed stdout nudge** when UI intent + no design (one format, plain
  language, names the one command). No AskUserQuestion. `--dry-run` unaffected.
- `conformance/`: new `fixture-design/` + `--verify-design`; **injection regression**; golden
  `finalized.json` per format; feat-todo anti-check untouched.
- `agents/qa-agent.md`: Design Artifact Gate **only if** a generator subagent is later kept.

### Implementation tasks (aggregated, post-review)
1. Vendor `templates/design/` (pretext.js, DesignCanvas.jsx, pinned React, shells).
2. `agents/modes/shared/design-spec-template.md` + wire `designer-agent` to include it.
3. `commands/design.md` + procedures (preflight+lock, clarify+reco-rule, generate+escape, spec+handoff).
4. Shared core (3 helpers) + 3 renderers; `finalized.json`/`design_format` + schema.
5. `R2` amendment + `specification.md` `has_design`; `design/` subdir both modes.
6. `commands/plan.md` printed nudge (stdout, dry-run safe).
7. `conformance/fixture-design/` + `--verify-design` + injection regression + goldens.
8. Docs: `pipeline-overview.md`, README, `rules.md`; version 0.13.0 + CHANGELOG + SPEC-015.

---

## Final Gate Outcome — APPROVED (2026-06-07)

User approved as-is. Final taste calls settled:

| # | Phase | Decision | Resolution |
|---|-------|----------|------------|
| 19 | Design | Walkthrough nav | **Support both, default lazy** — anchor-scroll for ≤8 screens; auto-switch to lazy screen-switching above 8. Two nav paths, budgeted. |
| 21 | Eng | Generation impl | Orchestrator **step** (not a 4th agent) — accepted. |
| 25 | Eng | design-spec.md authority | **Single-sourced template + direct authoring kept** (over eng's reversal) — accepted. |

**Walkthrough renderer (final):** below 8 screens → anchor-scroll gallery (the anchor-scroll
`finalized.html` pattern: app-bar + grouped sidebar + smooth-scroll, `content-visibility`
for safety); 8+ screens → lazy screen-switching (active+neighbors mounted, "Screen N of M"
counter, grouped by spec sections). The recommendation rule still prefers *prototype* at
≤2 screens, so the anchor-scroll path serves the 3–8 screen sweet spot.

**Status:** plan APPROVED, buildable. Next step (explicit, not auto-chained): author
`.planr/specs/SPEC-015-design-command/` and implement. Review logs written; restore point
at the top of this file.
