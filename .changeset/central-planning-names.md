---
'@openplanr/protocol': patch
'openplanr': patch
'planr-pipeline': patch
---

`@openplanr/protocol/names` exports `PLANNING_FOLDER` and `CLI_COMMAND`, the planning folder and command names. The CLI, the pipeline and the bundled sync skill read them from there instead of spelling them out. Output is unchanged.
