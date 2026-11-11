---
name: planr-delegate
description: Coordinate an explicitly requested implementation with Claude Code, Codex or Cursor, then independently review and integrate its observed changes. Use when the user asks another coding agent to implement.
license: MIT
---

# OpenPlanr Delegate

Hand one coherent repository scope to the user's installed Claude Code, Codex or Cursor
CLI. The delegate investigates, implements, builds, tests and corrects. You own the
scope, the brief, independent review, acceptance and integration. Ordinary
implementation stays with `planr-ship`.

Without a profile, use the native loop below. A saved profile runs only through
[the CLI path](references/openplanr-cli.md), which also adds the capsule, custody,
recorded checks and resume when the user wants them.

## Native loop

Agree the engine, model and optional profile with the user first. When `openplanr` is on
`PATH`, run `openplanr delegate probe --json` and offer `result.profiles` (saved profiles,
local-model ones included) alongside the installed engines, each labelled with its `kind`,
`selectedModel` (none means the native default) and `destination.class`. Then probe the
chosen engine or profile with `engine` or `profile` and read `result.selected.identity`
(missing means sign-in was not checked) and `destination.class`. A profile's name does not
prove local routing: for a local run, rely on the probe's destination; if it is not local,
stop, and never fall back to a cloud model. Without `openplanr`, run the engine with its
own default sign-in and no profile, and offer to have the user install `openplanr` for
profiles or a local run. Sign-in stays in each engine's own CLI.

1. **Worktree.** From a clean base, `git worktree add -b planr-delegate/<slug> <dir> HEAD`
   with `<dir>` outside the checkout. Copy any uncommitted parent file the task needs,
   then commit it there with `--no-verify` as the base. Record the base commit.
2. **Brief.** Write it to a file outside the worktree: goal, current state, scope paths,
   paths not to touch, the repository's real gate commands, the report you expect back,
   and "Do not commit." Include required ignored planning files by path; never summarize
   a required source.
3. **Run.** Start the native CLI in the worktree with its edit permission and the brief,
   as [native commands](references/native-commands.md) shows. Check each command and
   flag against the installed `--help` first and name any you could not verify. No
   bypass, force, yolo or approve-all flags.
4. **Observe.** Read its final message, then `git -C <dir> add -A` and
   `git -C <dir> diff --cached --stat <base>` and the full diff. A summary is a claim,
   not evidence.
5. **Review and integrate.** Every changed path must be in scope. Run the gates
   yourself in the worktree. Send findings back to the same session; do not fix its
   work yourself. When accepted, write `git -C <dir> diff --cached --binary <base>` to a
   patch, run `git apply --check` then `git apply` in the parent checkout, and remove
   the worktree and branch. The delegate never commits; you commit only when the user
   asked. Keep the worktree on any stop.

## Stops

| Stop | Condition | Next |
|---|---|---|
| No local shell | The host cannot run commands, such as ChatGPT | Say that delegation needs a coding agent with a shell. |
| CLI missing | The engine's command is not on `PATH` | Name its install command; do not install it yourself. |
| Not signed in | The probe's `identity.state` is `signed-out`, or the run reports a sign-in failure | Show the probe's `nextAction`, or ask the user to sign in with that CLI's own login. |
| API-key sign-in | The probe's `identity.state` is `api-key` | Tell the user before running and let them choose whether to continue. |
| Not local | The user asked for a local run and the probe's `destination.class` is not `local` | Stop; never fall back to a cloud model. |
| Out of scope | A changed path is outside scope or in a protected path | Send it back, or ask the user to widen the scope. |
| Gates fail | A gate exits non-zero | Send the output back to the same session; integrate nothing. |
| Patch conflict | `git apply --check` fails | Report the paths; never overwrite the user's edits. |

## Return

Lead with the outcome: integrated, sent back, or stopped (name the stop). Then the
changed files with line counts, each gate with its exit code, the delegate's own claims
labelled as claims, the worktree and branch if kept, and a `Next:` line. After an
integration the user did not ask you to commit, that line offers the exact command:
`git add <changed paths> && git commit -m "<type(scope): summary>"`.
