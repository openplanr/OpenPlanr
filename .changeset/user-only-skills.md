---
'openplanr': minor
---

Skills can be marked as run only when you ask for them by name. Claude Code skills marked this way carry `disable-model-invocation: true`, Codex skills set `allow_implicit_invocation: false`, and Cursor rules apply only when you mention them. The generated `CLAUDE.md` and `AGENTS.md` list such skills as user-invoked, so the agent points you to them instead of running them.
