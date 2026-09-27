# `templates/design/` — design generation assets

Vendored runtime + renderer shells used by **`/planr-pipeline:design`** to generate
visual design artifacts. Paired with the tested helpers in [`lib/design/`](../../lib/design/).

## Renderer shells (one per format)

| File | Format | Substrate | Notes |
|------|--------|-----------|-------|
| `prototype-shell.html` | prototype | vanilla + Pretext | one interactive screen |
| `walkthrough-shell.html` | walkthrough | vanilla + Pretext | grouped sidebar gallery; **both nav modes** — anchor-scroll (≤8 screens) and lazy screen-switching (>8), auto-selected by [`chooseWalkthroughNav`](../../lib/design/walkthrough-nav.mjs) |

Each shell has `<!-- GENERATOR:* -->` markers (title, fonts, tokens, screens,
layout). The generator fills them and copies the needed `vendor/` files alongside the
output so the artifact is self-contained and offline.

## `vendor/` runtime

| File | Source / pin | Committed? |
|------|--------------|-----------|
| `pretext.js` | 30KB Pretext text-reflow runtime, vendored (text reflow / computed heights) | yes |

The runtime is **committed** so a generated artifact opens offline with zero setup.

## Security (mandatory)

Every spec-derived string interpolated into an artifact MUST be escaped:
[`escapeHtml`](../../lib/design/escape.mjs) for HTML/attribute text,
[`embedJson`](../../lib/design/escape.mjs) for objects embedded in `<script>` blocks.
This is the SPEC-015 finding **S1** XSS guard — see `tests/design/escape.test.mjs` for the
injection regression.
