---
'planr-pipeline': patch
'@openplanr/design': patch
---

A design board daemon started by the board command now keeps running after the command exits. It used to write its stderr to a pipe the command closed on exit, so its first later message, such as the notice logged when a board registers, failed with `EPIPE` and stopped it, and the printed board URL no longer answered. The daemon now writes its stderr to `daemon.log` in the daemon state directory (`~/.planr/design-daemon/`, owner-only), and the previous daemon's log is kept as `daemon.log.1`. The board command still relays the daemon's startup notices and still fails at once with the daemon's exit code and error when it cannot start.
