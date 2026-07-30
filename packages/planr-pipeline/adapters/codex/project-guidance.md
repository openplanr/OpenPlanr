<!-- openplanr:runtime:start -->
## OpenPlanr runtime policy

Use `.planr/runtime-lock.json` as the project compatibility contract and
`.planr/provenance.jsonl` as append-only producer history. Portable pipeline
procedures come from `planr-pipeline`; this file contains project policy only.

For guided Operating Board results, consume the installed `planr-operate` skill
and the CLI's schema-valid `questionnaire` and `actions`. Use a native question
tool only when the active runtime reports it; otherwise use an attached
CLI-owned interactive terminal, structured chat one question at a time, or the
CLI handoff. Never copy product questions into this project file or infer
authority from an answer. A bare skill invocation runs one complete cycle and
stops at review; explicit read-only subcommands remain read-only.

PLAN and SHIP are separate user actions. Use the installed `$planr-plan`,
`$planr-design`, `$planr-artifact`, `$planr-ship`, `$planr-dashboard`,
`$planr-sync`, and `$planr-doctor` skills. Artifact review must invoke the public
`planr artifact` route: generic HTML defaults to the headless `document`
presentation, while design boards and spatial variants use `canvas`. Respect
task dependency order, Preserve paths, the three-correction limit, and
frontend/backend ownership boundaries.
<!-- openplanr:runtime:end -->
