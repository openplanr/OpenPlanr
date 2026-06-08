# Procedure: /design Step C — generate the artifact (orchestrator step)

> Read by `commands/design.md` Step C. This is an **orchestrator step**, not a subagent
> (SPEC-015 finding A2) — the main thread already holds the clarified `{source, format}` and
> writes the files directly. The shared core is three helpers; the rest is per-format.

## C.0 — Ground the design in the target app (consume APP_CTX, v0.15.1)

A generated design must look like it belongs in the **real app**, at a **real screen size** —
not a generic card floating on gray. **You already resolved `APP_CTX` in preflight
(`design-step0-preflight.md` A.3.5): `{ APP_SHELL, DESIGN_SYSTEM, COMPONENT_LIB, REF_SCREENS,
VIEWPORT_W, breakpoints }`.** Build every screen from it — do **not** re-discover it ad hoc:

- **Embed in `APP_SHELL`.** Render each screen **inside the real shell** (the actual sidebar /
  nav / header you read), so it reads as embedded in the product. A free-floating centered card
  is correct ONLY when `APP_SHELL = none`, or the screen genuinely IS a modal / dialog /
  standalone marketing page.
- **Match `DESIGN_SYSTEM` + `COMPONENT_LIB`.** Use the **real** brand color, type scale,
  spacing, radii, and component shapes — never invent a generic palette/style.
- **Mirror `REF_SCREENS`** for layout density, navigation, and patterns.

### Target viewport — author at `VIEWPORT_W`, never a smaller ad-hoc width

- **Author every screen at `VIEWPORT_W`** (the desktop content width bound in A.3.5 — **1440**
  for a desktop web app unless the theme says otherwise). Let content use the full width; do
  **not** center a narrow card in empty space, and do **not** pick an arbitrary width like
  1320 — that was the bug.
- Responsive/mobile → design the app's breakpoints (375 / 768 / 1024 / 1440) and show the
  primary one (`VIEWPORT_W`) at full width.
