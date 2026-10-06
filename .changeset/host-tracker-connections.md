---
'openplanr': minor
'planr-pipeline': patch
'@openplanr/protocol': patch
---

The sync, sprint and status skills reach GitHub and Linear through your coding agent's own connection, or the GitHub CLI when it is signed in, and name the connection to add when one is missing. They no longer use the Linear token that `openplanr linear` stores; `openplanr linear` keeps working in a terminal. After `openplanr sprint apply`, the sprint skill updates the issue linked to each changed item.
