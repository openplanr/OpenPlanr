# Procedure: /design Step C — generate the artifact (orchestrator step)

> Read by `commands/design.md` Step C. This is an **orchestrator step**, not a subagent
> (SPEC-015 finding A2) — the main thread already holds the clarified `{source, format}` and
> writes the files directly. The shared core is three helpers; the rest is per-format.

## C.0 — Ground the design in the target app (read this FIRST, v0.14.1)

A generated design must look like it belongs in the **real app**, at a **real screen size** —
not a generic card floating on gray. Before filling any shell, read the project:

- **App shell / layout.** Find + read the app's layout + chrome — `app/layout.*`, `src/App.*`,
  `components/{Layout,Shell,Sidebar,Nav,Header,Topbar,AppBar}.*` (framework-appropriate).
  Render each generated screen **inside that shell** (the real sidebar / nav / header) so it
  reads as embedded in the product. A free-floating centered card is correct ONLY when the
  screen genuinely IS a modal / dialog / standalone marketing page.
- **Design system / tokens.** Read `DESIGN.md`, the CSS/Tailwind theme (`globals.css`,
  `tailwind.config.*`, `theme.*`), and the `ComponentLibrary` / `FrontendFramework` from
  `input/tech/stack.md`. Match the **real** colors, type scale, spacing, radii, and component
  shapes — never invent a generic palette/style.
- **Existing screens.** Read 1–2 real pages/components and mirror their layout density,
  navigation, and patterns.

### Target viewport — design for a real screen, not a tiny card

- **Desktop web app → full-bleed ~1440px** (use the app's real max-content width + breakpoints).
  Let content use the width; do **not** center a narrow card in empty space.
- Responsive/mobile → design the app's breakpoints (375 / 768 / 1024 / 1440) and show the
  primary one at full width.
- A constrained/centered card is correct ONLY for a genuine modal, dialog, or narrow form —
  never for a full page. (Non-web mediums: match that medium's real frame instead.)

### Craft — assemble it like a professional

Apply the **design-craft rubric** `${CLAUDE_PLUGIN_ROOT}/agents/modes/shared/design-craft-rubric.md`
**as you build**: one spacing scale (no arbitrary `13px`/`17px`), **same-type elements the
same size** (all pills/badges/buttons/cards/inputs in a group identical), align everything to
a grid, a consistent type scale, AA contrast, SVG icons (never emoji), `:focus-visible` +
150–300ms hover. The model's first draft drifts on exactly these — the § C.4.5 self-review
re-checks and fixes them before finalizing.

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
- Build the data object `{ sections: [ { id, title, subtitle?, artboards: [ { id, label,
  width, height, html } ] } ] }`, where `html` is each screen's rendered markup (spec text
  inside it already escaped). Replace the `GENERATOR:data` marker with
  `window.__CANVAS_DATA = <embedJson(data)>;` — **`embedJson` is required**.
- On **evolve**, merge `priorState` (`.design-canvas.state.json`) so saved order/labels
  survive; re-write the sidecar.
- Copy `vendor/{react.production.min.js, react-dom.production.min.js, DesignCanvas.js}` →
  `<DESIGN_DIR>/vendor/`. Output: `<DESIGN_DIR>/canvas.html`. `framework: react`.
- The shell already enforces view-only when no host bridge is present — do not add editing.

## C.4.5 — Self-review pass (mandatory — fixes the "silly mistakes", v0.15.0)

Before finalizing (the C.1 temp → final move), **audit your own artifact** against the craft
rubric `${CLAUDE_PLUGIN_ROOT}/agents/modes/shared/design-craft-rubric.md`. Re-read the markup +
CSS you just wrote and walk the rubric's pre-finalize checklist — with special attention to
the defects LLM drafts make most:

- **Sizing consistency (the #1 defect):** are all sibling elements of one type — pills, badges,
  buttons, cards, inputs — exactly the same height / padding / width? (e.g. an `error` pill and
  a `warn` pill MUST be identical in size.)
- **Spacing:** is every margin / padding / gap on the scale? Are gaps within a group equal?
- **Alignment:** does everything line up to a grid / baseline — no 1–3px drift, no orphaned or
  optically-off element?
- **Tokens / contrast / icons / focus** per the checklist.

For **every** violation, **fix it in the artifact** — do not merely note it. This self-critique
is **mandatory**, not optional: it is the step that turns a first-draft layout into a
professional one. Only after the audit passes do you move the temp file into place (C.1).

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
