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

`workspace-write` and `acceptEdits` let a stock install edit files in the worktree. They
can loosen a stricter mode the user configured, so ask the user before adding either flag
and leave it out unless they agree. Cursor's `-p` runs only the shell commands its
allowlist permits; ask the user to allow the commands the task needs in Cursor before the
run.

From inside Codex, its default `workspace-write` sandbox blocks network and writes
outside the workspace, so a nested `claude -p` or `codex exec` may not reach its model or
its config directory. Ask the user to run the command in their own terminal, or to
restart Codex with network and the config directory allowed.

These commands run the engine with its default sign-in. A saved profile runs through
[the CLI path](openplanr-cli.md), never through these commands.

## Session and resume

Record the session id: Codex's `thread.started` event `thread_id`, Claude's
`session_id` in `result.json`, Cursor's `session_id`. Resume only that session:

| Engine | Resume |
|---|---|
| Codex | `codex exec --json -o <out>/last.md -C <dir> -s workspace-write resume <session-id> - < <correction>` (the `exec` flags come before `resume`, which rejects `-C` and `-s`) |
| Claude Code | `cd <dir> && claude -p -r <session-id> --permission-mode acceptEdits --output-format json < <correction>` |
| Cursor | `agent -p --resume <session-id> --trust --workspace <dir> --output-format json "$(cat <correction>)"` |

Never resume "the latest" session (`--last`, `--continue`). A permission denial is an
attention state: the user resolves it in that CLI's configuration, then you resume the
same session.

## Choosing an engine and model

Precedence: what the user named, then their saved profile, then the only installed
engine; otherwise ask, engine first. A profile or model name does not prove where
inference runs. For a request to run locally, rely on `openplanr delegate probe`'s
`destination.class`; if it is not `local`, stop, and never fall back to a cloud model.

## Several tasks

Give each task its own worktree, branch and brief. Run them one at a time unless the
user asked for parallel runs and their scopes do not overlap. Integrate and gate each
patch before applying the next, so a failure points at one task.
