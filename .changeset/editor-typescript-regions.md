---
'planr-pipeline': patch
---

The diagram editor regions in `lib/artifact/ui` (`diagram-editor`, `diagram-editor-canvas`, `-chrome`, `-commands`, `-dialogs`, `-inspector`, `-keyboard` and `-outline`) are now compiled from TypeScript sources at build time, and `diagram-editor.d.mts` is generated instead of hand-maintained. The `./diagram-editor` export and its declared types are unchanged. The hand-written `diagram-editor-context.d.mts` is removed; its internal types now live in the modules that implement them and in the new `diagram-editor-regions.d.mts`. The compiled modules are token-identical to the JavaScript they replace.
