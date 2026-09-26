---
'@openplanr/protocol': patch
---

Two contract declarations now describe what the module returns: `OPERATE_GOVERNED_CORE_PROHIBITIONS_V2` is a `readonly string[]` of prohibition ids and `findOperateCoreProhibitionV2` returns the matching id or `null` (both were declared as records), and `assertOperateRoleOutputContractV2` returns the mandate's advertised output contract with its resolved schema `path` rather than its input. Every `src/*.mjs` module is now type-checked against its `.d.mts` by the workspace `typecheck:declarations` gate.
