---
'planr-pipeline': patch
'@openplanr/artifact': patch
---

The generated browser bundles under `templates/` start with a banner naming their generator and keep third-party license headers such as pako's in place. `lib/artifact/ui/generated/artifact-shell-assets.json` (schema 1.1.0) records a raw and gzip byte budget beside each asset digest.
