# OpenPlanr CLI

This step runs in the `openplanr` CLI. The skill ships no runtime of its own.
Version 3.7.0 matches this plugin; the commands need 3.7.0 or later.

## Probe

Run `openplanr --version` once, using the `openplanr` on `PATH`. Never search for
another copy, inspect `node_modules`, or import its modules.

| Probe result | Next action |
|---|---|
| A version of 3.7.0 or later | Run the command. |
| `openplanr` not found | **Stop: no CLI.** Tell the user the step needs the CLI, then run that one command as `npx -y openplanr@3.7.0 <command>`, or give `npm install -g openplanr@3.7.0`. On Codex, give only the install command; never run `npx` there. |
| A version below 3.7.0, or `unknown command`, `unknown option` or `too many arguments` from the command | **Stop: CLI too old.** Give `npm install -g openplanr@3.7.0`. |

After any stop, finish the work that does not need the CLI, report the step as not
run, and name the command that would run it.

## Results

Run the command with `--json`. Every result has `ok`. On success it also has
`contract` and `next`, the one step to take now. On failure it has `code`, `problem`
and `recovery`, the step that fixes it; the exit code is 1. Report the outcome first,
then the details, then `next` or `recovery`. Never retry a failed write on your own.
