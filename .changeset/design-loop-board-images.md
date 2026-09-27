---
'planr-pipeline': minor
'@openplanr/design': patch
---

The design-loop board shows each variant as its own image. `design-engine generate --provider openai` (also through `variants` and `evolve`) and `design-engine record` no longer write a `variant-{X}.html` React canvas and a `vendor/` copy of React 18 next to the image, so `design-engine board` no longer stops with `Artifact ./vendor/react-dom.production.min.js contains remote URL.` on the rounds they wrote. The board frames `variant-{X}.png` or `variant-{X}.svg` at the image's own size and keeps its zoom, views, pins, ratings and PNG or SVG source export. planr-pipeline no longer ships `templates/design/canvas-shell.html`, `templates/design/DesignCanvas.jsx`, `templates/design/vendor/react.production.min.js`, `templates/design/vendor/react-dom.production.min.js`, `templates/design/vendor/DesignCanvas.js`, `templates/design/vendor/fetch-vendor.mjs` or `lib/design-engine/canvas-wrap.mjs`; `discoverVariants` and `imageDimensions` are exported from `lib/design-engine/artifact-adapter.mjs`. In a session directory written by an earlier version, delete `variant-{X}.html` and `vendor/` before running `design-engine board` there.
