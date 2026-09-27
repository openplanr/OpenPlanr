---
'planr-pipeline': patch
---

The diagram studio modules in `lib/artifact/ui` (`diagram-source-panel`, `diagram-conflicts`, `diagram-svg`, `diagram-owner-studio` and `diagram-studio`) are now compiled from TypeScript sources at build time, and `diagram-source-panel.d.mts` is generated instead of hand-maintained. The `./diagram-editor` export and its declared types are unchanged; each module now ships its own generated `.d.mts`. The compiled modules are token-identical to the JavaScript they replace.
