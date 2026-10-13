---
'@openplanr/protocol': patch
'planr-pipeline': patch
'@openplanr/artifact': patch
'openplanr': patch
---

The JSON Schema validator now enforces `exclusiveMinimum`, `maxProperties`, `dependentRequired` and `unevaluatedProperties`. Data that breaks these constraints in the packaged schemas is rejected. A schema keyword or `format` the validator doesn't support is now reported as an error instead of being ignored.
