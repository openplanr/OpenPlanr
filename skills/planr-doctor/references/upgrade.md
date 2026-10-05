# Driving an OpenPlanr upgrade

`openplanr doctor` diagnoses; this reference is how to *act* once the tuple has
drifted. An OpenPlanr install has two parts: the npm CLI, and what `openplanr setup`
installed into each coding agent from that CLI — the `planr@openplanr-local`
Claude Code plugin, Codex skills, Cursor rules. `openplanr upgrade apply` moves the
npm CLI itself and never changes a coding agent; the upgraded CLI then hands back
one command per installed agent, and this skill runs them and confirms the result.

The cardinal rule: **name the actions, let the engine own the list.** Every
command you run comes from the CLI's own output. The skill never carries its own
copy of those commands — the moment it did, it would drift from the CLI the first
time the integration changed. The upgraded CLI plans them with the same preview
`openplanr runtime update` and `openplanr setup` apply, so they cannot diverge. A retired
remote plugin (`openplanr@openplanr`, `planr-pipeline@openplanr`) only ever leaves
through the `openplanr setup … --replace-managed` command the list carries; an
instruction to install one did not come from the CLI.

## 1. Decide whether to act

```bash
openplanr upgrade status --json
```

Shape (the fields this skill reads):

```json
{
  "status": "upgrade-available",
  "installed": { "cli": "2.2638.0", "skills": "2.2638.0", "pipeline": null },
  "bundledPipeline": "0.52.1",
  "published": {
    "cli": { "version": "2.2639.1" },
    "skills": { "version": "2.2639.1" },
    "pipeline": { "version": "0.52.1" }
  },
  "legacyPlugins": [],
  "ecosystemSource": "network",
  "nextSteps": []
}
```

- `installed.skills` is the installed version of `planr@openplanr-local`; `null`
  means Claude Code was not detected or `openplanr setup` has not installed the
  plugin. `installed.pipeline` is always `null` — the pipeline ships inside the
  CLI, and `bundledPipeline` reports it.
- `nextSteps` lists what each coding agent needs to match the installed CLI,
  in the shape step 2 describes.
- `aligned` or `unknown` with empty `nextSteps` → nothing to drive. Report and
  stop. (`unknown` means the published manifest was unreachable — say so; do not
  guess.)
- `upgrade-available` or `incompatible` → act. First **record the `installed`
  block as the before state** — the honest diff at the end depends on it. When
  only `nextSteps` is non-empty, skip to step 3.

## 2. Upgrade the CLI and obtain the next steps

Confirm with the user first (this upgrades the npm CLI), then:

```bash
openplanr upgrade apply --yes --json
```

On success the output carries `nextSteps`, planned by the newly installed CLI:

```json
{
  "ok": true,
  "cliUpgraded": true,
  "previousVersion": "2.2638.0",
  "installedVersion": "2.2639.1",
  "releaseNotes": [{ "version": "2.2639.1", "entries": ["…"] }],
  "nextSteps": [
    {
      "runtime": "claude-code",
      "host": "Claude Code",
      "command": "<one openplanr command>",
      "detail": "<what it changes>"
    }
  ]
}
```

The `command` values above are shown as placeholders on purpose: **run whatever
the array actually contains, in the order it gives — never a command typed into
this file.** Other shapes:

- An empty array: every installed coding agent already matches the new CLI.
- `nextStepsError` instead of steps: the upgraded CLI could not be asked. Run
  `openplanr upgrade status --json` and use its `nextSteps`.
- An `openplanr doctor` command: planning that agent's update failed, and `detail`
  says why. Relay it and run `openplanr doctor --json`.

`pluginHalfCommands` repeats the commands for older readers; read `nextSteps`.

If `apply` reports `ok: false`, stop and surface its `failure.message`; the CLI
restores the previous version on a bad install, so report what it says was
restored rather than continuing to the coding agents.

## 3. Run the next steps

Run each `command` of `nextSteps` verbatim, top to bottom, with your shell tool.
Each one refreshes the bundled `openplanr-local` marketplace before it updates the
plugin, so **do not reorder, drop, merge, or hand-edit a command**. If one fails,
stop and report the failure and every agent still on the old version — a partial
upgrade that reports success is the one outcome to avoid.

Then tell the user to restart each `host` the steps named; a running coding agent
keeps the old plugin and skills until it restarts.

## 4. Verify, then report what actually changed

```bash
openplanr upgrade status --json
openplanr doctor --json
```

Compare the new `installed` block against the before state you recorded, and
report the real difference — per component, old → new:

```
CLI                     2.2638.0 → 2.2639.1   moved
planr@openplanr-local   2.2638.0 → 2.2639.1   moved
```

`nextSteps` should now be empty. `openplanr doctor` adds what `upgrade status` does
not judge. A `runtime-claude-duplicate-plugin` warning means a second `planr`
plugin (usually `planr@openplanr`, installed from the public marketplace) sits
beside the setup-managed one, and both expose the same `/planr` commands. Its `fix`
carries the exact `claude plugin uninstall` command: relay it, and run it only
when the user asks — nothing removes a duplicate automatically. An
`installed-skill-commands` warning means installed skills still use the old
command name; relay its `fix`, which names the setup command that refreshes them.

State the outcome from this second reading, never from the commands you ran. If
a component did not move, say so plainly and name the likely cause (most often a
command that failed or a coding agent that was not restarted). "Upgraded" is a
claim about the after state — earn it with the re-check.
