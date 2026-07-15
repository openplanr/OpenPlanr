<!-- openplanr:runtime:start -->
## OpenPlanr runtime policy

Use `.planr/runtime-lock.json` as the project compatibility contract and
`.planr/provenance.jsonl` as append-only producer history. Portable pipeline
procedures come from `planr-pipeline`; this file contains project policy only.

PLAN and SHIP are separate user actions. Use the installed `$planr-plan`,
`$planr-design`, `$planr-artifact`, `$planr-ship`, `$planr-dashboard`,
`$planr-sync`, and `$planr-doctor` skills. Artifact review must invoke the public
`planr artifact` route: generic HTML defaults to the headless `document`
presentation, while design boards and spatial variants use `canvas`. Respect
task dependency order, Preserve paths, the three-correction limit, and
frontend/backend ownership boundaries.
<!-- openplanr:runtime:end -->