- A constrained/centered card is correct ONLY for a genuine modal, dialog, or narrow form —
  never for a full page. (Non-web mediums: match that medium's real frame instead.)

### Craft — assemble it like a professional

Apply the **design-craft rubric** `${CLAUDE_PLUGIN_ROOT}/agents/modes/shared/design-craft-rubric.md`
**as you build**: one spacing scale (no arbitrary `13px`/`17px`), **same-type elements the
same size** (all pills/badges/buttons/cards/inputs in a group identical), align everything to
a grid, a consistent type scale, AA contrast, SVG icons (never emoji), `:focus-visible` +
150–300ms hover. The model's first draft drifts on exactly these — the § C.4.5 self-review
re-checks and fixes them before finalizing.

## C.0.5 — Author with the token scale, not ad-hoc px (v0.16.0)

Internal consistency is enforced by **construction**, not by eyeballing — the engineering answer
to "make every size/spacing accurate". Author every screen from a small, fixed vocabulary so
off-scale values and same-type drift are *impossible*:

- **Spacing — the 4-point grid.** Every padding / margin / gap / inset is `0`, `2`, or a multiple
  of **4** — prefer the common steps **4 / 8 / 12 / 16 / 24 / 32 / 48 / 64** (`COMMON_SPACING` in
  `lib/design/tokens.mjs`). Never emit `13px` / `14px` / `17px`. Define the scale once as CSS
  custom properties (`--space-2: 8px`, …) — or reuse the app's real tokens from
  `APP_CTX.DESIGN_SYSTEM` — and reference those; do not hand-type arbitrary px.
- **Same-type elements share ONE class.** Every pill / badge / button / card / input of a kind
  uses the same class (e.g. `.ds-badge`) with the size defined **there once** — never a
  per-instance inline `width`/`height`/`padding`. Identical-by-construction beats
  remembering-to-match; inline sizing on a classed element is a linter drift warning.
- **Type + radii** come from the app's scale too — don't invent sizes.

The C.4.5a linter (`lib/design/lint.mjs`) deterministically **fails** off-grid spacing, so
authoring on-grid here is what makes the finalize gate pass first time.

## C.1 — Shared core (every format)

**Plugin-root handle — resolve it dynamically, do this once.** The `lib/design/*` helpers
live under the plugin install. **Never hardcode a versioned path** like
`…/planr-pipeline/0.13.0/` (wrong the moment the user updates). Resolve `PLUG` in order:

1. If `${CLAUDE_PLUGIN_ROOT}` is set, `PLUG="${CLAUDE_PLUGIN_ROOT}"`.
2. **Else derive it from a file you are already reading.** You loaded this procedure from
   `<plugin-root>/procedures/design-step2-generate.md`, so the helpers are the sibling
   `<plugin-root>/lib/design/` — strip the `/procedures/…` suffix from that path to get
   `PLUG`. In practice `$CLAUDE_PLUGIN_ROOT` is usually **unset** in the Bash subprocess, so
   this is the **normal** branch — use it; do **not** jump straight to hand-authoring.

Invoke any helper as `node "$PLUG/lib/design/<helper>.mjs"` — this keeps the **tested**
escaping + manifest validation engaged at runtime (the real SPEC-015 S1 guard, not a
best-effort hand-escape). Only if you genuinely cannot determine `PLUG` may you fall back to
authoring the small JSON/text outputs directly to the shapes documented below + validating
against `$PLUG/schemas/v1.0.0/`.

1. **Screen list** — already resolved in Step A (`SCREENS`). For `source == describe`,
   derive a short screen list from the gathered brief.
2. **Escaping (mandatory — SPEC-015 S1).** Interpolate NOTHING raw. **Before** writing any
   spec-derived string into the artifact — screen titles, group names, labels, copy, field
   names, all of it — escape it, **even when the value "looks safe"**:
   - HTML text / attributes → `escapeHtml(value)` (`$PLUG/lib/design/escape.mjs`)
   - objects embedded in a `<script>` (canvas data, `.state.json`) → `embedJson(value)`
   Apply this as you author the HTML — the helper is the rule; do not skip it for "obviously
   harmless" titles. Generate **realistic** content from the spec — never lorem ipsum, and
   never a screen not present in the spec/brief (SPEC-015 F8).
3. **Manifest** — build `finalized.json` with `node "$PLUG/lib/design/manifest.mjs"`
   `buildManifest({...})` and assert `validateManifest()` returns `ok: true` before writing.
   (Fallback: author `finalized.json` directly to the shape in C.5 and validate against
   `$PLUG/schemas/v1.0.0/design-manifest.schema.json`.)

Write the artifact to a temp file first (`<DESIGN_DIR>/.finalized.tmp.html`) and `mv` it
into place only after it is fully written, so a crashed run never leaves a half-written
artifact (SPEC-015 F6).

## C.2 — prototype

- Base: `templates/design/prototype-shell.html`.
- Fill `GENERATOR:title|fonts|tokens|screen|layout`. Choose a Pretext tier for the screen
  (Simple / Card-grid / Chat / Content) and call the matching API in `GENERATOR:layout`.
- Copy `templates/design/vendor/pretext.js` → `<DESIGN_DIR>/vendor/pretext.js`.
- Output: `<DESIGN_DIR>/finalized.html`. `framework: vanilla`.

## C.3 — walkthrough

- Base: `templates/design/walkthrough-shell.html`.
- `NAV_MODE = chooseWalkthroughNav(SCREEN_COUNT)` (`lib/design/walkthroughNav.mjs`:
  ≤8 → `anchor`, >8 → `lazy`). Set `<html data-nav-mode="<NAV_MODE>">`.
- For each screen emit
  `<section class="screen" id="s-<slug>" data-group="<group>" aria-label="<escaped name>"><h2>…</h2><div class="frame">…</div></section>`.
  Group screens by their spec section when one exists.
- Copy `vendor/pretext.js`. Output: `<DESIGN_DIR>/finalized.html`. `framework: vanilla`,
  `nav_mode: <NAV_MODE>`.

## C.4 — canvas

- Base: `templates/design/canvas-shell.html`.
- **Artboard size — ONE canonical frame for every screen (v0.16.0).** All desktop artboards use
  the **same** frame: `width: 1440, height: 1024` (the `FRAMES.desktop` constant in
  `lib/design/tokens.mjs`; a mobile app → `FRAMES.mobile` `390×844`). Do **not** vary height per
  screen — the 760 / 700 / 820 drift is exactly what makes a canvas look amateur; one consistent
  frame is what makes it read like a real Figma file, every screen directly comparable. Content
  taller than 1024 **scrolls inside** the screen container (`overflow:auto`), like a real desktop
  viewport. The `DesignCanvas` fallback is already `1440×1024`; still pass the dims explicitly.
  `lintCanvasData()` (C.4.5a) fails any artboard that isn't a canonical frame.
- Build the data object `{ sections: [ { id, title, subtitle?, artboards: [ { id, label,
  width, height, html } ] } ] }`, where `html` is each screen's rendered markup (spec text
  inside it already escaped). Replace the shell's `/* GENERATOR:data */` marker so the line
  reads `var DATA = <embedJson(data)>;` — **`embedJson` is required**.
