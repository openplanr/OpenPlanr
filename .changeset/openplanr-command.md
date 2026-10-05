---
'openplanr': major
'planr-pipeline': patch
'@openplanr/protocol': patch
---

The command is now `openplanr`, with `opr` as its short alias, and the `planr` command is removed so the CLI has one name. Replace `planr` with `openplanr` or `opr` in scripts, shell aliases and CI; after an upgrade started with `planr upgrade apply`, run `openplanr upgrade status` for the remaining steps. Skill names such as `/planr:plan`, the `planr` plugin and the `.planr/` folder are unchanged.
