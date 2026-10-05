---
'openplanr': minor
'@openplanr/pipeline': patch
'@openplanr/protocol': patch
---

The command is now `openplanr`, with `opr` as its short alias. `planr` keeps working in this release and prints a one-line notice; it will be removed in the next release, so switch scripts, shell aliases and CI to `openplanr` or `opr`. `openplanr doctor` reports installed skills that still use the old command and how to refresh them. Skill names such as `/planr:plan`, the `planr` plugin and the `.planr/` folder are unchanged.
