---
"openplanr": patch
"@openplanr/dashboard-app": patch
---

Data health now lists a finding whose item id or source path contains a colon or a percent sign, with the path as written, instead of failing the whole read. A backslash in a file name is shown as a replacement character. A file without an id whose name would give an id with a backslash or a control character is listed as an unrecognized identity, and Board, List and Detail keep working.
