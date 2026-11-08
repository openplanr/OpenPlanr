---
'openplanr': minor
---

The Release skill now gathers what shipped by following written steps with `git`, instead of running a bundled shell script. The OpenPlanr plugins for Claude Code, Codex and Cursor no longer ship that script.

- It finds the window the same way: your date, else since the last tag, else all history.
- It lists the five most recent tags, the commits in the window without merges, and the files touched grouped by area.
- It lists merged pull requests only when they help and `gh` is installed, and it tells you if the `gh` query fails.

Nothing changes in how you ask for a release, with or without the CLI installed.
