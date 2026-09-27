---
'planr-pipeline': patch
---

The diagram editor kernel core in `lib/artifact/diagram/editor` (`session`, `clipboard`, `draft`, `recovery`, `transport`, `cancellation` and `index`) is now compiled from TypeScript sources at build time, and `index.d.mts`, the `./diagram-editor` declaration, is generated instead of hand-maintained. The `./diagram-editor` and `./diagram-owner` exports and their declared types are unchanged; each module now also ships its own generated `.d.mts`. The compiled modules are token-identical to the JavaScript they replace.
