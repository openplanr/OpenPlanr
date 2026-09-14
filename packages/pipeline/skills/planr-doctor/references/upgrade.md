# Driving an OpenPlanr upgrade

`planr doctor` diagnoses; this reference is how to *act* once the tuple has
drifted. An OpenPlanr install is several moving parts across two package
managers — the npm CLI and the host plugins. `planr` can upgrade the npm half
itself, but a CLI cannot install a host plugin. So the CLI does the half it owns
and hands back the exact commands for the half it cannot; this skill runs them
inside the host and confirms the result.

The cardinal rule: **name the actions, let the engine own the list.** Every
plugin command you run comes from the CLI's own output. The skill never carries
its own copy of those commands — the moment it did, it would drift from the CLI
the first time the integration changed. This is the same staleness a generated
mirror suffers, applied to a command contract; the CLI renders the list from the
plugin integration's own operation set precisely so it cannot diverge.

## 1. Decide whether to act

```bash
planr upgrade status --json
```

Shape (the fields this skill reads):

```json
{
  "status": "upgrade-available",
  "installed": { "cli": "1.22.0", "skills": "1.22.0", "pipeline": "0.38.0" },
  "published": {
    "cli": { "version": "1.23.0" },
    "skills": { "version": "1.23.0" },
    "pipeline": { "version": "0.39.0" }
  },
  "ecosystemSource": "network"
}
```

- `aligned` or `unknown` → nothing to drive. Report and stop. (`unknown` means
  the published manifest was unreachable — say so; do not guess.)
- `upgrade-available` or `incompatible` → act. First **record the `installed`
  block as the before state** — the honest diff at the end depends on it.

## 2. Perform the owned half and obtain the prescription

The plugin commands are rendered by the CLI, from the plugin integration's own
operation list, so they always match what an install would really run. Confirm
with the user first (this upgrades the npm CLI), then:

```bash
planr upgrade apply --yes --json
```

On success the output carries the ordered `pluginHalfCommands` array:

```json
{
  "ok": true,
  "cliUpgraded": true,
  "installedVersion": "1.23.0",
  "changelogBullets": ["…"],
  "pluginHalfCommands": [
    "<marketplace-refresh — always position 0>",
    "<update the OpenPlanr skill plugin>",
    "<update the planr-pipeline plugin>"
  ]
}
```

The entries above are shown as roles, not literal strings, on purpose: **execute
whatever the array actually contains, in the order it gives — never a list typed
into this file.** If `apply` reports `ok: false`, stop and surface its
`failure.message`; the CLI restores the previous version on a bad install, so
report what it says was restored rather than continuing to the plugin half.

## 3. Execute the plugin half, refresh first

Run each entry of `pluginHalfCommands` verbatim, top to bottom, with your shell
tool. Two invariants:

- **Refresh is position 0 and runs first.** The first entry refreshes the plugin
  marketplace metadata. Without it, the installer reinstalls the cached, stale
  version and the user is told they upgraded when nothing moved. The CLI sorts it
  to position 0 for exactly this reason; preserve that order.
- **No substitutions.** Do not reorder, drop, merge, or hand-edit a command. If
  an entry fails, stop and report the failure and everything still on the stale
  version — a partial upgrade that reports success is the one outcome to avoid.

## 4. Verify, then report what actually changed

```bash
planr upgrade status --json
```

Compare the new `installed` block against the before state you recorded, and
report the real difference — per component, old → new:

```
CLI       1.22.0 → 1.23.0   moved
skills    1.22.0 → 1.23.0   moved
pipeline  0.38.0 → 0.38.0   unchanged — still stale
```

State the outcome from this second reading, never from the commands you ran. If
a component did not move, say so plainly and name the likely cause (most often a
skipped or failed marketplace refresh). "Upgraded" is a claim about the after
state — earn it with the re-check.
