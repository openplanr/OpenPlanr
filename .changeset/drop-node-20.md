---
'openplanr': minor
'planr-pipeline': minor
'@openplanr/protocol': minor
'@openplanr/artifact': patch
'@openplanr/design': patch
'@openplanr/integrations': patch
'@openplanr/operate': patch
'@openplanr/skill-runtime': patch
'@openplanr/dashboard-app': patch
---

Node.js 20 is no longer supported; it reached end of life in April 2026. The `openplanr` CLI requires Node.js `^22.13.0 || >=23.5.0`, and the pipeline and Protocol require 22.13.0 or later. On Node.js 20 the installers and `openplanr` stop with `E_NODE_VERSION` before installing or loading anything, `openplanr-pipeline doctor` reports the runtime as unsupported, and the delegate skill's probe reports Node.js 22 or later as required. Upgrade Node.js, then rerun the installer or `npm install --global openplanr`.
