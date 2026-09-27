---
'planr-pipeline': patch
---

`lib/artifact/diagram/editor/geometry-index.mjs` and `local-owner.mjs`, with their `.d.mts` declarations, are now compiled from TypeScript sources at build time instead of hand-maintained. The shipped file list, the `./diagram-editor` and `./diagram-owner` exports and their declared types are unchanged; the compiled modules are token-identical to the JavaScript they replace and every browser bundle is byte-identical.
