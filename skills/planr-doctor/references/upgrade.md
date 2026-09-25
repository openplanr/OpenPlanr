# Driving an OpenPlanr upgrade

`planr doctor` diagnoses; this reference is how to *act* once the tuple has
drifted. An OpenPlanr install has two halves: the npm CLI, and the Claude Code
plugin that `planr setup` installs from the marketplace bundled with that CLI —
`planr@openplanr-local`, from the `openplanr-local` directory marketplace.
`planr upgrade apply` moves the npm half itself and never changes Claude's plugin
state; it hands back the exact commands for the plugin half, and this skill runs
them inside the host and confirms the result.

The cardinal rule: **name the actions, let the engine own the list.** Every
plugin command you run comes from the CLI's own output. The skill never carries
its own copy of those commands — the moment it did, it would drift from the CLI
the first time the integration changed. The CLI renders the list from the same
inspection `planr setup` and `planr doctor` use, so it cannot diverge from them.
The retired remote plugins (`openplanr@openplanr`, `planr-pipeline@openplanr`)
only ever appear in that list as removals; an instruction to install one did not
come from the CLI.

## 1. Decide whether to act

```bash
planr upgrade status --json
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
  "ecosystemSource": "network"
}
```

- `installed.skills` is the installed version of `planr@openplanr-local`; `null`
  means Claude Code was not detected or `planr setup` has not installed the
  plugin. `installed.pipeline` is always `null` — the pipeline ships inside the
  CLI, and `bundledPipeline` reports it.
- `aligned` or `unknown` → nothing to drive. Report and stop. (`unknown` means
  the published manifest was unreachable — say so; do not guess.)
- `upgrade-available` or `incompatible` → act. First **record the `installed`
  block as the before state** — the honest diff at the end depends on it.

## 2. Perform the owned half and obtain the prescription

The plugin commands are rendered by the CLI from the bundled marketplace's own
operation list, so they always match what `planr setup` would really run. Confirm
with the user first (this upgrades the npm CLI), then:

```bash
planr upgrade apply --yes --json
```

On success the output carries the ordered `pluginHalfCommands` array:

```json
{
  "ok": true,
  "cliUpgraded": true,
  "installedVersion": "2.2639.1",
  "changelogBullets": ["…"],
  "pluginHalfCommands": [
    "<refresh the bundled openplanr-local marketplace — always position 0>",
    "<update planr@openplanr-local from it>",
    "<remove a retired plugin — only when one is still installed>"
  ]
}
```

The entries above are shown as roles, not literal strings, on purpose: **execute
whatever the array actually contains, in the order it gives — never a list typed
into this file.** Two other shapes are possible:

- An empty array: Claude Code was not detected, or its plugin state could not be
  inspected (`claude plugin list --json` failed). Run `planr doctor --json` to
  find out which, then go to step 4. When `planr@openplanr-local` already matches
  the new CLI the array is not empty: it holds the lone
  `claude plugin marketplace update openplanr-local` refresh — run it as usual.
- A single `planr setup --runtime claude --scope user` entry, with
  `--replace-managed` appended when a retired plugin must also be removed (setup
  refuses that removal without the flag): the bundled marketplace was never
  registered on this machine, and setup is the only command that registers it and
  records the installation. In a non-interactive shell it stops with
  `E_CONFIRMATION_REQUIRED`; show the user the preview (the same command with
  `--dry-run`) and rerun it with `--yes` only after they confirm.

If `apply` reports `ok: false`, stop and surface its `failure.message`; the CLI
restores the previous version on a bad install, so report what it says was
restored rather than continuing to the plugin half.

## 3. Execute the plugin half, refresh first

Run each entry of `pluginHalfCommands` verbatim, top to bottom, with your shell
tool. Two invariants:

- **Refresh is position 0 and runs first.** The first entry refreshes the
  `openplanr-local` marketplace, which points at the directory the upgraded CLI
  now bundles. Without it, the installer reinstalls the cached, stale version and
  the user is told they upgraded when nothing moved. The CLI sorts it to position
  0 for exactly this reason; preserve that order.
- **No substitutions.** Do not reorder, drop, merge, or hand-edit a command. If
  an entry fails, stop and report the failure and everything still on the stale
  version — a partial upgrade that reports success is the one outcome to avoid.

## 4. Verify, then report what actually changed

```bash
planr upgrade status --json
planr doctor --json
```

Compare the new `installed` block against the before state you recorded, and
report the real difference — per component, old → new:

```
CLI                     2.2638.0 → 2.2639.1   moved
planr@openplanr-local   2.2638.0 → 2.2639.1   moved
```

`planr doctor` adds what `upgrade status` does not judge. A
`runtime-claude-duplicate-plugin` warning means a second `planr` plugin (usually
`planr@openplanr`, installed from the public marketplace) sits beside the
setup-managed one, and both expose the same `/planr` commands. Its `fix` carries
the exact `claude plugin uninstall` command: relay it, and run it only when the
user asks — nothing removes a duplicate automatically.

State the outcome from this second reading, never from the commands you ran. If
a component did not move, say so plainly and name the likely cause (most often a
skipped or failed marketplace refresh). "Upgraded" is a claim about the after
state — earn it with the re-check.
