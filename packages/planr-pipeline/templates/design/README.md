# `templates/design/` — design generation assets

Vendored runtime + renderer shells used by **`/planr-pipeline:design`** to generate
visual design artifacts. Paired with the tested helpers in [`lib/design/`](../../lib/design/).

## Renderer shells (one per format)

| File | Format | Substrate | Notes |
|------|--------|-----------|-------|
| `prototype-shell.html` | prototype | vanilla + Pretext | one interactive screen |
| `walkthrough-shell.html` | walkthrough | vanilla + Pretext | grouped sidebar gallery; **both nav modes** — anchor-scroll (≤8 screens) and lazy screen-switching (>8), auto-selected by [`chooseWalkthroughNav`](../../lib/design/walkthroughNav.mjs) |
| `canvas-shell.html` | canvas | React (vendored) | Figma-like pan/zoom board; **export + view-only** when opened without a host bridge |

Each shell has `<!-- GENERATOR:* -->` markers (title, fonts, tokens, screens/data,
layout). The generator fills them and copies the needed `vendor/` files alongside the
output so the artifact is self-contained and offline.

## `vendor/` runtime

| File | Source / pin | Committed? |
|------|--------------|-----------|
| `pretext.js` | the same 30KB Pretext bundle gstack `design-html` vendors (text reflow / computed heights) | yes |
| `react.production.min.js` | React 18.3.1 UMD (SRI-pinned) | yes |
| `react-dom.production.min.js` | ReactDOM 18.3.1 UMD (SRI-pinned) | yes |
| `DesignCanvas.js` | compiled from `DesignCanvas.jsx` (classic JSX runtime) | yes |
| `DesignCanvas.jsx` | canvas source (kept as readable reference) | yes (in parent dir) |

The runtime is **committed** so a generated canvas opens offline with zero setup. To
upgrade a pin or re-verify integrity:

```bash
node templates/design/vendor/fetch-vendor.mjs
```

That re-fetches React (verifying SRI — a mismatch aborts without writing) and recompiles
`DesignCanvas.jsx → vendor/DesignCanvas.js` with esbuild.

## Security (mandatory)

Every spec-derived string interpolated into an artifact MUST be escaped:
[`escapeHtml`](../../lib/design/escape.mjs) for HTML/attribute text,
[`embedJson`](../../lib/design/escape.mjs) for objects embedded in `<script>` blocks.
This is the SPEC-015 finding **S1** XSS guard — see `tests/design/escape.test.mjs` for the
injection regression.
