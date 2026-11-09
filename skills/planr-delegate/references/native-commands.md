# Native commands

Checked against codex-cli 0.162.1, Claude Code 2.1.319 and Cursor agent 2026.11.05.
Flags change between versions: run the command's `--help` before the first use and
name any flag you could not confirm.

## Run

`<dir>` is the worktree, `<brief>` the brief file, `<out>` a directory outside the
worktree.

| Engine | Command |
|---|---|
| Codex | `codex exec --json -o <out>/last.md -C <dir> -s workspace-write [-m <model>] - < <brief> > <out>/events.jsonl` |
| Claude Code | `cd <dir> && claude -p --permission-mode acceptEdits --output-format json [--model <model>] < <brief> > <out>/result.json` |
| Cursor | `agent -p --trust --workspace <dir> --output-format json [--model <model>] "$(cat <brief>)" > <out>/result.json` |

`workspace-write` and `acceptEdits` let a stock install edit files in the worktree. When
the user's own settings choose a sandbox or permission mode (Codex `sandbox_mode`,
Claude `permissions.defaultMode`), leave the flag out so their choice applies. Cursor's
`-p` can already run shell commands its allowlist permits; add the commands the task
needs to `~/.cursor/cli-config.json` before the run.

With a profile, prefix the command with its directory: `CODEX_HOME=<dir> codex …` or
`CLAUDE_CONFIG_DIR=<dir> claude …`. Never share a Claude config directory's
`projects/` or `history.jsonl` with another directory.

## Session and resume

Record the session id: Codex's `thread.started` event `thread_id`, Claude's
`session_id` in `result.json`, Cursor's `session_id`. Resume only that session:

| Engine | Resume |
|---|---|
| Codex | `codex exec resume <session-id> - < <correction>` with the same `-C`, `-s` and `-o` |
| Claude Code | `cd <dir> && claude -p -r <session-id> --permission-mode acceptEdits --output-format json < <correction>` |
| Cursor | `agent -p --resume <session-id> --trust --workspace <dir> --output-format json "$(cat <correction>)"` |

Never resume "the latest" session (`--last`, `--continue`). A permission denial is an
attention state: the user resolves it in that CLI's configuration, then you resume the
same session.

## Choosing an engine and model

Precedence: what the user named, then their saved profile, then the only installed
engine; otherwise ask, engine first. A profile or model name does not prove where
inference runs. For a request to run locally, confirm the routing in the engine's own
configuration (Claude `ANTHROPIC_BASE_URL` in its settings, Codex `model_provider` in
`config.toml`) before the run, and never fall back to a cloud model.

## Several tasks

Give each task its own worktree, branch and brief. Run them one at a time unless the
user asked for parallel runs and their scopes do not overlap. Integrate and gate each
patch before applying the next, so a failure points at one task.
