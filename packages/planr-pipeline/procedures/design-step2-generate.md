# Procedure: /design Step C — generate the artifact (orchestrator step)

> Read by `commands/design.md` Step C. This is an **orchestrator step**, not a subagent
> (SPEC-015 finding A2) — the main thread already holds the clarified `{source, format}` and
> writes the files directly. The shared core is three helpers; the rest is per-format.

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
