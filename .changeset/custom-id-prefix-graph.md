---
"openplanr": patch
"@openplanr/dashboard-app": patch
---

Items written with a custom id prefix, such as `Task-001` or `my_bl-001`, appear again in `openplanr graph`, the dashboard and Home. A planning file with no id is now reported in Data health and on `openplanr graph` stderr instead of disappearing silently.
