---
'@openplanr/protocol': minor
'planr-pipeline': patch
---

Correct native role metadata to reference the generated Claude agents and their scoped identities. Keep all nine canonical roles and legacy aliases, mark QA and specification activation as conditional, and preserve task type and agent in prepared Ship context. Database inspection retains its read-only preflight meaning.
