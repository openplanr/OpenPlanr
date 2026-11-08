---
"openplanr": minor
---

Plan now picks story and task IDs by following written steps, so the OpenPlanr plugins for Claude Code, Codex and Cursor no longer ship a script for it and Plan needs no Node to number your work.

Plan reads `.id-sequence.json` and your existing specs, takes the next free `US-` and `T-` number, never overwrites an existing file, and moves the sequence forward in the same format the CLI writes. Projects planned with either one keep counting from the same place.

Plan waits for, and then stops on, the lock an `openplanr` command holds while it reserves IDs. It can't take that lock itself, so two Plan sessions, or a Plan session and an `openplanr` command, working in the same checkout at the same moment can still pick the same number. Plan in one session at a time, or create specs with the `openplanr` CLI when you need that guarantee.
