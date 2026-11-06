---
'openplanr': minor
'planr-pipeline': minor
---

The design skills now run local design work through `openplanr design`. The OpenPlanr plugins for Claude Code, Codex and Cursor no longer ship a design runtime of their own.

- Design, Design Loop and Design Review check `openplanr design capabilities --json` before they ask you anything. On Claude Code, Design builds on Claude's hosted design canvas when it's available, and that needs no CLI.
- Without a working CLI, the skills still write the design document, its sources and `design-spec.md`, marked unverified, then tell you what to run:
  - `openplanr` not found: `npm install -g openplanr`
  - an older `openplanr`: `npm install -g openplanr@latest`
  - `openplanr` installed with `--omit=optional`: `npm install -g openplanr` without that flag
- Design Review of a hosted canvas design works from the canvas comments.
- Plan reads a local design handoff with `openplanr design handoff`.

Removing a working feature normally waits for a major release. This one ships in a minor release as a deliberate exception: if you used the local design studio from the plugin without the CLI, install it with `npm install -g openplanr` and run the skill again.
