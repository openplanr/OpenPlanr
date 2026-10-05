---
'@openplanr/pipeline': minor
'openplanr': patch
'@openplanr/protocol': patch
---

The pipeline package is now published as `@openplanr/pipeline`, and its command is `openplanr-pipeline`. `planr-pipeline` receives no further releases: replace `planr-pipeline` imports with `@openplanr/pipeline`, and `planr-pipeline` commands with `openplanr-pipeline`. OpenPlanr installs the new package as its optional dependency, so updating OpenPlanr is enough unless you import the pipeline directly. The `/planr-pipeline:` host commands are unchanged.
