---
'openplanr': minor
---

`/ship` now finds verification checks by reading the task's test requirements, repository instructions, package scripts and CI config itself, so the plugin no longer bundles a discovery script that needed Node. If `openplanr` is on your `PATH`, `openplanr ship checks` still adds its completeness report. It always lists the pre-commit and pre-push hooks when present, and lists every CI job a `changes` job gates as conditional, running it when a local equivalent exists.
