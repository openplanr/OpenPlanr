---
'openplanr': minor
---

`openplanr ship checks --tier push` now lists `npm pack --dry-run --json --ignore-scripts` for each published package that gains non-code files such as JSON data or templates, with the new files to confirm in the tarball. The JSON result moves to schema `1.2.0`.
