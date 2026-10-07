---
'openplanr': major
'planr-pipeline': minor
---

Remove the `planr` and `planr-pipeline` commands. They were kept for one release after the rename to `openplanr`; this is a breaking change for anything that still runs them.

Replace `planr <command>` with `openplanr <command>` or the short alias `opr <command>`, and `planr-pipeline <command>` with `openplanr-pipeline <command>`, in scripts, shell aliases and CI. Upgrading with `openplanr upgrade apply`, the installer or `npm install --global openplanr` removes the old `planr` and `planr-pipeline` links. Then run `openplanr doctor`: if it reports installed skills or rules that still run `planr`, rerun `openplanr setup` for the hosts it names, or update the plugin, and restart the agent. The `planr` npm package is a different product; don't install it to restore the old command.

Skill names such as `/planr:plan`, the `planr` plugin, the `planr-pipeline` npm package and the `.planr/` folder are unchanged.
