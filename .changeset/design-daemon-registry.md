---
'planr-pipeline': patch
'@openplanr/design': patch
---

The design board daemon no longer replaces an unreadable board registry with an empty one. At startup, a `boards.json` that is not valid JSON or not a map of board ids to directories is moved aside intact to `boards.json.corrupt-<timestamp>`; the board command prints the daemon's notice naming both paths and the parse failure, and the daemon starts empty. Run the board command again to re-register each board. If the registry becomes invalid while the daemon runs, board routes fail with an error naming the file, `/health` still identifies the daemon and reports the error, and the next board command restarts the daemon, which sets the registry aside. A registry the daemon cannot read at all stops it from starting, and the board command now fails at once with the daemon's exit code and error, which names the file, instead of waiting 5 seconds and reporting only a timeout. Registry saves now replace the file atomically with owner-only permissions. The daemon version is now 5, so running daemons restart on the next board command.
