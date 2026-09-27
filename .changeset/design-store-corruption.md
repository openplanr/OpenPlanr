---
'planr-pipeline': patch
'@openplanr/design': patch
'@openplanr/artifact': patch
---

The design board no longer overwrites a board's `feedback.json` or the board token store `tokens.json` when it cannot read one: the file is kept, so earlier pins and other boards' URLs survive, and the board, the board command and `feedback resolve` report an error that names the file, without quoting it, and says how to recover. `planr-design setup` likewise leaves an unreadable `credentials.json` in place instead of replacing it, creates the file and a missing `~/.planr` owner-only from the start, and running daemons restart on the next board command (daemon version 6).
