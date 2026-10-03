---
"openplanr": patch
"planr-pipeline": patch
"@openplanr/artifact": patch
"@openplanr/design": patch
---

Correct supported Node.js versions to match the installed production dependencies. The CLI now checks support before loading prompt modules and gives an actionable error in startup, setup, doctor, and installers. Pipeline, Artifact, and Design declare their parser's Node.js 20.19 minimum. Standalone Protocol retains its Node.js 20 import contract.
