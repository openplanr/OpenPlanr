---
'planr-pipeline': patch
---

The artifact sandbox guards that `lib/artifact/bridge.mjs` injects (the worker, frame and review-shell scripts) are now modules under `lib/artifact/ui/sandbox/`, bundled at generate time into `lib/artifact/ui/generated/sandbox-guards.mjs`. The injected scripts do the same things in the same order; their text is now esbuild-formatted, so each is about 11% larger.
