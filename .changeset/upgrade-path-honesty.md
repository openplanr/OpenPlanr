---
"openplanr": patch
---

Stop `planr upgrade` from offering a downgrade, and make it actually print the plugin-half commands it promises.

**An installed version ahead of the registry is no longer an "upgrade".** Drift was computed
as plain inequality, so "different" and "older" were the same thing: anyone on a build ahead
of published — a linked dev build, a prerelease, a maintainer mid-release — was offered a
downgrade labelled as an upgrade, and accepting "always keep me current" would have rolled
the newer build back on every invocation. Only a version strictly *behind* now counts.
Range violations are untouched, since those are direction-independent.

**The prescription is no longer promised and withheld.** When the CLI is already current but
the host plugins trail — the state every release creates for anyone who upgrades the npm half
first — `apply` returned early with a message ending "run the prescribed commands below" and
then printed nothing, on both the human and `--json` surfaces. The commands are now built on
that path too, from the same helpers the post-upgrade path uses, so the two can never print
different instructions for the same machine.

**The skills plugin is no longer silently omitted.** The version the CLI targets for the
skills bundle had drifted three releases behind, and because the prescription derives its
target from it, a genuinely stale skills plugin was left out of the commands entirely — a
user could run every prescribed command and still be behind, believing they were current.
