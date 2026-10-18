---
'openplanr': minor
---

Ship and Investigate now keep what they notice outside your task. Each finding is listed with its evidence and severity, apart from anything that blocks the task, and offered as a backlog item: one question files all, some or none of them, and anything already in your backlog is shown as tracked instead of filed again. Runs nobody can answer report findings without filing them, unless `.planr/config.json` sets `"findings": { "unattended": "file" }`. Filing works without the CLI installed and writes the same file `openplanr backlog add` does.

`openplanr backlog list` and the other list commands now show each item's title, `Created` prints the path relative to your project, acceptance criteria passed as a list are written one per line, and settings you add to `.planr/config.json` are kept when OpenPlanr saves it.
