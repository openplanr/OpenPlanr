---
'openplanr': patch
'planr-pipeline': patch
'@openplanr/protocol': patch
---

The bundled design helper in the design, design-loop, design-review and plan skills now ships as `scripts/design.mjs` plus flat sibling `scripts/design-*.mjs` modules, each under 256 KiB and unminified, so the Claude Code plugin meets the plugin directory's per-file size limit. Commands, flags and output are unchanged. The skill registry and the pipeline's protocol projection carry the new resource digests.
