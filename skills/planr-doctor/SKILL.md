---
name: planr-doctor
description: Diagnose OpenPlanr CLI, pipeline, runtime-adapter, installation, and lock health. Use when setup, discovery, versions, generated assets, or runtime behavior seems wrong.
license: MIT
---

# Planr Doctor

Run `planr doctor` with the requested flags. Prefer `--json` for diagnosis.
Preview every repair; package installation, version changes, provenance recovery,
and deletion always require explicit confirmation.

## Driving an upgrade

`planr upgrade` moves only half of an OpenPlanr upgrade — the npm CLI. The other
half is the Claude Code plugin that `planr setup` installs from the bundled
`openplanr-local` marketplace, and the upgrade never changes that plugin itself:
it hands back the exact commands. Driving them with host shell access is this
skill's job, then reporting what actually changed — never what was merely
attempted.

1. **Decide.** Run `planr upgrade status --json` and read `status`. If it is
   `aligned` or `unknown`, there is nothing to drive — report it and stop.
   Record the reported `installed` versions; that is the before state.
2. **Own half, prescribe half.** If `status` is `upgrade-available` or
   `incompatible`, confirm with the user (this upgrades the npm CLI), then run
   `planr upgrade apply --yes --json`. The CLI performs the npm half itself and
   returns the plugin half as an ordered `pluginHalfCommands` array — the exact
   argv it would run, so the list can never drift from the engine. Take the
   commands from there; never write a plugin command of your own.
3. **Refresh first, then execute in order.** Run every entry of
   `pluginHalfCommands` verbatim, in the array's given order, with your shell.
   The first entry is either the `openplanr-local` marketplace refresh or a
   single `planr setup …` command (when that marketplace was never registered);
   it must run first: skip the refresh and the installer reinstalls the cached,
   stale version while the user believes they upgraded. Do not reorder, drop, or
   substitute an entry.
4. **Verify and report the real diff.** Re-run `planr upgrade status --json` and
   compare its `installed` versions against the before state. Report only what
   actually moved and to what. If a component did not move, say so — never claim
   "upgraded" for a version that did not change.

For the longer walkthrough, JSON output shape, and reporting format, read the
[upgrade guide](references/upgrade.md).
