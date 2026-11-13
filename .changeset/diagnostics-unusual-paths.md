---
"openplanr": patch
"@openplanr/dashboard-app": patch
---

Data health now lists a finding whose item id or source path contains a colon or a percent sign, with the path as written, instead of failing the whole read. A backslash in a file name is shown as a replacement character.
