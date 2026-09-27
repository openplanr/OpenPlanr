---
'planr-pipeline': patch
---

The diagram editor UI helpers in `lib/artifact/ui` (`diagram-editor-dom`, `diagram-editor-template`, `diagram-editor-host`, `diagram-editor-actions` and `diagram-editor-properties`) are now compiled from TypeScript sources at build time, and each ships a generated `.d.mts`. The package's exports and their declared types are unchanged. The compiled modules are token-identical to the JavaScript they replace.
