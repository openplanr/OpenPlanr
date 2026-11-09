# OpenPlanr CLI

This step runs in the `openplanr` CLI. The skill ships no runtime of its own.
Version {{PLUGIN_VERSION}} matches this plugin; the commands need {{SKILL_CLI_MINIMUM}} or later.

## Probe

Run `openplanr --version` once, using the `openplanr` on `PATH`. Never search for
another copy, inspect `node_modules`, or import its modules.

| Probe result | Next action |
|---|---|
| A version of {{SKILL_CLI_MINIMUM}} or later | Run the command. |
| `openplanr` not found | **Stop: no CLI.** Tell the user the step needs the CLI, then run that one command as `npx -y openplanr@{{PLUGIN_VERSION}} <command>`, or give `npm install -g openplanr@{{PLUGIN_VERSION}}`. On Codex, give only the install command; never run `npx` there. |
| A version below {{SKILL_CLI_MINIMUM}}, or `unknown command`, `unknown option` or `too many arguments` from the command | **Stop: CLI too old.** Give `npm install -g openplanr@{{PLUGIN_VERSION}}`. |

After any stop, finish the work that does not need the CLI, report the step as not
run, and name the command that would run it.

## Results

Run the command with `--json`. Every result has `ok`. On success it also has
`contract` and `next`, the one step to take now. On failure it has `code`, `problem`
and `recovery`, the step that fixes it; the exit code is 1. Report the outcome first,
then the details, then `next` or `recovery`. Never retry a failed write on your own.
