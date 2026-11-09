---
'openplanr': minor
---

Operate and its CEO, CTO, CPO, CMO, COO, Challenger and Chair reviews now check their notes against a written checklist (`references/note-checklist.md`) instead of running a bundled Node script. Plugin installs no longer ship `scripts/validate-note.mjs` or `runtime/operate/`, so the check works without Node. If `openplanr` is on your PATH, `openplanr operate validate-note` still runs the same checks. The checklist reports a missing section once, treats a note without a contract line as valid, and ends with one sorted `CODES:` line.
