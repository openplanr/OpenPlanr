# Procedure: generate the project design system (v0.18.0)

> Invoked by the **no-system gate** (`design-step0-preflight.md` A.3.6, option A) or
> explicitly via `/planr-pipeline:design <slug> --system`. Produces the project-wide
> design-system **package** that every `/design` run and the PO designer-agent ground
> designs in — so designs are a **continuation** of one feel, never standalone.
> This is an **orchestrator step** (main thread writes the files); it never generates a
> feature's screens — only the system.

## S.0 — Where it lives (project-wide, not per-feature)
Bind `DS_DIR` from `mode-detection.md`:
- spec-driven → `.planr/design-system/`
- default → `input/design-system/`

The package is **one per project**, reused by every feature. Create `DS_DIR` if missing.

## S.1 — Gather brand context (one source, in priority order)
1. **Existing-app scan** — if the project has *partial* signals (a `DESIGN.md`, a CSS/Tailwind
   theme, real screens/components, `input/tech/stack.md` ComponentLibrary), read them and extract
   the **real** palette, type, spacing, radii, and component patterns. The system **continues**
   what exists; never overwrite a real brand with a generic one.
2. **Brand answers** — from the gate's option C, or gather here with a focused `AskUserQuestion`
   (real tool call, never prose): product + industry, **3 personality adjectives**, the **one
   brand color**, light/dark + density. Keep it to ≤4 questions.
3. **Reference** — if the user pointed at an app/design/Atlas-style package, ingest + normalize it.
4. **Advisor mode (vague brief, no signal)** — propose **3 differentiated directions** via
   `AskUserQuestion` (e.g. *calm-enterprise* / *editorial-minimal* / *warm-product*), each a
   one-line aesthetic + a sample brand hue; the user picks one. Never silently invent a direction.

## S.2 — Compose the package (on the grid, AA, anti-slop)
Apply `${CLAUDE_PLUGIN_ROOT}/agents/modes/shared/design-principles.md` and the craft rubric.
Fill the templates under `${CLAUDE_PLUGIN_ROOT}/templates/design-system/`:

- **`tokens.css`** ← `tokens.css.tpl` — the real palette (light + `.dark`), type scale, the
  **4-point spacing** scale, radii, elevation, motion. **Every text/background pair MUST be AA**
  (≥4.5:1) — verify each with `node "$PLUG/lib/design/contrast.mjs"`-backed `contrastRatio` (the
  helper is exported from `lib/design/index.mjs`); fix any pair below 4.5:1 before writing. ONE
  saturated brand hue; status colors signal state only.
- **`manifest.json`** ← `manifest.json.tpl` — mirror `tokens.css` as structured tokens
  (`{name,value,kind,scope?}`) + `themes` + `fonts` + `frames`/`breakpoints` (reuse
  `lib/design/tokens.mjs` `FRAMES`/`BREAKPOINTS`). Keep it in sync with `tokens.css`.
- **`brand.md`** ← `brand.md.tpl` — positioning, priority-ordered personality, voice & tone
  (do/don't + microcopy), naming/vocabulary, color & contrast notes.
- **`components.md`** ← `components.md.tpl` — per-surface token recipes + the premium-polish details.

## S.3 — Validate, then write
- Assert every `tokens.css` text/background pair is AA (`contrastRatio ≥ 4.5`); spacing is on the
  4-point grid. Fix violations, do not ship them.
- Write each file to a temp (`<DS_DIR>/.tmp.*`) then `mv` into place (no half-written package).
- Log: `✓ Design system written to <DS_DIR> (N tokens, light+dark). Future designs continue it.`

## S.4 — Return
Bind `DESIGN_SYSTEM = resolveDesignSystem({ dir: DS_DIR })` (now `found: true, source: package`) and
hand back to the caller (the gate continues to design the feature; `--system` stops here with the
log above).
