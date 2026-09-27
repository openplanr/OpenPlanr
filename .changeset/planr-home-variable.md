---
'openplanr': patch
'planr-pipeline': patch
---

`PLANR_HOME` now also relocates the CLI's runtime state and backups, the pipeline runtime lookup and `doctor`, and design share custody, as it already did for the design engine and the review and dashboard daemons. `OPENPLANR_HOME` is deprecated: when `PLANR_HOME` is unset it still resolves to `$OPENPLANR_HOME/.planr`, and it prints a one-time warning on stderr; when both are set, `PLANR_HOME` wins. Design share custody kept under `OPENPLANR_HOME` moves from `$OPENPLANR_HOME/design-shares` to `$OPENPLANR_HOME/.planr/design-shares`, so move that directory if you set the variable. The doctor skill documents both variables.
