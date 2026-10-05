---
name: planr-doctor
description: Diagnose OpenPlanr CLI, pipeline, runtime-adapter, installation, and lock health. Use when setup, discovery, versions, generated assets, or runtime behavior seems wrong.
license: MIT
---

# OpenPlanr Doctor

Run `openplanr doctor` with the requested flags. Prefer `--json` for diagnosis.
Preview every repair; package installation, version changes, provenance recovery,
and deletion always require explicit confirmation.

## OpenPlanr home

`PLANR_HOME` names the user-level state directory, `~/.planr` by default: runtime
installs, backups, daemon state and design sessions live there. `OPENPLANR_HOME` is
deprecated; with `PLANR_HOME` unset it still resolves to `$OPENPLANR_HOME/.planr` and
prints one warning, and when both are set `PLANR_HOME` wins. CLI credentials,
company sign-in and design share custody honor that home. Existing private design
share custody under `~/.openplanr/design-shares` is read and safely moved only when
its canonical destination is absent. Existing destinations are never overwritten.
When state seems missing, check which variable is set.

Doctor also reports healthy owned local services. Use `openplanr server list --json`
to inspect their instance IDs, project and runtime. `openplanr server stop <instance>`
authenticates that exact service, drains pending saves and requests shutdown.
A port or process ID is never shutdown authority; legacy unowned services remain
untouched.

## Driving an upgrade

`openplanr upgrade` moves only half of an OpenPlanr upgrade — the npm CLI. The other
half is the Claude Code plugin that `openplanr setup` installs from the bundled
`openplanr-local` marketplace, and the upgrade never changes that plugin itself:
it hands back the exact commands. Driving them with host shell access is this
skill's job, then reporting what actually changed — never what was merely
attempted.

1. **Decide.** Run `openplanr upgrade status --json` and read `status`. If it is
   `aligned` or `unknown`, there is nothing to drive — report it and stop.
   Record the reported `installed` versions; that is the before state.
2. **Own half, prescribe half.** If `status` is `upgrade-available` or
   `incompatible`, confirm with the user (this upgrades the npm CLI), then run
   `openplanr upgrade apply --yes --json`. The CLI performs the npm half itself and
   returns the plugin half as an ordered `pluginHalfCommands` array — the exact
   argv it would run, so the list can never drift from the engine. Take the
   commands from there; never write a plugin command of your own.
3. **Refresh first, then execute in order.** Run every entry of
   `pluginHalfCommands` verbatim, in the array's given order, with your shell.
   The first entry is either the `openplanr-local` marketplace refresh or a
   single `openplanr setup …` command (when that marketplace was never registered);
   it must run first: skip the refresh and the installer reinstalls the cached,
   stale version while the user believes they upgraded. Do not reorder, drop, or
   substitute an entry.
4. **Verify and report the real diff.** Re-run `openplanr upgrade status --json` and
   compare its `installed` versions against the before state. Report only what
   actually moved and to what. If a component did not move, say so — never claim
   "upgraded" for a version that did not change.

For the longer walkthrough, JSON output shape, and reporting format, read the
[upgrade guide](references/upgrade.md).

## Return

Lead with the diagnosed or repaired state. Summarize actual changes, linking
relevant files and showing before/after versions only for components that moved.
State which health checks were executed and what remains unverified. For a
partial repair or blocker, retain successful work and show the exact recovery
command or missing decision. Do not repeat long logs or claim that an attempted
repair succeeded. Different summary wording never causes another repair.
