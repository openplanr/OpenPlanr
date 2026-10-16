---
'openplanr': patch
---

The CLI now ships the Protocol spec, story and task schemas, so it validates planning frontmatter without the optional `planr-pipeline` package, for example after `install.sh --minimal`. Invalid frontmatter is rejected before anything is written.
