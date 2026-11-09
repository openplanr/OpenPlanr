# OpenPlanr CLI for runtime skills

This skill's runtime is the `openplanr` command-line tool,
version 3.7.0 or later. Use the `openplanr` on `PATH`; never search
`node_modules`, import its packages, or look for bundled scripts.

## Probe

Run once before the first command:

```sh
openplanr --version
```

| Result | Stop | Next action |
|---|---|---|
| A version ≥ 3.7.0 | None | Use the commands in the skill. |
| `openplanr` not found | Stop 1: no CLI | Tell the user, then run the one command as `npx -y openplanr@3.6.0 <command>`, or give `npm install -g openplanr@3.6.0`. On Codex give only the install command. |
| A version below 3.7.0, or `unknown command` | Stop 2: CLI too old | `npm install -g openplanr@3.6.0` |
| Delegate: `E_DELEGATE_RUNTIME_MISSING` | Stop 3: CLI without its workflow package | `npm install -g openplanr@3.6.0`, without `--omit=optional` |

| Host | Missing CLI |
|---|---|
| Claude Code, Cursor | Say that the CLI is missing, then run the pinned `npx` form. |
| Codex | Give `npm install -g openplanr@3.6.0` and stop; never run `npx`, which the sandbox may block. |
| ChatGPT, or no local shell | Stop 1 with the install command for a coding agent that has a shell. |

At a stop, report the step as not run and name the command the user can run. Never
replace the CLI with your own scripts.

## Results

Pass `--json` on every call. Read `ok` first.

- `ok: true`: `result` holds the command's fields and `next` says what to run or
  decide next.
- `ok: false`, exit code 1: `code`, `problem` and `recovery` say what failed and how to
  recover; `runId` and `details` appear when they apply. Show the problem and the
  recovery; never retry with changed input the user did not approve.
