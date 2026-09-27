---
'planr-pipeline': patch
---

The artifact review stage, shell, theme tokens, renderers and bridge tools in `lib/artifact/ui` are now compiled from TypeScript sources at build time, and each ships a generated `.d.mts`; every module in the directory is now compiled. The compiled modules are token-identical to the JavaScript they replace, and the review stage bundle is byte-identical.
