---
'openplanr': patch
'planr-pipeline': patch
'@openplanr/protocol': patch
---

The plan skill's ID helper now accepts only the planning folder your `.planr/config.json` configures, including an empty one in a new project. For any other folder it stops with an error naming the config it checked and the folder it expects, instead of offering `US-001` and `T-001`. It no longer creates the folder when reserving IDs.
