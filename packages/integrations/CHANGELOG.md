# @openplanr/integrations

## 0.1.2

### Patch Changes

- e5cb862: `openplanr github` and `openplanr doctor` now start their child processes with a limited environment instead of the full one. `openplanr delegate prune` reports nothing to prune when no run has been recorded yet, and a missing run store gives a clear error elsewhere. Protocol v1 checks accept `executable`, and the environment hint after a failed apply appears only when a check failed for a missing toolchain.

## 0.1.1

### Patch Changes

- 625c09f: Drop Node.js 20, which reached end of life in April 2026. This is a breaking CLI change: `openplanr` now requires Node.js `^22.13.0 || >=23.5.0`, and the pipeline and Protocol require Node.js 22.13.0 or later.
  
  Run `node -v` to check your version. If it reports v20, or a 22 release below 22.13, install Node.js 24 LTS or Node.js 22.13 or later, then rerun the installer or `npm install --global openplanr`.
  
  On Node.js 20 the install scripts stop before installing anything with `E_NODE_VERSION: OpenPlanr requires Node.js ^22.13.0 || >=23.5.0; found v20.x.y.` `npm install --global openplanr` only warns about the engines range, and `openplanr` then stops before loading anything with `E_NODE_VERSION: OpenPlanr requires Node.js ^22.13.0 || >=23.5.0; found 20.x.y.` `openplanr-pipeline doctor` fails its Node.js check with `Node 20.x.y does not satisfy engines.node >=22.13.0`, and the delegate skill's probe reports that Node 22 or later is required.
