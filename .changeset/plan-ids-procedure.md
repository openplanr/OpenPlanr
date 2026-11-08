---
"openplanr": minor
---

Plan now picks story and task IDs by following written steps, so the OpenPlanr plugins for Claude Code, Codex and Cursor no longer ship a script for it and Plan needs no Node to number your work.

Plan reads `.id-sequence.json` and your existing specs, takes the next free `US-` and `T-` number, never overwrites an existing file, and moves the sequence forward in the same format the CLI writes. Projects planned with either one keep counting from the same place.

If two agents plan in the same checkout at the same moment, they can now pick the same number, because written steps can't lock the file the way the script did. Plan in one session at a time, or create specs with the `openplanr` CLI when you need that guarantee.
