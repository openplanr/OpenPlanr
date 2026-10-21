---
'openplanr': minor
---

New `openplanr ship checks` lists the checks a change needs, read from your GitHub Actions workflows, husky and pre-commit hooks, package scripts and the task's Test Requirements. It never runs them. Pick a tier with `--tier task|story|push|planning`; without it you get `task`, or `planning` when only `.planr/` files changed. `--json` returns a versioned result.

CI `run` steps come back verbatim, multi-line ones included, with the working directory CI uses and a pointer to the workflow line. A step that only calls a package script is listed once. The build comes first when CI runs it. Static matrix values are expanded, and anything else with an expression is marked for review. Checks that only see tracked or staged files, such as lint-staged, are marked `tracked-only`. Prose Test Requirements and acceptance IDs are returned as entries, and existing tests that mention a name your change exports are listed. A workflow that fails to parse is reported as an error and the result says `complete: false`, so a broken workflow never looks like no checks.

Ship now uses this command to find its checks, and falls back to its packaged helper when the CLI isn't installed.
