---
'@openplanr/protocol': patch
'planr-pipeline': patch
---

`@openplanr/protocol/canonical-json` exports `deepFreeze` and `assertPlainData(value, label)`. The Protocol contracts, the Operate, artifact and design runtimes and the dashboard now use them instead of their own copies; what is frozen, what is rejected and every error message are unchanged.