- On **evolve**, merge `priorState` (`.design-canvas.state.json`) so saved order/labels
  survive; re-write the sidecar.
- Copy `vendor/{react.production.min.js, react-dom.production.min.js, DesignCanvas.js}` →
  `<DESIGN_DIR>/vendor/`. Output: `<DESIGN_DIR>/canvas.html`. `framework: react`.
- The shell already enforces view-only when no host bridge is present — do not add editing.

## C.4.5 — Finalize gate: deterministic lint THEN visual self-review (v0.16.0)

Before finalizing (the C.1 temp → final move), the artifact passes **two** checks — a machine
linter first (it catches the *measurable* defects with certainty), then a visual self-review for
what no static check can see.

### C.4.5a — Deterministic lint gate (machine — mandatory)

Run the linter on the artifact you just wrote (it is the engineering guarantee, not a vibe check):

```bash
node "$PLUG/lib/design/lint.mjs" <DESIGN_DIR>/.finalized.tmp.html
```

- For **every `spacing-off-grid` ERROR**, change that value to the reported `suggestion` (the
  nearest 4-point-grid step) in the markup/CSS.
- For **canvas**, also assert `lintCanvasData(data).ok === true` — every artboard must be the
  canonical `1440×1024` frame (C.4).
- **Re-run until it exits 0** (zero errors). Off-grid spacing and off-frame artboards never ship.
- Treat `inline-sizing-drift` **warnings** as a worklist for the visual pass — move the inline
  sizing onto the shared class so siblings can't diverge.

(Fallback if `$PLUG` is unresolved: apply the same rule by hand — every padding/margin/gap/inset
is `0`, `2`, or a multiple of 4; every canvas artboard is `1440×1024`.)

### C.4.5b — Visual self-review (the subjective layer — mandatory)

The linter can't see optical alignment, hierarchy, or rhythm. Re-read the markup + CSS against
the craft rubric `${CLAUDE_PLUGIN_ROOT}/agents/modes/shared/design-craft-rubric.md` and fix:

- **Sizing consistency (the #1 defect):** are all sibling elements of one type — pills, badges,
  buttons, cards, inputs — exactly the same height / padding / width? (Same class, no inline
  overrides — the C.4.5a drift warnings point right at these. An `error` pill and a `warn` pill
  MUST be identical.)
- **Spacing rhythm — esp. vertical lists / nav / sidebar sections:** the values are on-grid (the
  linter proved it); now confirm the gaps between sibling rows are **equal** and each row's
  padding is identical. Uneven row rhythm is the recurring "broken spacing" miss.
- **Alignment:** everything lines up to a grid / baseline — no 1–3px drift, no optically-off
  element.
- **Hierarchy / contrast / icons / focus** per the checklist.

Fix **every** violation in the artifact. Only after **both** passes are clean do you move the
temp file into place (C.1).

## C.5 — finalized.json + manifest record

Write `<DESIGN_DIR>/finalized.json` from `buildManifest`:
`{ design_format, source, content_provenance, framework, screens, screen_count, nav_mode?,
screen_name, iterations (prior+1 on evolve, else 0), generated_at, branch, spec_id,
html_file }`.

If a `.run-manifest.jsonl` exists for the feature, append a `design.generate` stage record
(`stage`, `agent: null`, `started_at`/`ended_at`, `files_written`, `exit_status: success`).

## C.6 — Scoped `.gitignore` (keep the repo clean — v0.13.3)

The rendered preview is regenerable build output, and the third-party runtime under
`vendor/` (React ~141KB, pretext ~30KB) must **never** be committed per design. Write
`<DESIGN_DIR>/.gitignore` so the project commits only the design **intent** by default. This
does NOT touch the developer's root `.gitignore` — it only scopes the directory `/design`
generated, and the developer stays in full control (edit or delete it to commit the visual):

```gitignore
# Written by /planr-pipeline:design. The rendered preview is build output (regenerable).
# Tracked by default: design-spec.md (the intent /plan consumes) + finalized.json (metadata).
# Delete this file to commit the full self-contained visual artifact instead.
vendor/
finalized.html
canvas.html
.design-canvas.state.json
.finalized.tmp.*
.design.lock
```

Write it only if `<DESIGN_DIR>/.gitignore` is absent — on a re-run/evolve, leave the
developer's existing version untouched (they may have opted to track the visual).
