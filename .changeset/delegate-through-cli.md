---
'openplanr': minor
'planr-pipeline': minor
---

The Delegate skill now hands work to Claude Code, Codex or Cursor with written steps, so the OpenPlanr plugins for Claude Code, Codex and Cursor no longer ship its scripts and Delegate needs neither Node nor the CLI.

- It creates a git worktree for the task, writes a brief with the scope and your repository's real checks, and runs `codex exec`, `claude -p` or Cursor's `agent` there with edit permission.
- It reads the diff itself, runs the checks, and applies only in-scope changes to your checkout. The delegated agent never commits.
- It stops and tells you when the CLI is missing or signed out, when an API key is set in your environment that you did not choose, when the agent edits outside the scope, or when a check fails.
- A profile is a native config directory and a model, such as `CODEX_HOME` or `CLAUDE_CONFIG_DIR`. Delegate checks who is signed in with the CLI's own status command and never reads credentials.

The new `openplanr delegate` command keeps the recorded flow (context capsule, worktree custody, recorded checks and exact-session resume). Delegate uses it when `openplanr` 3.7.0 or later is installed and you want that record. With `--json`, each command prints `ok`, its result and a `next` step, or a `code`, `problem` and `recovery` on failure. Runs you started with an earlier version finish on the code that prepared them.

In that command, the coding agent no longer inherits your whole environment. It gets the basics (paths, locale, terminal, proxy and certificates), its config directory and the routing variables delegation reads, and nothing else (no key, token or custom header) unless a saved profile lists it in `allowedEnv`. A check gets the variables named in its `env` list, such as `"env": ["DATABASE_URL"]`.
