---
'openplanr': major
'planr-pipeline': minor
'@openplanr/protocol': minor
'@openplanr/artifact': patch
'@openplanr/design': patch
'@openplanr/integrations': patch
'@openplanr/operate': patch
'@openplanr/skill-runtime': patch
'@openplanr/dashboard-app': patch
---

Drop Node.js 20, which reached end of life in April 2026. This is a breaking CLI change: `openplanr` now requires Node.js `^22.13.0 || >=23.5.0`, and the pipeline and Protocol require Node.js 22.13.0 or later.

Run `node -v` to check your version. If it reports v20, or a 22 release below 22.13, install Node.js 24 LTS or Node.js 22.13 or later, then rerun the installer or `npm install --global openplanr`.

On Node.js 20 the install scripts stop before installing anything with `E_NODE_VERSION: OpenPlanr requires Node.js ^22.13.0 || >=23.5.0; found v20.x.y.` `npm install --global openplanr` only warns about the engines range, and `openplanr` then stops before loading anything with `E_NODE_VERSION: OpenPlanr requires Node.js ^22.13.0 || >=23.5.0; found 20.x.y.` `openplanr-pipeline doctor` fails its Node.js check with `Node 20.x.y does not satisfy engines.node >=22.13.0`, and the delegate skill's probe reports that Node 22 or later is required.
