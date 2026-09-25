---
'@openplanr/protocol': patch
---

Protocol artifact validation no longer deep-clones the schema, and every `$ref` target, on each call. Each packaged schema is parsed and frozen once per process and validated in place. `resolveProtocolSchema` and `resolveOperateExperienceSchemaV2` still return a mutable copy, and validation results are unchanged.
