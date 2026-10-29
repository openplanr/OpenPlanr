---
'openplanr': minor
---

`openplanr ship checks --tier push` now lists `npm pack --dry-run --json --ignore-scripts` for each published package that gains non-code files such as JSON data or templates, with the new files to account for: each is in the tarball or deliberately left out. The JSON result moves to schema `1.2.0`.
